import type { ExtensionAPI, ToolInfo } from "@mariozechner/pi-coding-agent";
import type { McpExtensionState } from "./state.js";
import { Type } from "typebox";
import { showStatus, showTools, reconnectServers, authenticateServer, openMcpPanel, openMcpSetup } from "./commands.js";
import { loadMcpConfig } from "./config.js";
import { buildProxyDescription, createDirectToolExecutor, getMissingConfiguredDirectToolServers, resolveDirectTools } from "./direct-tools.js";
import { flushMetadataCache, initializeMcp, updateStatusBar } from "./init.js";
import { loadMetadataCache } from "./metadata-cache.js";
import { executeCall, executeConnect, executeDescribe, executeList, executeSearch, executeStatus, executeUiMessages } from "./proxy-modes.js";
import { getConfigPathFromArgv, truncateAtWord } from "./utils.js";
import { initializeOAuth, shutdownOAuth } from "./mcp-auth-flow.js";
import { McpCallComponent, McpResultComponent } from "./mcp-tool-renderer.js";
import { logger } from "./logger.js";

interface SharedMcpRuntime {
  state: McpExtensionState | null;
  initPromise: Promise<McpExtensionState> | null;
  lifecycleGeneration: number;
  activeSessions: number;
}

const sharedRuntime = ((globalThis as typeof globalThis & {
  __piMcpAdapterRuntime?: SharedMcpRuntime;
}).__piMcpAdapterRuntime ??= {
  state: null,
  initPromise: null,
  lifecycleGeneration: 0,
  activeSessions: 0,
});

type ProxyToolArgs = Record<string, unknown>;

