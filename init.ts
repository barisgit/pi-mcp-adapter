import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { McpExtensionState } from "./state.js";
import type { ToolMetadata } from "./types.js";
import { loadMcpConfig } from "./config.js";
import { ConsentManager } from "./consent-manager.js";
import { McpLifecycleManager } from "./lifecycle.js";
import {
  computeServerHash,
  isServerCacheStale,
  isServerCacheValid,
  loadMetadataCache,
  reconstructToolMetadata,
  saveMetadataCache,
  serializeResources,
  serializeResourceTemplates,
  serializeTools,
  type ServerCacheEntry,
} from "./metadata-cache.js";
import { McpServerManager } from "./server-manager.js";
import { logger } from "./logger.js";
import { buildToolMetadata, totalToolCount } from "./tool-metadata.js";
import { UiResourceHandler } from "./ui-resource-handler.js";
import { openUrl, parallelLimit } from "./utils.js";
import { getMissingConfiguredDirectToolServers } from "./direct-tools.js";
import { loadServerStatuses, updateServerStatus } from "./server-status.js";

const FAILURE_BACKOFF_MS = 60 * 1000;
// A server whose background metadata refresh failed (or needs a login) is
// retried at most this often, so startups do not keep probing it.
const METADATA_REFRESH_RETRY_MS = 24 * 60 * 60 * 1000;

export async function initializeMcp(
  pi: ExtensionAPI,
  ctx: ExtensionContext
): Promise<McpExtensionState> {
  const configPath = pi.getFlag("mcp-config") as string | undefined;
  const config = loadMcpConfig(configPath);

  const manager = new McpServerManager();
  const samplingAutoApprove = config.settings?.samplingAutoApprove === true;
  if (config.settings?.sampling !== false && (ctx.hasUI || samplingAutoApprove)) {
    manager.setSamplingConfig({
      autoApprove: samplingAutoApprove,
      ui: ctx.hasUI ? ctx.ui : undefined,
      modelRegistry: ctx.modelRegistry,
      getCurrentModel: () => ctx.model,
      getSignal: () => ctx.signal,
    });
  }
  // Always register an elicitation handler with auto-approve.
  // Pi already gates all MCP tool invocations behind its own consent layer, so a
  // second prompt at elicitation/create just causes servers like Computer Use to
  // stall or get "Method not found". Auto-approve unconditionally unless the user
  // explicitly disabled elicitation.
  if (config.settings?.elicitation !== false) {
    manager.setElicitationConfig({
      autoApprove: true,
      ui: ctx.hasUI ? ctx.ui : undefined,
    });
  }
  const lifecycle = new McpLifecycleManager(manager);
  const toolMetadata = new Map<string, ToolMetadata[]>();
  const failureTracker = new Map<string, number>();
  const uiResourceHandler = new UiResourceHandler(manager);
  const consentManager = new ConsentManager("once-per-server");
  const ui = ctx.hasUI ? ctx.ui : undefined;
  const state: McpExtensionState = {
    manager,
    lifecycle,
    toolMetadata,
    config,
    failureTracker,
    uiResourceHandler,
    consentManager,
    uiServer: null,
    completedUiSessions: [],
    sessionId: ctx.sessionManager.getSessionId(),
    openBrowser: (url: string) => openUrl(pi, url, process.env.BROWSER),
    ui,
    sendMessage: (message, options) => pi.sendMessage(message, options),
  };
  manager.setResourceListChangedCallback((serverName) => {
    updateServerMetadata(state, serverName);
    updateMetadataCache(state, serverName);
  });

  const serverEntries = Object.entries(config.mcpServers);
  if (serverEntries.length === 0) {
    return state;
  }

  const idleSetting = typeof config.settings?.idleTimeout === "number" ? config.settings.idleTimeout : 10;
  lifecycle.setGlobalIdleTimeout(idleSetting);

  const cache = loadMetadataCache();
  const prefix = config.settings?.toolPrefix ?? "server";

  for (const [name, definition] of serverEntries) {
    const lifecycleMode = definition.lifecycle ?? "lazy";
    const idleOverride = definition.idleTimeout ?? (lifecycleMode === "eager" ? 0 : undefined);
    lifecycle.registerServer(
      name,
      definition,
      idleOverride !== undefined ? { idleTimeout: idleOverride } : undefined
    );
    if (lifecycleMode === "keep-alive") {
      lifecycle.markKeepAlive(name, definition);
    }

    if (cache?.servers?.[name] && isServerCacheValid(cache.servers[name], definition)) {
      const metadata = reconstructToolMetadata(name, cache.servers[name], prefix, definition);
      toolMetadata.set(name, metadata);
    }
  }

  const startupServers = serverEntries.filter(([, definition]) => {
    const mode = definition.lifecycle ?? "lazy";
    return mode === "keep-alive" || mode === "eager";
  });

  if (ctx.hasUI && startupServers.length > 0) {
    ctx.ui.setStatus("mcp", `MCP: connecting to ${startupServers.length} servers...`);
  }

  const results = await parallelLimit(startupServers, 10, async ([name, definition]) => {
    try {
      const connection = await manager.connect(name, definition);
      if (connection.status === "needs-auth") {
        return { name, definition, connection: null, error: `OAuth authentication required. Run /mcp-auth ${name}.` };
      }
      return { name, definition, connection, error: null };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { name, definition, connection: null, error: message };
    }
  });

  for (const { name, definition, connection, error } of results) {
    if (error || !connection) {
      if (ctx.hasUI) {
        ctx.ui.notify(`MCP: Failed to connect to ${name}: ${error}`, "error");
      }
      logger.error(`MCP: Failed to connect to ${name}`, error instanceof Error ? error : new Error(String(error)));
      continue;
    }

    const { metadata, failedTools } = buildToolMetadata(connection.tools, connection.resources, definition, name, prefix);
    toolMetadata.set(name, metadata);
    updateMetadataCache(state, name);

    if (failedTools.length > 0 && ctx.hasUI) {
      ctx.ui.notify(
        `MCP: ${name} - ${failedTools.length} tools skipped`,
        "warning"
      );
    }
  }

  const connectedCount = results.filter(r => r.connection).length;
  const failedCount = results.filter(r => r.error).length;
  if (ctx.hasUI && connectedCount > 0) {
    const totalTools = totalToolCount(state);
    const msg = failedCount > 0
      ? `MCP: ${connectedCount}/${startupServers.length} servers connected (${totalTools} tools)`
      : `MCP: ${connectedCount} servers connected (${totalTools} tools)`;
    ctx.ui.notify(msg, "info");
  }

  lifecycle.setReconnectCallback((serverName) => {
    updateServerMetadata(state, serverName);
    updateMetadataCache(state, serverName);
    state.failureTracker.delete(serverName);
    updateStatusBar(state);
  });

  lifecycle.setIdleShutdownCallback((serverName) => {
    const idleMinutes = getEffectiveIdleTimeoutMinutes(state, serverName);
    logger.debug(`${serverName} shut down (idle ${idleMinutes}m)`);
    updateStatusBar(state);
  });

  lifecycle.startHealthChecks();

  const directToolServersMissingCache = process.env.MCP_DIRECT_TOOLS === "__none__"
    ? []
    : getMissingConfiguredDirectToolServers(config, cache);
  // Not awaited: tools must be usable while slow or failing servers are probed.
  void refreshStaleMetadata(state, directToolServersMissingCache).catch(error => {
    logger.error("MCP: background metadata refresh failed", error instanceof Error ? error : new Error(String(error)));
  });

  return state;
}

