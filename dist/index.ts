import {
  ConsentError,
  ResourceFetchError,
  ResourceParseError,
  buildMcpRequestMeta,
  logger
} from "./chunk-UR763VA2.ts";
import {
  resourceContentsToBlocks,
  resourceToolBaseNames
} from "./chunk-I4BZXY6U.ts";
import {
  UI_STREAM_HOST_CONTEXT_KEY,
  UI_STREAM_REQUEST_META_KEY,
  UI_STREAM_STRUCTURED_CONTENT_KEY,
  extractUiPromptText,
  formatToolName,
  getEffectiveToolDescription,
  getServerPrefix,
  isToolExcluded,
  parseUiPromptHandoff,
  serverStreamResultPatchNotificationSchema
} from "./chunk-VDZJM7QN.ts";

// index.ts
import { Type } from "typebox";

// commands.ts
import { BorderedLoader } from "@earendil-works/pi-coding-agent";

// config.ts
import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, renameSync, writeFileSync } from "node:fs";
import { homedir as homedir2 } from "node:os";
import { dirname, join as join2, resolve as resolve2 } from "node:path";

// agent-dir.ts
import { homedir } from "node:os";
import { join, resolve } from "node:path";
function getAgentDir() {
  const configured = process.env.PI_CODING_AGENT_DIR?.trim();
  if (!configured) {
    return join(homedir(), ".pi", "agent");
  }
  if (configured === "~") {
    return homedir();
  }
  if (configured.startsWith("~/")) {
    return resolve(homedir(), configured.slice(2));
  }
  return resolve(configured);
}
function getAgentPath(...segments) {
  return join(getAgentDir(), ...segments);
}

// config.ts
var GENERIC_GLOBAL_CONFIG_PATH = join2(homedir2(), ".config", "mcp", "mcp.json");
var PROJECT_CONFIG_NAME = ".mcp.json";
var PROJECT_PI_CONFIG_NAME = ".pi/mcp.json";
var REPOPROMPT_BINARY_CANDIDATES = [
  join2(homedir2(), "RepoPrompt", "repoprompt_cli"),
  "/Applications/Repo Prompt.app/Contents/MacOS/repoprompt-mcp"
];
var IMPORT_PATHS = {
  cursor: [join2(homedir2(), ".cursor", "mcp.json")],
  "claude-code": [
    join2(homedir2(), ".claude", "mcp.json"),
    join2(homedir2(), ".claude.json"),
    join2(homedir2(), ".claude", "claude_desktop_config.json")
  ],
  "claude-desktop": [join2(homedir2(), "Library", "Application Support", "Claude", "claude_desktop_config.json")],
  codex: [join2(homedir2(), ".codex", "config.json")],
  windsurf: [join2(homedir2(), ".windsurf", "mcp.json")],
  vscode: [".vscode/mcp.json"]
};
function getPiGlobalConfigPath(overridePath) {
  return overridePath ? resolve2(overridePath) : getAgentPath("mcp.json");
}
function getProjectConfigPath(cwd = process.cwd()) {
  return resolve2(cwd, PROJECT_CONFIG_NAME);
}
function getProjectPiConfigPath(cwd = process.cwd()) {
  return resolve2(cwd, PROJECT_PI_CONFIG_NAME);
}
function getMcpDiscoverySummary(overridePath, cwd = process.cwd()) {
  const sources = getConfigSources(overridePath, cwd).map((source) => {
    const loaded = readValidatedConfig(source.readPath, `MCP config from ${source.readPath}`);
    return {
      id: source.id,
      label: source.label,
      path: source.readPath,
      exists: existsSync(source.readPath),
      scope: source.scope,
      kind: source.shared ? "shared" : "pi",
      serverCount: loaded ? Object.keys(loaded.mcpServers).length : 0
    };
  });
  const imports = Object.keys(IMPORT_PATHS).map((kind) => {
    const path = resolveImportPath(kind, cwd);
    if (!path) return null;
    return {
      kind,
      path,
      serverCount: getImportServerCount(kind, path)
    };
  }).filter((value) => value !== null);
  const totalServerCount = sources.reduce((sum, source) => sum + source.serverCount, 0);
  const hasSharedServers = sources.some((source) => source.kind === "shared" && source.serverCount > 0);
  const hasPiOwnedServers = sources.some((source) => source.kind === "pi" && source.serverCount > 0);
  const hasAnyDetectedPaths = sources.some((source) => source.exists) || imports.length > 0;
  const hasAnyConfig = totalServerCount > 0 || imports.some((entry) => entry.serverCount > 0) || hasAnyDetectedPaths;
  const summaryWithoutRepoPrompt = {
    sources,
    imports,
    hasAnyConfig,
    hasAnyDetectedPaths,
    hasSharedServers,
    hasPiOwnedServers,
    totalServerCount
  };
  const fingerprint = JSON.stringify({
    sources: sources.map((source) => [source.id, source.exists, source.serverCount]),
    imports: imports.map((entry) => [entry.kind, entry.path, entry.serverCount])
  });
  return {
    ...summaryWithoutRepoPrompt,
    fingerprint,
    repoPrompt: detectRepoPrompt(summaryWithoutRepoPrompt, cwd)
  };
}
function loadMcpConfig(overridePath) {
  let config = { mcpServers: {} };
  for (const source of getConfigSources(overridePath)) {
    const loaded = readValidatedConfig(source.readPath, `MCP config from ${source.readPath}`);
    if (!loaded) continue;
    config = mergeConfigs(config, expandImports(loaded));
  }
  return config;
}
function getConfigSources(overridePath, cwd = process.cwd()) {
  const userPath = getPiGlobalConfigPath(overridePath);
  const projectPath = getProjectConfigPath(cwd);
  const projectPiPath = getProjectPiConfigPath(cwd);
  const sources = [];
  if (GENERIC_GLOBAL_CONFIG_PATH !== userPath) {
    sources.push({
      id: "shared-global",
      label: "user-global standard MCP",
      readPath: GENERIC_GLOBAL_CONFIG_PATH,
      writePath: userPath,
      kind: "import",
      importKind: "global MCP config",
      shared: true,
      scope: "global"
    });
  }
  sources.push({
    id: "pi-global",
    label: "Pi global override",
    readPath: userPath,
    writePath: userPath,
    kind: "user",
    shared: false,
    scope: "global"
  });
  if (projectPath !== userPath) {
    sources.push({
      id: "shared-project",
      label: "project standard MCP",
      readPath: projectPath,
      writePath: projectPath,
      kind: "project",
      shared: true,
      scope: "project"
    });
  }
  if (projectPiPath !== userPath && projectPiPath !== projectPath) {
    sources.push({
      id: "pi-project",
      label: "project Pi override",
      readPath: projectPiPath,
      writePath: projectPiPath,
      kind: "project",
      shared: false,
      scope: "project"
    });
  }
  return sources;
}
function mergeConfigs(base, next) {
  return {
    mcpServers: { ...base.mcpServers, ...next.mcpServers },
    imports: mergeImports(base.imports, next.imports),
    settings: next.settings ? { ...base.settings, ...next.settings } : base.settings
  };
}
function mergeImports(left, right) {
  const merged = [...left ?? [], ...right ?? []];
  if (merged.length === 0) return void 0;
  return [...new Set(merged)];
}
function expandImports(config) {
  if (!config.imports?.length) return config;
  const importedServers = {};
  for (const importKind of config.imports) {
    const importPath = resolveImportPath(importKind);
    if (!importPath) continue;
    try {
      const imported = JSON.parse(readFileSync(importPath, "utf-8"));
      const servers = extractServers(imported, importKind);
      for (const [name, definition] of Object.entries(servers)) {
        if (!importedServers[name]) {
          importedServers[name] = definition;
        }
      }
    } catch (error) {
      logger.warn(`Failed to import MCP config from ${importKind}`, { error: error instanceof Error ? error.message : String(error) });
    }
  }
  return {
    imports: config.imports,
    settings: config.settings,
    mcpServers: { ...importedServers, ...config.mcpServers }
  };
}
function resolveImportPath(importKind, cwd = process.cwd()) {
  const candidates = IMPORT_PATHS[importKind] ?? [];
  for (const candidate of candidates) {
    const fullPath = candidate.startsWith(".") ? resolve2(cwd, candidate) : candidate;
    if (existsSync(fullPath)) {
      return fullPath;
    }
  }
  return null;
}
function getImportServerCount(importKind, path) {
  try {
    const raw = JSON.parse(readFileSync(path, "utf-8"));
    return Object.keys(extractServers(raw, importKind)).length;
  } catch {
    return 0;
  }
}
function readValidatedConfig(path, label) {
  if (!existsSync(path)) return null;
  try {
    return validateConfig(JSON.parse(readFileSync(path, "utf-8")));
  } catch (error) {
    logger.warn(`Failed to load ${label}`, { error: error instanceof Error ? error.message : String(error) });
    return null;
  }
}
function validateConfig(raw) {
  if (!raw || typeof raw !== "object") {
    return { mcpServers: {} };
  }
  const obj = raw;
  const servers = obj.mcpServers ?? obj["mcp-servers"] ?? {};
  if (typeof servers !== "object" || servers === null || Array.isArray(servers)) {
    return { mcpServers: {} };
  }
  const normalizedServers = {};
  for (const [name, server2] of Object.entries(servers)) {
    if (!server2 || typeof server2 !== "object" || Array.isArray(server2)) continue;
    const definition = { ...server2 };
    if (definition.toolOverrides !== void 0) {
      const overrides = {};
      if (definition.toolOverrides && typeof definition.toolOverrides === "object" && !Array.isArray(definition.toolOverrides)) {
        for (const [toolName, override] of Object.entries(definition.toolOverrides)) {
          if (override && typeof override === "object" && !Array.isArray(override) && typeof override.description === "string") {
            overrides[toolName] = { description: override.description };
          }
        }
      }
      definition.toolOverrides = overrides;
    }
    normalizedServers[name] = definition;
  }
  return {
    mcpServers: normalizedServers,
    imports: Array.isArray(obj.imports) ? obj.imports : void 0,
    settings: obj.settings
  };
}
function extractServers(config, kind) {
  if (!config || typeof config !== "object") return {};
  const obj = config;
  let servers;
  switch (kind) {
    case "claude-desktop":
    case "claude-code":
    case "codex":
      servers = obj.mcpServers;
      break;
    case "cursor":
    case "windsurf":
    case "vscode":
      servers = obj.mcpServers ?? obj["mcp-servers"];
      break;
    default:
      return {};
  }
  if (!servers || typeof servers !== "object" || Array.isArray(servers)) {
    return {};
  }
  return servers;
}
function serializeRawConfig(raw) {
  return `${JSON.stringify(raw, null, 2)}
`;
}
function buildUnifiedDiff(beforeText, afterText) {
  if (beforeText === afterText) return "(no changes)";
  const before = beforeText.split("\n");
  const after = afterText.split("\n");
  const rows = before.length;
  const cols = after.length;
  const lcs = Array.from({ length: rows + 1 }, () => Array(cols + 1).fill(0));
  for (let i2 = rows - 1; i2 >= 0; i2--) {
    for (let j2 = cols - 1; j2 >= 0; j2--) {
      lcs[i2][j2] = before[i2] === after[j2] ? lcs[i2 + 1][j2 + 1] + 1 : Math.max(lcs[i2 + 1][j2], lcs[i2][j2 + 1]);
    }
  }
  const lines = ["--- before", "+++ after"];
  let i = 0;
  let j = 0;
  while (i < rows || j < cols) {
    if (i < rows && j < cols && before[i] === after[j]) {
      lines.push(`  ${before[i]}`);
      i++;
      j++;
      continue;
    }
    if (j < cols && (i === rows || lcs[i][j + 1] >= lcs[i + 1][j])) {
      lines.push(`+ ${after[j]}`);
      j++;
      continue;
    }
    if (i < rows) {
      lines.push(`- ${before[i]}`);
      i++;
    }
  }
  return lines.join("\n");
}
function buildConfigWritePreview(filePath, nextRaw) {
  const existed = existsSync(filePath);
  const beforeRaw = readRawConfigObject(filePath);
  const beforeText = existed ? serializeRawConfig(beforeRaw) : "";
  const afterText = serializeRawConfig(nextRaw);
  return {
    path: filePath,
    existed,
    changed: beforeText !== afterText,
    beforeText,
    afterText,
    diffText: buildUnifiedDiff(beforeText, afterText)
  };
}
function readRawConfigObject(filePath) {
  if (!existsSync(filePath)) return {};
  try {
    const raw = JSON.parse(readFileSync(filePath, "utf-8"));
    return raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  } catch {
    return {};
  }
}
function writeRawConfigObject(filePath, raw) {
  let writePath = filePath;
  try {
    if (lstatSync(filePath).isSymbolicLink()) writePath = realpathSync(filePath);
  } catch {
  }
  mkdirSync(dirname(writePath), { recursive: true });
  const tmpPath = `${writePath}.${process.pid}.tmp`;
  writeFileSync(tmpPath, `${JSON.stringify(raw, null, 2)}
`, "utf-8");
  renameSync(tmpPath, writePath);
}
function getServersObject(raw) {
  const existing = raw.mcpServers ?? raw["mcp-servers"] ?? {};
  if (!existing || typeof existing !== "object" || Array.isArray(existing)) {
    return {};
  }
  return existing;
}
function setServersObject(raw, servers) {
  delete raw["mcp-servers"];
  raw.mcpServers = servers;
}
function isRepoPromptServer(name, entry) {
  const normalizedName = name.toLowerCase();
  if (normalizedName.includes("repoprompt") || normalizedName === "rp") {
    return true;
  }
  const command = entry.command?.toLowerCase() ?? "";
  if (command.includes("repoprompt") || command.includes("rp-mcp") || command.endsWith("repoprompt_cli")) {
    return true;
  }
  return (entry.args ?? []).some((arg) => typeof arg === "string" && arg.toLowerCase().includes("repoprompt"));
}
function findProjectRoot(cwd = process.cwd()) {
  let current = resolve2(cwd);
  while (true) {
    if (existsSync(join2(current, ".git")) || existsSync(join2(current, "package.json")) || existsSync(join2(current, PROJECT_CONFIG_NAME)) || existsSync(join2(current, ".pi"))) {
      return current;
    }
    const parent = dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}
function buildRepoPromptEntry(executablePath) {
  return {
    command: executablePath,
    args: [],
    lifecycle: "lazy"
  };
}
function detectRepoPrompt(summary, cwd = process.cwd()) {
  for (const source of summary.sources) {
    if (source.kind !== "shared" || source.serverCount === 0) continue;
    const config = readValidatedConfig(source.path, `MCP config from ${source.path}`);
    if (!config) continue;
    for (const [name, entry] of Object.entries(config.mcpServers)) {
      if (isRepoPromptServer(name, entry)) {
        return { configured: true, configuredPath: source.path };
      }
    }
  }
  const executablePath = REPOPROMPT_BINARY_CANDIDATES.find((candidate) => existsSync(candidate));
  if (!executablePath) {
    return { configured: false };
  }
  const projectRoot = findProjectRoot(cwd);
  const targetPath = projectRoot ? join2(projectRoot, PROJECT_CONFIG_NAME) : GENERIC_GLOBAL_CONFIG_PATH;
  return {
    configured: false,
    executablePath,
    targetPath,
    serverName: "repoprompt",
    entry: buildRepoPromptEntry(executablePath)
  };
}
function previewCompatibilityImports(importKinds, overridePath) {
  const targetPath = getPiGlobalConfigPath(overridePath);
  const raw = readRawConfigObject(targetPath);
  const currentImports = Array.isArray(raw.imports) ? raw.imports.filter((value) => typeof value === "string") : [];
  const merged = [.../* @__PURE__ */ new Set([...currentImports, ...importKinds])];
  const nextRaw = { ...raw, imports: merged };
  setServersObject(nextRaw, getServersObject(nextRaw));
  return buildConfigWritePreview(targetPath, nextRaw);
}
function ensureCompatibilityImports(importKinds, overridePath) {
  const targetPath = getPiGlobalConfigPath(overridePath);
  const raw = readRawConfigObject(targetPath);
  const currentImports = Array.isArray(raw.imports) ? raw.imports.filter((value) => typeof value === "string") : [];
  const merged = [.../* @__PURE__ */ new Set([...currentImports, ...importKinds])];
  const added = merged.filter((kind) => !currentImports.includes(kind));
  if (added.length === 0) {
    return { path: targetPath, added: [] };
  }
  raw.imports = merged;
  const servers = getServersObject(raw);
  setServersObject(raw, servers);
  writeRawConfigObject(targetPath, raw);
  return { path: targetPath, added };
}
function buildStarterProjectConfig() {
  return {
    mcpServers: {}
  };
}
function previewStarterProjectConfig(cwd = process.cwd()) {
  const targetPath = getProjectConfigPath(cwd);
  const nextRaw = { mcpServers: buildStarterProjectConfig().mcpServers };
  return buildConfigWritePreview(targetPath, nextRaw);
}
function writeStarterProjectConfig(cwd = process.cwd()) {
  const targetPath = getProjectConfigPath(cwd);
  const raw = { mcpServers: buildStarterProjectConfig().mcpServers };
  writeRawConfigObject(targetPath, raw);
  return targetPath;
}
function previewSharedServerEntry(filePath, serverName, entry) {
  const raw = readRawConfigObject(filePath);
  const nextRaw = { ...raw };
  const servers = getServersObject(nextRaw);
  servers[serverName] = entry;
  setServersObject(nextRaw, servers);
  return buildConfigWritePreview(filePath, nextRaw);
}
function writeSharedServerEntry(filePath, serverName, entry) {
  const raw = readRawConfigObject(filePath);
  const servers = getServersObject(raw);
  servers[serverName] = entry;
  setServersObject(raw, servers);
  writeRawConfigObject(filePath, raw);
  return filePath;
}
function getServerProvenance(overridePath) {
  const provenance = /* @__PURE__ */ new Map();
  const userPath = getPiGlobalConfigPath(overridePath);
  for (const source of getConfigSources(overridePath)) {
    const loaded = readValidatedConfig(source.readPath, `MCP config from ${source.readPath}`);
    if (!loaded) continue;
    if (loaded.imports?.length) {
      for (const importKind of loaded.imports) {
        const importPath = resolveImportPath(importKind);
        if (!importPath) continue;
        try {
          const imported = JSON.parse(readFileSync(importPath, "utf-8"));
          const servers = extractServers(imported, importKind);
          for (const name of Object.keys(servers)) {
            if (!provenance.has(name)) {
              provenance.set(name, { path: userPath, kind: "import", importKind });
            }
          }
        } catch {
        }
      }
    }
    for (const name of Object.keys(loaded.mcpServers)) {
      provenance.set(name, {
        path: source.writePath,
        kind: source.kind,
        importKind: source.importKind
      });
    }
  }
  return provenance;
}
function writePromotedToolsConfig(changes, provenance, fullConfig) {
  const byPath = /* @__PURE__ */ new Map();
  for (const [serverName, value] of changes) {
    const prov = provenance.get(serverName);
    if (!prov) continue;
    const targetPath = prov.path;
    if (!byPath.has(targetPath)) byPath.set(targetPath, []);
    byPath.get(targetPath).push({ name: serverName, value, prov });
  }
  for (const [filePath, entries] of byPath) {
    const raw = readRawConfigObject(filePath);
    const servers = getServersObject(raw);
    for (const { name, value, prov } of entries) {
      if (prov.kind === "import") {
        const fullDef = fullConfig.mcpServers[name];
        const base = servers[name] ?? (value.length > 0 ? fullDef : void 0);
        if (base) {
          const next = { ...base };
          if (value.length === 0) delete next.promotedTools;
          else next.promotedTools = value;
          servers[name] = next;
        }
      } else if (servers[name]) {
        const next = { ...servers[name] };
        if (value.length === 0) delete next.promotedTools;
        else next.promotedTools = value;
        servers[name] = next;
      }
    }
    setServersObject(raw, servers);
    writeRawConfigObject(filePath, raw);
  }
}

// consent-manager.ts
var ConsentManager = class {
  constructor(mode = "once-per-server") {
    this.mode = mode;
    this.log.debug("Initialized", { mode });
  }
  mode;
  approvedServers = /* @__PURE__ */ new Set();
  deniedServers = /* @__PURE__ */ new Set();
  log = logger.child({ component: "ConsentManager" });
  requiresPrompt(serverName) {
    if (this.mode === "never") return false;
    if (this.deniedServers.has(serverName)) return true;
    if (this.mode === "always") return true;
    return !this.approvedServers.has(serverName);
  }
  shouldCacheConsent() {
    return this.mode !== "always";
  }
  registerDecision(serverName, approved) {
    this.deniedServers.delete(serverName);
    this.approvedServers.delete(serverName);
    if (approved) {
      this.approvedServers.add(serverName);
      this.log.debug("Consent granted", { server: serverName });
      return;
    }
    this.deniedServers.add(serverName);
    this.log.debug("Consent denied", { server: serverName });
  }
  ensureApproved(serverName) {
    if (this.mode === "never") return;
    if (this.deniedServers.has(serverName)) {
      throw new ConsentError(serverName, { denied: true });
    }
    if (!this.approvedServers.has(serverName)) {
      throw new ConsentError(serverName, { requiresApproval: true });
    }
    if (this.mode === "always") {
      this.approvedServers.delete(serverName);
    }
  }
  clear(serverName) {
    if (serverName) {
      this.approvedServers.delete(serverName);
      this.deniedServers.delete(serverName);
      this.log.debug("Cleared consent for server", { server: serverName });
      return;
    }
    this.approvedServers.clear();
    this.deniedServers.clear();
    this.log.debug("Cleared all consent records");
  }
};

// lifecycle.ts
var McpLifecycleManager = class {
  manager;
  keepAliveServers = /* @__PURE__ */ new Map();
  allServers = /* @__PURE__ */ new Map();
  serverSettings = /* @__PURE__ */ new Map();
  globalIdleTimeout = 10 * 60 * 1e3;
  healthCheckInterval;
  onReconnect;
  onIdleShutdown;
  constructor(manager) {
    this.manager = manager;
  }
  /**
   * Set callback to be invoked after a successful auto-reconnect.
   * Use this to update tool metadata when a server reconnects.
   */
  setReconnectCallback(callback) {
    this.onReconnect = callback;
  }
  markKeepAlive(name, definition) {
    this.keepAliveServers.set(name, definition);
  }
  registerServer(name, definition, settings) {
    this.allServers.set(name, definition);
    if (settings?.idleTimeout !== void 0) {
      this.serverSettings.set(name, settings);
    }
  }
  setGlobalIdleTimeout(minutes) {
    this.globalIdleTimeout = minutes * 60 * 1e3;
  }
  setIdleShutdownCallback(callback) {
    this.onIdleShutdown = callback;
  }
  startHealthChecks(intervalMs = 3e4) {
    this.healthCheckInterval = setInterval(() => {
      this.checkConnections();
    }, intervalMs);
    this.healthCheckInterval.unref();
  }
  async checkConnections() {
    for (const [name, definition] of this.keepAliveServers) {
      const connection = this.manager.getConnection(name);
      if (!connection || connection.status !== "connected") {
        try {
          await this.manager.connect(name, definition);
          logger.debug(`Reconnected to ${name}`);
          this.onReconnect?.(name);
        } catch (error) {
          logger.error(`MCP: Failed to reconnect to ${name}`, error instanceof Error ? error : new Error(String(error)));
        }
      }
    }
    for (const [name] of this.allServers) {
      if (this.keepAliveServers.has(name)) continue;
      const timeout = this.getIdleTimeout(name);
      if (timeout > 0 && this.manager.isIdle(name, timeout)) {
        await this.manager.close(name);
        this.onIdleShutdown?.(name);
      }
    }
  }
  getIdleTimeout(name) {
    const perServer = this.serverSettings.get(name)?.idleTimeout;
    if (perServer !== void 0) return perServer * 60 * 1e3;
    return this.globalIdleTimeout;
  }
  async gracefulShutdown() {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
    }
    await this.manager.closeAll();
  }
};

// metadata-cache.ts
import { existsSync as existsSync2, readFileSync as readFileSync2, writeFileSync as writeFileSync2, renameSync as renameSync2, mkdirSync as mkdirSync2 } from "node:fs";
import { dirname as dirname2 } from "node:path";
import { createHash } from "node:crypto";
import { getToolUiResourceUri } from "@modelcontextprotocol/ext-apps/app-bridge";