function getJsonType(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

function normalizeProxyToolArgs(args: unknown): ProxyToolArgs {
  let normalized = args;
  if (typeof args === "string") {
    try {
      normalized = JSON.parse(args);
    } catch (error) {
      if (error instanceof SyntaxError) {
        throw new Error(`Invalid args JSON: ${error.message}`, { cause: error });
      }
      throw error;
    }
  }

  if (typeof normalized !== "object" || normalized === null || Array.isArray(normalized)) {
    throw new Error(`Invalid args: expected a JSON object, got ${getJsonType(normalized)}`);
  }

  return normalized as ProxyToolArgs;
}

function prepareMcpProxyArguments(raw: unknown) {
  if (!raw || typeof raw !== "object") return raw;

  const params = raw as { args?: unknown; [key: string]: unknown };
  if (params.args === undefined) return params;

  return {
    ...params,
    args: normalizeProxyToolArgs(params.args),
  };
}

export default function mcpAdapter(pi: ExtensionAPI) {
  let sessionAttached = false;

  async function getReadyState(): Promise<McpExtensionState | null> {
    if (sharedRuntime.state) return sharedRuntime.state;
    const promise = sharedRuntime.initPromise;
    if (!promise) return null;
    return promise;
  }

  async function shutdownState(currentState: McpExtensionState | null, reason: string): Promise<void> {
    if (!currentState) return;

    if (currentState.uiServer) {
      currentState.uiServer.close(reason);
      currentState.uiServer = null;
    }

    let flushError: unknown;
    try {
      flushMetadataCache(currentState);
    } catch (error) {
      flushError = error;
    }

    try {
      await currentState.lifecycle.gracefulShutdown();
    } catch (error) {
      if (flushError) {
        logger.error("MCP: graceful shutdown failed after metadata flush error", error instanceof Error ? error : new Error(String(error)));
      } else {
        throw error;
      }
    }

    if (flushError) {
      throw flushError;
    }
  }

  const earlyConfigPath = getConfigPathFromArgv();
  const earlyConfig = loadMcpConfig(earlyConfigPath);
  const earlyCache = loadMetadataCache();
  const prefix = earlyConfig.settings?.toolPrefix ?? "server";

  const envRaw = process.env.MCP_DIRECT_TOOLS;
  const directSpecs = envRaw === "__none__"
    ? []
    : resolveDirectTools(
        earlyConfig,
        earlyCache,
        prefix,
        envRaw?.split(",").map(s => s.trim()).filter(Boolean),
      );
  const missingConfiguredDirectToolServers = getMissingConfiguredDirectToolServers(earlyConfig, earlyCache);
  const shouldRegisterProxyTool =
    earlyConfig.settings?.disableProxyTool !== true
    || directSpecs.length === 0
    || missingConfiguredDirectToolServers.length > 0;

  for (const spec of directSpecs) {
    pi.registerTool({
      name: spec.prefixedName,
      label: `MCP: ${spec.originalName}`,
      description: spec.description || "(no description)",
      promptSnippet: truncateAtWord(spec.description, 100) || `MCP tool from ${spec.serverName}`,
      parameters: Type.Unsafe<Record<string, unknown>>(spec.inputSchema || { type: "object", properties: {} }),
      execute: createDirectToolExecutor(() => sharedRuntime.state, () => sharedRuntime.initPromise, spec),
      renderCall: (args, theme, context) => new McpCallComponent(
        `mcp → ${spec.serverName}/${spec.originalName}`,
        args,
        context?.expanded ?? false,
        theme,
        "direct",
      ),
      renderResult: (result, options, theme, context) => new McpResultComponent(result, options.expanded, context?.isError ?? false, theme),
    });
  }

  const getPiTools = (): ToolInfo[] => pi.getAllTools();

  pi.registerFlag("mcp-config", {
    description: "Path to MCP config file",
    type: "string",
  });

  function startInitialization(ctx: Parameters<Parameters<typeof pi.on>[1]>[1]) {
    const generation = ++sharedRuntime.lifecycleGeneration;
    const promise = initializeMcp(pi, ctx);
    sharedRuntime.initPromise = promise;

    promise.then(async (nextState) => {
      if (generation !== sharedRuntime.lifecycleGeneration || sharedRuntime.initPromise !== promise) {
        try {
          await shutdownState(nextState, "stale_session_start");
        } catch (error) {
          logger.error("MCP: failed to clean stale session state", error instanceof Error ? error : new Error(String(error)));
        }
        return;
      }

      sharedRuntime.state = nextState;
      updateStatusBar(nextState);
      sharedRuntime.initPromise = null;
    }).catch(err => {
      if (generation !== sharedRuntime.lifecycleGeneration) {
        return;
      }
      if (sharedRuntime.initPromise !== promise && sharedRuntime.initPromise !== null) {
        return;
      }
      logger.error("MCP initialization failed", err instanceof Error ? err : new Error(String(err)));
      sharedRuntime.initPromise = null;
    });
  }

  pi.on("session_start", async (_event, ctx) => {
    if (!sessionAttached) {
      sessionAttached = true;
      sharedRuntime.activeSessions += 1;

      if (sharedRuntime.state) {
        updateStatusBar(sharedRuntime.state);
        return;
      }
      if (sharedRuntime.initPromise) {
        return;
      }
    }

    const previousState = sharedRuntime.state;
    sharedRuntime.state = null;
    sharedRuntime.initPromise = null;

    try {
      await Promise.all([
        shutdownState(previousState, "session_restart"),
        shutdownOAuth(),
      ]);
    } catch (error) {
      logger.error("MCP: failed to shut down previous session state", error instanceof Error ? error : new Error(String(error)));
    }

    await initializeOAuth().catch(err => {
      logger.error("MCP OAuth initialization failed", err instanceof Error ? err : new Error(String(err)));
    });

    startInitialization(ctx);
  });

  pi.on("session_shutdown", async () => {
    if (sessionAttached) {
      sessionAttached = false;
      sharedRuntime.activeSessions = Math.max(0, sharedRuntime.activeSessions - 1);
    }

    if (sharedRuntime.activeSessions > 0) {
      return;
    }

    ++sharedRuntime.lifecycleGeneration;
    const currentState = sharedRuntime.state;
    sharedRuntime.state = null;
    sharedRuntime.initPromise = null;

    try {
      await Promise.all([
        shutdownState(currentState, "session_shutdown"),
        shutdownOAuth(),
      ]);
    } catch (error) {
      logger.error("MCP: session shutdown cleanup failed", error instanceof Error ? error : new Error(String(error)));
    }
  });

  pi.registerCommand("mcp", {
    description: "Show MCP server status",
    handler: async (args, ctx) => {
      let state: McpExtensionState | null;
      try {
        state = await getReadyState();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (ctx.hasUI) ctx.ui.notify(`MCP initialization failed: ${message}`, "error");
        return;
      }
      if (!state) {
        if (ctx.hasUI) ctx.ui.notify("MCP not initialized", "error");
        return;
      }

      const parts = args?.trim()?.split(/\s+/) ?? [];
      const subcommand = parts[0] ?? "";
      const targetServer = parts[1];

      switch (subcommand) {
        case "reconnect":
          await reconnectServers(state, ctx, targetServer);
          break;
        case "tools":
          await showTools(state, ctx);
          break;
        case "setup": {
          const result = await openMcpSetup(state, pi, ctx, earlyConfigPath, "setup");
          if (result?.configChanged) {
            await ctx.reload();
            return;
          }
          break;
        }
        case "status":
        case "":
        default:
          if (ctx.hasUI) {
            const result = await openMcpPanel(state, pi, ctx, earlyConfigPath);
            if (result?.configChanged) {
              await ctx.reload();
              return;
            }
          } else {
            await showStatus(state, ctx);
          }
          break;
      }
    },
  });

  pi.registerCommand("mcp-auth", {
    description: "Authenticate with an MCP server (OAuth)",
    handler: async (args, ctx) => {
      const serverName = args?.trim();
      if (!serverName) {
        if (ctx.hasUI) ctx.ui.notify("Usage: /mcp-auth <server-name>", "error");
        return;
      }

      let state: McpExtensionState | null;
      try {
        state = await getReadyState();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (ctx.hasUI) ctx.ui.notify(`MCP initialization failed: ${message}`, "error");
        return;
      }
      if (!state) {
        if (ctx.hasUI) ctx.ui.notify("MCP not initialized", "error");
        return;
      }

      await authenticateServer(serverName, state.config, ctx);
    },
  });

  if (shouldRegisterProxyTool) {
    pi.registerTool({
      name: "mcp",
      label: "MCP",
      description: buildProxyDescription(earlyConfig, earlyCache, directSpecs),
      promptSnippet: "MCP gateway - connect to MCP servers and call their tools",
      parameters: Type.Object({
        tool: Type.Optional(Type.String({ description: "Tool name to call (e.g., 'xcodebuild_list_sims')" })),
        args: Type.Optional(Type.Object({}, {
          additionalProperties: Type.Any(),
          description: "Arguments as an object; JSON string is also accepted for compatibility (e.g., {\"key\": \"value\"})",
        })),
        connect: Type.Optional(Type.String({ description: "Server name to connect (lazy connect + metadata refresh)" })),
        describe: Type.Optional(Type.String({ description: "Tool name to describe (shows parameters)" })),
        search: Type.Optional(Type.String({ description: "Search tools by name/description" })),
        regex: Type.Optional(Type.Boolean({ description: "Treat search as regex (default: substring match)" })),
        includeSchemas: Type.Optional(Type.Boolean({ description: "Include parameter schemas in search results (default: true)" })),
        server: Type.Optional(Type.String({ description: "Filter to specific server (also disambiguates tool calls)" })),
        action: Type.Optional(Type.String({ description: "Action: 'ui-messages' to retrieve prompts/intents from UI sessions" })),
      }),
      prepareArguments: prepareMcpProxyArguments,
      renderCall: (args, theme, context) => new McpCallComponent(
        "mcp",
        args,
        context?.expanded ?? false,
        theme,
        "proxy",
      ),
      renderResult: (result, options, theme, context) => new McpResultComponent(result, options.expanded, context?.isError ?? false, theme),
      async execute(_toolCallId, params: {
        tool?: string;
        args?: unknown;
        connect?: string;
        describe?: string;
        search?: string;
        regex?: boolean;
        includeSchemas?: boolean;
        server?: string;
        action?: string;
      }, signal, _onUpdate, _ctx) {
        const parsedArgs = params.args === undefined ? undefined : normalizeProxyToolArgs(params.args);

        let state: McpExtensionState | null;
        try {
          state = await getReadyState();
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          return {
            content: [{ type: "text" as const, text: `MCP initialization failed: ${message}` }],
            details: { error: "init_failed", message },
          };
        }
        if (!state) {
          return {
            content: [{ type: "text" as const, text: "MCP not initialized" }],
            details: { error: "not_initialized" },
          };
        }

        if (params.action === "ui-messages") {
          return executeUiMessages(state);
        }
        if (params.tool) {
          return executeCall(state, params.tool, parsedArgs, params.server, getPiTools, signal);
        }
        if (params.connect) {
          return executeConnect(state, params.connect, signal);
        }
        if (params.describe) {
          return executeDescribe(state, params.describe);
        }
        if (params.search) {
          return await executeSearch(state, params.search, params.regex, params.server, params.includeSchemas);
        }
        if (params.server) {
          return await executeList(state, params.server);
        }
        return executeStatus(state);
      },
    });
  }
}