/**
 * Connect in the background to servers whose cached metadata is missing or stale,
 * so their tools stay searchable without connecting every server on every startup.
 * Servers that fail or need a login are retried at most once per
 * METADATA_REFRESH_RETRY_MS. Lazy servers connected here are closed by the normal
 * idle timeout. Ends by reporting servers that need a login.
 */
async function refreshStaleMetadata(state: McpExtensionState, directToolServersMissingCache: string[]): Promise<void> {
  const cache = loadMetadataCache();
  const statuses = loadServerStatuses();
  const now = Date.now();

  const targets = Object.entries(state.config.mcpServers).filter(([name, definition]) => {
    if (state.manager.getConnection(name)) return false;

    const entry = cache?.servers?.[name];
    if (entry && isServerCacheValid(entry, definition) && !isServerCacheStale(entry, now)) return false;

    const lastAttemptAt = statuses[name]?.lastRefreshAttemptAt ?? 0;
    return now - lastAttemptAt >= METADATA_REFRESH_RETRY_MS;
  });

  const refreshed = await parallelLimit(targets, 10, async ([name, definition]) => {
    // The session may have ended while earlier servers were being probed.
    if (state.closed) return null;

    updateServerStatus(name, { lastRefreshAttemptAt: Date.now() });
    try {
      const connection = await state.manager.connect(name, definition);
      if (connection.status !== "connected") return null;
      updateServerMetadata(state, name);
      updateMetadataCache(state, name);
      return name;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.debug(`MCP: background metadata refresh failed for ${name}: ${message}`);
      return null;
    }
  });

  if (state.closed) return;
  updateStatusBar(state);

  const ui = state.ui;
  if (!ui) return;

  const directToolsReady = refreshed.filter((name): name is string => name !== null && directToolServersMissingCache.includes(name));
  if (directToolsReady.length > 0) {
    ui.notify(`MCP: direct tools for ${directToolsReady.join(", ")} will be available after restart`, "info");
  }

  const needsAuth = getServersNeedingAuth(state);
  if (needsAuth.length > 0) {
    ui.notify(`MCP: login required for ${needsAuth.join(", ")}. Run /mcp-auth to sign in.`, "warning");
  }
}