// utils.ts
import { homedir as homedir3, platform } from "node:os";
import { join as join3 } from "node:path";
async function execOpen(pi, target, browser) {
  const os = platform();
  if (os === "darwin") {
    return browser ? pi.exec("open", ["-a", browser, target]) : pi.exec("open", [target]);
  }
  if (os === "win32") {
    return browser ? pi.exec("cmd", ["/c", "start", "", browser, target]) : pi.exec("cmd", ["/c", "start", "", target]);
  }
  return browser ? pi.exec(browser, [target]) : pi.exec("xdg-open", [target]);
}
async function openUrl(pi, url, browser) {
  const result = await execOpen(pi, url, browser);
  if (result.code !== 0) {
    throw new Error(result.stderr || `Failed to open browser (exit code ${result.code})`);
  }
}
async function openPath(pi, targetPath) {
  const result = await execOpen(pi, targetPath);
  if (result.code !== 0) {
    throw new Error(result.stderr || `Failed to open path (exit code ${result.code})`);
  }
}
async function parallelLimit(items, limit, fn) {
  const results = [];
  let index = 0;
  async function worker() {
    while (index < items.length) {
      const i = index++;
      results[i] = await fn(items[i]);
    }
  }
  const workers = Array(Math.min(limit, items.length)).fill(null).map(() => worker());
  await Promise.all(workers);
  return results;
}
function getConfigPathFromArgv() {
  const idx = process.argv.indexOf("--mcp-config");
  if (idx >= 0 && idx + 1 < process.argv.length) {
    return process.argv[idx + 1];
  }
  return void 0;
}
function interpolateEnvVars(value) {
  return value.replace(/\$\{(\w+)\}/g, (_, name) => process.env[name] ?? "").replace(/\$env:(\w+)/g, (_, name) => process.env[name] ?? "");
}
function interpolateEnvRecord(values) {
  if (!values) return void 0;
  const resolved = {};
  for (const [key, value] of Object.entries(values)) {
    resolved[key] = interpolateEnvVars(value);
  }
  return resolved;
}
function resolveConfigPath(value) {
  if (value === void 0) return void 0;
  const resolved = interpolateEnvVars(value);
  if (resolved === "~") return homedir3();
  if (resolved.startsWith("~/") || resolved.startsWith("~\\")) {
    return join3(homedir3(), resolved.slice(2));
  }
  return resolved;
}
function truncateAtWord(text, target) {
  if (!text || text.length <= target) return text;
  const truncated = text.slice(0, target);
  const lastSpace = truncated.lastIndexOf(" ");
  if (lastSpace > target * 0.6) {
    return truncated.slice(0, lastSpace) + "...";
  }
  return truncated + "...";
}
function formatAuthRequiredMessage(config, serverName, defaultMessage) {
  const template = config.settings?.authRequiredMessage;
  return template ? template.replaceAll("${server}", serverName) : defaultMessage;
}
function extractToolUiStreamMode(toolMeta) {
  const uiMeta = toolMeta?.ui;
  if (!uiMeta || typeof uiMeta !== "object") return void 0;
  const streamMode = uiMeta["pi-mcp-adapter.streamMode"];
  if (streamMode === "eager" || streamMode === "stream-first") {
    return streamMode;
  }
  return void 0;
}

// metadata-cache.ts
var CACHE_VERSION = 1;
var CACHE_REFRESH_AFTER_MS = 7 * 24 * 60 * 60 * 1e3;
function getMetadataCachePath() {
  return getAgentPath("mcp-cache.json");
}
function loadMetadataCache() {
  const cachePath = getMetadataCachePath();
  if (!existsSync2(cachePath)) return null;
  try {
    const raw = JSON.parse(readFileSync2(cachePath, "utf-8"));
    if (!raw || typeof raw !== "object") return null;
    if (raw.version !== CACHE_VERSION) return null;
    if (!raw.servers || typeof raw.servers !== "object") return null;
    return raw;
  } catch {
    return null;
  }
}
function saveMetadataCache(cache) {
  const cachePath = getMetadataCachePath();
  const dir = dirname2(cachePath);
  mkdirSync2(dir, { recursive: true });
  let merged = { version: CACHE_VERSION, servers: {} };
  try {
    if (existsSync2(cachePath)) {
      const existing = JSON.parse(readFileSync2(cachePath, "utf-8"));
      if (existing && existing.version === CACHE_VERSION && existing.servers) {
        merged.servers = { ...existing.servers };
      }
    }
  } catch {
  }
  merged.version = CACHE_VERSION;
  merged.servers = { ...merged.servers, ...cache.servers };
  const tmpPath = `${cachePath}.${process.pid}.tmp`;
  writeFileSync2(tmpPath, JSON.stringify(merged, null, 2), "utf-8");
  renameSync2(tmpPath, cachePath);
}
function computeServerHash(definition) {
  const identity = {
    command: definition.command,
    args: definition.args,
    env: interpolateEnvRecord(definition.env),
    cwd: resolveConfigPath(definition.cwd),
    url: definition.url,
    headers: interpolateEnvRecord(definition.headers),
    auth: definition.auth,
    bearerToken: definition.bearerToken ?? (definition.bearerTokenEnv ? process.env[definition.bearerTokenEnv] : void 0),
    bearerTokenEnv: definition.bearerTokenEnv,
    exposeResources: definition.exposeResources,
    excludeTools: definition.excludeTools
  };
  const normalized = stableStringify(identity);
  return createHash("sha256").update(normalized).digest("hex");
}
function isServerCacheValid(entry, definition) {
  if (!entry || entry.configHash !== computeServerHash(definition)) return false;
  if (!entry.cachedAt || typeof entry.cachedAt !== "number") return false;
  return true;
}
function isServerCacheStale(entry, now = Date.now()) {
  return now - entry.cachedAt > CACHE_REFRESH_AFTER_MS;
}
function reconstructToolMetadata(serverName, entry, prefix, definition) {
  const metadata = [];
  for (const tool of entry.tools ?? []) {
    if (!tool?.name) continue;
    if (isToolExcluded(tool.name, serverName, prefix, definition.excludeTools)) {
      continue;
    }
    metadata.push({
      name: formatToolName(tool.name, serverName, prefix),
      originalName: tool.name,
      description: getEffectiveToolDescription(definition, tool.name, tool.description),
      inputSchema: tool.inputSchema,
      uiResourceUri: tool.uiResourceUri,
      uiStreamMode: tool.uiStreamMode
    });
  }
  if (definition.exposeResources !== false) {
    const resources = entry.resources ?? [];
    const baseNames = resourceToolBaseNames(resources, entry.tools?.map((tool) => tool.name));
    for (const [index, resource] of resources.entries()) {
      if (!resource?.name || !resource?.uri) continue;
      const baseName = baseNames[index];
      if (isToolExcluded(baseName, serverName, prefix, definition.excludeTools)) {
        continue;
      }
      metadata.push({
        name: formatToolName(baseName, serverName, prefix),
        originalName: baseName,
        description: resource.description ?? `Read resource: ${resource.uri}`,
        resourceUri: resource.uri,
        resourceTitle: resource.title,
        resourceMimeType: resource.mimeType,
        resourceAnnotations: resource.annotations,
        resourceMeta: resource._meta
      });
    }
  }
  return metadata;
}
function serializeTools(tools) {
  return tools.filter((t) => t?.name).map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: t.inputSchema,
    uiResourceUri: tryGetToolUiResourceUri(t),
    uiStreamMode: extractToolUiStreamMode(t._meta)
  }));
}
function serializeResources(resources) {
  return resources.filter((r) => r?.name && r?.uri).map((r) => ({
    uri: r.uri,
    name: r.name,
    title: r.title,
    description: r.description,
    mimeType: r.mimeType,
    annotations: r.annotations,
    _meta: r._meta
  }));
}
function serializeResourceTemplates(templates) {
  return templates.filter((template) => template?.name && template?.uriTemplate).map((template) => ({ ...template }));
}
function stableStringify(value) {
  if (value === null || value === void 0 || typeof value !== "object") {
    const serialized = JSON.stringify(value);
    return serialized === void 0 ? "undefined" : serialized;
  }
  if (Array.isArray(value)) {
    return `[${value.map((v) => stableStringify(v)).join(",")}]`;
  }
  const obj = value;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(",")}}`;
}
function tryGetToolUiResourceUri(tool) {
  try {
    return getToolUiResourceUri({ _meta: tool._meta });
  } catch {
    return void 0;
  }
}

// server-manager.ts
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import {
  ErrorCode,
  McpError,
  ResourceListChangedNotificationSchema
} from "@modelcontextprotocol/sdk/types.js";

// npx-resolver.ts
import { existsSync as existsSync3, readFileSync as readFileSync3, realpathSync as realpathSync2, readdirSync, statSync, writeFileSync as writeFileSync3, renameSync as renameSync3, mkdirSync as mkdirSync3, openSync, readSync, closeSync } from "node:fs";
import { join as join4, dirname as dirname3, extname, resolve as resolve3, sep } from "node:path";
import { spawn, spawnSync } from "node:child_process";
var CACHE_VERSION2 = 1;
var CACHE_TTL_MS = 24 * 60 * 60 * 1e3;
async function resolveNpxBinary(command, args) {
  const parsed = command === "npx" ? parseNpxArgs(args) : command === "npm" ? parseNpmExecArgs(args) : null;
  if (!parsed) return null;
  const packageName = extractPackageName(parsed.packageSpec);
  if (!packageName) return null;
  const unversioned = parsed.packageSpec.trim() === packageName;
  const requestedVersion = parsed.packageSpec.trim().slice(packageName.length + 1);
  if (!unversioned && !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(requestedVersion)) return null;
  const cacheKey = JSON.stringify([command, ...args]);
  const cache = loadCache();
  const cached = cache?.entries?.[cacheKey];
  if (unversioned && cached && Date.now() - cached.resolvedAt < CACHE_TTL_MS && existsSync3(cached.resolvedBin)) {
    return { binPath: cached.resolvedBin, extraArgs: parsed.extraArgs, isJs: cached.isJs };
  }
  const resolved = resolveFromNpmCache(parsed.packageSpec, parsed.binName);
  if (resolved) {
    saveCacheEntry(cacheKey, resolved);
    return { binPath: resolved.resolvedBin, extraArgs: parsed.extraArgs, isJs: resolved.isJs };
  }
  await forceNpxCache(parsed.packageSpec);
  const resolvedAfterInstall = resolveFromNpmCache(parsed.packageSpec, parsed.binName);
  if (resolvedAfterInstall) {
    saveCacheEntry(cacheKey, resolvedAfterInstall);
    return { binPath: resolvedAfterInstall.resolvedBin, extraArgs: parsed.extraArgs, isJs: resolvedAfterInstall.isJs };
  }
  return null;
}
function parseNpxArgs(args) {
  const separatorIndex = args.indexOf("--");
  const before = separatorIndex >= 0 ? args.slice(0, separatorIndex) : args;
  const after = separatorIndex >= 0 ? args.slice(separatorIndex + 1) : [];
  const positionals = [];
  let packageSpec;
  let sawPackageFlag = false;
  let foundFirstPositional = false;
  for (let i = 0; i < before.length; i++) {
    const arg = before[i];
    if (foundFirstPositional) {
      positionals.push(arg);
      continue;
    }
    if (arg === "-y" || arg === "--yes") continue;
    if (arg === "-p" || arg === "--package") {
      const value = before[i + 1];
      if (!value || value.startsWith("-")) return null;
      if (!packageSpec) packageSpec = value;
      sawPackageFlag = true;
      i++;
      continue;
    }
    if (arg.startsWith("--package=")) {
      const value = arg.slice("--package=".length);
      if (!value) return null;
      if (!packageSpec) packageSpec = value;
      sawPackageFlag = true;
      continue;
    }
    if (arg.startsWith("-")) {
      return null;
    }
    positionals.push(arg);
    foundFirstPositional = true;
  }
  if (sawPackageFlag) {
    const binName = positionals[0];
    if (!packageSpec || !binName) return null;
    const extraArgs2 = positionals.slice(1).concat(after);
    return { packageSpec, binName, extraArgs: extraArgs2 };
  }
  const packagePositional = positionals[0];
  if (!packagePositional) return null;
  const extraArgs = positionals.slice(1).concat(after);
  return { packageSpec: packagePositional, extraArgs };
}
function parseNpmExecArgs(args) {
  if (args[0] !== "exec") return null;
  const execArgs = args.slice(1);
  const separatorIndex = execArgs.indexOf("--");
  if (separatorIndex < 0) return null;
  const before = execArgs.slice(0, separatorIndex);
  const after = execArgs.slice(separatorIndex + 1);
  let packageSpec;
  for (let i = 0; i < before.length; i++) {
    const arg = before[i];
    if (arg === "-y" || arg === "--yes") continue;
    if (arg === "--package") {
      const value = before[i + 1];
      if (!value || value.startsWith("-")) return null;
      if (!packageSpec) packageSpec = value;
      i++;
      continue;
    }
    if (arg.startsWith("--package=")) {
      const value = arg.slice("--package=".length);
      if (!value) return null;
      if (!packageSpec) packageSpec = value;
      continue;
    }
    if (arg.startsWith("-")) {
      return null;
    }
  }
  const binName = after[0];
  if (!packageSpec || !binName) return null;
  const extraArgs = after.slice(1);
  return { packageSpec, binName, extraArgs };
}
function resolveFromNpmCache(packageSpec, binName) {
  const cacheDir = getNpmCacheDir();
  if (!cacheDir) return null;
  const packageName = extractPackageName(packageSpec);
  if (!packageName) return null;
  const requestedVersion = packageSpec.trim().slice(packageName.length + 1) || void 0;
  const packageDir = findCachedPackageDir(cacheDir, packageName, requestedVersion);
  if (!packageDir) return null;
  const packageJsonPath = join4(packageDir, "package.json");
  if (!existsSync3(packageJsonPath)) return null;
  let pkg = null;
  try {
    pkg = JSON.parse(readFileSync3(packageJsonPath, "utf-8"));
  } catch {
    return null;
  }
  const binField = pkg?.bin;
  if (!binField) return null;
  const candidates = buildBinCandidates(packageName, binName);
  let chosenBinName;
  let binRel;
  if (typeof binField === "string") {
    chosenBinName = defaultBinName(packageName);
    binRel = binField;
  } else {
    for (const candidate of candidates) {
      if (binField[candidate]) {
        chosenBinName = candidate;
        binRel = binField[candidate];
        break;
      }
    }
    if (!binRel) {
      const firstEntry = Object.entries(binField)[0];
      if (firstEntry) {
        chosenBinName = firstEntry[0];
        binRel = firstEntry[1];
      }
    }
  }
  if (!binRel) return null;
  const nodeModulesDir = findNodeModulesDir(packageDir);
  const binLink = chosenBinName ? join4(nodeModulesDir, ".bin", chosenBinName) : null;
  let resolvedBin = binLink && existsSync3(binLink) ? safeRealpath(binLink) : "";
  if (!resolvedBin) {
    resolvedBin = resolve3(packageDir, binRel);
    if (!existsSync3(resolvedBin)) return null;
  }
  const isJs = detectJsBinary(resolvedBin);
  return {
    resolvedBin,
    resolvedAt: Date.now(),
    packageVersion: pkg?.version,
    isJs
  };
}
var FORCE_CACHE_TIMEOUT_MS = 3e4;
async function forceNpxCache(packageSpec) {
  try {
    await new Promise((resolve4, reject) => {
      const proc = spawn(
        "npm",
        ["exec", "--yes", "--package", packageSpec, "--", "node", "-e", "1"],
        { stdio: "ignore" }
      );
      const timer = setTimeout(() => {
        proc.kill();
        reject(new Error("timeout"));
      }, FORCE_CACHE_TIMEOUT_MS);
      timer.unref();
      proc.on("close", () => {
        clearTimeout(timer);
        resolve4();
      });
      proc.on("error", (err) => {
        clearTimeout(timer);
        reject(err);
      });
    });
  } catch {
  }
}
function buildBinCandidates(packageName, explicitBin) {
  const candidates = [];
  if (explicitBin) candidates.push(explicitBin);
  if (packageName.startsWith("@")) {
    const namePart = packageName.split("/")[1] ?? "";
    const scopePart = packageName.split("/")[0]?.replace("@", "") ?? "";
    if (namePart) candidates.push(namePart);
    if (scopePart && namePart) candidates.push(`${scopePart}-${namePart}`);
  } else {
    candidates.push(packageName);
  }
  return [...new Set(candidates.filter(Boolean))];
}
function extractPackageName(spec) {
  const trimmed = spec.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("@")) {
    const slashIndex = trimmed.indexOf("/");
    if (slashIndex < 0) return null;
    const atIndex2 = trimmed.lastIndexOf("@");
    if (atIndex2 > slashIndex) {
      return trimmed.slice(0, atIndex2);
    }
    return trimmed;
  }
  const atIndex = trimmed.indexOf("@");
  return atIndex >= 0 ? trimmed.slice(0, atIndex) : trimmed;
}
function defaultBinName(packageName) {
  if (packageName.startsWith("@")) {
    const parts = packageName.split("/");
    return parts[1] ?? packageName.replace("@", "").replace("/", "-");
  }
  return packageName;
}
function findCachedPackageDir(cacheDir, packageName, requestedVersion) {
  const npxDir = join4(cacheDir, "_npx");
  if (!existsSync3(npxDir)) return null;
  const packagePathParts = packageName.startsWith("@") ? packageName.split("/") : [packageName];
  const candidates = readdirSync(npxDir, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => {
    const full = join4(npxDir, entry.name);
    const mtime = safeStatMtime(full);
    return { name: entry.name, mtime };
  }).sort((a, b) => b.mtime - a.mtime);
  for (const entry of candidates) {
    const pkgDir = join4(npxDir, entry.name, "node_modules", ...packagePathParts);
    if (existsSync3(join4(pkgDir, "package.json"))) {
      try {
        const pkg = JSON.parse(readFileSync3(join4(pkgDir, "package.json"), "utf-8"));
        if (pkg.name !== packageName) continue;
        if (requestedVersion && pkg.version !== requestedVersion) continue;
      } catch {
        continue;
      }
      return pkgDir;
    }
  }
  return null;
}
function findNodeModulesDir(packageDir) {
  const parts = packageDir.split(sep);
  const idx = parts.lastIndexOf("node_modules");
  if (idx >= 0) {
    return parts.slice(0, idx + 1).join(sep);
  }
  return join4(packageDir, "..");
}
function detectJsBinary(binPath) {
  const ext = extname(binPath).toLowerCase();
  if (ext === ".js" || ext === ".mjs" || ext === ".cjs") return true;
  try {
    const fd = openSync(binPath, "r");
    try {
      const buf = Buffer.alloc(256);
      readSync(fd, buf, 0, 256, 0);
      const firstLine = buf.toString("utf-8").split("\n")[0] ?? "";
      return firstLine.startsWith("#!") && firstLine.includes("node");
    } finally {
      closeSync(fd);
    }
  } catch {
    return false;
  }
}
var npmCacheDirCached;
function getNpmCacheDir() {
  if (npmCacheDirCached !== void 0) return npmCacheDirCached;
  if (process.env.NPM_CONFIG_CACHE) {
    npmCacheDirCached = process.env.NPM_CONFIG_CACHE;
    return npmCacheDirCached;
  }
  try {
    const result = spawnSync("npm", ["config", "get", "cache"], { encoding: "utf-8" });
    if (result.status === 0) {
      const path = String(result.stdout).trim();
      npmCacheDirCached = path || null;
      return npmCacheDirCached;
    }
  } catch {
    npmCacheDirCached = null;
    return null;
  }
  npmCacheDirCached = null;
  return null;
}
function getNpxCachePath() {
  return getAgentPath("mcp-npx-cache.json");
}
function loadCache() {
  const cachePath = getNpxCachePath();
  if (!existsSync3(cachePath)) return null;
  try {
    const raw = JSON.parse(readFileSync3(cachePath, "utf-8"));
    if (!raw || typeof raw !== "object") return null;
    if (raw.version !== CACHE_VERSION2) return null;
    if (!raw.entries || typeof raw.entries !== "object") return null;
    return raw;
  } catch {
    return null;
  }
}
function saveCacheEntry(key, entry) {
  const cachePath = getNpxCachePath();
  const dir = dirname3(cachePath);
  mkdirSync3(dir, { recursive: true });
  let merged = { version: CACHE_VERSION2, entries: {} };
  try {
    if (existsSync3(cachePath)) {
      const existing = JSON.parse(readFileSync3(cachePath, "utf-8"));
      if (existing && existing.version === CACHE_VERSION2 && existing.entries) {
        merged.entries = { ...existing.entries };
      }
    }
  } catch {
  }
  merged.entries[key] = entry;
  const tmpPath = `${cachePath}.${process.pid}.tmp`;
  writeFileSync3(tmpPath, JSON.stringify(merged, null, 2), "utf-8");
  renameSync3(tmpPath, cachePath);
}
function safeRealpath(path) {
  try {
    return realpathSync2(path);
  } catch {
    return "";
  }
}
function safeStatMtime(path) {
  try {
    return statSync(path).mtimeMs;
  } catch {
    return 0;
  }
}

// mcp-oauth-provider.ts
import { UnauthorizedError } from "@modelcontextprotocol/sdk/client/auth.js";

// mcp-auth.ts
import { mkdirSync as mkdirSync4, readFileSync as readFileSync4, writeFileSync as writeFileSync4, existsSync as existsSync4, rmSync } from "fs";
import { join as join5 } from "path";
function getAuthBaseDir() {
  const override = process.env.MCP_OAUTH_DIR?.trim();
  return override ? override : getAgentPath("mcp-oauth");
}
function getServerDir(serverName) {
  return join5(getAuthBaseDir(), serverName);
}
function getTokensFilePath(serverName) {
  return join5(getServerDir(serverName), "tokens.json");
}
function ensureServerDir(serverName) {
  const dir = getServerDir(serverName);
  if (!existsSync4(dir)) {
    mkdirSync4(dir, { recursive: true, mode: 448 });
  }
}
function readAuthEntry(serverName) {
  try {
    const filePath = getTokensFilePath(serverName);
    if (!existsSync4(filePath)) {
      return void 0;
    }
    const data = readFileSync4(filePath, "utf-8");
    return JSON.parse(data);
  } catch (error) {
    logger.error(`Failed to read auth entry for ${serverName}`, error instanceof Error ? error : new Error(String(error)));
    return void 0;
  }
}
function writeAuthEntry(serverName, entry) {
  ensureServerDir(serverName);
  const filePath = getTokensFilePath(serverName);
  writeFileSync4(filePath, JSON.stringify(entry, null, 2), { mode: 384 });
}
function getAuthEntry(serverName) {
  return readAuthEntry(serverName);
}
function getAuthForUrl(serverName, serverUrl) {
  const entry = getAuthEntry(serverName);
  if (!entry) return void 0;
  if (!entry.serverUrl) return void 0;
  if (entry.serverUrl !== serverUrl) return void 0;
  return entry;
}
function saveAuthEntry(serverName, entry, serverUrl) {
  if (serverUrl) {
    entry.serverUrl = serverUrl;
  }
  writeAuthEntry(serverName, entry);
}
function removeAuthEntry(serverName) {
  try {
    const filePath = getTokensFilePath(serverName);
    if (existsSync4(filePath)) {
      writeFileSync4(filePath, "{}", { mode: 384 });
    }
    const dir = getServerDir(serverName);
    if (existsSync4(dir)) {
      try {
        rmSync(dir, { recursive: true });
      } catch {
      }
    }
  } catch (error) {
    logger.error(`Failed to remove auth entry for ${serverName}`, error instanceof Error ? error : new Error(String(error)));
  }
}
function updateTokens(serverName, tokens, serverUrl) {
  const entry = getAuthEntry(serverName) ?? {};
  entry.tokens = tokens;
  saveAuthEntry(serverName, entry, serverUrl);
}
function updateClientInfo(serverName, clientInfo, serverUrl) {
  const entry = getAuthEntry(serverName) ?? {};
  entry.clientInfo = clientInfo;
  saveAuthEntry(serverName, entry, serverUrl);
}
function updateCodeVerifier(serverName, codeVerifier) {
  const entry = getAuthEntry(serverName) ?? {};
  entry.codeVerifier = codeVerifier;
  saveAuthEntry(serverName, entry);
}
function updateOAuthState(serverName, state) {
  const entry = getAuthEntry(serverName) ?? {};
  entry.oauthState = state;
  saveAuthEntry(serverName, entry);
}
function getOAuthState(serverName) {
  const entry = getAuthEntry(serverName);
  return entry?.oauthState;
}
function clearOAuthState(serverName) {
  const entry = getAuthEntry(serverName);
  if (entry) {
    delete entry.oauthState;
    saveAuthEntry(serverName, entry);
  }
}
function hasStoredTokens(serverName) {
  const entry = getAuthEntry(serverName);
  return !!entry?.tokens;
}
function clearAllCredentials(serverName) {
  removeAuthEntry(serverName);
}
function clearClientInfo(serverName) {
  const entry = getAuthEntry(serverName);
  if (entry) {
    delete entry.clientInfo;
    saveAuthEntry(serverName, entry);
  }
}
function clearTokens(serverName) {
  const entry = getAuthEntry(serverName);
  if (entry) {
    delete entry.tokens;
    saveAuthEntry(serverName, entry);
  }
}

// mcp-oauth-provider.ts
var DEFAULT_OAUTH_CALLBACK_PORT = 19876;
var OAUTH_CALLBACK_PATH = "/callback";
var configuredOAuthCallbackPort = DEFAULT_OAUTH_CALLBACK_PORT;
if (process.env.MCP_OAUTH_CALLBACK_PORT) {
  const parsedPort = Number.parseInt(process.env.MCP_OAUTH_CALLBACK_PORT, 10);
  if (Number.isInteger(parsedPort) && parsedPort > 0 && parsedPort <= 65535) {
    configuredOAuthCallbackPort = parsedPort;
  }
}
var oauthCallbackPort = configuredOAuthCallbackPort;
function getConfiguredOAuthCallbackPort() {
  return configuredOAuthCallbackPort;
}
function getOAuthCallbackPort() {
  return oauthCallbackPort;
}
function setOAuthCallbackPort(port) {
  oauthCallbackPort = port;
}
var McpOAuthProvider = class {
  constructor(serverName, serverUrl, config, callbacks) {
    this.serverName = serverName;
    this.serverUrl = serverUrl;
    this.config = config;
    this.callbacks = callbacks;
  }
  serverName;
  serverUrl;
  config;
  callbacks;
  get usesClientCredentials() {
    return this.config.grantType === "client_credentials";
  }
  /**
   * The redirect URL for OAuth callbacks.
   * This must match the redirect_uri in client metadata.
   */
  get redirectUrl() {
    if (this.usesClientCredentials) return void 0;
    return `http://localhost:${getOAuthCallbackPort()}${OAUTH_CALLBACK_PATH}`;
  }
  /**
   * Client metadata for dynamic registration.
   * Describes this client to the OAuth authorization server.
   */
  get clientMetadata() {
    if (this.usesClientCredentials) {
      return {
        client_name: "Pi Coding Agent",
        redirect_uris: [],
        grant_types: ["client_credentials"],
        token_endpoint_auth_method: this.config.clientSecret ? "client_secret_post" : "none"
      };
    }
    const redirectUrl = this.redirectUrl;
    if (!redirectUrl) {
      throw new Error("redirectUrl is required for authorization_code flow");
    }
    return {
      redirect_uris: [redirectUrl],
      client_name: "Pi Coding Agent",
      client_uri: "https://github.com/nicobailon/pi-mcp-adapter",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: this.config.clientSecret ? "client_secret_post" : "none"
    };
  }
  /**
   * Whether a cached registration may start authorization at the active callback URI.
   * Legacy entries without redirectUris never match; client_credentials has no redirect.
   */
  matchesRedirect(clientInfo) {
    const redirectUrl = this.redirectUrl;
    return redirectUrl === void 0 || clientInfo.redirectUris?.includes(redirectUrl) === true;
  }
  /**
   * Get client information (for pre-registered or dynamically registered clients).
   * Fresh authorization requires a known redirect binding; refresh keeps its original
   * client unless that client's secret has expired, which forces registration.
   */
  async clientInformation() {
    if (this.config.clientId) {
      return {
        client_id: this.config.clientId,
        client_secret: this.config.clientSecret
      };
    }
    const entry = await getAuthForUrl(this.serverName, this.serverUrl);
    if (entry?.clientInfo) {
      if (!entry.tokens?.refreshToken && !this.matchesRedirect(entry.clientInfo)) {
        return void 0;
      }
      if (entry.clientInfo.clientSecretExpiresAt && entry.clientInfo.clientSecretExpiresAt < Date.now() / 1e3) {
        return void 0;
      }
      return {
        client_id: entry.clientInfo.clientId,
        client_secret: entry.clientInfo.clientSecret
      };
    }
    return void 0;
  }
  /**
   * Save client information from dynamic registration.
   */
  async saveClientInformation(info) {
    const clientInfo = {
      clientId: info.client_id,
      redirectUris: info.redirect_uris,
      clientSecret: info.client_secret,
      clientIdIssuedAt: info.client_id_issued_at,
      clientSecretExpiresAt: info.client_secret_expires_at
    };
    updateClientInfo(this.serverName, clientInfo, this.serverUrl);
  }
  /**
   * Get stored OAuth tokens.
   * Returns undefined if no tokens exist or if the server URL has changed.
   */
  async tokens() {
    const entry = await getAuthForUrl(this.serverName, this.serverUrl);
    if (!entry?.tokens) return void 0;
    return {
      access_token: entry.tokens.accessToken,
      token_type: "Bearer",
      refresh_token: entry.tokens.refreshToken,
      expires_in: entry.tokens.expiresAt ? Math.max(0, Math.floor(entry.tokens.expiresAt - Date.now() / 1e3)) : void 0,
      scope: entry.tokens.scope
    };
  }
  /**
   * Save OAuth tokens.
   */
  async saveTokens(tokens) {
    const storedTokens = {
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresAt: tokens.expires_in ? Date.now() / 1e3 + tokens.expires_in : void 0,
      scope: tokens.scope
    };
    updateTokens(this.serverName, storedTokens, this.serverUrl);
  }
  /**
   * Redirect the user to the authorization URL.
   * This opens the browser for the user to authenticate.
   *
   * Throws UnauthorizedError when called outside of a user-initiated flow
   * (no oauthState saved by startAuth). That path is reached when the SDK
   * falls through from a failed refresh into a fresh authorization_code
   * flow, which library hosts cannot complete in-process.
   */
  async redirectToAuthorization(authorizationUrl) {
    if (this.usesClientCredentials) {
      throw new Error("redirectToAuthorization is not used for client_credentials flow");
    }
    const entry = await getAuthEntry(this.serverName);
    if (!entry?.oauthState) {
      throw new UnauthorizedError(
        `Re-authentication required for MCP server: ${this.serverName}`
      );
    }
    await this.callbacks.onRedirect(authorizationUrl);
  }
  /**
   * Save the PKCE code verifier.
   */
  async saveCodeVerifier(codeVerifier) {
    updateCodeVerifier(this.serverName, codeVerifier);
  }
  /**
   * Get the stored PKCE code verifier.
   * @throws Error if no code verifier is stored
   */
  async codeVerifier() {
    if (this.usesClientCredentials) {
      throw new Error("codeVerifier is not used for client_credentials flow");
    }
    const entry = await getAuthEntry(this.serverName);
    if (!entry?.codeVerifier) {
      throw new Error(`No code verifier saved for MCP server: ${this.serverName}`);
    }
    return entry.codeVerifier;
  }
  /**
   * Save the OAuth state parameter for CSRF protection.
   */
  async saveState(state) {
    updateOAuthState(this.serverName, state);
  }
  /**
   * Get the stored OAuth state parameter.
   * @throws UnauthorizedError if no flow is in progress (see redirectToAuthorization)
   */
  async state() {
    if (this.usesClientCredentials) {
      throw new Error("state is not used for client_credentials flow");
    }
    const entry = await getAuthEntry(this.serverName);
    if (!entry?.oauthState) {
      throw new UnauthorizedError(
        `Re-authentication required for MCP server: ${this.serverName}`
      );
    }
    const authEntry = await getAuthForUrl(this.serverName, this.serverUrl);
    if (!this.config.clientId && authEntry?.clientInfo && !this.matchesRedirect(authEntry.clientInfo)) {
      throw new UnauthorizedError(
        `Token refresh did not succeed for MCP server: ${this.serverName}; cached OAuth client has an unknown or different callback URI. Retry when the authorization server is available.`
      );
    }
    return entry.oauthState;
  }
  /**
   * Invalidate credentials when authentication fails.
   * Clears tokens, client info, or all credentials based on the type.
   */
  async invalidateCredentials(type) {
    switch (type) {
      case "all":
        clearAllCredentials(this.serverName);
        break;
      case "client":
        clearClientInfo(this.serverName);
        break;
      case "tokens":
        clearTokens(this.serverName);
        break;
    }
  }
  prepareTokenRequest(scope) {
    if (!this.usesClientCredentials) {
      return void 0;
    }
    const params = new URLSearchParams({ grant_type: "client_credentials" });
    const requestedScope = scope ?? this.config.scope;
    if (requestedScope) {
      params.set("scope", requestedScope);
    }
    return params;
  }
};

