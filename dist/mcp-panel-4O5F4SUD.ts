import {
  resourceToolBaseNames
} from "./chunk-I4BZXY6U.ts";
import {
  isToolExcluded
} from "./chunk-VDZJM7QN.ts";

// mcp-panel.ts
import { matchesKey, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
var DEFAULT_THEME = {
  border: "2",
  title: "2",
  selected: "36",
  promoted: "32",
  needsAuth: "33",
  placeholder: "2;3",
  description: "2",
  hint: "2",
  confirm: "32",
  cancel: "31"
};
function fg(code, text) {
  if (!code) return text;
  return `\x1B[${code}m${text}\x1B[0m`;
}
var RAINBOW_COLORS = [
  "38;2;178;129;214",
  "38;2;215;135;175",
  "38;2;254;188;56",
  "38;2;228;192;15",
  "38;2;137;210;129",
  "38;2;0;175;175",
  "38;2;23;143;185"
];
function rainbowProgress(filled, total) {
  const dots = [];
  for (let i = 0; i < total; i++) {
    const color = RAINBOW_COLORS[i % RAINBOW_COLORS.length];
    dots.push(fg(color, i < filled ? "\u25CF" : "\u25CB"));
  }
  return dots.join(" ");
}
function fuzzyScore(query, text) {
  const lq = query.toLowerCase();
  const lt = text.toLowerCase();
  if (lt.includes(lq)) return 100 + lq.length / lt.length * 50;
  let score = 0;
  let qi = 0;
  let consecutive = 0;
  for (let i = 0; i < lt.length && qi < lq.length; i++) {
    if (lt[i] === lq[qi]) {
      score += 10 + consecutive;
      consecutive += 5;
      qi++;
    } else {
      consecutive = 0;
    }
  }
  return qi === lq.length ? score : 0;
}
function estimateTokens(tool) {
  const schemaLen = JSON.stringify(tool.inputSchema ?? {}).length;
  const descLen = tool.description?.length ?? 0;
  return Math.ceil((tool.name.length + descLen + schemaLen) / 4) + 10;
}
var McpPanel = class _McpPanel {
  constructor(config, cache, provenance, callbacks, tui, done, noticeLines = []) {
    this.callbacks = callbacks;
    this.done = done;
    this.tui = tui;
    this.noticeLines = noticeLines;
    this.prefix = config.settings?.toolPrefix ?? "server";
    for (const [serverName, definition] of Object.entries(config.mcpServers)) {
      const prov = provenance.get(serverName);
      const serverCache = cache?.servers?.[serverName];
      const promotedTools = new Set(definition.promotedTools ?? []);
      const tools = [];
      if (serverCache) {
        for (const tool of serverCache.tools ?? []) {
          if (isToolExcluded(tool.name, serverName, this.prefix, definition.excludeTools)) {
            continue;
          }
          const isPromoted = promotedTools.has(tool.name);
          tools.push({
            name: tool.name,
            description: tool.description ?? "",
            isPromoted,
            wasPromoted: isPromoted,
            estimatedTokens: estimateTokens(tool)
          });
        }
        if (definition.exposeResources !== false) {
          const resources = serverCache.resources ?? [];
          const resourceNames = resourceToolBaseNames(resources, serverCache.tools?.map((tool) => tool.name));
          for (const [index, resource] of resources.entries()) {
            const baseName = resourceNames[index];
            if (isToolExcluded(baseName, serverName, this.prefix, definition.excludeTools)) {
              continue;
            }
            const isPromoted = promotedTools.has(baseName);
            const ct = { name: baseName, description: resource.description };
            tools.push({
              name: baseName,
              description: resource.description ?? `Read resource: ${resource.uri}`,
              isPromoted,
              wasPromoted: isPromoted,
              estimatedTokens: estimateTokens(ct)
            });
          }
        }
      }
      const status = callbacks.getConnectionStatus(serverName);
      this.servers.push({
        name: serverName,
        expanded: false,
        source: prov?.kind ?? "user",
        importKind: prov?.importKind,
        excludeTools: definition.excludeTools,
        exposeResources: definition.exposeResources !== false,
        connectionStatus: status,
        tools,
        hasCachedData: !!serverCache
      });
    }
    this.rebuildVisibleItems();
    this.resetInactivityTimeout();
  }
  callbacks;
  done;
  noticeLines;
  prefix;
  servers = [];
  cursorIndex = 0;
  nameQuery = "";
  descSearchActive = false;
  descQuery = "";
  dirty = false;
  confirmingDiscard = false;
  discardSelected = 1;
  importNotice = null;
  authNotice = null;
  inactivityTimeout = null;
  visibleItems = [];
  tui;
  t = DEFAULT_THEME;
  static MAX_VISIBLE = 12;
  static INACTIVITY_MS = 6e4;
  resetInactivityTimeout() {
    if (this.inactivityTimeout) clearTimeout(this.inactivityTimeout);
    this.inactivityTimeout = setTimeout(() => {
      this.cleanup();
      this.done({ cancelled: true, changes: /* @__PURE__ */ new Map() });
    }, _McpPanel.INACTIVITY_MS);
  }
  cleanup() {
    if (this.inactivityTimeout) {
      clearTimeout(this.inactivityTimeout);
      this.inactivityTimeout = null;
    }
  }
  rebuildVisibleItems() {
    const query = this.descSearchActive ? this.descQuery : this.nameQuery;
    const mode = this.descSearchActive ? "desc" : "name";
    this.visibleItems = [];
    for (let si = 0; si < this.servers.length; si++) {
      const server = this.servers[si];
      this.visibleItems.push({ type: "server", serverIndex: si });
      if (server.expanded || query) {
        for (let ti = 0; ti < server.tools.length; ti++) {
          const tool = server.tools[ti];
          if (query) {
            const score = mode === "name" ? Math.max(
              fuzzyScore(query, tool.name),
              fuzzyScore(query, server.name) * 0.6
            ) : fuzzyScore(query, tool.description);
            if (score === 0) continue;
          }
          this.visibleItems.push({ type: "tool", serverIndex: si, toolIndex: ti });
        }
      }
    }
    if (query) {
      this.visibleItems = this.visibleItems.filter((item) => {
        if (item.type === "server") {
          return this.visibleItems.some(
            (other) => other.type === "tool" && other.serverIndex === item.serverIndex
          );
        }
        return true;
      });
    }
  }
  updateDirty() {
    this.dirty = this.servers.some((s) => s.tools.some((t) => t.isPromoted !== t.wasPromoted));
  }
  buildResult() {
    const changes = /* @__PURE__ */ new Map();
    for (const server of this.servers) {
      const changed = server.tools.some((t) => t.isPromoted !== t.wasPromoted);
      if (!changed) continue;
      changes.set(server.name, server.tools.filter((t) => t.isPromoted).map((t) => t.name));
    }
    return { changes, cancelled: false };
  }
  handleInput(data) {
    this.resetInactivityTimeout();
    this.importNotice = null;
    this.authNotice = null;
    if (this.confirmingDiscard) {
      this.handleDiscardInput(data);
      return;
    }
    if (matchesKey(data, "ctrl+c")) {
      this.cleanup();
      this.done({ cancelled: true, changes: /* @__PURE__ */ new Map() });
      return;
    }
    if (matchesKey(data, "ctrl+s")) {
      this.cleanup();
      this.done(this.buildResult());
      return;
    }
    if (this.descSearchActive) {
      if (matchesKey(data, "escape") || matchesKey(data, "return")) {
        this.descSearchActive = false;
        this.descQuery = "";
        this.rebuildVisibleItems();
        this.cursorIndex = Math.min(this.cursorIndex, Math.max(0, this.visibleItems.length - 1));
        return;
      }
      if (matchesKey(data, "backspace")) {
        if (this.descQuery.length > 0) {
          this.descQuery = this.descQuery.slice(0, -1);
          this.rebuildVisibleItems();
          this.cursorIndex = Math.min(this.cursorIndex, Math.max(0, this.visibleItems.length - 1));
        }
        return;
      }
      if (matchesKey(data, "up")) {
        this.moveCursor(-1);
        return;
      }
      if (matchesKey(data, "down")) {
        this.moveCursor(1);
        return;
      }
      if (matchesKey(data, "space")) {
        const item = this.visibleItems[this.cursorIndex];
        if (item) this.toggleItem(item);
        return;
      }
      if (data.length === 1 && data.charCodeAt(0) >= 32) {
        this.descQuery += data;
        this.rebuildVisibleItems();
        this.cursorIndex = Math.min(this.cursorIndex, Math.max(0, this.visibleItems.length - 1));
        return;
      }
      return;
    }
    if (matchesKey(data, "escape")) {
      if (this.nameQuery) {
        this.nameQuery = "";
        this.rebuildVisibleItems();
        this.cursorIndex = Math.min(this.cursorIndex, Math.max(0, this.visibleItems.length - 1));
        return;
      }
      if (this.dirty) {
        this.confirmingDiscard = true;
        this.discardSelected = 1;
        return;
      }
      this.cleanup();
      this.done({ cancelled: true, changes: /* @__PURE__ */ new Map() });
      return;
    }
    if (matchesKey(data, "up")) {
      this.moveCursor(-1);
      return;
    }
    if (matchesKey(data, "down")) {
      this.moveCursor(1);
      return;
    }
    if (matchesKey(data, "space")) {
      const item = this.visibleItems[this.cursorIndex];
      if (item) this.toggleItem(item);
      return;
    }
    if (matchesKey(data, "return")) {
      const item = this.visibleItems[this.cursorIndex];
      if (!item) return;
      const server = this.servers[item.serverIndex];
      if (item.type === "server") {
        if (server.connectionStatus === "needs-auth") {
          if (this.dirty) {
            this.authNotice = `Save (ctrl+s) or discard changes before logging in to ${server.name}`;
            return;
          }
          this.cleanup();
          this.done({ cancelled: true, changes: /* @__PURE__ */ new Map(), loginServer: server.name });
          return;
        }
        server.expanded = !server.expanded;
        this.rebuildVisibleItems();
        this.cursorIndex = Math.min(this.cursorIndex, Math.max(0, this.visibleItems.length - 1));
      } else if (item.toolIndex !== void 0) {
        const tool = server.tools[item.toolIndex];
        tool.isPromoted = !tool.isPromoted;
        if (tool.isPromoted && server.source === "import") {
          this.importNotice = `Imported from ${server.importKind ?? "external"} \u2014 will copy to user config on save`;
        }
        this.updateDirty();
      }
      return;
    }
    if (matchesKey(data, "ctrl+r")) {
      const item = this.visibleItems[this.cursorIndex];
      if (!item) return;
      const server = this.servers[item.serverIndex];
      if (server.connectionStatus === "connecting") return;
      server.connectionStatus = "connecting";
      this.callbacks.reconnect(server.name).then(() => {
        server.connectionStatus = this.callbacks.getConnectionStatus(server.name);
        if (server.connectionStatus === "connected") {
          const entry = this.callbacks.refreshCacheAfterReconnect(server.name);
          if (entry) {
            this.rebuildServerTools(server, entry);
          }
          server.hasCachedData = true;
        }
        this.tui.requestRender();
      }).catch((error) => {
        server.connectionStatus = "failed";
        const message = error instanceof Error ? error.message : String(error);
        this.authNotice = `Reconnect failed for ${server.name}: ${message}`;
        this.tui.requestRender();
      });
      return;
    }
    if (data === "?") {
      this.descSearchActive = true;
      this.descQuery = "";
      this.rebuildVisibleItems();
      this.cursorIndex = Math.min(this.cursorIndex, Math.max(0, this.visibleItems.length - 1));
      return;
    }
    if (matchesKey(data, "backspace")) {
      if (this.nameQuery.length > 0) {
        this.nameQuery = this.nameQuery.slice(0, -1);
        this.rebuildVisibleItems();
        this.cursorIndex = Math.min(this.cursorIndex, Math.max(0, this.visibleItems.length - 1));
      }
      return;
    }
    if (data.length === 1 && data.charCodeAt(0) >= 32) {
      this.nameQuery += data;
      this.rebuildVisibleItems();
      this.cursorIndex = Math.min(this.cursorIndex, Math.max(0, this.visibleItems.length - 1));
      return;
    }
  }
  toggleItem(item) {
    const server = this.servers[item.serverIndex];
    if (item.type === "server") {
      const newState = !server.tools.every((t) => t.isPromoted);
      if (server.source === "import" && newState) {
        this.importNotice = `Imported from ${server.importKind ?? "external"} \u2014 will copy to user config on save`;
      }
      for (const t of server.tools) t.isPromoted = newState;
    } else if (item.toolIndex !== void 0) {
      const tool = server.tools[item.toolIndex];
      tool.isPromoted = !tool.isPromoted;
      if (tool.isPromoted && server.source === "import") {
        this.importNotice = `Imported from ${server.importKind ?? "external"} \u2014 will copy to user config on save`;
      }
    }
    this.updateDirty();
  }
  handleDiscardInput(data) {
    if (matchesKey(data, "ctrl+c")) {
      this.cleanup();
      this.done({ cancelled: true, changes: /* @__PURE__ */ new Map() });
      return;
    }
    if (matchesKey(data, "escape") || data === "n" || data === "N") {
      this.confirmingDiscard = false;
      return;
    }
    if (matchesKey(data, "return")) {
      if (this.discardSelected === 0) {
        this.cleanup();
        this.done({ cancelled: true, changes: /* @__PURE__ */ new Map() });
      } else {
        this.confirmingDiscard = false;
      }
      return;
    }
    if (data === "y" || data === "Y") {
      this.cleanup();
      this.done({ cancelled: true, changes: /* @__PURE__ */ new Map() });
      return;
    }
    if (matchesKey(data, "left") || matchesKey(data, "right") || matchesKey(data, "tab")) {
      this.discardSelected = this.discardSelected === 0 ? 1 : 0;
    }
  }
  moveCursor(delta) {
    if (this.visibleItems.length === 0) return;
    this.cursorIndex = Math.max(0, Math.min(this.visibleItems.length - 1, this.cursorIndex + delta));
  }
  rebuildServerTools(server, entry) {
    const existingState = /* @__PURE__ */ new Map();
    for (const t of server.tools) existingState.set(t.name, t.isPromoted);
    const newTools = [];
    for (const tool of entry.tools ?? []) {
      if (isToolExcluded(tool.name, server.name, this.prefix, server.excludeTools)) {
        continue;
      }
      const prev = existingState.get(tool.name);
      const isPromoted = prev !== void 0 ? prev : false;
      newTools.push({
        name: tool.name,
        description: tool.description ?? "",
        isPromoted,
        wasPromoted: prev !== void 0 ? server.tools.find((t) => t.name === tool.name)?.wasPromoted ?? false : false,
        estimatedTokens: estimateTokens(tool)
      });
    }
    if (server.exposeResources) {
      const resources = entry.resources ?? [];
      const resourceNames = resourceToolBaseNames(resources, entry.tools?.map((tool) => tool.name));
      for (const [index, resource] of resources.entries()) {
        const baseName = resourceNames[index];
        if (isToolExcluded(baseName, server.name, this.prefix, server.excludeTools)) {
          continue;
        }
        const prev = existingState.get(baseName);
        const isPromoted = prev !== void 0 ? prev : false;
        const ct = { name: baseName, description: resource.description };
        newTools.push({
          name: baseName,
          description: resource.description ?? `Read resource: ${resource.uri}`,
          isPromoted,
          wasPromoted: prev !== void 0 ? server.tools.find((t) => t.name === baseName)?.wasPromoted ?? false : false,
          estimatedTokens: estimateTokens(ct)
        });
      }
    }
    server.tools = newTools;
    this.rebuildVisibleItems();
    this.updateDirty();
  }
  render(width) {
    const innerW = width - 2;
    const lines = [];
    const t = this.t;
    const bold = (s) => `\x1B[1m${s}\x1B[22m`;
    const italic = (s) => `\x1B[3m${s}\x1B[23m`;
    const inverse = (s) => `\x1B[7m${s}\x1B[27m`;
    const row = (content) => fg(t.border, "\u2502") + truncateToWidth(" " + content, innerW, "\u2026", true) + fg(t.border, "\u2502");
    const emptyRow = () => fg(t.border, "\u2502") + " ".repeat(innerW) + fg(t.border, "\u2502");
    const divider = () => fg(t.border, "\u251C" + "\u2500".repeat(innerW) + "\u2524");
    const titleText = " MCP Servers ";
    const borderLen = innerW - visibleWidth(titleText);
    const leftB = Math.floor(borderLen / 2);
    const rightB = borderLen - leftB;
    lines.push(fg(t.border, "\u256D" + "\u2500".repeat(leftB)) + fg(t.title, titleText) + fg(t.border, "\u2500".repeat(rightB) + "\u256E"));
    lines.push(emptyRow());
    const cursor = fg(t.selected, "\u2502");
    const searchIcon = fg(t.border, "\u25CE");
    if (this.descSearchActive) {
      lines.push(row(`${searchIcon}  ${fg(t.needsAuth, "desc:")} ${this.descQuery}${cursor}`));
    } else if (this.nameQuery) {
      lines.push(row(`${searchIcon}  ${this.nameQuery}${cursor}`));
    } else {
      lines.push(row(`${searchIcon}  ${fg(t.placeholder, italic("search..."))}`));
    }
    lines.push(emptyRow());
    if (this.noticeLines.length > 0) {
      for (const notice of this.noticeLines) {
        lines.push(row(fg(t.hint, italic(notice))));
      }
      lines.push(emptyRow());
    }
    lines.push(divider());
    if (this.servers.length === 0) {
      lines.push(emptyRow());
      lines.push(row(fg(t.hint, italic("No MCP servers configured."))));
      lines.push(emptyRow());
    } else {
      const maxVis = _McpPanel.MAX_VISIBLE;
      const total = this.visibleItems.length;
      const startIdx = Math.max(0, Math.min(this.cursorIndex - Math.floor(maxVis / 2), total - maxVis));
      const endIdx = Math.min(startIdx + maxVis, total);
      lines.push(emptyRow());
      for (let i = startIdx; i < endIdx; i++) {
        const item = this.visibleItems[i];
        const isCursor = i === this.cursorIndex;
        const server = this.servers[item.serverIndex];
        if (item.type === "server") {
          lines.push(row(this.renderServerRow(server, isCursor)));
        } else if (item.toolIndex !== void 0) {
          lines.push(row(this.renderToolRow(server.tools[item.toolIndex], isCursor, innerW)));
        }
      }
      lines.push(emptyRow());
      if (total > maxVis) {
        const prog = Math.round((this.cursorIndex + 1) / total * 10);
        lines.push(row(`${rainbowProgress(prog, 10)}  ${fg(t.hint, `${this.cursorIndex + 1}/${total}`)}`));
        lines.push(emptyRow());
      }
      if (this.importNotice) {
        lines.push(row(fg(t.needsAuth, italic(this.importNotice))));
        lines.push(emptyRow());
      }
      if (this.authNotice) {
        lines.push(row(fg(t.needsAuth, italic(this.authNotice))));
        lines.push(emptyRow());
      }
    }
    lines.push(divider());
    lines.push(emptyRow());
    if (this.confirmingDiscard) {
      const discardBtn = this.discardSelected === 0 ? inverse(bold(fg(t.cancel, "  Discard  "))) : fg(t.hint, "  Discard  ");
      const keepBtn = this.discardSelected === 1 ? inverse(bold(fg(t.confirm, "  Keep  "))) : fg(t.hint, "  Keep  ");
      lines.push(row(`Discard unsaved changes?  ${discardBtn}   ${keepBtn}`));
    } else {
      const promotedCount = this.servers.reduce((sum, s) => sum + s.tools.filter((t2) => t2.isPromoted).length, 0);
      const totalTokens = this.servers.reduce(
        (sum, s) => sum + s.tools.filter((t2) => t2.isPromoted).reduce((ts, t2) => ts + t2.estimatedTokens, 0),
        0
      );
      const stats = promotedCount > 0 ? `${promotedCount} schemas  ~${totalTokens.toLocaleString()} tokens` : "no preloaded schemas";
      lines.push(row(fg(t.description, stats + (this.dirty ? fg(t.needsAuth, "  (unsaved)") : ""))));
    }
    lines.push(emptyRow());
    const hints = [
      italic("\u2191\u2193") + " navigate",
      italic("space") + " toggle",
      italic("\u23CE") + " expand",
      italic("ctrl+r") + " reconnect",
      italic("?") + " desc search",
      italic("ctrl+s") + " save",
      italic("esc") + " clear/close",
      italic("ctrl+c") + " quit"
    ];
    const gap = "  ";
    const gapW = 2;
    const maxW = innerW - 2;
    let curLine = "";
    let curW = 0;
    for (const hint of hints) {
      const hw = visibleWidth(hint);
      const needed = curW === 0 ? hw : gapW + hw;
      if (curW > 0 && curW + needed > maxW) {
        lines.push(row(fg(t.hint, curLine)));
        curLine = hint;
        curW = hw;
      } else {
        curLine += (curW > 0 ? gap : "") + hint;
        curW += needed;
      }
    }
    if (curLine) lines.push(row(fg(t.hint, curLine)));
    lines.push(fg(t.border, "\u2570" + "\u2500".repeat(innerW) + "\u256F"));
    return lines;
  }
  renderServerRow(server, isCursor) {
    const t = this.t;
    const bold = (s) => `\x1B[1m${s}\x1B[22m`;
    const expandIcon = server.expanded ? "\u25BE" : "\u25B8";
    const prefix = isCursor ? fg(t.selected, expandIcon) : fg(t.border, server.expanded ? expandIcon : "\xB7");
    const nameStr = isCursor ? bold(fg(t.selected, server.name)) : server.name;
    const importLabel = server.source === "import" ? fg(t.description, ` (${server.importKind ?? "import"})`) : "";
    if (!server.hasCachedData) {
      return `${prefix}   ${nameStr}${importLabel}  ${fg(t.description, "(not cached)")}`;
    }
    const promotedCount = server.tools.filter((t2) => t2.isPromoted).length;
    const totalCount = server.tools.length;
    let toggleIcon = fg(t.description, "\u25CB");
    if (promotedCount === totalCount && totalCount > 0) {
      toggleIcon = fg(t.promoted, "\u25CF");
    } else if (promotedCount > 0) {
      toggleIcon = fg(t.needsAuth, "\u25D0");
    }
    let toolInfo = "";
    if (totalCount > 0) {
      toolInfo = `${promotedCount}/${totalCount}`;
      if (promotedCount > 0) {
        const tokens = server.tools.filter((t2) => t2.isPromoted).reduce((s, t2) => s + t2.estimatedTokens, 0);
        toolInfo += `  ~${tokens.toLocaleString()}`;
      }
      toolInfo = fg(t.description, toolInfo);
    }
    return `${prefix} ${toggleIcon} ${nameStr}${importLabel}  ${toolInfo}`;
  }
  renderToolRow(tool, isCursor, innerW) {
    const t = this.t;
    const bold = (s) => `\x1B[1m${s}\x1B[22m`;
    const toggleIcon = tool.isPromoted ? fg(t.promoted, "\u25CF") : fg(t.description, "\u25CB");
    const cursor = isCursor ? fg(t.selected, "\u25B8") : " ";
    const nameStr = isCursor ? bold(fg(t.selected, tool.name)) : tool.name;
    const prefixLen = 7 + visibleWidth(tool.name);
    const maxDescLen = Math.max(0, innerW - prefixLen - 8);
    const descStr = maxDescLen > 5 && tool.description ? fg(t.description, "\u2014 " + truncateToWidth(tool.description, maxDescLen, "\u2026")) : "";
    return `  ${cursor} ${toggleIcon} ${nameStr} ${descStr}`;
  }
  invalidate() {
  }
  dispose() {
    this.cleanup();
  }
};
function createMcpPanel(config, cache, provenance, callbacks, tui, done, options) {
  return new McpPanel(config, cache, provenance, callbacks, tui, done, options?.noticeLines ?? []);
}
export {
  createMcpPanel
};
