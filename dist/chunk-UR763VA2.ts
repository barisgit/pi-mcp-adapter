// logger.ts
import { appendFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
var LEVEL_PRIORITY = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3
};
var LEVEL_PREFIX = {
  debug: "[MCP-UI:DEBUG]",
  info: "[MCP-UI]",
  warn: "[MCP-UI:WARN]",
  error: "[MCP-UI:ERROR]"
};
var DEFAULT_LOG_PATH = join(homedir(), ".pi", "logs", "extensions", "pi-mcp-adapter.log");
var LOG_PATH = process.env.PI_MCP_ADAPTER_LOG_PATH?.trim() || DEFAULT_LOG_PATH;
var Logger = class {
  minLevel = "info";
  handlers = [];
  defaultContext = {};
  setLevel(level) {
    this.minLevel = level;
  }
  setDefaultContext(context) {
    this.defaultContext = context;
  }
  addHandler(handler) {
    this.handlers.push(handler);
  }
  clearHandlers() {
    this.handlers = [];
  }
  shouldLog(level) {
    return LEVEL_PRIORITY[level] >= LEVEL_PRIORITY[this.minLevel];
  }
  emit(level, message, context, error) {
    if (!this.shouldLog(level)) return;
    const entry = {
      level,
      message,
      context: { ...this.defaultContext, ...context },
      error,
      timestamp: /* @__PURE__ */ new Date()
    };
    appendEntryToFile(entry);
    for (const handler of this.handlers) {
      try {
        handler(entry);
      } catch {
      }
    }
  }
  debug(message, context) {
    this.emit("debug", message, context);
  }
  info(message, context) {
    this.emit("info", message, context);
  }
  warn(message, context) {
    this.emit("warn", message, context);
  }
  error(message, error, context) {
    this.emit("error", message, context, error);
  }
  /**
   * Create a child logger with additional default context.
   */
  child(context) {
    return new ChildLogger(this, context);
  }
};
var ChildLogger = class _ChildLogger {
  constructor(parent, context) {
    this.parent = parent;
    this.context = context;
  }
  parent;
  context;
  debug(message, context) {
    this.parent.debug(message, { ...this.context, ...context });
  }
  info(message, context) {
    this.parent.info(message, { ...this.context, ...context });
  }
  warn(message, context) {
    this.parent.warn(message, { ...this.context, ...context });
  }
  error(message, error, context) {
    this.parent.error(message, error, { ...this.context, ...context });
  }
  child(context) {
    return new _ChildLogger(this.parent, { ...this.context, ...context });
  }
};
function appendEntryToFile(entry) {
  try {
    mkdirSync(dirname(LOG_PATH), { recursive: true });
    appendFileSync(LOG_PATH, `${formatEntry(entry)}
`, "utf-8");
  } catch {
  }
}
function formatEntry(entry) {
  const prefix = LEVEL_PREFIX[entry.level];
  const contextStr = formatContext(entry.context);
  const message = contextStr ? `${prefix} ${entry.message} ${contextStr}` : `${prefix} ${entry.message}`;
  const error = entry.error ? ` ${formatError(entry.error)}` : "";
  return `${entry.timestamp.toISOString()} ${message}${error}`;
}
function formatError(error) {
  return error.stack ?? error.message;
}
function formatContext(context) {
  if (!context || Object.keys(context).length === 0) return "";
  const parts = [];
  for (const [key, value] of Object.entries(context)) {
    if (value !== void 0 && value !== null) {
      parts.push(`${key}=${typeof value === "string" ? value : JSON.stringify(value)}`);
    }
  }
  return parts.length > 0 ? `(${parts.join(", ")})` : "";
}
var logger = new Logger();
if (process.env.MCP_UI_DEBUG === "1" || process.env.MCP_UI_DEBUG === "true") {
  logger.setLevel("debug");
}

// errors.ts
var McpUiError = class extends Error {
  code;
  context;
  recoveryHint;
  cause;
  constructor(message, options) {
    super(message);
    this.name = "McpUiError";
    this.code = options.code;
    this.context = options.context ?? {};
    this.recoveryHint = options.recoveryHint;
    this.cause = options.cause;
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }
  toJSON() {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      context: this.context,
      recoveryHint: this.recoveryHint,
      stack: this.stack
    };
  }
};
var ResourceFetchError = class extends McpUiError {
  constructor(uri, reason, options) {
    super(`Failed to fetch UI resource "${uri}": ${reason}`, {
      code: "RESOURCE_FETCH_ERROR",
      context: { uri, server: options?.server },
      recoveryHint: "Check that the MCP server is connected and the resource URI is valid.",
      cause: options?.cause
    });
    this.name = "ResourceFetchError";
  }
};
var ResourceParseError = class extends McpUiError {
  constructor(uri, reason, options) {
    super(`Invalid UI resource "${uri}": ${reason}`, {
      code: "RESOURCE_PARSE_ERROR",
      context: { uri, server: options?.server, mimeType: options?.mimeType },
      recoveryHint: "Ensure the resource returns valid HTML with the correct MIME type."
    });
    this.name = "ResourceParseError";
  }
};
var ConsentError = class extends McpUiError {
  denied;
  constructor(server, options) {
    const message = options.denied ? `Tool calls for "${server}" were denied for this session` : `Tool call approval required for "${server}"`;
    super(message, {
      code: options.denied ? "CONSENT_DENIED" : "CONSENT_REQUIRED",
      context: { server },
      recoveryHint: options.denied ? "The user denied tool access. Start a new session to try again." : "Prompt the user for consent before calling tools."
    });
    this.name = "ConsentError";
    this.denied = options.denied ?? false;
  }
};
var ServerError = class extends McpUiError {
  constructor(reason, options) {
    super(`UI server error: ${reason}`, {
      code: "SERVER_ERROR",
      context: { port: options?.port },
      recoveryHint: "Check if the port is available. Another process may be using it.",
      cause: options?.cause
    });
    this.name = "ServerError";
  }
};
function wrapError(error, context) {
  if (error instanceof McpUiError) {
    return new McpUiError(error.message, {
      code: error.code,
      context: { ...error.context, ...context },
      recoveryHint: error.recoveryHint,
      cause: error.cause
    });
  }
  const cause = error instanceof Error ? error : void 0;
  const message = error instanceof Error ? error.message : String(error);
  return new McpUiError(message, {
    code: "UNKNOWN_ERROR",
    context,
    cause
  });
}

// state.ts
function buildMcpRequestMeta(sessionId, requestMeta) {
  if (!sessionId) return requestMeta;
  return {
    ...requestMeta,
    "pi/session_id": sessionId
  };
}

export {
  logger,
  ResourceFetchError,
  ResourceParseError,
  ConsentError,
  ServerError,
  wrapError,
  buildMcpRequestMeta
};