// mcp-auth-flow.ts
import {
  auth as runSdkAuth,
  UnauthorizedError as UnauthorizedError2
} from "@modelcontextprotocol/sdk/client/auth.js";
import { OAuthError, ServerError } from "@modelcontextprotocol/sdk/server/auth/errors.js";

// mcp-callback-server.ts
import { createServer } from "http";
var HTML_SUCCESS = `<!DOCTYPE html>
<html>
<head>
  <title>Pi - Authorization Successful</title>
  <style>
    body { font-family: system-ui, -apple-system, sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; background: #1a1a2e; color: #eee; }
    .container { text-align: center; padding: 2rem; }
    h1 { color: #4ade80; margin-bottom: 1rem; }
    p { color: #aaa; }
  </style>
</head>
<body>
  <div class="container">
    <h1>Authorization Successful</h1>
    <p>You can close this window and return to Pi.</p>
  </div>
  <script>setTimeout(() => window.close(), 2000);</script>
</body>
</html>`;
var HTML_ERROR = (error) => `<!DOCTYPE html>
<html>
<head>
  <title>Pi - Authorization Failed</title>
  <style>
    body { font-family: system-ui, -apple-system, sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; background: #1a1a2e; color: #eee; }
    .container { text-align: center; padding: 2rem; }
    h1 { color: #f87171; margin-bottom: 1rem; }
    p { color: #aaa; }
    .error { color: #fca5a5; font-family: monospace; margin-top: 1rem; padding: 1rem; background: rgba(248,113,113,0.1); border-radius: 0.5rem; }
  </style>
</head>
<body>
  <div class="container">
    <h1>Authorization Failed</h1>
    <p>An error occurred during authorization.</p>
    <div class="error">${error}</div>
  </div>
</body>
</html>`;
var server;
var pendingAuths = /* @__PURE__ */ new Map();
var CALLBACK_TIMEOUT_MS = 5 * 60 * 1e3;
var MAX_PORT_SCAN_ATTEMPTS = 25;
function handleRequest(req, res) {
  const url = new URL(req.url || "/", `http://${req.headers.host}`);
  if (url.pathname !== OAUTH_CALLBACK_PATH) {
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Not found");
    return;
  }
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");
  const errorDescription = url.searchParams.get("error_description");
  if (!state) {
    const errorMsg = "Missing required state parameter - potential CSRF attack";
    res.writeHead(400, { "Content-Type": "text/html" });
    res.end(HTML_ERROR(errorMsg));
    return;
  }
  if (error) {
    const errorMsg = errorDescription || error;
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(HTML_ERROR(errorMsg));
    if (pendingAuths.has(state)) {
      const pending2 = pendingAuths.get(state);
      clearTimeout(pending2.timeout);
      pendingAuths.delete(state);
      setTimeout(() => pending2.reject(new Error(errorMsg)), 0);
    }
    return;
  }
  if (!code) {
    res.writeHead(400, { "Content-Type": "text/html" });
    res.end(HTML_ERROR("No authorization code provided"));
    return;
  }
  if (!pendingAuths.has(state)) {
    const errorMsg = "Invalid or expired state parameter - potential CSRF attack";
    res.writeHead(400, { "Content-Type": "text/html" });
    res.end(HTML_ERROR(errorMsg));
    return;
  }
  const pending = pendingAuths.get(state);
  clearTimeout(pending.timeout);
  pendingAuths.delete(state);
  pending.resolve(code);
  res.writeHead(200, { "Content-Type": "text/html" });
  res.end(HTML_SUCCESS);
}
async function ensureCallbackServer(options = {}) {
  const configuredPort = getConfiguredOAuthCallbackPort();
  const strictPort = options.strictPort === true;
  if (server) {
    if (!strictPort || getOAuthCallbackPort() === configuredPort) return;
    if (pendingAuths.size > 0) {
      throw new Error(
        `OAuth callback server is running on port ${getOAuthCallbackPort()}, but strict callback port ${configuredPort} is required and cannot be switched while authorizations are pending`
      );
    }
    await stopCallbackServer();
  }
  const preferredPort = configuredPort;
  const maxAttempts = strictPort ? 1 : MAX_PORT_SCAN_ATTEMPTS;
  let lastError;
  for (let offset = 0; offset < maxAttempts; offset++) {
    const candidatePort = preferredPort + offset;
    const candidateServer = createServer(handleRequest);
    try {
      await new Promise((resolve4, reject) => {
        candidateServer.once("error", (err) => {
          reject(err);
        });
        candidateServer.listen(candidatePort, "localhost", () => {
          resolve4();
        });
      });
      server = candidateServer;
      server.unref();
      setOAuthCallbackPort(candidatePort);
      return;
    } catch (error) {
      const nodeError = error;
      await new Promise((resolve4) => {
        candidateServer.close(() => resolve4());
      });
      if (nodeError.code !== "EADDRINUSE") {
        throw error;
      }
      lastError = error instanceof Error ? error : new Error(String(error));
    }
  }
  if (strictPort) {
    throw new Error(
      `OAuth callback port ${preferredPort} is already in use. Pre-registered OAuth clients require an exact redirect URI; set MCP_OAUTH_CALLBACK_PORT to your registered port or free port ${preferredPort}`,
      { cause: lastError }
    );
  }
  throw new Error(
    `OAuth callback port ${preferredPort} is already in use and no free port was found in range ${preferredPort}-${preferredPort + MAX_PORT_SCAN_ATTEMPTS - 1}`,
    { cause: lastError }
  );
}
function waitForCallback(oauthState) {
  return new Promise((resolve4, reject) => {
    const timeout = setTimeout(() => {
      if (pendingAuths.has(oauthState)) {
        pendingAuths.delete(oauthState);
        reject(new Error("OAuth callback timeout - authorization took too long"));
      }
    }, CALLBACK_TIMEOUT_MS);
    pendingAuths.set(oauthState, { resolve: resolve4, reject, timeout });
  });
}
function cancelPendingCallback(oauthState) {
  const pending = pendingAuths.get(oauthState);
  if (pending) {
    clearTimeout(pending.timeout);
    pendingAuths.delete(oauthState);
    pending.reject(new Error("Authorization cancelled"));
  }
}
async function stopCallbackServer() {
  if (server) {
    await new Promise((resolve4) => {
      server.close(() => {
        resolve4();
      });
    });
    server = void 0;
  }
  setOAuthCallbackPort(getConfiguredOAuthCallbackPort());
  const pendingList = Array.from(pendingAuths.entries());
  pendingAuths.clear();
  setTimeout(() => {
    for (const [, pending] of pendingList) {
      clearTimeout(pending.timeout);
      pending.reject(new Error("OAuth callback server stopped"));
    }
  }, 0);
}

// mcp-auth-flow.ts
var pendingTransports = /* @__PURE__ */ new Map();
var pendingAuthentications = /* @__PURE__ */ new Map();
function generateState() {
  return Array.from(crypto.getRandomValues(new Uint8Array(32))).map((b) => b.toString(16).padStart(2, "0")).join("");
}
function extractOAuthConfig(definition) {
  if (definition.oauth === false) {
    return {};
  }
  return {
    grantType: definition.oauth?.grantType,
    clientId: definition.oauth?.clientId,
    clientSecret: definition.oauth?.clientSecret,
    scope: definition.oauth?.scope
  };
}
function isOAuthRejection(error) {
  return error instanceof UnauthorizedError2 || error instanceof OAuthError && !(error instanceof ServerError);
}
async function runAuthDiscardingRejectedTokens(provider, serverUrl) {
  try {
    return await runSdkAuth(provider, { serverUrl });
  } catch (error) {
    const hadTokens = Boolean(await provider.tokens());
    if (!hadTokens || !(error instanceof OAuthError) || error instanceof ServerError) {
      throw error;
    }
    logger.warn(`MCP Auth: stored tokens for ${provider.serverName} were rejected; starting a fresh login`);
    await provider.invalidateCredentials("tokens");
    return await runSdkAuth(provider, { serverUrl });
  }
}
async function startAuth(serverName, serverUrl, definition) {
  const config = definition ? extractOAuthConfig(definition) : {};
  if (config.grantType === "client_credentials") {
    const authProvider2 = new McpOAuthProvider(serverName, serverUrl, config, {
      onRedirect: async () => {
        throw new Error("Browser redirect is not used for client_credentials flow");
      }
    });
    const result = await runAuthDiscardingRejectedTokens(authProvider2, serverUrl);
    if (result !== "AUTHORIZED") {
      throw new UnauthorizedError2("Failed to authorize");
    }
    return { authorizationUrl: "" };
  }
  await ensureCallbackServer({ strictPort: Boolean(config.clientId) });
  const oauthState = generateState();
  await updateOAuthState(serverName, oauthState);
  let capturedUrl;
  const authProvider = new McpOAuthProvider(serverName, serverUrl, config, {
    onRedirect: async (url) => {
      capturedUrl = url;
    }
  });
  try {
    const result = await runAuthDiscardingRejectedTokens(authProvider, serverUrl);
    if (result === "AUTHORIZED") {
      await clearOAuthState(serverName);
      return { authorizationUrl: "" };
    }
    if (!capturedUrl) {
      throw new UnauthorizedError2("OAuth authorization URL was not provided");
    }
    const { StreamableHTTPClientTransport } = await import("@modelcontextprotocol/sdk/client/streamableHttp.js");
    pendingTransports.set(
      serverName,
      new StreamableHTTPClientTransport(new URL(serverUrl), { authProvider })
    );
    return { authorizationUrl: capturedUrl.toString() };
  } catch (error) {
    await clearOAuthState(serverName);
    throw error;
  }
}
async function completeAuth(serverName, authorizationCode) {
  const transport = pendingTransports.get(serverName);
  if (!transport) {
    throw new Error(`No pending OAuth flow for server: ${serverName}`);
  }
  try {
    await transport.finishAuth(authorizationCode);
    return "authenticated";
  } finally {
    pendingTransports.delete(serverName);
    await transport.close().catch(() => {
    });
  }
}
async function authenticate(serverName, serverUrl, definition, signal) {
  const inFlight = pendingAuthentications.get(serverName);
  if (inFlight) {
    return inFlight;
  }
  const operation = (async () => {
    const { authorizationUrl } = await startAuth(serverName, serverUrl, definition);
    if (!authorizationUrl) {
      return "authenticated";
    }
    const oauthState = await getOAuthState(serverName);
    if (!oauthState) {
      throw new Error("OAuth state not found - this should not happen");
    }
    const callbackPromise = waitForCallback(oauthState);
    signal?.addEventListener("abort", () => cancelPendingCallback(oauthState), { once: true });
    try {
      if (signal?.aborted) {
        throw new Error("Authorization cancelled");
      }
      try {
        const { default: open } = await import("open");
        await open(authorizationUrl);
      } catch (error) {
        logger.warn(`MCP Auth: Failed to open browser for ${serverName}`, { error });
        throw new Error(
          `Could not open browser. Please open this URL manually: ${authorizationUrl}`,
          { cause: error }
        );
      }
      const code = await callbackPromise;
      const storedState = await getOAuthState(serverName);
      if (storedState !== oauthState) {
        await clearOAuthState(serverName);
        throw new Error("OAuth state mismatch - potential CSRF attack");
      }
      await clearOAuthState(serverName);
      return await completeAuth(serverName, code);
    } catch (error) {
      cancelPendingCallback(oauthState);
      await clearOAuthState(serverName);
      const pendingTransport = pendingTransports.get(serverName);
      if (pendingTransport) {
        pendingTransports.delete(serverName);
        await pendingTransport.close().catch(() => {
        });
      }
      throw error;
    }
  })();
  pendingAuthentications.set(serverName, operation);
  try {
    return await operation;
  } finally {
    if (pendingAuthentications.get(serverName) === operation) {
      pendingAuthentications.delete(serverName);
    }
  }
}
function supportsOAuth(definition) {
  if (!definition.url) return false;
  if (definition.auth === false) return false;
  if (definition.oauth === false) return false;
  return definition.auth === "oauth" || definition.auth === void 0;
}
async function initializeOAuth() {
  await ensureCallbackServer();
}
async function shutdownOAuth() {
  await stopCallbackServer();
}

