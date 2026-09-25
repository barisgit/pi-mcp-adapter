// server-status.ts - Persisted per-server connection outcomes.
//
// Survives restarts so the adapter can show which servers need an OAuth login
// without connecting to them, and so a server whose background metadata refresh
// failed is not re-probed on every startup (subagent sessions start often).
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { getAgentPath } from "./agent-dir.js";
import { logger } from "./logger.js";

export interface ServerStatus {
  /** The last connection attempt was refused for missing or rejected OAuth credentials. */
  needsAuth?: boolean;
  /** When the last background metadata refresh was attempted (ms since epoch). */
  lastRefreshAttemptAt?: number;
}

interface ServerStatusFile {
  version: 1;
  servers: Record<string, ServerStatus>;
}

export function getServerStatusPath(): string {
  return getAgentPath("mcp-server-status.json");
}

export function loadServerStatuses(): Record<string, ServerStatus> {
  try {
    const raw = JSON.parse(readFileSync(getServerStatusPath(), "utf-8")) as Partial<ServerStatusFile>;
    if (raw?.version !== 1 || !raw.servers || typeof raw.servers !== "object") return {};
    return raw.servers;
  } catch {
    return {};
  }
}

/**
 * Merge a patch into one server's status. Never throws: status is advisory and
 * must not break a connection attempt.
 */
export function updateServerStatus(name: string, patch: ServerStatus): void {
  try {
    const servers = loadServerStatuses();
    const current = servers[name] ?? {};
    const next = { ...current, ...patch };
    // Connections happen often; skip rewriting an unchanged file.
    if (JSON.stringify(next) === JSON.stringify(current)) return;

    servers[name] = next;
    const path = getServerStatusPath();
    mkdirSync(dirname(path), { recursive: true });
    const tmpPath = `${path}.${process.pid}.tmp`;
    const file: ServerStatusFile = { version: 1, servers };
    writeFileSync(tmpPath, JSON.stringify(file, null, 2), "utf-8");
    renameSync(tmpPath, path);
  } catch (error) {
    logger.debug(`MCP: failed to save status for ${name}: ${error instanceof Error ? error.message : String(error)}`);
  }
}