/**
 * Servers that need an OAuth login: those refused in this session, plus those
 * refused in an earlier session and not connected since.
 */
export function getServersNeedingAuth(state: McpExtensionState): string[] {
  const statuses = loadServerStatuses();
  return Object.keys(state.config.mcpServers).filter(name => {
    const status = state.manager.getConnection(name)?.status;
    if (status === "needs-auth") return true;
    if (status === "connected") return false;
    return statuses[name]?.needsAuth === true;
  });
}

export function updateServerMetadata(state: McpExtensionState, serverName: string): void {
  const connection = state.manager.getConnection(serverName);
  if (!connection || connection.status !== "connected") return;

  const definition = state.config.mcpServers[serverName];
  if (!definition) return;

  const prefix = state.config.settings?.toolPrefix ?? "server";

  const { metadata } = buildToolMetadata(connection.tools, connection.resources, definition, serverName, prefix);
  state.toolMetadata.set(serverName, metadata);
}

export function updateMetadataCache(state: McpExtensionState, serverName: string): void {
  const connection = state.manager.getConnection(serverName);
  if (!connection || connection.status !== "connected") return;

  const definition = state.config.mcpServers[serverName];
  if (!definition) return;

  const configHash = computeServerHash(definition);
  const tools = serializeTools(connection.tools);
  const resources = definition.exposeResources === false ? [] : serializeResources(connection.resources);
  const resourceTemplates = definition.exposeResources === false
    ? []
    : serializeResourceTemplates(connection.resourceTemplates);

  const entry: ServerCacheEntry = {
    configHash,
    tools,
    resources,
    resourceTemplates,
    cachedAt: Date.now(),
  };

  saveMetadataCache({ version: 1, servers: { [serverName]: entry } });
}

export function flushMetadataCache(state: McpExtensionState): void {
  for (const [name, connection] of state.manager.getAllConnections()) {
    if (connection.status === "connected") {
      updateMetadataCache(state, name);
    }
  }
}

export function updateStatusBar(state: McpExtensionState): void {
  const ui = state.ui;
  if (!ui) return;
  const total = Object.keys(state.config.mcpServers).length;
  if (total === 0) {
    ui.setStatus("mcp", undefined);
    return;
  }

  const connectedCount = [...state.manager.getAllConnections().values()]
    .filter(connection => connection.status === "connected")
    .length;
  let text = ui.theme.fg("accent", `MCP: ${connectedCount}/${total} servers`);

  const needsAuthCount = getServersNeedingAuth(state).length;
  if (needsAuthCount > 0) {
    text += ui.theme.fg("warning", ` · ${needsAuthCount} need login`);
  }
  ui.setStatus("mcp", text);
}

export function getFailureAgeSeconds(state: McpExtensionState, serverName: string): number | null {
  const failedAt = state.failureTracker.get(serverName);
  if (!failedAt) return null;
  const ageMs = Date.now() - failedAt;
  if (ageMs > FAILURE_BACKOFF_MS) return null;
  return Math.round(ageMs / 1000);
}

export async function lazyConnect(state: McpExtensionState, serverName: string): Promise<boolean> {
  const connection = state.manager.getConnection(serverName);
  if (connection?.status === "needs-auth") {
    return false;
  }
  if (connection?.status === "connected") {
    updateServerMetadata(state, serverName);
    return true;
  }

  const failedAgo = getFailureAgeSeconds(state, serverName);
  if (failedAgo !== null) return false;

  const definition = state.config.mcpServers[serverName];
  if (!definition) return false;

  try {
    if (state.ui) {
      state.ui.setStatus("mcp", `MCP: connecting to ${serverName}...`);
    }
    const newConnection = await state.manager.connect(serverName, definition);
    if (newConnection.status === "needs-auth") {
      return false;
    }
    state.failureTracker.delete(serverName);
    updateServerMetadata(state, serverName);
    updateMetadataCache(state, serverName);
    updateStatusBar(state);
    return true;
  } catch (error) {
    state.failureTracker.set(serverName, Date.now());
    const message = error instanceof Error ? error.message : String(error);
    logger.debug(`MCP: lazy connect failed for ${serverName}: ${message}`);
    updateStatusBar(state);
    return false;
  }
}

function getEffectiveIdleTimeoutMinutes(state: McpExtensionState, serverName: string): number {
  const definition = state.config.mcpServers[serverName];
  if (!definition) {
    return typeof state.config.settings?.idleTimeout === "number" ? state.config.settings.idleTimeout : 10;
  }
  if (typeof definition.idleTimeout === "number") return definition.idleTimeout;
  const mode = definition.lifecycle ?? "lazy";
  if (mode === "eager") return 0;
  return typeof state.config.settings?.idleTimeout === "number" ? state.config.settings.idleTimeout : 10;
}