// server-status.ts
import { mkdirSync as mkdirSync5, readFileSync as readFileSync5, renameSync as renameSync4, writeFileSync as writeFileSync5 } from "node:fs";
import { dirname as dirname4 } from "node:path";
function getServerStatusPath() {
  return getAgentPath("mcp-server-status.json");
}
function loadServerStatuses() {
  try {
    const raw = JSON.parse(readFileSync5(getServerStatusPath(), "utf-8"));
    if (raw?.version !== 1 || !raw.servers || typeof raw.servers !== "object") return {};
    return raw.servers;
  } catch {
    return {};
  }
}
function updateServerStatus(name, patch) {
  try {
    const servers = loadServerStatuses();
    const current = servers[name] ?? {};
    const next = { ...current, ...patch };
    if (JSON.stringify(next) === JSON.stringify(current)) return;
    servers[name] = next;
    const path = getServerStatusPath();
    mkdirSync5(dirname4(path), { recursive: true });
    const tmpPath = `${path}.${process.pid}.tmp`;
    const file = { version: 1, servers };
    writeFileSync5(tmpPath, JSON.stringify(file, null, 2), "utf-8");
    renameSync4(tmpPath, path);
  } catch (error) {
    logger.debug(`MCP: failed to save status for ${name}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

// sampling-handler.ts
import {
  CreateMessageRequestSchema
} from "@modelcontextprotocol/sdk/types.js";
function registerSamplingHandler(client, options) {
  client.setRequestHandler(CreateMessageRequestSchema, (request) => {
    return handleSamplingRequest(options, request);
  });
}
async function handleSamplingRequest(options, request) {
  const params = request.params;
  if ("task" in params && params.task) {
    throw new Error("MCP sampling tasks are not supported");
  }
  if (params.includeContext && params.includeContext !== "none") {
    throw new Error("MCP sampling context inclusion is not supported");
  }
  if (params.tools?.length) {
    throw new Error("MCP sampling tool use is not supported");
  }
  if (params.toolChoice) {
    throw new Error("MCP sampling tool choice is not supported");
  }
  if (params.stopSequences?.length) {
    throw new Error("MCP sampling stop sequences are not supported");
  }
  const messages = params.messages.map(convertSamplingMessage);
  const { model, apiKey, headers } = await resolveSamplingModel(options);
  await confirmSampling(
    options,
    "Approve MCP sampling request",
    formatRequestApproval(options.serverName, `${model.provider}/${model.id}`, params.systemPrompt, messages)
  );
  const { complete } = await import("@earendil-works/pi-ai/compat");
  const result = await complete(
    model,
    {
      systemPrompt: params.systemPrompt,
      messages
    },
    {
      apiKey,
      headers,
      maxTokens: params.maxTokens,
      temperature: params.temperature,
      metadata: params.metadata,
      signal: options.getSignal()
    }
  );
  const converted = convertAssistantResult(result);
  await confirmSampling(
    options,
    "Return MCP sampling response",
    formatResponseApproval(options.serverName, converted)
  );
  return converted;
}
function formatRequestApproval(serverName, modelName, systemPrompt, messages) {
  const lines = [`${serverName} wants to sample ${messages.length} message${messages.length === 1 ? "" : "s"} with ${modelName}.`];
  if (systemPrompt) {
    lines.push(`System: ${truncateAtWord(systemPrompt, 400)}`);
  }
  for (const [index, message] of messages.entries()) {
    lines.push(`${index + 1}. ${message.role}: ${truncateAtWord(messageText(message), 400)}`);
  }
  return lines.join("\n\n");
}
function formatResponseApproval(serverName, response) {
  const text = response.content.type === "text" ? response.content.text : `[${response.content.type} content]`;
  return `${serverName} will receive this response from ${response.model}:

${truncateAtWord(text, 1e3)}`;
}
function messageText(message) {
  if (typeof message.content === "string") return message.content;
  return message.content.map((block) => {
    if (block.type === "text") return block.text;
    if (block.type === "image") return `[image: ${block.mimeType}]`;
    if (block.type === "thinking") return "[thinking]";
    if (block.type === "toolCall") return `[tool call: ${block.name}]`;
    return "[content]";
  }).join("\n");
}
async function resolveSamplingModel(options) {
  const candidates = [];
  const currentModel = options.getCurrentModel();
  if (currentModel) candidates.push(currentModel);
  for (const model of options.modelRegistry.getAvailable()) {
    if (!candidates.some((candidate) => candidate.provider === model.provider && candidate.id === model.id)) {
      candidates.push(model);
    }
  }
  const errors = [];
  for (const model of candidates) {
    const auth = await options.modelRegistry.getApiKeyAndHeaders(model);
    if (auth.ok) {
      return { model, apiKey: auth.apiKey, headers: auth.headers };
    }
    errors.push(`${model.provider}/${model.id}: ${auth.error}`);
  }
  if (errors.length > 0) {
    throw new Error(`No configured auth for MCP sampling model. ${errors.join("; ")}`);
  }
  throw new Error("No Pi model is available for MCP sampling");
}
async function confirmSampling(options, title, message) {
  if (options.autoApprove) return;
  if (!options.ui) {
    throw new Error("MCP sampling requires interactive approval. Set settings.samplingAutoApprove to true to allow it without UI.");
  }
  const approved = await options.ui.confirm(title, message);
  if (!approved) {
    throw new Error("MCP sampling request was declined");
  }
}
function convertSamplingMessage(message) {
  const blocks = Array.isArray(message.content) ? message.content : [message.content];
  if (message.role === "user") {
    return {
      role: "user",
      content: blocks.map(convertUserContent),
      timestamp: Date.now()
    };
  }
  return {
    role: "assistant",
    content: blocks.map(convertAssistantContent),
    api: "mcp-sampling",
    provider: "mcp",
    model: "sampling-request",
    usage: zeroUsage(),
    stopReason: "stop",
    timestamp: Date.now()
  };
}
function convertUserContent(block) {
  if (block.type === "text") {
    return { type: "text", text: block.text };
  }
  throw new Error(`MCP sampling ${block.type} content is not supported`);
}
function convertAssistantContent(block) {
  if (block.type === "text") {
    return { type: "text", text: block.text };
  }
  throw new Error(`MCP sampling assistant ${block.type} content is not supported`);
}
function convertAssistantResult(message) {
  if (message.stopReason === "error") {
    throw new Error(message.errorMessage ?? "MCP sampling model call failed");
  }
  if (message.stopReason === "aborted") {
    throw new Error(message.errorMessage ?? "MCP sampling model call was aborted");
  }
  const text = message.content.map((block) => {
    if (block.type === "text") return block.text;
    if (block.type === "thinking") return void 0;
    throw new Error(`MCP sampling result ${block.type} content is not supported`);
  }).filter((value) => value !== void 0).join("\n\n").trim();
  if (!text) {
    throw new Error("MCP sampling result did not contain text content");
  }
  return {
    role: "assistant",
    content: { type: "text", text },
    model: `${message.provider}/${message.model}`,
    stopReason: mapStopReason(message.stopReason)
  };
}
function mapStopReason(reason) {
  if (reason === "stop") return "endTurn";
  if (reason === "length") return "maxTokens";
  if (reason === "toolUse") return "toolUse";
  return reason;
}
function zeroUsage() {
  return {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      total: 0
    }
  };
}

// elicitation-handler.ts
import {
  ElicitRequestSchema
} from "@modelcontextprotocol/sdk/types.js";
function registerElicitationHandler(client, options) {
  client.setRequestHandler(ElicitRequestSchema, (request) => {
    return handleElicitationRequest(options, request);
  });
}
async function handleElicitationRequest(options, request) {
  const params = request.params;
  const message = truncateAtWord(params.message ?? "", 1e3);
  const heading = `MCP elicitation from ${options.serverName}`;
  if ("mode" in params && params.mode === "url") {
    const detail = `${message}

Open URL: ${params.url}`;
    if (options.autoApprove) {
      return { action: "accept" };
    }
    if (!options.ui) {
      logger.debug(`${options.serverName}: declined URL elicitation (no UI)`);
      return { action: "decline" };
    }
    const approved = await options.ui.confirm(heading, detail);
    return { action: approved ? "accept" : "decline" };
  }
  const schema = params.requestedSchema;
  const properties = schema?.properties ?? {};
  const required = new Set(Array.isArray(schema?.required) ? schema.required : []);
  const propertyNames = Object.keys(properties);
  if (options.autoApprove) {
    return { action: "accept", content: autoApproveContent(properties) };
  }
  if (!options.ui) {
    logger.debug(`${options.serverName}: declined form elicitation (no UI)`);
    return { action: "decline" };
  }
  if (propertyNames.length === 0) {
    const approved = await options.ui.confirm(heading, message);
    return { action: approved ? "accept" : "decline" };
  }
  const introApproved = await options.ui.confirm(
    heading,
    `${message}

This server wants to collect ${propertyNames.length} field${propertyNames.length === 1 ? "" : "s"}. Continue?`
  );
  if (!introApproved) {
    return { action: "decline" };
  }
  const content = {};
  for (const name of propertyNames) {
    const propSchema = properties[name] ?? {};
    const title = typeof propSchema.title === "string" ? propSchema.title : name;
    const description = typeof propSchema.description === "string" ? propSchema.description : "";
    const isRequired = required.has(name);
    const promptTitle = `${heading}: ${title}${isRequired ? " *required*" : ""}`;
    const enumValues = Array.isArray(propSchema.enum) ? propSchema.enum.map(String) : void 0;
    const type = typeof propSchema.type === "string" ? propSchema.type : enumValues ? "string" : void 0;
    if (enumValues && enumValues.length > 0) {
      const selectTitle = description ? `${promptTitle} \u2014 ${truncateAtWord(description, 200)}` : promptTitle;
      const choice = await options.ui.select(selectTitle, enumValues);
      if (choice === void 0) {
        return { action: "cancel" };
      }
      content[name] = choice;
      continue;
    }
    if (type === "boolean") {
      const approved = await options.ui.confirm(promptTitle, description || `Accept ${name}?`);
      content[name] = approved;
      continue;
    }
    const placeholder = description || (typeof propSchema.default === "string" ? String(propSchema.default) : "");
    const answer = await options.ui.input(promptTitle, placeholder);
    if (answer === void 0) {
      return { action: "cancel" };
    }
    if (type === "number" || type === "integer") {
      const parsed = Number(answer);
      if (Number.isNaN(parsed)) {
        if (isRequired) {
          return { action: "cancel" };
        }
        continue;
      }
      content[name] = parsed;
      continue;
    }
    if (answer === "" && !isRequired) {
      continue;
    }
    content[name] = answer;
  }
  return { action: "accept", content };
}
function autoApproveContent(properties) {
  const content = {};
  for (const [name, schema] of Object.entries(properties)) {
    const enumValues = Array.isArray(schema.enum) ? schema.enum.map(String) : void 0;
    const type = typeof schema.type === "string" ? schema.type : enumValues ? "string" : void 0;
    if (schema.default !== void 0) {
      const def = schema.default;
      if (typeof def === "string" || typeof def === "number" || typeof def === "boolean") {
        content[name] = def;
        continue;
      }
      if (Array.isArray(def) && def.every((v) => typeof v === "string")) {
        content[name] = def;
        continue;
      }
    }
    if (enumValues && enumValues.length > 0) {
      content[name] = enumValues[0];
      continue;
    }
    if (type === "boolean") {
      content[name] = true;
      continue;
    }
    if (type === "number" || type === "integer") {
      content[name] = 0;
      continue;
    }
    content[name] = "";
  }
  return content;
}

// server-manager.ts
function isMethodNotFound(error) {
  return error instanceof McpError && error.code === ErrorCode.MethodNotFound;
}
var McpServerManager = class {
  connections = /* @__PURE__ */ new Map();
  connectPromises = /* @__PURE__ */ new Map();
  connectControllers = /* @__PURE__ */ new Map();
  closePromises = /* @__PURE__ */ new Map();
  uiStreamListeners = /* @__PURE__ */ new Map();
  samplingConfig;
  elicitationConfig;
  resourceListChangedCallback;
  setSamplingConfig(config) {
    this.samplingConfig = config;
  }
  setElicitationConfig(config) {
    this.elicitationConfig = config;
  }
  async connect(name, definition) {
    if (this.connectPromises.has(name)) {
      return this.connectPromises.get(name);
    }
    const existing = this.connections.get(name);
    if (existing?.status === "connected") {
      existing.lastUsedAt = Date.now();
      return existing;
    }
    const controller = new AbortController();
    const { signal } = controller;
    let onAbort;
    const cancelled = new Promise((_resolve, reject) => {
      onAbort = () => reject(signal.reason);
      signal.addEventListener("abort", onAbort, { once: true });
    });
    const attempt = this.createConnection(name, definition, signal).then(async (connection) => {
      if (this.connectPromises.get(name) !== promise) {
        connection.status = "closed";
        await connection.client.close().catch(() => {
        });
        await connection.transport.close().catch(() => {
        });
        throw new Error(`Connection to ${name} was closed`);
      }
      this.connections.set(name, connection);
      updateServerStatus(name, { needsAuth: connection.status === "needs-auth" });
      return connection;
    });
    const promise = Promise.race([attempt, cancelled]).finally(() => {
      signal.removeEventListener("abort", onAbort);
      if (this.connectPromises.get(name) === promise) {
        this.connectPromises.delete(name);
        this.connectControllers.delete(name);
      }
    });
    this.connectPromises.set(name, promise);
    this.connectControllers.set(name, controller);
    return promise;
  }
  async createConnection(name, definition, signal) {
    const client = this.createClient(name);
    let transport;
    if (definition.command) {
      let command = definition.command;
      let args = definition.args ?? [];
      if (command === "npx" || command === "npm") {
        const resolved = await resolveNpxBinary(command, args);
        if (resolved) {
          command = resolved.isJs ? "node" : resolved.binPath;
          args = resolved.isJs ? [resolved.binPath, ...resolved.extraArgs] : resolved.extraArgs;
          logger.debug(`${name} resolved to ${resolved.binPath} (skipping npm parent)`);
        }
      }
      const { StdioClientTransport } = await import("@modelcontextprotocol/sdk/client/stdio.js");
      transport = new StdioClientTransport({
        command,
        args,
        env: resolveEnv(definition.env),
        cwd: resolveConfigPath(definition.cwd),
        stderr: definition.debug ? "inherit" : "ignore"
      });
    } else if (definition.url) {
      transport = await this.createHttpTransport(definition, name, signal);
    } else {
      throw new Error(`Server ${name} has no command or url`);
    }
    const onAbort = () => {
      void client.close().catch(() => {
      });
      void transport.close().catch(() => {
      });
    };
    signal.addEventListener("abort", onAbort, { once: true });
    try {
      signal.throwIfAborted();
      await client.connect(transport, { signal });
      signal.throwIfAborted();
      this.attachAdapterNotificationHandlers(name, client);
      const [tools, resources, resourceTemplates] = await Promise.all([
        this.fetchAllTools(client, signal),
        this.fetchAllResources(client, signal),
        this.fetchAllResourceTemplates(client, signal)
      ]);
      signal.throwIfAborted();
      return {
        client,
        transport,
        definition,
        tools,
        resources,
        resourceTemplates,
        lastUsedAt: Date.now(),
        inFlight: 0,
        status: "connected"
      };
    } catch (error) {
      if (!signal.aborted && isOAuthRejection(error) && supportsOAuth(definition)) {
        await client.close().catch(() => {
        });
        await transport.close().catch(() => {
        });
        return {
          client,
          transport,
          definition,
          tools: [],
          resources: [],
          resourceTemplates: [],
          lastUsedAt: Date.now(),
          inFlight: 0,
          status: "needs-auth"
        };
      }
      await Promise.all([client.close().catch(() => {
      }), transport.close().catch(() => {
      })]);
      throw error;
    } finally {
      signal.removeEventListener("abort", onAbort);
    }
  }
  createClient(serverName) {
    const capabilities = {};
    if (this.samplingConfig) capabilities.sampling = {};
    if (this.elicitationConfig) capabilities.elicitation = {};
    const client = new Client(
      { name: `pi-mcp-${serverName}`, version: "1.0.0" },
      Object.keys(capabilities).length > 0 ? { capabilities } : void 0
    );
    if (this.samplingConfig) {
      registerSamplingHandler(client, { ...this.samplingConfig, serverName });
    }
    if (this.elicitationConfig) {
      registerElicitationHandler(client, { ...this.elicitationConfig, serverName });
    }
    return client;
  }
  async createHttpTransport(definition, serverName, signal) {
    const { StreamableHTTPClientTransport } = await import("@modelcontextprotocol/sdk/client/streamableHttp.js");
    signal.throwIfAborted();
    const url = new URL(definition.url);
    const headers = resolveHeaders(definition.headers) ?? {};
    if (definition.auth === "bearer") {
      const token = definition.bearerToken ?? (definition.bearerTokenEnv ? process.env[definition.bearerTokenEnv] : void 0);
      if (token) {
        headers["Authorization"] = `Bearer ${token}`;
      }
    }
    const requestInit = Object.keys(headers).length > 0 ? { headers } : void 0;
    let authProvider;
    if (supportsOAuth(definition)) {
      const oauthConfig = definition.oauth === false ? {} : {
        grantType: definition.oauth?.grantType,
        clientId: definition.oauth?.clientId,
        clientSecret: definition.oauth?.clientSecret,
        scope: definition.oauth?.scope
      };
      authProvider = new McpOAuthProvider(
        serverName,
        definition.url,
        oauthConfig,
        {
          onRedirect: async (_authUrl) => {
          }
        }
      );
    }
    const streamableTransport = new StreamableHTTPClientTransport(url, {
      requestInit,
      authProvider
    });
    const testClient = new Client({ name: "pi-mcp-probe", version: "2.1.2" });
    const onAbort = () => {
      void testClient.close().catch(() => {
      });
      void streamableTransport.close().catch(() => {
      });
    };
    signal.addEventListener("abort", onAbort, { once: true });
    try {
      signal.throwIfAborted();
      await testClient.connect(streamableTransport, { signal });
      signal.throwIfAborted();
      await testClient.close().catch(() => {
      });
      await streamableTransport.close().catch(() => {
      });
      signal.throwIfAborted();
      return new StreamableHTTPClientTransport(url, { requestInit, authProvider });
    } catch (error) {
      await Promise.all([testClient.close().catch(() => {
      }), streamableTransport.close().catch(() => {
      })]);
      signal.throwIfAborted();
      if (isOAuthRejection(error)) {
        throw error;
      }
      const { SSEClientTransport } = await import("@modelcontextprotocol/sdk/client/sse.js");
      signal.throwIfAborted();
      return new SSEClientTransport(url, { requestInit, authProvider });
    } finally {
      signal.removeEventListener("abort", onAbort);
    }
  }
  async fetchAllTools(client, signal) {
    const allTools = [];
    let cursor;
    do {
      const result = await client.listTools(cursor ? { cursor } : void 0, { signal });
      allTools.push(...result.tools ?? []);
      cursor = result.nextCursor;
    } while (cursor);
    return allTools;
  }
  async fetchAllResources(client, signal) {
    try {
      const allResources = [];
      let cursor;
      do {
        const result = await client.listResources(cursor ? { cursor } : void 0, { signal });
        allResources.push(...result.resources ?? []);
        cursor = result.nextCursor;
      } while (cursor);
      return allResources;
    } catch (error) {
      if (isMethodNotFound(error)) return [];
      logger.warn("MCP resource listing failed; continuing without concrete resources", {
        error: error instanceof Error ? error.message : String(error)
      });
      return [];
    }
  }
  async fetchAllResourceTemplates(client, signal) {
    try {
      const allTemplates = [];
      let cursor;
      do {
        const result = await client.listResourceTemplates(cursor ? { cursor } : void 0, { signal });
        allTemplates.push(...result.resourceTemplates ?? []);
        cursor = result.nextCursor;
      } while (cursor);
      return allTemplates;
    } catch (error) {
      if (isMethodNotFound(error)) return [];
      logger.warn("MCP resource template listing failed; continuing without templates", {
        error: error instanceof Error ? error.message : String(error)
      });
      return [];
    }
  }
  attachAdapterNotificationHandlers(serverName, client) {
    client.setNotificationHandler(serverStreamResultPatchNotificationSchema, (notification) => {
      const listener = this.uiStreamListeners.get(notification.params.streamToken);
      if (!listener) return;
      listener(serverName, notification.params);
    });
    client.setNotificationHandler(ResourceListChangedNotificationSchema, async () => {
      const connection = this.connections.get(serverName);
      if (!connection || connection.status !== "connected") return;
      try {
        const [resources, resourceTemplates] = await Promise.all([
          this.fetchAllResources(client),
          this.fetchAllResourceTemplates(client)
        ]);
        connection.resources = resources;
        connection.resourceTemplates = resourceTemplates;
        this.resourceListChangedCallback?.(serverName);
      } catch (error) {
        logger.error(`Failed to refresh resources for ${serverName}`, error instanceof Error ? error : new Error(String(error)));
      }
    });
  }
  setResourceListChangedCallback(callback) {
    this.resourceListChangedCallback = callback;
  }
  registerUiStreamListener(streamToken, listener) {
    this.uiStreamListeners.set(streamToken, listener);
  }
  removeUiStreamListener(streamToken) {
    this.uiStreamListeners.delete(streamToken);
  }
  async readResource(name, uri, signal) {
    const connection = this.connections.get(name);
    if (!connection || connection.status !== "connected") {
      throw new Error(`Server "${name}" is not connected`);
    }
    try {
      this.touch(name);
      this.incrementInFlight(name);
      return await connection.client.readResource({ uri }, { signal });
    } finally {
      this.decrementInFlight(name);
      this.touch(name);
    }
  }
  async close(name) {
    this.connectPromises.delete(name);
    const controller = this.connectControllers.get(name);
    this.connectControllers.delete(name);
    controller?.abort(new Error(`Connection to ${name} was closed`));
    const connection = this.connections.get(name);
    const previousClose = this.closePromises.get(name);
    if (!connection) return previousClose;
    connection.status = "closed";
    this.connections.delete(name);
    const cleanup = (async () => {
      await connection.client.close().catch(() => {
      });
      await connection.transport.close().catch(() => {
      });
    })();
    const promise = Promise.all([previousClose, cleanup]).then(() => {
    }).finally(() => {
      if (this.closePromises.get(name) === promise) {
        this.closePromises.delete(name);
      }
    });
    this.closePromises.set(name, promise);
    return promise;
  }
  async closeAll() {
    const names = [.../* @__PURE__ */ new Set([...this.connections.keys(), ...this.connectPromises.keys(), ...this.closePromises.keys()])];
    await Promise.all(names.map((name) => this.close(name)));
  }
  getConnection(name) {
    return this.connections.get(name);
  }
  getAllConnections() {
    return new Map(this.connections);
  }
  touch(name) {
    const connection = this.connections.get(name);
    if (connection) {
      connection.lastUsedAt = Date.now();
    }
  }
  incrementInFlight(name) {
    const connection = this.connections.get(name);
    if (connection) {
      connection.inFlight = (connection.inFlight ?? 0) + 1;
    }
  }
  decrementInFlight(name) {
    const connection = this.connections.get(name);
    if (connection && connection.inFlight) {
      connection.inFlight--;
    }
  }
  isIdle(name, timeoutMs) {
    const connection = this.connections.get(name);
    if (!connection || connection.status !== "connected") return false;
    if (connection.inFlight > 0) return false;
    return Date.now() - connection.lastUsedAt > timeoutMs;
  }
};
function resolveEnv(env) {
  const resolved = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== void 0) {
      resolved[key] = value;
    }
  }
  if (!env) return resolved;
  const overrides = interpolateEnvRecord(env);
  return overrides ? { ...resolved, ...overrides } : resolved;
}
function resolveHeaders(headers) {
  return interpolateEnvRecord(headers);
}

// tool-metadata.ts
import { getToolUiResourceUri as getToolUiResourceUri2 } from "@modelcontextprotocol/ext-apps/app-bridge";
function buildToolMetadata(tools, resources, definition, serverName, prefix) {
  const metadata = [];
  const failedTools = [];
  for (const tool of tools) {
    if (!tool?.name) {
      failedTools.push("(unnamed)");
      continue;
    }
    if (isToolExcluded(tool.name, serverName, prefix, definition.excludeTools)) {
      continue;
    }
    let uiResourceUri;
    try {
      uiResourceUri = getToolUiResourceUri2({ _meta: tool._meta });
    } catch {
      failedTools.push(tool.name);
    }
    metadata.push({
      name: formatToolName(tool.name, serverName, prefix),
      originalName: tool.name,
      description: getEffectiveToolDescription(definition, tool.name, tool.description),
      inputSchema: tool.inputSchema,
      uiResourceUri,
      uiStreamMode: extractToolUiStreamMode(tool._meta)
    });
  }
  if (definition.exposeResources !== false) {
    const baseNames = resourceToolBaseNames(resources, tools.map((tool) => tool.name));
    for (const [index, resource] of resources.entries()) {
      const baseName = baseNames[index];
      if (isToolExcluded(baseName, serverName, prefix, definition.excludeTools)) {
        continue;
      }
      metadata.push({
        name: formatToolName(baseName, serverName, prefix),
        originalName: baseName,
        description: resource.description ?? `Read resource: ${resource.uri}`,
        resourceUri: resource.uri,
        resourceTitle: resource.title,
        resourceMimeType: resource.mimeType,
        resourceAnnotations: resource.annotations,
        resourceMeta: resource._meta
      });
    }
  }
  return { metadata, failedTools };
}
function getToolNames(state, serverName) {
  return state.toolMetadata.get(serverName)?.map((m) => m.name) ?? [];
}
function totalToolCount(state) {
  let count = 0;
  for (const metadata of state.toolMetadata.values()) {
    count += metadata.length;
  }
  return count;
}
function findToolByName(metadata, toolName) {
  if (!metadata) return void 0;
  const exact = metadata.find((m) => m.name === toolName);
  if (exact) return exact;
  const normalized = toolName.replace(/-/g, "_");
  const byPrefixed = metadata.find((m) => m.name.replace(/-/g, "_") === normalized);
  if (byPrefixed) return byPrefixed;
  const byOriginal = metadata.find((m) => m.originalName === toolName);
  if (byOriginal) return byOriginal;
  return metadata.find((m) => m.originalName.replace(/-/g, "_") === normalized);
}
function formatSchema(schema, indent = "  ") {
  if (!schema || typeof schema !== "object") {
    return `${indent}(no schema)`;
  }
  const s = schema;
  if (s.type === "object" && s.properties && typeof s.properties === "object") {
    const props = s.properties;
    const required = Array.isArray(s.required) ? s.required : [];
    if (Object.keys(props).length === 0) {
      return `${indent}(no parameters)`;
    }
    const lines = [];
    for (const [name, propSchema] of Object.entries(props)) {
      const isRequired = required.includes(name);
      const propLine = formatProperty(name, propSchema, isRequired, indent);
      lines.push(propLine);
    }
    return lines.join("\n");
  }
  if (s.type) {
    return `${indent}(${s.type})`;
  }
  return `${indent}(complex schema)`;
}
function formatProperty(name, schema, required, indent) {
  if (!schema || typeof schema !== "object") {
    return `${indent}${name}${required ? " *required*" : ""}`;
  }
  const s = schema;
  const parts = [];
  let typeStr = "";
  if (s.type) {
    if (Array.isArray(s.type)) {
      typeStr = s.type.join(" | ");
    } else {
      typeStr = String(s.type);
    }
  } else if (s.enum) {
    typeStr = "enum";
  } else if (s.anyOf || s.oneOf) {
    typeStr = "union";
  }
  if (Array.isArray(s.enum)) {
    const enumVals = s.enum.map((v) => JSON.stringify(v)).join(", ");
    typeStr = `enum: ${enumVals}`;
  }
  parts.push(`${indent}${name}`);
  if (typeStr) parts.push(`(${typeStr})`);
  if (required) parts.push("*required*");
  if (s.description && typeof s.description === "string") {
    parts.push(`- ${s.description}`);
  }
  if (s.default !== void 0) {
    parts.push(`[default: ${JSON.stringify(s.default)}]`);
  }
  return parts.join(" ");
}

// ui-resource-handler.ts
import { RESOURCE_MIME_TYPE } from "@modelcontextprotocol/ext-apps/app-bridge";
var UiResourceHandler = class {
  constructor(manager) {
    this.manager = manager;
  }
  manager;
  log = logger.child({ component: "UiResourceHandler" });
  async readUiResource(serverName, uri) {
    const log = this.log.child({ server: serverName, uri });
    if (!uri.startsWith("ui://")) {
      throw new ResourceParseError(uri, "URI must start with ui://", { server: serverName });
    }
    log.debug("Fetching UI resource");
    let result;
    try {
      result = await this.manager.readResource(serverName, uri);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log.error("Failed to read resource", error instanceof Error ? error : void 0);
      throw new ResourceFetchError(uri, message, {
        server: serverName,
        cause: error instanceof Error ? error : void 0
      });
    }
    const content = selectContent(result, uri);
    const mimeType = content.mimeType;
    if (mimeType && !isHtmlMimeType(mimeType)) {
      log.warn("Unsupported MIME type", { mimeType });
      throw new ResourceParseError(
        uri,
        `unsupported MIME type "${mimeType}" (expected text/html or ${RESOURCE_MIME_TYPE})`,
        { server: serverName, mimeType }
      );
    }
    const html = toHtml(content);
    if (!html.trim()) {
      log.warn("Resource content is empty");
      throw new ResourceParseError(uri, "content is empty", { server: serverName });
    }
    const contentMeta = extractUiMeta(content._meta);
    const listMeta = extractUiMeta(this.getListResourceMeta(serverName, uri));
    log.debug("Resource loaded successfully", {
      contentLength: html.length,
      hasCsp: !!contentMeta.csp || !!listMeta.csp
    });
    return {
      uri: content.uri ?? uri,
      html,
      mimeType: mimeType ?? RESOURCE_MIME_TYPE,
      meta: {
        csp: contentMeta.csp ?? listMeta.csp,
        permissions: contentMeta.permissions ?? listMeta.permissions,
        domain: contentMeta.domain ?? listMeta.domain,
        prefersBorder: contentMeta.prefersBorder ?? listMeta.prefersBorder
      }
    };
  }
  getListResourceMeta(serverName, uri) {
    const connection = this.manager.getConnection(serverName);
    if (!connection?.resources?.length) return void 0;
    const resource = connection.resources.find((entry) => entry.uri === uri);
    if (!resource || !resource._meta || typeof resource._meta !== "object") return void 0;
    return resource._meta;
  }
};
function selectContent(result, preferredUri) {
  const contents = result.contents ?? [];
  if (contents.length === 0) {
    throw new Error(`No contents returned for UI resource: ${preferredUri}`);
  }
  const byUri = contents.find((content) => content.uri === preferredUri);
  if (byUri) return byUri;
  const byHtmlMime = contents.find(
    (content) => content.mimeType && isHtmlMimeType(content.mimeType)
  );
  if (byHtmlMime) return byHtmlMime;
  return contents[0];
}
function isHtmlMimeType(mimeType) {
  const normalized = mimeType.toLowerCase();
  return normalized.startsWith("text/html") || normalized === RESOURCE_MIME_TYPE.toLowerCase();
}
function toHtml(content) {
  if (typeof content.text === "string") {
    return content.text;
  }
  if (typeof content.blob === "string") {
    return Buffer.from(content.blob, "base64").toString("utf-8");
  }
  throw new Error(`UI resource ${content.uri ?? "(unknown)"} did not include text or blob content`);
}
function extractUiMeta(meta) {
  if (!meta || typeof meta !== "object") return {};
  const ui = meta.ui;
  if (!ui || typeof ui !== "object") return {};
  const out = {};
  if (ui.csp && typeof ui.csp === "object") {
    out.csp = ui.csp;
  }
  if (ui.permissions && typeof ui.permissions === "object") {
    out.permissions = ui.permissions;
  }
  if (typeof ui.domain === "string") {
    out.domain = ui.domain;
  }
  if (typeof ui.prefersBorder === "boolean") {
    out.prefersBorder = ui.prefersBorder;
  }
  return out;
}

// tool-registrar.ts
function transformMcpContent(content) {
  return content.map((c) => {
    if (c.type === "text") {
      return { type: "text", text: c.text ?? "" };
    }
    if (c.type === "image") {
      return {
        type: "image",
        data: c.data ?? "",
        mimeType: c.mimeType ?? "image/png"
      };
    }
    if (c.type === "resource") {
      const resourceUri = c.resource?.uri ?? "(no URI)";
      const resourceContent = c.resource?.text ?? (c.resource ? JSON.stringify(c.resource) : "(no content)");
      return {
        type: "text",
        text: `[Resource: ${resourceUri}]
${resourceContent}`
      };
    }
    if (c.type === "resource_link") {
      const linkName = c.name ?? c.uri ?? "unknown";
      const linkUri = c.uri ?? "(no URI)";
      return {
        type: "text",
        text: `[Resource Link: ${linkName}]
URI: ${linkUri}`
      };
    }
    if (c.type === "audio") {
      return {
        type: "text",
        text: `[Audio content: ${c.mimeType ?? "audio/*"}]`
      };
    }
    return { type: "text", text: JSON.stringify(c) };
  });
}

// response-cap.ts
import { randomUUID } from "node:crypto";
import { writeFileSync as writeFileSync6 } from "node:fs";
import { tmpdir } from "node:os";
import { join as join6 } from "node:path";
import {
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_LINES,
  formatSize,
  truncateHead
} from "@earendil-works/pi-coding-agent";
function resolveLimits(settings) {
  const maxBytes = settings?.maxResponseBytes ?? DEFAULT_MAX_BYTES;
  const maxLines = settings?.maxResponseLines ?? DEFAULT_MAX_LINES;
  return { maxBytes, maxLines };
}
function cappingDisabled(limits) {
  return limits.maxBytes <= 0;
}
function sanitizeLabel(label) {
  if (!label) return "mcp";
  const cleaned = label.replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
  return cleaned.slice(0, 40) || "mcp";
}
function writeFullOutput(label, fullText) {
  try {
    const path = join6(tmpdir(), `pi-mcp-${sanitizeLabel(label)}-${randomUUID().slice(0, 8)}.txt`);
    writeFileSync6(path, fullText, "utf-8");
    return path;
  } catch {
    return void 0;
  }
}
function capText(text, label, settings) {
  const limits = resolveLimits(settings);
  if (cappingDisabled(limits)) {
    return { text, truncated: false };
  }
  const truncation = truncateHead(text, { maxBytes: limits.maxBytes, maxLines: limits.maxLines });
  if (!truncation.truncated) {
    return { text, truncated: false };
  }
  const fullOutputPath = writeFullOutput(label ?? "mcp", text);
  const fullRef = fullOutputPath ? ` Full output: ${fullOutputPath}` : "";
  let notice;
  if (truncation.firstLineExceedsLimit) {
    notice = `[Truncated: first line exceeds ${formatSize(limits.maxBytes)} limit (line is ${formatSize(truncation.totalBytes)}).${fullRef}]`;
  } else if (truncation.truncatedBy === "lines") {
    notice = `[Truncated: showing ${truncation.outputLines} of ${truncation.totalLines} lines.${fullRef}]`;
  } else {
    notice = `[Truncated: showing ${formatSize(truncation.outputBytes)} of ${formatSize(truncation.totalBytes)} (${formatSize(limits.maxBytes)} limit).${fullRef}]`;
  }
  const body = truncation.content ? `${truncation.content}

` : "";
  return { text: `${body}${notice}`, truncated: true, fullOutputPath };
}
function capContentBlocks(content, label, settings) {
  const limits = resolveLimits(settings);
  if (cappingDisabled(limits) || content.length === 0) {
    return { content, truncated: false };
  }
  const textBlocks = content.filter((b) => b.type === "text");
  if (textBlocks.length === 0) {
    return { content, truncated: false };
  }
  const joined = textBlocks.map((b) => b.text ?? "").join("\n");
  const result = capText(joined, label, settings);
  if (!result.truncated) {
    return { content, truncated: false };
  }
  const firstTextIndex = content.findIndex((b) => b.type === "text");
  const rebuilt = [];
  let inserted = false;
  content.forEach((block, index) => {
    if (block.type === "text") {
      if (index === firstTextIndex && !inserted) {
        rebuilt.push({ type: "text", text: result.text });
        inserted = true;
      }
      return;
    }
    rebuilt.push(block);
  });
  return { content: rebuilt, truncated: true, fullOutputPath: result.fullOutputPath };
}

// ui-session.ts
import { randomUUID as randomUUID2 } from "node:crypto";

// glimpse-ui.ts
import { existsSync as existsSync5 } from "node:fs";
import { execFileSync } from "node:child_process";
import { join as join7, dirname as dirname5 } from "node:path";
import { platform as platform2 } from "node:os";
import { createRequire } from "node:module";
var glimpseAvailable = null;
var resolvedBinaryPath = null;
function isGlimpseAvailable() {
  if (glimpseAvailable !== null) return glimpseAvailable;
  if (platform2() !== "darwin") {
    glimpseAvailable = false;
    return false;
  }
  resolvedBinaryPath = getGlimpseBinaryPath();
  glimpseAvailable = resolvedBinaryPath !== null;
  return glimpseAvailable;
}
function getGlimpseBinaryPath() {
  if (process.env.GLIMPSE_BINARY && existsSync5(process.env.GLIMPSE_BINARY)) {
    return process.env.GLIMPSE_BINARY;
  }
  try {
    const require2 = createRequire(import.meta.url);
    const glimpseuiPath = require2.resolve("glimpseui");
    const binaryPath = join7(dirname5(glimpseuiPath), "glimpse");
    if (existsSync5(binaryPath)) return binaryPath;
  } catch {
  }
  try {
    const globalRoot = execFileSync("npm", ["root", "-g"], { encoding: "utf-8" }).trim();
    const binaryPath = join7(globalRoot, "glimpseui", "src", "glimpse");
    if (existsSync5(binaryPath)) return binaryPath;
  } catch {
  }
  return null;
}
async function openGlimpseWindow(html, options) {
  const modulePath = resolvedBinaryPath ? join7(dirname5(resolvedBinaryPath), "glimpse.mjs") : "glimpseui";
  const glimpse = await import(modulePath);
  let active = true;
  const win = glimpse.open(html, {
    width: options.width ?? 900,
    height: options.height ?? 700,
    title: options.title
  });
  win.on("closed", () => {
    if (!active) return;
    active = false;
    options.onClosed();
  });
  return {
    close: () => {
      if (!active) return;
      active = false;
      win.close();
    }
  };
}

// ui-session.ts
var activeGlimpseWindow = null;
var MAX_COMPLETED_SESSIONS = 10;
function withStreamEnvelope(result, streamId, sequence) {
  if (!streamId) {
    return result;
  }
  const structuredContent = result.structuredContent && typeof result.structuredContent === "object" && !Array.isArray(result.structuredContent) ? { ...result.structuredContent } : {};
  const rawEnvelope = structuredContent[UI_STREAM_STRUCTURED_CONTENT_KEY];
  const envelope = rawEnvelope && typeof rawEnvelope === "object" && !Array.isArray(rawEnvelope) ? { ...rawEnvelope } : {
    frameType: "final",
    phase: "settled",
    status: result.isError ? "error" : "ok"
  };
  structuredContent[UI_STREAM_STRUCTURED_CONTENT_KEY] = {
    ...envelope,
    streamId,
    sequence
  };
  return {
    ...result,
    structuredContent
  };
}
async function openInBrowser(state, url) {
  try {
    await state.openBrowser(url);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    state.ui?.notify(`MCP UI browser open failed: ${message}`, "warning");
    state.ui?.notify(`Open manually: ${url}`, "info");
  }
}
async function maybeStartUiSession(state, request) {
  const log = logger.child({
    component: "UiSession",
    server: request.serverName,
    tool: request.toolName
  });
  try {
    if (state.uiServer && state.uiServer.serverName === request.serverName && state.uiServer.toolName === request.toolName) {
      const existingHandle = state.uiServer;
      const streamMode2 = request.streamMode;
      const streamId2 = streamMode2 ? randomUUID2() : void 0;
      const streamToken2 = streamMode2 ? randomUUID2() : void 0;
      let active2 = true;
      let nextStreamSequence2 = 0;
      const cleanupStreamListener2 = () => {
        if (streamToken2) {
          state.manager.removeUiStreamListener(streamToken2);
        }
      };
      existingHandle.sendToolInput(request.toolArgs);
      if (streamToken2) {
        state.manager.registerUiStreamListener(streamToken2, (serverName, notification) => {
          if (!active2 || state.uiServer !== existingHandle) return;
          if (serverName !== request.serverName) return;
          nextStreamSequence2 += 1;
          existingHandle.sendResultPatch(
            withStreamEnvelope(notification.result, streamId2, nextStreamSequence2)
          );
        });
      }
      return {
        serverName: request.serverName,
        toolName: request.toolName,
        reused: true,
        streamId: streamId2,
        streamToken: streamToken2,
        streamMode: streamMode2,
        requestMeta: streamToken2 ? { [UI_STREAM_REQUEST_META_KEY]: streamToken2 } : void 0,
        url: existingHandle.url,
        isActive: () => active2 && state.uiServer === existingHandle,
        sendToolResult: (result) => {
          if (!active2 || state.uiServer !== existingHandle) return;
          nextStreamSequence2 += 1;
          existingHandle.sendToolResult(withStreamEnvelope(result, streamId2, nextStreamSequence2));
        },
        sendResultPatch: (result) => {
          if (!active2 || state.uiServer !== existingHandle) return;
          nextStreamSequence2 += 1;
          existingHandle.sendResultPatch(withStreamEnvelope(result, streamId2, nextStreamSequence2));
        },
        sendToolCancelled: (reason) => {
          if (!active2 || state.uiServer !== existingHandle) return;
          nextStreamSequence2 += 1;
          existingHandle.sendToolResult(
            withStreamEnvelope(
              {
                isError: true,
                content: [{ type: "text", text: reason }]
              },
              streamId2,
              nextStreamSequence2
            )
          );
        },
        close: () => {
          active2 = false;
          cleanupStreamListener2();
        }
      };
    }
    const resource = await state.uiResourceHandler.readUiResource(request.serverName, request.uiResourceUri);
    if (state.uiServer) {
      state.uiServer.close("replaced");
      state.uiServer = null;
    }
    if (activeGlimpseWindow) {
      activeGlimpseWindow.close();
      activeGlimpseWindow = null;
    }
    const streamMode = request.streamMode;
    const streamId = streamMode ? randomUUID2() : void 0;
    const streamToken = streamMode ? randomUUID2() : void 0;
    const hostContext = streamMode && streamId ? {
      [UI_STREAM_HOST_CONTEXT_KEY]: {
        mode: streamMode,
        streamId,
        intermediateResultPatches: streamMode === "stream-first",
        partialInput: false
      }
    } : void 0;
    let active = true;
    let nextStreamSequence = 0;
    let handle = null;
    const cleanupStreamListener = () => {
      if (streamToken) {
        state.manager.removeUiStreamListener(streamToken);
      }
    };
    const { startUiServer } = await import("./ui-server-UVKKBVQW.ts");
    handle = await startUiServer({
      serverName: request.serverName,
      toolName: request.toolName,
      toolArgs: streamMode === "stream-first" ? {} : request.toolArgs,
      resource,
      manager: state.manager,
      consentManager: state.consentManager,
      hostContext,
      piSessionId: state.sessionId,
      onMessage: (params) => {
        const prompt = extractUiPromptText(params);
        if (prompt) {
          if (state.sendMessage) {
            state.sendMessage(
              {
                customType: "mcp-ui-prompt",
                content: [{ type: "text", text: `User sent prompt from ${request.serverName} UI: "${prompt}"` }],
                display: true,
                details: { server: request.serverName, tool: request.toolName, prompt }
              },
              { triggerTurn: true }
            );
            log.debug("Triggered agent turn for UI prompt", { prompt: prompt.slice(0, 50) });
          }
        } else if (params.type === "intent" || params.intent) {
          const intent = params.intent ?? "";
          const intentParams = params.params;
          if (intent && state.sendMessage) {
            const paramsStr = intentParams ? ` ${JSON.stringify(intentParams)}` : "";
            state.sendMessage(
              {
                customType: "mcp-ui-intent",
                content: [{ type: "text", text: `User triggered intent from ${request.serverName} UI: ${intent}${paramsStr}` }],
                display: true,
                details: { server: request.serverName, tool: request.toolName, intent, params: intentParams }
              },
              { triggerTurn: true }
            );
            log.debug("Triggered agent turn for UI intent", { intent });
          }
        } else if (params.type === "notify" || params.message) {
          const text = params.message ?? "";
          if (text && state.ui) {
            state.ui.notify(`[${request.serverName}] ${text}`, "info");
          }
        }
      },
      onContextUpdate: (params) => {
        log.debug("Model context update from UI", {
          hasContent: !!params.content,
          hasStructured: !!params.structuredContent
        });
      },
      onComplete: (reason) => {
        active = false;
        cleanupStreamListener();
        if (handle && state.uiServer === handle) {
          const messages = handle.getSessionMessages();
          const stream = handle.getStreamSummary();
          const hasContent = messages.prompts.length > 0 || messages.intents.length > 0 || messages.notifications.length > 0 || !!stream;
          if (hasContent) {
            state.completedUiSessions.push({
              serverName: handle.serverName,
              toolName: handle.toolName,
              completedAt: /* @__PURE__ */ new Date(),
              reason,
              messages,
              stream
            });
            while (state.completedUiSessions.length > MAX_COMPLETED_SESSIONS) {
              state.completedUiSessions.shift();
            }
            log.debug("Session completed", {
              reason,
              prompts: messages.prompts.length,
              intents: messages.intents.length,
              notifications: messages.notifications.length,
              streamFrames: stream?.frames ?? 0
            });
          }
          state.uiServer = null;
          if (activeGlimpseWindow) {
            activeGlimpseWindow.close();
            activeGlimpseWindow = null;
          }
        }
      }
    });
    if (streamToken) {
      state.manager.registerUiStreamListener(streamToken, (serverName, notification) => {
        if (!active || state.uiServer !== handle) return;
        if (serverName !== request.serverName) return;
        nextStreamSequence += 1;
        handle.sendResultPatch(withStreamEnvelope(notification.result, streamId, nextStreamSequence));
      });
    }
    state.uiServer = handle;
    const glimpseDetected = isGlimpseAvailable();
    const viewerPref = process.env.MCP_UI_VIEWER?.toLowerCase();
    const useGlimpse = viewerPref === "glimpse" || viewerPref !== "browser" && glimpseDetected;
    if (useGlimpse) {
      try {
        const glimpseHtml = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>body{margin:0;padding:0;width:100vw;height:100vh;overflow:hidden}iframe{width:100%;height:100%;border:none}</style></head><body><iframe src="${handle.url}"></iframe></body></html>`;
        activeGlimpseWindow = await openGlimpseWindow(glimpseHtml, {
          title: `MCP \xB7 ${request.serverName} \xB7 ${request.toolName}`,
          width: 1e3,
          height: 800,
          onClosed: () => {
            if (active) handle.close("glimpse-closed");
          }
        });
      } catch (error) {
        log.debug("Glimpse unavailable, using browser", {
          error: error instanceof Error ? error.message : String(error)
        });
        await openInBrowser(state, handle.url);
      }
    } else {
      await openInBrowser(state, handle.url);
    }
    return {
      serverName: request.serverName,
      toolName: request.toolName,
      reused: false,
      streamId,
      streamToken,
      streamMode,
      requestMeta: streamToken ? { [UI_STREAM_REQUEST_META_KEY]: streamToken } : void 0,
      url: handle.url,
      isActive: () => active && state.uiServer === handle,
      sendToolResult: (result) => {
        if (!active || state.uiServer !== handle) return;
        nextStreamSequence += 1;
        handle.sendToolResult(withStreamEnvelope(result, streamId, nextStreamSequence));
      },
      sendResultPatch: (result) => {
        if (!active || state.uiServer !== handle) return;
        nextStreamSequence += 1;
        handle.sendResultPatch(withStreamEnvelope(result, streamId, nextStreamSequence));
      },
      sendToolCancelled: (reason) => {
        if (!active || state.uiServer !== handle) return;
        handle.sendToolCancelled(reason);
      },
      close: (reason) => {
        active = false;
        cleanupStreamListener();
        handle.close(reason);
      }
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.error("Failed to start UI session", error instanceof Error ? error : void 0);
    state.ui?.notify(
      `MCP UI unavailable for ${request.toolName} (${request.serverName}): ${message}`,
      "warning"
    );
    return null;
  }
}

