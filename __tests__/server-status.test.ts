import { describe, expect, it } from "vitest";
import { getServerStatusPath, loadServerStatuses, updateServerStatus } from "../server-status.ts";
import { getServersNeedingAuth } from "../init.ts";
import { isServerCacheStale, isServerCacheValid, computeServerHash } from "../metadata-cache.ts";
import { rmSync } from "node:fs";

function stateWith(connections: Record<string, { status: string }>) {
  return {
    config: { mcpServers: { wiki: { url: "https://wiki.example/mcp" }, notion: { url: "https://notion.example/mcp" }, local: { command: "x" } } },
    manager: { getConnection: (name: string) => connections[name] },
  } as any;
}

describe("server status", () => {
  it("persists needs-auth across sessions until the server connects", () => {
    rmSync(getServerStatusPath(), { force: true });
    updateServerStatus("wiki", { needsAuth: true });
    updateServerStatus("notion", { lastRefreshAttemptAt: 5 });

    expect(loadServerStatuses()).toEqual({ wiki: { needsAuth: true }, notion: { lastRefreshAttemptAt: 5 } });

    // New session, nothing connected yet: the persisted flag is still reported.
    expect(getServersNeedingAuth(stateWith({}))).toEqual(["wiki"]);
    // A live connection wins over the persisted flag, both ways.
    expect(getServersNeedingAuth(stateWith({ wiki: { status: "connected" }, notion: { status: "needs-auth" } }))).toEqual(["notion"]);
  });
});

describe("metadata cache age", () => {
  it("keeps old entries usable and only marks them stale", () => {
    const definition = { command: "x" };
    const entry = { configHash: computeServerHash(definition), tools: [], resources: [], cachedAt: Date.now() - 30 * 24 * 60 * 60 * 1000 };

    expect(isServerCacheValid(entry, definition)).toBe(true);
    expect(isServerCacheStale(entry)).toBe(true);
    expect(isServerCacheStale({ ...entry, cachedAt: Date.now() })).toBe(false);
    expect(isServerCacheValid(entry, { command: "y" })).toBe(false);
  });
});