// direct-tools.ts
var BUILTIN_NAMES = /* @__PURE__ */ new Set(["read", "bash", "edit", "write", "grep", "find", "ls", "mcp"]);
function getDirectAuthRequiredMessage(state, serverName, defaultMessage = `MCP server "${serverName}" requires OAuth authentication. Run /mcp-auth ${serverName} first.`) {
  return formatAuthRequiredMessage(state.config, serverName, defaultMessage);
}
function getDirectAuthFailedMessage(state, serverName, message) {
  const customGuidance = state.config.settings?.authRequiredMessage;
  if (customGuidance) {
    return `OAuth authentication failed for "${serverName}": ${message}. ${getDirectAuthRequiredMessage(state, serverName)}`;
  }
  return `OAuth authentication failed for "${serverName}": ${message}. Run /mcp-auth ${serverName} first.`;
}
async function attemptDirectAutoAuth(state, serverName) {
  if (state.config.settings?.autoAuth !== true) {
    return { status: "skipped" };
  }
  const definition = state.config.mcpServers[serverName];
  if (!definition || !supportsOAuth(definition) || !definition.url) {
    return { status: "skipped" };
  }
  const grantType = definition.oauth?.grantType ?? "authorization_code";
  if (!state.ui && grantType !== "client_credentials") {
    return {
      status: "failed",
      message: getDirectAuthRequiredMessage(
        state,
        serverName,
        `MCP server "${serverName}" requires OAuth authentication. Run /mcp-auth ${serverName} in an interactive session.`
      )
    };
  }
  try {
    await authenticate(serverName, definition.url, definition);
    return { status: "success" };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      status: "failed",
      message: getDirectAuthFailedMessage(state, serverName, message)
    };
  }
}
function resolveDirectTools(config, cache, prefix, envOverride) {
  const specs = [];
  if (!cache) return specs;
  const seenNames = /* @__PURE__ */ new Set();
  const envServers = /* @__PURE__ */ new Set();
  const envTools = /* @__PURE__ */ new Map();
  if (envOverride) {
    for (let item of envOverride) {
      item = item.replace(/\/+$/, "");
      if (item.includes("/")) {
        const [server2, tool] = item.split("/", 2);
        if (server2 && tool) {
          if (!envTools.has(server2)) envTools.set(server2, /* @__PURE__ */ new Set());
          envTools.get(server2).add(tool);
        } else if (server2) {
          envServers.add(server2);
        }
      } else if (item) {
        envServers.add(item);
      }
    }
  }
  const globalDirect = config.settings?.directTools;
  for (const [serverName, definition] of Object.entries(config.mcpServers)) {
    const serverCache = cache.servers[serverName];
    if (!serverCache || !isServerCacheValid(serverCache, definition)) continue;
    let toolFilter = false;
    if (envOverride) {
      if (envServers.has(serverName)) {
        toolFilter = true;
      } else if (envTools.has(serverName)) {
        toolFilter = [...envTools.get(serverName)];
      }
    } else {
      if (definition.directTools !== void 0) {
        toolFilter = definition.directTools;
      } else if (globalDirect) {
        toolFilter = globalDirect;
      }
    }
    if (!toolFilter) continue;
    for (const tool of serverCache.tools ?? []) {
      if (toolFilter !== true && !toolFilter.includes(tool.name)) continue;
      if (isToolExcluded(tool.name, serverName, prefix, definition.excludeTools)) continue;
      const prefixedName = formatToolName(tool.name, serverName, prefix);
      if (BUILTIN_NAMES.has(prefixedName)) {
        logger.warn(`MCP: skipping direct tool "${prefixedName}" (collides with builtin)`);
        continue;
      }
      if (seenNames.has(prefixedName)) {
        logger.warn(`MCP: skipping duplicate direct tool "${prefixedName}" from "${serverName}"`);
        continue;
      }
      seenNames.add(prefixedName);
      specs.push({
        serverName,
        originalName: tool.name,
        prefixedName,
        description: getEffectiveToolDescription(definition, tool.name, tool.description),
        inputSchema: tool.inputSchema,
        uiResourceUri: tool.uiResourceUri,
        uiStreamMode: tool.uiStreamMode
      });
    }
    if (definition.exposeResources !== false) {
      const resources = serverCache.resources ?? [];
      const resourceNames = resourceToolBaseNames(resources, serverCache.tools?.map((tool) => tool.name));
      for (const [index, resource] of resources.entries()) {
        const baseName = resourceNames[index];
        if (toolFilter !== true && !toolFilter.includes(baseName)) continue;
        if (isToolExcluded(baseName, serverName, prefix, definition.excludeTools)) continue;
        const prefixedName = formatToolName(baseName, serverName, prefix);
        if (BUILTIN_NAMES.has(prefixedName)) {
          logger.warn(`MCP: skipping direct resource tool "${prefixedName}" (collides with builtin)`);
          continue;
        }
        if (seenNames.has(prefixedName)) {
          logger.warn(`MCP: skipping duplicate direct resource tool "${prefixedName}" from "${serverName}"`);
          continue;
        }
        seenNames.add(prefixedName);
        specs.push({
          serverName,
          originalName: baseName,
          prefixedName,
          description: resource.description ?? `Read resource: ${resource.uri}`,
          resourceUri: resource.uri
        });
      }
    }
  }
  return specs;
}
function getMissingConfiguredDirectToolServers(config, cache) {
  const missing = [];
  const globalDirect = config.settings?.directTools;
  for (const [serverName, definition] of Object.entries(config.mcpServers)) {
    const hasDirectTools = definition.directTools !== void 0 ? !!definition.directTools : !!globalDirect;
    if (!hasDirectTools) continue;
    const serverCache = cache?.servers?.[serverName];
    if (!serverCache || !isServerCacheValid(serverCache, definition)) {
      missing.push(serverName);
    }
  }
  return missing;
}
function buildProxyDescription(config, cache, directSpecs) {
  const prefix = config.settings?.toolPrefix ?? "server";
  let desc = `MCP gateway - connect to MCP servers and call their tools. Non-MCP Pi tools should be called directly, not through mcp.
`;
  const directByServer = /* @__PURE__ */ new Map();
  for (const spec of directSpecs) {
    directByServer.set(spec.serverName, (directByServer.get(spec.serverName) ?? 0) + 1);
  }
  if (directByServer.size > 0) {
    const parts = [...directByServer.entries()].map(
      ([server2, count]) => `${server2} (${count})`
    );
    desc += `
Direct tools available (call as normal tools): ${parts.join(", ")}
`;
  }
  const serverSummaries = [];
  for (const serverName of Object.keys(config.mcpServers)) {
    const entry = cache?.servers?.[serverName];
    const definition = config.mcpServers[serverName];
    const toolCount = (entry?.tools ?? []).filter(
      (tool) => !isToolExcluded(tool.name, serverName, prefix, definition.excludeTools)
    ).length;
    const resources = entry?.resources ?? [];
    const resourceNames = resourceToolBaseNames(resources, entry?.tools?.map((tool) => tool.name));
    const resourceCount = definition?.exposeResources !== false ? resources.filter((_resource, index) => {
      const baseName = resourceNames[index];
      return !isToolExcluded(baseName, serverName, prefix, definition.excludeTools);
    }).length : 0;
    const totalItems = toolCount + resourceCount;
    if (totalItems === 0) continue;
    const directCount = directByServer.get(serverName) ?? 0;
    const proxyCount = totalItems - directCount;
    if (proxyCount > 0) {
      const summary = `${serverName} (${proxyCount} tools)`;
      serverSummaries.push(definition.description ? `${summary} - ${definition.description}` : summary);
    }
  }
  if (serverSummaries.length > 0) {
    desc += `
<mcp_servers>
${serverSummaries.join("\n")}
</mcp_servers>
`;
  }
  const promotedLines = [];
  for (const [serverName, definition] of Object.entries(config.mcpServers)) {
    const promotedTools = definition.promotedTools ?? [];
    if (promotedTools.length === 0) continue;
    const entry = cache?.servers?.[serverName];
    if (!entry || !isServerCacheValid(entry, definition)) continue;
    const promotedSet = new Set(promotedTools);
    for (const tool of entry.tools ?? []) {
      if (!promotedSet.has(tool.name)) continue;
      if (isToolExcluded(tool.name, serverName, prefix, definition.excludeTools)) continue;
      const toolName = formatToolName(tool.name, serverName, prefix);
      promotedLines.push(`<mcp_tool name="${toolName}" server="${serverName}">`);
      promotedLines.push(getEffectiveToolDescription(definition, tool.name, tool.description) || "(no description)");
      promotedLines.push(`  Parameters:`);
      promotedLines.push(formatSchema(tool.inputSchema, "    "));
      promotedLines.push(`</mcp_tool>`);
    }
    if (definition.exposeResources !== false) {
      const resources = entry.resources ?? [];
      const resourceNames = resourceToolBaseNames(resources, entry.tools?.map((tool) => tool.name));
      for (const [index, resource] of resources.entries()) {
        const baseName = resourceNames[index];
        if (!promotedSet.has(baseName)) continue;
        if (isToolExcluded(baseName, serverName, prefix, definition.excludeTools)) continue;
        const toolName = formatToolName(baseName, serverName, prefix);
        promotedLines.push(`<mcp_tool name="${toolName}" server="${serverName}">`);
        promotedLines.push(resource.description || `Read resource: ${resource.uri}`);
        promotedLines.push(`  Parameters:`);
        promotedLines.push(formatSchema(void 0, "    "));
        promotedLines.push(`</mcp_tool>`);
      }
    }
  }
  if (promotedLines.length > 0) {
    desc += `
<mcp_tool_schemas>
${promotedLines.join("\n")}
</mcp_tool_schemas>
`;
  }
  desc += `
Usage:
`;
  desc += `  mcp({ })                              \u2192 Show server status
`;
  desc += `  mcp({ server: "name" })               \u2192 List tools from server
`;
  desc += `  mcp({ search: "query" })              \u2192 Search MCP tools by name/description
`;
  desc += `  mcp({ describe: "tool_name" })        \u2192 Show tool details and parameters
`;
  desc += `  mcp({ connect: "server-name" })       \u2192 Connect to a server and refresh metadata
`;
  desc += `  mcp({ tool: "name", args: {"key": "value"} })      \u2192 Call a tool (JSON string also accepted)
`;
  desc += `  mcp({ resource: "uri", server: "name" }) \u2192 Read a concrete or template-expanded resource URI
`;
  desc += `  mcp({ action: "ui-messages" })        \u2192 Retrieve accumulated messages from completed UI sessions
`;
  desc += `
Mode: tool (call) > connect > describe > search > server (list) > action > nothing (status)`;
  return desc;
}
function createDirectToolExecutor(getState, getInitPromise, spec) {
  return async function execute(_toolCallId, params, signal) {
    if (signal?.aborted) {
      return {
        content: [{ type: "text", text: "Tool call cancelled before execution." }],
        isError: true,
        details: { error: "aborted", server: spec.serverName }
      };
    }
    let state = getState();
    const initPromise = getInitPromise();
    if (!state && initPromise) {
      try {
        state = await initPromise;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: "text", text: `MCP initialization failed: ${message}` }],
          isError: true,
          details: { error: "init_failed", message }
        };
      }
    }
    if (!state) {
      return {
        content: [{ type: "text", text: "MCP not initialized" }],
        isError: true,
        details: { error: "not_initialized" }
      };
    }
    let connected = await lazyConnect(state, spec.serverName);
    let autoAuthAttempted = false;
    if (!connected && state.manager.getConnection(spec.serverName)?.status === "needs-auth") {
      autoAuthAttempted = true;
      const autoAuth = await attemptDirectAutoAuth(state, spec.serverName);
      if (autoAuth.status === "failed") {
        return {
          content: [{ type: "text", text: autoAuth.message }],
          isError: true,
          details: { error: "auth_required", server: spec.serverName, message: autoAuth.message }
        };
      }
      if (autoAuth.status === "success") {
        await state.manager.close(spec.serverName);
        state.failureTracker.delete(spec.serverName);
        connected = await lazyConnect(state, spec.serverName);
      }
    }
    if (!connected) {
      const authConnection = state.manager.getConnection(spec.serverName);
      if (authConnection?.status === "needs-auth") {
        const message = getDirectAuthRequiredMessage(state, spec.serverName);
        return {
          content: [{ type: "text", text: message }],
          isError: true,
          details: { error: "auth_required", server: spec.serverName, message, autoAuthAttempted }
        };
      }
      const failedAgo = getFailureAgeSeconds(state, spec.serverName);
      return {
        content: [{ type: "text", text: `MCP server "${spec.serverName}" not available${failedAgo !== null ? ` (failed ${failedAgo}s ago)` : ""}` }],
        isError: true,
        details: { error: "server_unavailable", server: spec.serverName }
      };
    }
    const connection = state.manager.getConnection(spec.serverName);
    if (!connection || connection.status !== "connected") {
      return {
        content: [{ type: "text", text: `MCP server "${spec.serverName}" not connected` }],
        isError: true,
        details: { error: "not_connected", server: spec.serverName }
      };
    }
    let uiSession = null;
    try {
      state.manager.touch(spec.serverName);
      state.manager.incrementInFlight(spec.serverName);
      if (spec.resourceUri) {
        const result2 = await connection.client.readResource({ uri: spec.resourceUri }, { signal });
        const converted = resourceContentsToBlocks(result2.contents ?? [], `${spec.serverName}-resource`);
        const cappedResource = capContentBlocks(converted.content, `${spec.serverName}-resource`, state.config.settings).content;
        return {
          content: cappedResource.length > 0 ? cappedResource : [{ type: "text", text: "(empty resource)" }],
          details: { server: spec.serverName, resourceUri: spec.resourceUri, files: converted.files }
        };
      }
      const hasUi = !!spec.uiResourceUri;
      uiSession = hasUi ? await maybeStartUiSession(state, {
        serverName: spec.serverName,
        toolName: spec.originalName,
        toolArgs: params ?? {},
        uiResourceUri: spec.uiResourceUri,
        streamMode: spec.uiStreamMode
      }) : null;
      const resultPromise = connection.client.callTool(
        {
          name: spec.originalName,
          arguments: params ?? {},
          _meta: buildMcpRequestMeta(state.sessionId, uiSession?.requestMeta)
        },
        void 0,
        { signal }
      );
      const result = await resultPromise;
      uiSession?.sendToolResult(result);
      const mcpContent = result.content ?? [];
      const content = transformMcpContent(mcpContent);
      if (result.isError) {
        const rawErrorText = content.filter((c) => c.type === "text").map((c) => c.text).join("\n") || "Tool execution failed";
        let errorText = capText(rawErrorText, `${spec.serverName}-${spec.originalName}-error`, state.config.settings).text;
        if (spec.inputSchema) {
          errorText += `

Expected parameters:
${formatSchema(spec.inputSchema)}`;
        }
        return {
          content: [{ type: "text", text: `Error: ${errorText}` }],
          isError: true,
          details: { error: "tool_error", server: spec.serverName }
        };
      }
      if (hasUi) {
        const rawResultText = content.filter((c) => c.type === "text").map((c) => c.text).join("\n") || "(empty result)";
        const resultText = capText(rawResultText, `${spec.serverName}-${spec.originalName}`, state.config.settings).text;
        const uiMessage = uiSession?.reused ? "Updated the open UI." : "\u{1F4FA} Interactive UI is now open in your browser. I'll respond to your prompts and intents as you interact with it.";
        return {
          content: [{ type: "text", text: `${resultText}

${uiMessage}` }],
          details: { server: spec.serverName, tool: spec.originalName, uiOpen: true }
        };
      }
      const cappedResult = capContentBlocks(content, `${spec.serverName}-${spec.originalName}`, state.config.settings).content;
      return {
        content: cappedResult.length > 0 ? cappedResult : [{ type: "text", text: "(empty result)" }],
        details: { server: spec.serverName, tool: spec.originalName }
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      uiSession?.sendToolCancelled(message);
      let errorText = `Failed to call tool: ${message}`;
      if (spec.inputSchema) {
        errorText += `

Expected parameters:
${formatSchema(spec.inputSchema)}`;
      }
      return {
        content: [{ type: "text", text: errorText }],
        isError: true,
        details: { error: "call_failed", server: spec.serverName }
      };
    } finally {
      if (uiSession?.reused) {
        uiSession.close();
      }
      state.manager.decrementInFlight(spec.serverName);
      state.manager.touch(spec.serverName);
    }
  };
}

// init.ts
var FAILURE_BACKOFF_MS = 60 * 1e3;
var METADATA_REFRESH_RETRY_MS = 24 * 60 * 60 * 1e3;
async function initializeMcp(pi, ctx) {
  const configPath = pi.getFlag("mcp-config");
  const config = loadMcpConfig(configPath);
  const manager = new McpServerManager();
  const samplingAutoApprove = config.settings?.samplingAutoApprove === true;
  if (config.settings?.sampling !== false && (ctx.hasUI || samplingAutoApprove)) {
    manager.setSamplingConfig({
      autoApprove: samplingAutoApprove,
      ui: ctx.hasUI ? ctx.ui : void 0,
      modelRegistry: ctx.modelRegistry,
      getCurrentModel: () => ctx.model,
      getSignal: () => ctx.signal
    });
  }
  if (config.settings?.elicitation !== false) {
    manager.setElicitationConfig({
      autoApprove: true,
      ui: ctx.hasUI ? ctx.ui : void 0
    });
  }
  const lifecycle = new McpLifecycleManager(manager);
  const toolMetadata = /* @__PURE__ */ new Map();
  const failureTracker = /* @__PURE__ */ new Map();
  const uiResourceHandler = new UiResourceHandler(manager);
  const consentManager = new ConsentManager("once-per-server");
  const ui = ctx.hasUI ? ctx.ui : void 0;
  const state = {
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
    openBrowser: (url) => openUrl(pi, url, process.env.BROWSER),
    ui,
    sendMessage: (message, options) => pi.sendMessage(message, options)
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
    const idleOverride = definition.idleTimeout ?? (lifecycleMode === "eager" ? 0 : void 0);
    lifecycle.registerServer(
      name,
      definition,
      idleOverride !== void 0 ? { idleTimeout: idleOverride } : void 0
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
      logger.error(`MCP: Failed to connect to ${name}`, new Error(error ?? "Connection unavailable"));
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
  const connectedCount = results.filter((r) => r.connection).length;
  const failedCount = results.filter((r) => r.error).length;
  if (ctx.hasUI && connectedCount > 0) {
    const totalTools = totalToolCount(state);
    const msg = failedCount > 0 ? `MCP: ${connectedCount}/${startupServers.length} servers connected (${totalTools} tools)` : `MCP: ${connectedCount} servers connected (${totalTools} tools)`;
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
  const directToolServersMissingCache = process.env.MCP_DIRECT_TOOLS === "__none__" ? [] : getMissingConfiguredDirectToolServers(config, cache);
  void refreshStaleMetadata(state, directToolServersMissingCache).catch((error) => {
    logger.error("MCP: background metadata refresh failed", error instanceof Error ? error : new Error(String(error)));
  });
  return state;
}
async function refreshStaleMetadata(state, directToolServersMissingCache) {
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
  const directToolsReady = refreshed.filter((name) => name !== null && directToolServersMissingCache.includes(name));
  if (directToolsReady.length > 0) {
    ui.notify(`MCP: direct tools for ${directToolsReady.join(", ")} will be available after restart`, "info");
  }
  const needsAuth = getServersNeedingAuth(state);
  if (needsAuth.length > 0) {
    ui.notify(`MCP: login required for ${needsAuth.join(", ")}. Run /mcp-auth to sign in.`, "warning");
  }
}
function getServersNeedingAuth(state) {
  const statuses = loadServerStatuses();
  return Object.keys(state.config.mcpServers).filter((name) => {
    const status = state.manager.getConnection(name)?.status;
    if (status === "needs-auth") return true;
    if (status === "connected") return false;
    return statuses[name]?.needsAuth === true;
  });
}
function updateServerMetadata(state, serverName) {
  const connection = state.manager.getConnection(serverName);
  if (!connection || connection.status !== "connected") return;
  const definition = state.config.mcpServers[serverName];
  if (!definition) return;
  const prefix = state.config.settings?.toolPrefix ?? "server";
  const { metadata } = buildToolMetadata(connection.tools, connection.resources, definition, serverName, prefix);
  state.toolMetadata.set(serverName, metadata);
}
function updateMetadataCache(state, serverName) {
  const connection = state.manager.getConnection(serverName);
  if (!connection || connection.status !== "connected") return;
  const definition = state.config.mcpServers[serverName];
  if (!definition) return;
  const configHash = computeServerHash(definition);
  const tools = serializeTools(connection.tools);
  const resources = definition.exposeResources === false ? [] : serializeResources(connection.resources);
  const resourceTemplates = definition.exposeResources === false ? [] : serializeResourceTemplates(connection.resourceTemplates);
  const entry = {
    configHash,
    tools,
    resources,
    resourceTemplates,
    cachedAt: Date.now()
  };
  saveMetadataCache({ version: 1, servers: { [serverName]: entry } });
}
function flushMetadataCache(state) {
  for (const [name, connection] of state.manager.getAllConnections()) {
    if (connection.status === "connected") {
      updateMetadataCache(state, name);
    }
  }
}
function updateStatusBar(state) {
  const ui = state.ui;
  if (!ui) return;
  const total = Object.keys(state.config.mcpServers).length;
  if (total === 0) {
    ui.setStatus("mcp", void 0);
    return;
  }
  const connectedCount = [...state.manager.getAllConnections().values()].filter((connection) => connection.status === "connected").length;
  let text = ui.theme.fg("accent", `MCP: ${connectedCount}/${total} servers`);
  const needsAuthCount = getServersNeedingAuth(state).length;
  if (needsAuthCount > 0) {
    text += ui.theme.fg("warning", ` \xB7 ${needsAuthCount} need login`);
  }
  ui.setStatus("mcp", text);
}
function getFailureAgeSeconds(state, serverName) {
  const failedAt = state.failureTracker.get(serverName);
  if (!failedAt) return null;
  const ageMs = Date.now() - failedAt;
  if (ageMs > FAILURE_BACKOFF_MS) return null;
  return Math.round(ageMs / 1e3);
}
async function lazyConnect(state, serverName) {
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
function getEffectiveIdleTimeoutMinutes(state, serverName) {
  const definition = state.config.mcpServers[serverName];
  if (!definition) {
    return typeof state.config.settings?.idleTimeout === "number" ? state.config.settings.idleTimeout : 10;
  }
  if (typeof definition.idleTimeout === "number") return definition.idleTimeout;
  const mode = definition.lifecycle ?? "lazy";
  if (mode === "eager") return 0;
  return typeof state.config.settings?.idleTimeout === "number" ? state.config.settings.idleTimeout : 10;
}

// onboarding-state.ts
import { existsSync as existsSync6, mkdirSync as mkdirSync6, readFileSync as readFileSync6, writeFileSync as writeFileSync7, renameSync as renameSync5 } from "node:fs";
import { dirname as dirname6 } from "node:path";
var DEFAULT_STATE = {
  version: 1,
  sharedConfigHintShown: false,
  setupCompleted: false
};
function getOnboardingStatePath() {
  return getAgentPath("mcp-onboarding.json");
}
function loadOnboardingState() {
  const path = getOnboardingStatePath();
  if (!existsSync6(path)) return { ...DEFAULT_STATE };
  try {
    const raw = JSON.parse(readFileSync6(path, "utf-8"));
    if (!raw || typeof raw !== "object") return { ...DEFAULT_STATE };
    return {
      version: 1,
      sharedConfigHintShown: raw.sharedConfigHintShown === true,
      setupCompleted: raw.setupCompleted === true,
      lastDiscoveryFingerprint: typeof raw.lastDiscoveryFingerprint === "string" ? raw.lastDiscoveryFingerprint : void 0
    };
  } catch {
    return { ...DEFAULT_STATE };
  }
}
function saveOnboardingState(state) {
  const path = getOnboardingStatePath();
  mkdirSync6(dirname6(path), { recursive: true });
  const tmpPath = `${path}.${process.pid}.tmp`;
  writeFileSync7(tmpPath, `${JSON.stringify(state, null, 2)}
`, "utf-8");
  renameSync5(tmpPath, path);
}
function updateOnboardingState(updater) {
  const next = updater(loadOnboardingState());
  saveOnboardingState(next);
  return next;
}
function markSharedConfigHintShown(fingerprint) {
  return updateOnboardingState((state) => ({
    ...state,
    sharedConfigHintShown: true,
    lastDiscoveryFingerprint: fingerprint ?? state.lastDiscoveryFingerprint
  }));
}
function markSetupCompleted(fingerprint) {
  return updateOnboardingState((state) => ({
    ...state,
    setupCompleted: true,
    lastDiscoveryFingerprint: fingerprint ?? state.lastDiscoveryFingerprint
  }));
}

// commands.ts
async function showStatus(state, ctx) {
  if (!ctx.hasUI) return;
  const lines = ["MCP Server Status:", ""];
  const needsAuth = new Set(getServersNeedingAuth(state));
  for (const name of Object.keys(state.config.mcpServers)) {
    const connection = state.manager.getConnection(name);
    const metadata = state.toolMetadata.get(name);
    const toolCount = metadata?.length ?? 0;
    const failedAgo = getFailureAgeSeconds(state, name);
    let status = "not connected";
    let statusIcon = "\u25CB";
    let failed = false;
    if (connection?.status === "connected") {
      status = "connected";
      statusIcon = "\u2713";
    } else if (needsAuth.has(name)) {
      status = `needs auth (/mcp-auth ${name})`;
      statusIcon = "\u26A0";
    } else if (failedAgo !== null) {
      status = `failed ${failedAgo}s ago`;
      statusIcon = "\u2717";
      failed = true;
    } else if (metadata !== void 0) {
      status = "cached";
    }
    const toolSuffix = failed ? "" : ` (${toolCount} tools${status === "cached" ? ", cached" : ""})`;
    lines.push(`${statusIcon} ${name}: ${status}${toolSuffix}`);
  }
  if (Object.keys(state.config.mcpServers).length === 0) {
    lines.push("No MCP servers configured");
    lines.push("Run /mcp setup to adopt imports or scaffold a starter .mcp.json");
  }
  ctx.ui.notify(lines.join("\n"), "info");
}
async function showTools(state, ctx) {
  if (!ctx.hasUI) return;
  const allTools = [...state.toolMetadata.values()].flat().map((m) => m.name);
  if (allTools.length === 0) {
    ctx.ui.notify("No MCP tools available", "info");
    return;
  }
  const lines = [
    "MCP Tools:",
    "",
    ...allTools.map((t) => `  ${t}`),
    "",
    `Total: ${allTools.length} tools`
  ];
  ctx.ui.notify(lines.join("\n"), "info");
}
async function reconnectServers(state, ctx, targetServer) {
  if (targetServer && !state.config.mcpServers[targetServer]) {
    if (ctx.hasUI) {
      ctx.ui.notify(`Server "${targetServer}" not found in config`, "error");
    }
    return;
  }
  const entries = targetServer ? [[targetServer, state.config.mcpServers[targetServer]]] : Object.entries(state.config.mcpServers);
  for (const [name, definition] of entries) {
    try {
      await state.manager.close(name);
      const connection = await state.manager.connect(name, definition);
      if (connection.status === "needs-auth") {
        if (ctx.hasUI) {
          ctx.ui.notify(`MCP: ${name} requires OAuth. Run /mcp-auth ${name} first.`, "warning");
        }
        continue;
      }
      const prefix = state.config.settings?.toolPrefix ?? "server";
      const { metadata, failedTools } = buildToolMetadata(connection.tools, connection.resources, definition, name, prefix);
      state.toolMetadata.set(name, metadata);
      updateMetadataCache(state, name);
      state.failureTracker.delete(name);
      if (ctx.hasUI) {
        ctx.ui.notify(
          `MCP: Reconnected to ${name} (${connection.tools.length} tools, ${connection.resources.length} resources)`,
          "info"
        );
        if (failedTools.length > 0) {
          ctx.ui.notify(`MCP: ${name} - ${failedTools.length} tools skipped`, "warning");
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      state.failureTracker.set(name, Date.now());
      if (ctx.hasUI) {
        ctx.ui.notify(`MCP: Failed to reconnect to ${name}: ${message}`, "error");
      }
    }
  }
  updateStatusBar(state);
}
function listOAuthServers(state) {
  const needsAuth = new Set(getServersNeedingAuth(state));
  return Object.entries(state.config.mcpServers).filter(([, definition]) => supportsOAuth(definition)).map(([name]) => ({ name, needsAuth: needsAuth.has(name) })).sort((a, b) => Number(b.needsAuth) - Number(a.needsAuth));
}
async function pickServerToAuthenticate(state, ctx) {
  const servers = listOAuthServers(state);
  if (servers.length === 0) {
    ctx.ui.notify("No OAuth MCP servers are configured.", "info");
    return void 0;
  }
  const labels = servers.map((server2) => server2.needsAuth ? `${server2.name} (needs login)` : server2.name);
  const choice = await ctx.ui.select("Log in to MCP server", labels);
  if (choice === void 0) return void 0;
  return servers[labels.indexOf(choice)]?.name;
}
async function authenticateServer(state, requestedServer, ctx) {
  if (!ctx.hasUI) return;
  const serverName = requestedServer || await pickServerToAuthenticate(state, ctx);
  if (!serverName) return;
  const definition = state.config.mcpServers[serverName];
  if (!definition) {
    ctx.ui.notify(`Server "${serverName}" not found in config`, "error");
    return;
  }
  if (!supportsOAuth(definition)) {
    ctx.ui.notify(
      `Server "${serverName}" does not use OAuth authentication.
Set "auth": "oauth" or omit auth for auto-detection.`,
      "error"
    );
    return;
  }
  if (!definition.url) {
    ctx.ui.notify(
      `Server "${serverName}" has no URL configured (OAuth requires HTTP transport)`,
      "error"
    );
    return;
  }
  const url = definition.url;
  const outcome = await ctx.ui.custom((tui, theme, _keybindings, done) => {
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      done(result);
    };
    const loader = new BorderedLoader(tui, theme, `Finish logging in to ${serverName} in your browser...`);
    loader.onAbort = () => finish({ kind: "cancelled" });
    authenticate(serverName, url, definition, loader.signal).then((status) => finish({ kind: "done", status })).catch((error) => finish({ kind: "error", message: error instanceof Error ? error.message : String(error) }));
    return loader;
  });
  if (outcome.kind === "cancelled") {
    ctx.ui.notify(`Login to "${serverName}" cancelled.`, "info");
  } else if (outcome.kind === "error") {
    ctx.ui.notify(`Failed to authenticate "${serverName}": ${outcome.message}`, "error");
  } else if (outcome.status === "authenticated") {
    ctx.ui.notify(`Logged in to "${serverName}".`, "info");
    await reconnectServers(state, ctx, serverName);
  } else {
    ctx.ui.notify(`OAuth authentication failed for "${serverName}".`, "error");
  }
}
function buildSharedConfigNoticeLines(configOverridePath) {
  const discovery = getMcpDiscoverySummary(configOverridePath);
  const onboardingState = loadOnboardingState();
  if (!discovery.hasSharedServers || onboardingState.sharedConfigHintShown) {
    return { lines: [], fingerprint: null };
  }
  const sharedSources = discovery.sources.filter((source) => source.kind === "shared" && source.serverCount > 0);
  const sourceList = sharedSources.map((source) => source.path).join(", ");
  return {
    lines: [
      `Using standard MCP config from ${sourceList}.`,
      "Pi only writes compatibility imports and adapter-specific overrides into Pi-owned files when needed."
    ],
    fingerprint: discovery.fingerprint
  };
}
async function openMcpSetup(_state, pi, ctx, configOverridePath, mode = "setup") {
  if (!ctx.hasUI) return { configChanged: false };
  const discovery = getMcpDiscoverySummary(configOverridePath);
  const onboardingState = loadOnboardingState();
  const { createMcpSetupPanel } = await import("./mcp-setup-panel-WFOK4PLR.ts");
  let configChanged = false;
  const callbacks = {
    previewImports: (imports) => previewCompatibilityImports(imports, configOverridePath),
    previewStarterProject: () => previewStarterProjectConfig(),
    previewRepoPrompt: () => {
      const repoPrompt = getMcpDiscoverySummary(configOverridePath).repoPrompt;
      if (!repoPrompt.entry || !repoPrompt.targetPath || !repoPrompt.serverName) return null;
      return previewSharedServerEntry(repoPrompt.targetPath, repoPrompt.serverName, repoPrompt.entry);
    },
    adoptImports: async (imports) => {
      const result = ensureCompatibilityImports(imports, configOverridePath);
      if (result.added.length > 0) configChanged = true;
      return result;
    },
    scaffoldProjectConfig: async () => {
      const path = writeStarterProjectConfig();
      configChanged = true;
      return { path };
    },
    addRepoPrompt: async () => {
      const repoPrompt = getMcpDiscoverySummary(configOverridePath).repoPrompt;
      if (!repoPrompt.entry || !repoPrompt.targetPath || !repoPrompt.serverName) {
        throw new Error("RepoPrompt is not available to add from this setup screen.");
      }
      const path = writeSharedServerEntry(repoPrompt.targetPath, repoPrompt.serverName, repoPrompt.entry);
      configChanged = true;
      return { path, serverName: repoPrompt.serverName };
    },
    openPath: async (targetPath) => {
      await openPath(pi, targetPath);
    },
    markSetupCompleted: () => {
      markSetupCompleted(discovery.fingerprint);
    }
  };
  return new Promise((resolve4) => {
    ctx.ui.custom(
      (tui, _theme, _keybindings, done) => {
        return createMcpSetupPanel(discovery, callbacks, { mode, onboardingState }, tui, () => {
          done(void 0);
          resolve4({ configChanged });
        });
      },
      { overlay: true, overlayOptions: { anchor: "center", width: 92 } }
    );
  });
}
async function openMcpPanel(state, pi, ctx, configOverridePath) {
  if (Object.keys(state.config.mcpServers).length === 0) {
    return openMcpSetup(state, pi, ctx, configOverridePath, "empty");
  }
  const config = state.config;
  const cache = loadMetadataCache();
  const provenanceMap = getServerProvenance(pi.getFlag("mcp-config") ?? configOverridePath);
  const { lines: noticeLines, fingerprint } = buildSharedConfigNoticeLines(pi.getFlag("mcp-config") ?? configOverridePath);
  const callbacks = {
    reconnect: async (serverName) => {
      return lazyConnect(state, serverName);
    },
    getConnectionStatus: (serverName) => {
      const definition = config.mcpServers[serverName];
      const connection = state.manager.getConnection(serverName);
      if (getServersNeedingAuth(state).includes(serverName)) {
        return "needs-auth";
      }
      if (definition?.auth === "oauth" && definition.oauth !== false && definition.oauth?.grantType !== "client_credentials" && !hasStoredTokens(serverName)) {
        return "needs-auth";
      }
      if (connection?.status === "connected") return "connected";
      if (getFailureAgeSeconds(state, serverName) !== null) return "failed";
      return "idle";
    },
    refreshCacheAfterReconnect: (serverName) => {
      const freshCache = loadMetadataCache();
      return freshCache?.servers?.[serverName] ?? null;
    }
  };
  const { createMcpPanel } = await import("./mcp-panel-4O5F4SUD.ts");
  let configChanged = false;
  let loginServer;
  await new Promise((resolve4) => {
    ctx.ui.custom(
      (tui, _theme, _keybindings, done) => {
        return createMcpPanel(config, cache, provenanceMap, callbacks, tui, (result) => {
          loginServer = result.loginServer;
          if (!result.cancelled && result.changes.size > 0) {
            writePromotedToolsConfig(result.changes, provenanceMap, config);
            configChanged = true;
            ctx.ui.notify("MCP tool schemas updated. Pi will reload after this panel closes.", "info");
          }
          done(void 0);
          resolve4();
        }, { noticeLines });
      },
      { overlay: true, overlayOptions: { anchor: "center", width: 82 } }
    );
  });
  if (noticeLines.length > 0 && fingerprint) {
    markSharedConfigHintShown(fingerprint);
  }
  if (loginServer) {
    await authenticateServer(state, loginServer, ctx);
  }
  return { configChanged };
}

// proxy-modes.ts
function getAuthRequiredMessage(state, serverName, defaultMessage = `Server "${serverName}" requires OAuth authentication. Run /mcp-auth ${serverName} first.`) {
  return formatAuthRequiredMessage(state.config, serverName, defaultMessage);
}
async function executeReadResource(state, serverName, uri, signal) {
  if (!state.config.mcpServers[serverName]) {
    return {
      content: [{ type: "text", text: `Server "${serverName}" not found. Use mcp({}) to see available servers.` }],
      isError: true,
      details: { mode: "resource", error: "not_found", server: serverName, uri }
    };
  }
  if (signal?.aborted) {
    return {
      content: [{ type: "text", text: "Resource read cancelled before execution." }],
      isError: true,
      details: { mode: "resource", error: "aborted", server: serverName, uri }
    };
  }
  try {
    if (!state.manager.getConnection(serverName)) {
      const connected = await lazyConnect(state, serverName);
      if (!connected) throw new Error(`Server "${serverName}" is not connected`);
    }
    const result = await state.manager.readResource(serverName, uri, signal);
    const converted = resourceContentsToBlocks(result.contents ?? [], `${serverName}-resource`);
    const capped = capContentBlocks(converted.content, `${serverName}-resource`, state.config.settings).content;
    return {
      content: capped.length > 0 ? capped : [{ type: "text", text: "(empty resource)" }],
      details: { mode: "resource", server: serverName, uri, files: converted.files }
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      content: [{ type: "text", text: `Failed to read resource from "${serverName}": ${message}` }],
      isError: true,
      details: { mode: "resource", error: "read_failed", server: serverName, uri, message }
    };
  }
}
function getAuthFailedMessage(state, serverName, message) {
  const customGuidance = state.config.settings?.authRequiredMessage;
  if (customGuidance) {
    return `OAuth authentication failed for "${serverName}": ${message}. ${getAuthRequiredMessage(state, serverName)}`;
  }
  return `OAuth authentication failed for "${serverName}": ${message}. Run /mcp-auth ${serverName} first.`;
}
async function attemptAutoAuth(state, serverName) {
  if (state.config.settings?.autoAuth !== true) {
    return { status: "skipped" };
  }
  const definition = state.config.mcpServers[serverName];
  if (!definition || !supportsOAuth(definition) || !definition.url) {
    return { status: "skipped" };
  }
  const grantType = definition.oauth?.grantType ?? "authorization_code";
  if (!state.ui && grantType !== "client_credentials") {
    return {
      status: "failed",
      message: getAuthRequiredMessage(
        state,
        serverName,
        `Server "${serverName}" requires OAuth authentication. Run /mcp-auth ${serverName} in an interactive session.`
      )
    };
  }
  try {
    await authenticate(serverName, definition.url, definition);
    return { status: "success" };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      status: "failed",
      message: getAuthFailedMessage(state, serverName, message)
    };
  }
}
function executeUiMessages(state) {
  const sessions = state.completedUiSessions;
  if (sessions.length === 0) {
    return {
      content: [{ type: "text", text: "No UI session messages available." }],
      details: { sessions: 0 }
    };
  }
  const output = [];
  output.push(`UI Session Messages (${sessions.length} session${sessions.length > 1 ? "s" : ""}):
`);
  const allPrompts = [];
  const allIntents = sessions.flatMap((session) => session.messages.intents);
  const parsedHandoffs = [];
  for (const session of sessions) {
    const timestamp = session.completedAt.toLocaleTimeString();
    output.push(`
## ${session.serverName} / ${session.toolName} (${timestamp}, ${session.reason})`);
    const plainPrompts = [];
    for (const prompt of session.messages.prompts) {
      allPrompts.push(prompt);
      const handoff = parseUiPromptHandoff(prompt);
      if (handoff) {
        parsedHandoffs.push(handoff);
      } else {
        plainPrompts.push(prompt);
      }
    }
    if (plainPrompts.length > 0) {
      output.push("\n### Prompts:");
      for (const prompt of plainPrompts) {
        output.push(`- ${prompt}`);
      }
    }
    const intentsForSession = [
      ...session.messages.intents,
      ...session.messages.prompts.map((prompt) => parseUiPromptHandoff(prompt)).filter((handoff) => !!handoff).map((handoff) => ({ intent: handoff.intent, params: handoff.params }))
    ];
    if (intentsForSession.length > 0) {
      output.push("\n### Intents:");
      for (const intent of intentsForSession) {
        const params = intent.params ? ` (${JSON.stringify(intent.params)})` : "";
        output.push(`- ${intent.intent}${params}`);
      }
    }
    if (session.messages.notifications.length > 0) {
      output.push("\n### Notifications:");
      for (const notification of session.messages.notifications) {
        output.push(`- ${notification}`);
      }
    }
  }
  const count = sessions.length;
  state.completedUiSessions = [];
  return {
    content: [{ type: "text", text: output.join("\n") }],
    details: {
      sessions: count,
      prompts: allPrompts,
      intents: [...allIntents, ...parsedHandoffs.map(({ intent, params }) => ({ intent, params }))],
      handoffs: parsedHandoffs,
      cleared: true
    }
  };
}
function executeStatus(state) {
  const servers = [];
  const needsAuth = new Set(getServersNeedingAuth(state));
  for (const name of Object.keys(state.config.mcpServers)) {
    const connection = state.manager.getConnection(name);
    const metadata = state.toolMetadata.get(name);
    const toolCount = metadata?.length ?? 0;
    const failedAgo = getFailureAgeSeconds(state, name);
    let status = "not connected";
    if (connection?.status === "connected") {
      status = "connected";
    } else if (needsAuth.has(name)) {
      status = "needs-auth";
    } else if (failedAgo !== null) {
      status = "failed";
    } else if (metadata !== void 0) {
      status = "cached";
    }
    servers.push({ name, status, toolCount, failedAgo });
  }
  const totalTools = servers.reduce((sum, s) => sum + s.toolCount, 0);
  const connectedCount = servers.filter((s) => s.status === "connected").length;
  let text = `MCP: ${connectedCount}/${servers.length} servers, ${totalTools} tools

`;
  for (const server2 of servers) {
    if (server2.status === "connected") {
      text += `\u2713 ${server2.name} (${server2.toolCount} tools)
`;
      continue;
    }
    if (server2.status === "needs-auth") {
      text += `\u26A0 ${server2.name} (needs auth: user must run /mcp-auth ${server2.name}${server2.toolCount > 0 ? `; ${server2.toolCount} cached tools` : ""})
`;
      continue;
    }
    if (server2.status === "cached") {
      text += `\u25CB ${server2.name} (${server2.toolCount} tools, cached)
`;
      continue;
    }
    if (server2.status === "failed") {
      text += `\u2717 ${server2.name} (failed ${server2.failedAgo ?? 0}s ago)
`;
      continue;
    }
    text += `\u25CB ${server2.name} (not connected)
`;
  }
  if (servers.length > 0) {
    text += `
mcp({ server: "name" }) to list tools, mcp({ search: "..." }) to search`;
  }
  return {
    content: [{ type: "text", text: text.trim() }],
    details: { mode: "status", servers, totalTools, connectedCount }
  };
}
function executeDescribe(state, toolName) {
  let serverName;
  let toolMeta;
  for (const [server2, metadata] of state.toolMetadata.entries()) {
    const found = findToolByName(metadata, toolName);
    if (found) {
      serverName = server2;
      toolMeta = found;
      break;
    }
  }
  if (!serverName || !toolMeta) {
    return {
      content: [{ type: "text", text: `Tool "${toolName}" not found. Use mcp({ search: "..." }) to search.` }],
      isError: true,
      details: { mode: "describe", error: "tool_not_found", requestedTool: toolName }
    };
  }
  let text = `${toolMeta.name}
`;
  text += `Server: ${serverName}
`;
  if (toolMeta.resourceUri) {
    text += `Type: Resource (reads from ${toolMeta.resourceUri})
`;
  }
  text += `
${toolMeta.description || "(no description)"}
`;
  if (toolMeta.inputSchema && !toolMeta.resourceUri) {
    text += `
Parameters:
${formatSchema(toolMeta.inputSchema)}`;
  } else if (toolMeta.resourceUri) {
    text += `
No parameters required (resource tool).`;
  } else {
    text += `
No parameters defined.`;
  }
  return {
    content: [{ type: "text", text: text.trim() }],
    details: { mode: "describe", tool: toolMeta, server: serverName }
  };
}
function hydrateDiscoveryMetadataFromCache(state, server2) {
  const cache = loadMetadataCache();
  if (!cache) return;
  const prefix = state.config.settings?.toolPrefix ?? "server";
  const entries = server2 ? [[server2, state.config.mcpServers[server2]]] : Object.entries(state.config.mcpServers);
  for (const [serverName, definition] of entries) {
    if (!definition || state.toolMetadata.has(serverName)) continue;
    const entry = cache.servers?.[serverName];
    if (entry && isServerCacheValid(entry, definition)) {
      state.toolMetadata.set(serverName, reconstructToolMetadata(serverName, entry, prefix, definition));
    }
  }
}
async function ensureDiscoveryMetadata(state, server2) {
  if (state.toolMetadata.has(server2)) return;
  hydrateDiscoveryMetadataFromCache(state, server2);
  if (state.toolMetadata.has(server2)) return;
  await lazyConnect(state, server2);
}
function normalizeSearchText(value) {
  return value.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/[^a-zA-Z0-9]+/g, " ").trim().toLowerCase();
}
function searchTerms(query) {
  return [...new Set(normalizeSearchText(query).split(/\s+/).filter(Boolean))];
}
function scoreSearchMatch(tool, query, terms, requireAllTerms) {
  const normalizedQuery = normalizeSearchText(query);
  const name = normalizeSearchText(tool.name);
  const originalName = normalizeSearchText(tool.originalName);
  const description = normalizeSearchText(tool.description || "");
  const nameTerms = new Set([...name.split(/\s+/), ...originalName.split(/\s+/)].filter(Boolean));
  const descriptionTerms = new Set(description.split(/\s+/).filter(Boolean));
  const hasTerm = (term) => nameTerms.has(term) || descriptionTerms.has(term);
  const matchedTerms = terms.filter(hasTerm);
  if (terms.length > 0) {
    if (requireAllTerms && matchedTerms.length !== terms.length) return null;
    if (!requireAllTerms && matchedTerms.length === 0) return null;
  } else if (!normalizedQuery) {
    return null;
  }
  let score = 0;
  if (name === normalizedQuery || originalName === normalizedQuery) score += 1e4;
  if (name.includes(normalizedQuery) || originalName.includes(normalizedQuery)) score += 3e3;
  if (description.includes(normalizedQuery)) score += 500;
  const allTermsInName = terms.length > 0 && terms.every((term) => nameTerms.has(term));
  const allTermsSomewhere = terms.length > 0 && matchedTerms.length === terms.length;
  if (allTermsInName) score += 2e3;
  else if (allTermsSomewhere) score += 1200;
  for (const term of matchedTerms) {
    if (nameTerms.has(term)) score += 120;
    if (descriptionTerms.has(term)) score += 30;
  }
  return score;
}
async function executeSearch(state, query, regex, server2, includeSchemas) {
  const showSchemas = includeSchemas !== false;
  if (server2) {
    if (!state.config.mcpServers[server2]) {
      return {
        content: [{ type: "text", text: `Server "${server2}" not found. Use mcp({}) to see available servers.` }],
        isError: true,
        details: { mode: "search", error: "server_not_found", server: server2, matches: [], count: 0, query }
      };
    }
    await ensureDiscoveryMetadata(state, server2);
  }
  const matches = [];
  const terms = searchTerms(query);
  if (terms.length === 0) {
    return {
      content: [{ type: "text", text: "Search query cannot be empty" }],
      isError: true,
      details: { mode: "search", error: "empty_query" }
    };
  }
  let pattern;
  if (regex) {
    try {
      pattern = new RegExp(query, "i");
    } catch {
      return {
        content: [{ type: "text", text: `Invalid regex: ${query}` }],
        isError: true,
        details: { mode: "search", error: "invalid_pattern", query }
      };
    }
  }
  if (!server2) {
    hydrateDiscoveryMetadataFromCache(state);
  }
  const serverTerms = server2 ? searchTerms(server2) : [];
  const effectiveTerms = server2 ? terms.filter((term) => !serverTerms.includes(term)) : terms;
  const rankedTerms = effectiveTerms.length > 0 ? effectiveTerms : terms;
  for (const [serverName, metadata] of state.toolMetadata.entries()) {
    if (server2 && serverName !== server2) continue;
    for (const tool of metadata) {
      if (pattern) {
        if (pattern.test(tool.name) || pattern.test(tool.description)) {
          matches.push({ server: serverName, tool, score: 0 });
        }
        continue;
      }
      const score = scoreSearchMatch(tool, query, rankedTerms, Boolean(server2));
      if (score !== null) {
        matches.push({ server: serverName, tool, score });
      }
    }
  }
  if (!pattern) {
    matches.sort((a, b) => b.score - a.score || a.tool.name.localeCompare(b.tool.name));
  }
  const totalCount = matches.length;
  if (totalCount === 0) {
    const msg = server2 ? `No tools matching "${query}" in "${server2}"` : `No tools matching "${query}"`;
    return {
      content: [{ type: "text", text: msg }],
      details: { mode: "search", matches: [], count: 0, query }
    };
  }
  let text = `Found ${totalCount} tool${totalCount === 1 ? "" : "s"} matching "${query}":

`;
  for (const match of matches) {
    if (showSchemas) {
      text += `${match.tool.name}
`;
      text += `  ${match.tool.description || "(no description)"}
`;
      if (match.tool.inputSchema && !match.tool.resourceUri) {
        text += `
  Parameters:
${formatSchema(match.tool.inputSchema, "    ")}
`;
      } else if (match.tool.resourceUri) {
        text += `  No parameters (resource tool).
`;
      }
      text += "\n";
    } else {
      text += `- ${match.tool.name}`;
      if (match.tool.description) {
        text += ` - ${truncateAtWord(match.tool.description, 50)}`;
      }
      text += "\n";
    }
  }
  return {
    content: [{ type: "text", text: text.trim() }],
    details: {
      mode: "search",
      matches: matches.map((m) => ({ server: m.server, tool: m.tool.name })),
      count: totalCount,
      query
    }
  };
}
async function executeList(state, server2) {
  if (!state.config.mcpServers[server2]) {
    return {
      content: [{ type: "text", text: `Server "${server2}" not found. Use mcp({}) to see available servers.` }],
      isError: true,
      details: { mode: "list", server: server2, tools: [], count: 0, error: "not_found" }
    };
  }
  await ensureDiscoveryMetadata(state, server2);
  const metadata = state.toolMetadata.get(server2);
  const toolNames = metadata?.map((m) => m.name) ?? [];
  const connection = state.manager.getConnection(server2);
  const resourceTemplates = connection?.resourceTemplates ?? loadMetadataCache()?.servers?.[server2]?.resourceTemplates ?? [];
  if (toolNames.length === 0 && resourceTemplates.length === 0) {
    if (connection?.status === "connected") {
      return {
        content: [{ type: "text", text: `Server "${server2}" has no tools.` }],
        details: { mode: "list", server: server2, tools: [], count: 0 }
      };
    }
    if (metadata !== void 0) {
      return {
        content: [{ type: "text", text: `Server "${server2}" has no cached tools (not connected).` }],
        details: { mode: "list", server: server2, tools: [], count: 0, cached: true }
      };
    }
    return {
      content: [{ type: "text", text: `Server "${server2}" is configured but not connected. Use mcp({ connect: "${server2}" }) or /mcp reconnect ${server2} to retry.` }],
      isError: true,
      details: { mode: "list", server: server2, tools: [], count: 0, error: "not_connected" }
    };
  }
  const cachedNote = connection?.status === "connected" ? "" : " (not connected, cached)";
  let text = `${server2} (${toolNames.length} tools${cachedNote}):

`;
  const descMap = /* @__PURE__ */ new Map();
  if (metadata) {
    for (const m of metadata) {
      descMap.set(m.name, m.description);
    }
  }
  for (const tool of toolNames) {
    const desc = (descMap.get(tool) ?? "").trim();
    text += `- ${tool}`;
    if (desc) text += ` - ${desc}`;
    text += "\n";
  }
  if (resourceTemplates.length > 0) {
    text += `
Resource templates (read with mcp({ resource: "expanded URI", server: "${server2}" })):
`;
    for (const template of resourceTemplates) {
      text += `- ${template.uriTemplate} - ${template.title ?? template.name}`;
      if (template.description) text += `: ${template.description}`;
      text += "\n";
    }
  }
  const capped = capText(text.trim(), `${server2}-list`, state.config.settings);
  return {
    content: [{ type: "text", text: capped.text }],
    details: {
      mode: "list",
      server: server2,
      tools: toolNames,
      count: toolNames.length,
      resourceTemplates,
      truncated: capped.truncated,
      fullOutputPath: capped.fullOutputPath
    }
  };
}
async function executeConnect(state, serverName, signal) {
  const definition = state.config.mcpServers[serverName];
  if (!definition) {
    return {
      content: [{ type: "text", text: `Server "${serverName}" not found. Use mcp({}) to see available servers.` }],
      isError: true,
      details: { mode: "connect", error: "not_found", server: serverName }
    };
  }
  try {
    if (state.ui) {
      state.ui.setStatus("mcp", `MCP: connecting to ${serverName}...`);
    }
    let connection = await state.manager.connect(serverName, definition);
    if (connection.status === "needs-auth") {
      const autoAuth = await attemptAutoAuth(state, serverName);
      if (autoAuth.status === "failed") {
        return {
          content: [{ type: "text", text: autoAuth.message }],
          isError: true,
          details: { mode: "connect", error: "auth_required", server: serverName, message: autoAuth.message }
        };
      }
      if (autoAuth.status === "success") {
        await state.manager.close(serverName);
        connection = await state.manager.connect(serverName, definition);
      }
      if (connection.status === "needs-auth") {
        const message = getAuthRequiredMessage(state, serverName);
        return {
          content: [{ type: "text", text: message }],
          isError: true,
          details: { mode: "connect", error: "auth_required", server: serverName, message }
        };
      }
    }
    const prefix = state.config.settings?.toolPrefix ?? "server";
    const { metadata } = buildToolMetadata(connection.tools, connection.resources, definition, serverName, prefix);
    state.toolMetadata.set(serverName, metadata);
    updateMetadataCache(state, serverName);
    state.failureTracker.delete(serverName);
    updateStatusBar(state);
    const templateCount = connection.resourceTemplates?.length ?? 0;
    const text = `Connected to ${serverName} (${metadata.length} tools), with ${connection.resources.length} concrete resources and ${templateCount} resource templates. Use mcp({ search: "query", server: "${serverName}" }) to find tools or mcp({ server: "${serverName}" }) for the full list.`;
    return {
      content: [{ type: "text", text }],
      details: {
        mode: "connect",
        server: serverName,
        count: metadata.length,
        resourceCount: connection.resources.length,
        resourceTemplateCount: templateCount
      }
    };
  } catch (error) {
    state.failureTracker.set(serverName, Date.now());
    updateStatusBar(state);
    const message = error instanceof Error ? error.message : String(error);
    return {
      content: [{ type: "text", text: `Failed to connect to "${serverName}": ${message}` }],
      isError: true,
      details: { mode: "connect", error: "connect_failed", server: serverName, message }
    };
  }
}
async function executeCall(state, toolName, args, serverOverride, getPiTools, signal) {
  if (signal?.aborted) {
    return {
      content: [{ type: "text", text: "Tool call cancelled before execution." }],
      isError: true,
      details: { mode: "call", error: "aborted" }
    };
  }
  let serverName = serverOverride;
  let toolMeta;
  let autoAuthAttempted = false;
  const prefixMode = state.config.settings?.toolPrefix ?? "server";
  if (serverName && !state.config.mcpServers[serverName]) {
    return {
      content: [{ type: "text", text: `Server "${serverName}" not found. Use mcp({}) to see available servers.` }],
      isError: true,
      details: { mode: "call", error: "server_not_found", server: serverName }
    };
  }
  if (serverName) {
    toolMeta = findToolByName(state.toolMetadata.get(serverName), toolName);
  } else {
    for (const [server2, metadata] of state.toolMetadata.entries()) {
      const found = findToolByName(metadata, toolName);
      if (found) {
        serverName = server2;
        toolMeta = found;
        break;
      }
    }
  }
  if (serverName && !toolMeta) {
    const connected = await lazyConnect(state, serverName);
    if (connected) {
      toolMeta = findToolByName(state.toolMetadata.get(serverName), toolName);
    } else {
      const needsAuthConnection = state.manager.getConnection(serverName);
      if (needsAuthConnection?.status === "needs-auth") {
        if (!autoAuthAttempted) {
          autoAuthAttempted = true;
          const autoAuth = await attemptAutoAuth(state, serverName);
          if (autoAuth.status === "failed") {
            return {
              content: [{ type: "text", text: autoAuth.message }],
              isError: true,
              details: { mode: "call", error: "auth_required", server: serverName, message: autoAuth.message }
            };
          }
          if (autoAuth.status === "success") {
            await state.manager.close(serverName);
            state.failureTracker.delete(serverName);
            const connectedAfterAuth = await lazyConnect(state, serverName);
            if (connectedAfterAuth) {
              toolMeta = findToolByName(state.toolMetadata.get(serverName), toolName);
              if (!toolMeta) {
                return {
                  content: [{ type: "text", text: `Tool "${toolName}" not found on "${serverName}" after reconnect.` }],
                  isError: true,
                  details: { mode: "call", error: "tool_not_found_after_reconnect", requestedTool: toolName }
                };
              }
            }
          }
        }
        if (!toolMeta && state.manager.getConnection(serverName)?.status === "needs-auth") {
          const message = getAuthRequiredMessage(state, serverName);
          return {
            content: [{ type: "text", text: message }],
            isError: true,
            details: { mode: "call", error: "auth_required", server: serverName, message }
          };
        }
      }
      if (!toolMeta) {
        const failedAgo = getFailureAgeSeconds(state, serverName);
        if (failedAgo !== null) {
          return {
            content: [{ type: "text", text: `Server "${serverName}" not available (last failed ${failedAgo}s ago)` }],
            isError: true,
            details: { mode: "call", error: "server_backoff", server: serverName }
          };
        }
      }
    }
  }
  let prefixMatchedServer;
  if (!serverName && !toolMeta && prefixMode !== "none") {
    const candidates = Object.keys(state.config.mcpServers).map((name) => ({ name, prefix: getServerPrefix(name, prefixMode) })).filter((c) => c.prefix && toolName.startsWith(c.prefix + "_")).sort((a, b) => b.prefix.length - a.prefix.length);
    for (const { name: configuredServer } of candidates) {
      const existingConnection = state.manager.getConnection(configuredServer);
      const failedAgo = getFailureAgeSeconds(state, configuredServer);
      if (failedAgo !== null && existingConnection?.status !== "needs-auth") continue;
      let connected = await lazyConnect(state, configuredServer);
      if (!connected && state.manager.getConnection(configuredServer)?.status === "needs-auth" && !autoAuthAttempted) {
        autoAuthAttempted = true;
        const autoAuth = await attemptAutoAuth(state, configuredServer);
        if (autoAuth.status === "failed") {
          return {
            content: [{ type: "text", text: autoAuth.message }],
            isError: true,
            details: { mode: "call", error: "auth_required", server: configuredServer, message: autoAuth.message }
          };
        }
        if (autoAuth.status === "success") {
          await state.manager.close(configuredServer);
          state.failureTracker.delete(configuredServer);
          connected = await lazyConnect(state, configuredServer);
        }
      }
      if (!connected) continue;
      if (!prefixMatchedServer) prefixMatchedServer = configuredServer;
      toolMeta = findToolByName(state.toolMetadata.get(configuredServer), toolName);
      if (toolMeta) {
        serverName = configuredServer;
        break;
      }
    }
  }
  if (!serverName || !toolMeta) {
    const nativeTool = !serverOverride ? getPiTools?.().find((tool) => tool.name === toolName && tool.name !== "mcp") : void 0;
    if (nativeTool) {
      return {
        content: [{ type: "text", text: `"${toolName}" is a native Pi tool. Call ${toolName} directly instead of using mcp({ tool: "${toolName}" }).` }],
        isError: true,
        details: { mode: "call", error: "native_tool", requestedTool: toolName }
      };
    }
    const hintServer = serverName ?? prefixMatchedServer;
    const available = hintServer ? getToolNames(state, hintServer) : [];
    let msg = `Tool "${toolName}" not found.`;
    if (available.length > 0) {
      msg += ` Server "${hintServer}" has: ${available.join(", ")}`;
    } else {
      msg += ` Use mcp({ search: "..." }) to search.`;
    }
    return {
      content: [{ type: "text", text: msg }],
      isError: true,
      details: { mode: "call", error: "tool_not_found", requestedTool: toolName, hintServer }
    };
  }
  let connection = state.manager.getConnection(serverName);
  if (connection?.status === "needs-auth") {
    if (!autoAuthAttempted) {
      autoAuthAttempted = true;
      const autoAuth = await attemptAutoAuth(state, serverName);
      if (autoAuth.status === "failed") {
        return {
          content: [{ type: "text", text: autoAuth.message }],
          isError: true,
          details: { mode: "call", error: "auth_required", server: serverName, message: autoAuth.message }
        };
      }
      if (autoAuth.status === "success") {
        await state.manager.close(serverName);
        state.failureTracker.delete(serverName);
        connection = state.manager.getConnection(serverName);
      }
    }
    if (connection?.status === "needs-auth") {
      const message = getAuthRequiredMessage(state, serverName);
      return {
        content: [{ type: "text", text: message }],
        isError: true,
        details: { mode: "call", error: "auth_required", server: serverName, message }
      };
    }
  }
  if (!connection || connection.status !== "connected") {
    const failedAgo = getFailureAgeSeconds(state, serverName);
    if (failedAgo !== null) {
      return {
        content: [{ type: "text", text: `Server "${serverName}" not available (last failed ${failedAgo}s ago)` }],
        isError: true,
        details: { mode: "call", error: "server_backoff", server: serverName }
      };
    }
    const definition = state.config.mcpServers[serverName];
    if (!definition) {
      return {
        content: [{ type: "text", text: `Server "${serverName}" not connected` }],
        isError: true,
        details: { mode: "call", error: "server_not_connected", server: serverName }
      };
    }
    try {
      if (state.ui) {
        state.ui.setStatus("mcp", `MCP: connecting to ${serverName}...`);
      }
      connection = await state.manager.connect(serverName, definition);
      if (connection.status === "needs-auth") {
        if (!autoAuthAttempted) {
          autoAuthAttempted = true;
          const autoAuth = await attemptAutoAuth(state, serverName);
          if (autoAuth.status === "failed") {
            return {
              content: [{ type: "text", text: autoAuth.message }],
              isError: true,
              details: { mode: "call", error: "auth_required", server: serverName, message: autoAuth.message }
            };
          }
          if (autoAuth.status === "success") {
            await state.manager.close(serverName);
            connection = await state.manager.connect(serverName, definition);
          }
        }
        if (connection.status === "needs-auth") {
          const message = getAuthRequiredMessage(state, serverName);
          return {
            content: [{ type: "text", text: message }],
            isError: true,
            details: { mode: "call", error: "auth_required", server: serverName, message }
          };
        }
      }
      state.failureTracker.delete(serverName);
      updateServerMetadata(state, serverName);
      updateMetadataCache(state, serverName);
      updateStatusBar(state);
      toolMeta = findToolByName(state.toolMetadata.get(serverName), toolName);
      if (!toolMeta) {
        const available = getToolNames(state, serverName);
        const hint = available.length > 0 ? `Available tools on "${serverName}": ${available.join(", ")}` : `Server "${serverName}" has no tools.`;
        return {
          content: [{ type: "text", text: `Tool "${toolName}" not found on "${serverName}" after reconnect. ${hint}` }],
          isError: true,
          details: { mode: "call", error: "tool_not_found_after_reconnect", requestedTool: toolName }
        };
      }
    } catch (error) {
      state.failureTracker.set(serverName, Date.now());
      updateStatusBar(state);
      const message = error instanceof Error ? error.message : String(error);
      return {
        content: [{ type: "text", text: `Failed to connect to "${serverName}": ${message}` }],
        isError: true,
        details: { mode: "call", error: "connect_failed", message }
      };
    }
  }
  let uiSession = null;
  try {
    state.manager.touch(serverName);
    state.manager.incrementInFlight(serverName);
    if (toolMeta.resourceUri) {
      return executeReadResource(state, serverName, toolMeta.resourceUri, signal);
    }
    uiSession = toolMeta.uiResourceUri ? await maybeStartUiSession(state, {
      serverName,
      toolName: toolMeta.originalName,
      toolArgs: args ?? {},
      uiResourceUri: toolMeta.uiResourceUri,
      streamMode: toolMeta.uiStreamMode
    }) : null;
    const resultPromise = connection.client.callTool(
      {
        name: toolMeta.originalName,
        arguments: args ?? {},
        _meta: buildMcpRequestMeta(state.sessionId, uiSession?.requestMeta)
      },
      void 0,
      { signal }
    );
    if (toolMeta.uiResourceUri) {
      const result2 = await resultPromise;
      uiSession?.sendToolResult(result2);
      const mcpContent2 = result2.content ?? [];
      const content2 = transformMcpContent(mcpContent2);
      const mcpText = content2.filter((c) => c.type === "text").map((c) => c.text).join("\n");
      if (result2.isError) {
        const cappedErr = capText(mcpText || "Tool execution failed", `${serverName}-${toolMeta.originalName}-error`, state.config.settings).text;
        let errorWithSchema = `Error: ${cappedErr}`;
        if (toolMeta.inputSchema) {
          errorWithSchema += `

Expected parameters:
${formatSchema(toolMeta.inputSchema)}`;
        }
        return {
          content: [{ type: "text", text: errorWithSchema }],
          isError: true,
          details: { mode: "call", error: "tool_error", mcpResult: result2 }
        };
      }
      const resultText = capText(mcpText || "(empty result)", `${serverName}-${toolMeta.originalName}`, state.config.settings).text;
      const uiMessage = uiSession?.reused ? "Updated the open UI." : "\u{1F4FA} Interactive UI is now open in your browser. I'll respond to your prompts and intents as you interact with it.";
      return {
        content: [{ type: "text", text: `${resultText}

${uiMessage}` }],
        details: { mode: "call", mcpResult: result2, server: serverName, tool: toolMeta.originalName, uiOpen: true }
      };
    }
    const result = await resultPromise;
    const mcpContent = result.content ?? [];
    const content = transformMcpContent(mcpContent);
    if (result.isError) {
      const rawErrorText = content.filter((c) => c.type === "text").map((c) => c.text).join("\n") || "Tool execution failed";
      const errorText = capText(rawErrorText, `${serverName}-${toolMeta.originalName}-error`, state.config.settings).text;
      let errorWithSchema = `Error: ${errorText}`;
      if (toolMeta.inputSchema) {
        errorWithSchema += `

Expected parameters:
${formatSchema(toolMeta.inputSchema)}`;
      }
      return {
        content: [{ type: "text", text: errorWithSchema }],
        isError: true,
        details: { mode: "call", error: "tool_error", mcpResult: result }
      };
    }
    const capped = capContentBlocks(content, `${serverName}-${toolMeta.originalName}`, state.config.settings).content;
    return {
      content: capped.length > 0 ? capped : [{ type: "text", text: "(empty result)" }],
      details: { mode: "call", mcpResult: result, server: serverName, tool: toolMeta.originalName }
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    uiSession?.sendToolCancelled(message);
    let errorWithSchema = `Failed to call tool: ${message}`;
    if (toolMeta.inputSchema) {
      errorWithSchema += `

Expected parameters:
${formatSchema(toolMeta.inputSchema)}`;
    }
    return {
      content: [{ type: "text", text: errorWithSchema }],
      isError: true,
      details: { mode: "call", error: "call_failed", message }
    };
  } finally {
    if (uiSession?.reused) {
      uiSession.close();
    }
    state.manager.decrementInFlight(serverName);
    state.manager.touch(serverName);
  }
}

// mcp-tool-renderer.ts
import { keyHint } from "@earendil-works/pi-coding-agent";
import { Text, visibleWidth } from "@earendil-works/pi-tui";
var COLLAPSED_RESULT_LINES = 10;
var TRUNCATED_SUFFIX = "...";
var McpCallComponent = class extends Text {
  constructor(titleText, args, expanded, theme, summaryKind) {
    super("", 0, 0);
    this.titleText = titleText;
    this.expanded = expanded;
    this.theme = theme;
    this.summaryKind = summaryKind;
    this.args = args ?? {};
  }
  titleText;
  expanded;
  theme;
  summaryKind;
  args;
  render(width) {
    const title = this.theme.fg("toolTitle", this.theme.bold(this.titleText));
    if (this.expanded) {
      this.setText(`${title}

${this.theme.fg("toolOutput", JSON.stringify(this.args ?? {}, null, 2))}`);
    } else {
      let summary = JSON.stringify(this.args) ?? "{}";
      if (this.summaryKind === "proxy") {
        if (this.args.action === "ui-messages") summary = "ui-messages";
        else if (this.args.tool) summary = `tool ${this.args.tool}`;
        else if (this.args.connect) summary = `connect ${this.args.connect}`;
        else if (this.args.describe) summary = `describe ${this.args.describe}`;
        else if (this.args.search) summary = `search ${JSON.stringify(this.args.search)}`;
        else if (this.args.server) summary = `server ${this.args.server}`;
        else summary = "status";
      }
      const separator = summary ? " " : "";
      const summaryWidth = Math.max(0, width - visibleWidth(title) - visibleWidth(separator));
      this.setText(`${title}${separator}${this.theme.fg("dim", truncateVisible(summary, summaryWidth).text)}`);
    }
    return super.render(width);
  }
};
var McpResultComponent = class extends Text {
  constructor(result, expanded, contextIsError, theme) {
    super("", 0, 0);
    this.expanded = expanded;
    this.theme = theme;
    this.output = result.content.filter((block) => block.type === "text").map((block) => block.text ?? "").filter(Boolean).join("\n");
    this.isError = contextIsError || !!result.details?.error;
  }
  expanded;
  theme;
  output;
  isError;
  render(width) {
    const normalized = this.output.replace(/\r\n/g, "\n").replace(/\r/g, "").trimEnd();
    let output = normalized || "(empty result)";
    if (normalized && !this.expanded) {
      const logicalLines = normalized.split("\n");
      const truncatedLines = logicalLines.slice(0, COLLAPSED_RESULT_LINES).map((line) => truncateVisible(line, Math.max(0, width)));
      const lines = truncatedLines.map((line) => line.text);
      const skippedCount = logicalLines.length - truncatedLines.length;
      if (skippedCount > 0 || truncatedLines.some((line) => line.truncated)) {
        const hidden = skippedCount > 0 ? `${skippedCount} more line${skippedCount === 1 ? "" : "s"}` : "more text";
        output = [
          ...lines,
          `... (${hidden}, ${keyHint("app.tools.expand", "to expand")})`
        ].join("\n");
      } else {
        output = lines.join("\n");
      }
    }
    const outputColor = this.isError ? "error" : "toolOutput";
    this.setText(`
${this.theme.fg(outputColor, output)}`);
    return super.render(width);
  }
};
function truncateVisible(value, maxWidth) {
  if (visibleWidth(value) <= maxWidth) return { text: value, truncated: false };
  const suffixWidth = visibleWidth(TRUNCATED_SUFFIX);
  if (maxWidth <= suffixWidth) {
    return { text: TRUNCATED_SUFFIX.slice(0, Math.max(0, maxWidth)), truncated: true };
  }
  const targetWidth = maxWidth - suffixWidth;
  let current = "";
  for (const char of value) {
    if (visibleWidth(current + char) > targetWidth) break;
    current += char;
  }
  return { text: `${current}${TRUNCATED_SUFFIX}`, truncated: true };
}

// index.ts
var sharedRuntime = globalThis.__piMcpAdapterRuntime ??= {
  state: null,
  initPromise: null,
  lifecycleGeneration: 0,
  activeSessions: 0
};
function getJsonType(value) {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}
function requireProxyToolArgs(value) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`Invalid args: expected a JSON object, got ${getJsonType(value)}`);
  }
  return value;
}
function normalizeProxyToolArgs(args) {
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
  return requireProxyToolArgs(normalized);
}
function prepareMcpProxyArguments(raw) {
  const params = requireProxyToolArgs(raw);
  if (params.args === void 0) return params;
  return {
    ...params,
    args: normalizeProxyToolArgs(params.args)
  };
}
function mcpAdapter(pi) {
  let sessionAttached = false;
  async function getReadyState() {
    if (sharedRuntime.state) return sharedRuntime.state;
    const promise = sharedRuntime.initPromise;
    if (!promise) return null;
    return promise;
  }
  async function shutdownState(currentState, reason) {
    if (!currentState) return;
    currentState.closed = true;
    if (currentState.uiServer) {
      currentState.uiServer.close(reason);
      currentState.uiServer = null;
    }
    let flushError;
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
  const directSpecs = envRaw === "__none__" ? [] : resolveDirectTools(
    earlyConfig,
    earlyCache,
    prefix,
    envRaw?.split(",").map((s) => s.trim()).filter(Boolean)
  );
  const missingConfiguredDirectToolServers = getMissingConfiguredDirectToolServers(earlyConfig, earlyCache);
  const shouldRegisterProxyTool = earlyConfig.settings?.disableProxyTool !== true || directSpecs.length === 0 || missingConfiguredDirectToolServers.length > 0;
  for (const spec of directSpecs) {
    pi.registerTool({
      name: spec.prefixedName,
      label: `MCP: ${spec.originalName}`,
      description: spec.description || "(no description)",
      promptSnippet: truncateAtWord(spec.description, 100) || `MCP tool from ${spec.serverName}`,
      parameters: Type.Unsafe(spec.inputSchema || { type: "object", properties: {} }),
      execute: createDirectToolExecutor(() => sharedRuntime.state, () => sharedRuntime.initPromise, spec),
      renderCall: (args, theme, context) => new McpCallComponent(
        `mcp \u2192 ${spec.serverName}/${spec.originalName}`,
        args,
        context?.expanded ?? false,
        theme,
        "direct"
      ),
      renderResult: (result, options, theme, context) => new McpResultComponent(result, options.expanded, context?.isError ?? false, theme)
    });
  }
  const getPiTools = () => pi.getAllTools();
  pi.registerFlag("mcp-config", {
    description: "Path to MCP config file",
    type: "string"
  });
  function startInitialization(ctx) {
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
    }).catch((err) => {
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
        shutdownOAuth()
      ]);
    } catch (error) {
      logger.error("MCP: failed to shut down previous session state", error instanceof Error ? error : new Error(String(error)));
    }
    await initializeOAuth().catch((err) => {
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
        shutdownOAuth()
      ]);
    } catch (error) {
      logger.error("MCP: session shutdown cleanup failed", error instanceof Error ? error : new Error(String(error)));
    }
  });
  pi.registerCommand("mcp", {
    description: "Show MCP server status",
    handler: async (args, ctx) => {
      let state;
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
    }
  });
  pi.registerCommand("mcp-auth", {
    description: "Log in to an OAuth MCP server (pick one if no name is given)",
    getArgumentCompletions: (prefix2) => {
      const state = sharedRuntime.state;
      if (!state) return null;
      const items = listOAuthServers(state).filter((server2) => server2.name.startsWith(prefix2.trim())).map((server2) => ({
        value: server2.name,
        label: server2.name,
        description: server2.needsAuth ? "needs login" : void 0
      }));
      return items.length > 0 ? items : null;
    },
    handler: async (args, ctx) => {
      const serverName = args?.trim() || void 0;
      let state;
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
      await authenticateServer(state, serverName, ctx);
    }
  });
  if (shouldRegisterProxyTool) {
    pi.registerTool({
      name: "mcp",
      label: "MCP",
      description: buildProxyDescription(earlyConfig, earlyCache, directSpecs),
      promptSnippet: "MCP gateway - connect to MCP servers and call their tools",
      parameters: Type.Object({
        tool: Type.Optional(Type.String({ description: "Tool name to call (e.g., 'xcodebuild_list_sims')" })),
        resource: Type.Optional(Type.String({ description: "Resource URI or expanded template URI to read (requires server)" })),
        args: Type.Optional(Type.Object({}, {
          additionalProperties: Type.Any(),
          description: 'Arguments as an object; JSON string is also accepted for compatibility (e.g., {"key": "value"})'
        })),
        connect: Type.Optional(Type.String({ description: "Server name to connect (lazy connect + metadata refresh)" })),
        describe: Type.Optional(Type.String({ description: "Tool name to describe (shows parameters)" })),
        search: Type.Optional(Type.String({ description: "Search tools by name/description" })),
        regex: Type.Optional(Type.Boolean({ description: "Treat search as regex (default: substring match)" })),
        includeSchemas: Type.Optional(Type.Boolean({ description: "Include parameter schemas in search results (default: true)" })),
        server: Type.Optional(Type.String({ description: "Filter to specific server (also disambiguates tool calls)" })),
        action: Type.Optional(Type.String({ description: "Action: 'ui-messages' to retrieve prompts/intents from UI sessions" }))
      }),
      prepareArguments: prepareMcpProxyArguments,
      renderCall: (args, theme, context) => new McpCallComponent(
        "mcp",
        args,
        context?.expanded ?? false,
        theme,
        "proxy"
      ),
      renderResult: (result, options, theme, context) => new McpResultComponent(result, options.expanded, context?.isError ?? false, theme),
      async execute(_toolCallId, params, signal, _onUpdate, _ctx) {
        const parsedArgs = params.args === void 0 ? void 0 : normalizeProxyToolArgs(params.args);
        let state;
        try {
          state = await getReadyState();
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          return {
            content: [{ type: "text", text: `MCP initialization failed: ${message}` }],
            isError: true,
            details: { error: "init_failed", message }
          };
        }
        if (!state) {
          return {
            content: [{ type: "text", text: "MCP not initialized" }],
            isError: true,
            details: { error: "not_initialized" }
          };
        }
        if (params.action === "ui-messages") {
          return executeUiMessages(state);
        }
        if (params.tool) {
          return executeCall(state, params.tool, parsedArgs, params.server, getPiTools, signal);
        }
        if (params.resource) {
          if (!params.server) {
            return {
              content: [{ type: "text", text: "Reading a resource requires the server parameter." }],
              isError: true,
              details: { error: "server_required", resource: params.resource }
            };
          }
          return executeReadResource(state, params.server, params.resource, signal);
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
      }
    });
  }
}
export {
  mcpAdapter as default
};
