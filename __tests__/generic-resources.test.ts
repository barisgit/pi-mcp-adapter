import { mkdtempSync, readFileSync, rmSync, statSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ErrorCode, McpError } from "@modelcontextprotocol/sdk/types.js";
import { computeServerHash, loadMetadataCache, reconstructToolMetadata, saveMetadataCache, serializeResources, serializeResourceTemplates } from "../metadata-cache.js";
import { updateMetadataCache } from "../init.js";
import type { McpExtensionState } from "../state.js";
import { resourceContentsToBlocks } from "../resource-tools.js";
import { buildToolMetadata } from "../tool-metadata.js";
import { McpServerManager } from "../server-manager.js";
import { logger, type LogEntry } from "../logger.js";

describe("generic MCP resources", () => {
  it("keeps concrete resources zero-argument and preserves their metadata through cache reconstruction", () => {
    const resource = {
      uri: "docs://guide",
      name: "guide",
      title: "Project guide",
      description: "Read the guide",
      mimeType: "text/markdown",
      annotations: { audience: ["assistant"] },
      _meta: { source: "project" },
    };

    const live = buildToolMetadata([], [resource], { command: "demo" }, "demo", "server").metadata[0];
    const cached = reconstructToolMetadata("demo", {
      configHash: "hash",
      cachedAt: Date.now(),
      tools: [],
      resources: serializeResources([resource]),
      resourceTemplates: [],
    }, "server", { command: "demo" })[0];

    expect(live).toMatchObject({
      name: "demo_get_guide",
      resourceUri: resource.uri,
      resourceTitle: resource.title,
      resourceMimeType: resource.mimeType,
      resourceAnnotations: resource.annotations,
      resourceMeta: resource._meta,
    });
    expect(cached).toEqual(live);
  });

  it("preserves discovered resource templates in the cache", () => {
    const templates = [{
      uriTemplate: "file:///{path}",
      name: "files",
      title: "Files",
      description: "Read any file",
      mimeType: "application/octet-stream",
      annotations: { priority: 0.5 },
      _meta: { root: true },
    }];

    expect(serializeResourceTemplates(templates)).toEqual(templates);
  });

  it("logs unexpected resource listing failures without losing tool connectivity", async () => {
    const manager = new McpServerManager() as unknown as {
      fetchAllResources(client: unknown): Promise<unknown[]>;
    };
    const unsupported = { listResources: async () => { throw new McpError(ErrorCode.MethodNotFound, "unsupported"); } };
    const broken = { listResources: async () => { throw new McpError(ErrorCode.InternalError, "broken"); } };
    const logs: LogEntry[] = [];
    logger.addHandler(entry => logs.push(entry));

    try {
      await expect(manager.fetchAllResources(unsupported)).resolves.toEqual([]);
      await expect(manager.fetchAllResources(broken)).resolves.toEqual([]);
      expect(logs.some(entry => entry.level === "warn" && String(entry.context?.error).includes("broken"))).toBe(true);
    } finally {
      logger.clearHandlers();
    }
  });

  it("refreshes resources and templates after resources/list_changed", async () => {
    const manager = new McpServerManager();
    const handlers: Array<() => Promise<void>> = [];
    const client = {
      setNotificationHandler: (_schema: unknown, handler: () => Promise<void>) => handlers.push(handler),
      listResources: async () => ({ resources: [{ uri: "docs://new", name: "new" }] }),
      listResourceTemplates: async () => ({ resourceTemplates: [{ uriTemplate: "docs://{name}", name: "docs" }] }),
    };
    const connection = { status: "connected", client, resources: [], resourceTemplates: [] };
    const refreshed: string[] = [];
    const internal = manager as unknown as {
      connections: Map<string, typeof connection>;
      attachAdapterNotificationHandlers(server: string, client: unknown): void;
    };
    internal.connections.set("demo", connection);
    manager.setResourceListChangedCallback(server => refreshed.push(server));
    internal.attachAdapterNotificationHandlers("demo", client);

    await handlers[1]();

    expect(connection.resources).toEqual([{ uri: "docs://new", name: "new" }]);
    expect(connection.resourceTemplates).toEqual([{ uriTemplate: "docs://{name}", name: "docs" }]);
    expect(refreshed).toEqual(["demo"]);
  });

  it("clears stale cached resources when a connected server reports none", () => {
    const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
    const agentDir = mkdtempSync(join(tmpdir(), "pi-mcp-resource-cache-"));
    process.env.PI_CODING_AGENT_DIR = agentDir;
    try {
      saveMetadataCache({
        version: 1,
        servers: {
          demo: {
            configHash: computeServerHash({ command: "demo" }),
            cachedAt: Date.now(),
            tools: [],
            resources: [{ uri: "docs://stale", name: "stale" }],
            resourceTemplates: [],
          },
        },
      });
      const connection = {
        status: "connected",
        tools: [],
        resources: [],
        resourceTemplates: [],
      };
      const state = {
        manager: { getConnection: () => connection },
        config: { mcpServers: { demo: { command: "demo" } } },
      } as unknown as McpExtensionState;

      updateMetadataCache(state, "demo");

      expect(loadMetadataCache()?.servers.demo.resources).toEqual([]);
    } finally {
      if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
      else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
      rmSync(agentDir, { recursive: true, force: true });
    }
  });

  it("makes colliding sanitized resource names unique", () => {
    const resources = [
      { name: "foo/bar", uri: "docs://one" },
      { name: "foo bar", uri: "docs://two" },
    ];
    const metadata = buildToolMetadata([], resources, { command: "demo" }, "demo", "server").metadata;

    expect(new Set(metadata.map((item) => item.name)).size).toBe(2);
    expect(metadata.every((item) => item.name.startsWith("demo_get_foo_bar_"))).toBe(true);
  });

  it("spills binary resource contents to a private usable file", () => {
    const payload = Buffer.from([0, 1, 2, 255]);
    const result = resourceContentsToBlocks([
      { uri: "asset://firmware", mimeType: "application/octet-stream", blob: payload.toString("base64") },
    ], "demo");
    const path = result.files[0];

    try {
      expect(readFileSync(path)).toEqual(payload);
      expect(statSync(path).mode & 0o777).toBe(0o600);
      expect(result.content[0].text).toContain(path);
    } finally {
      unlinkSync(path);
    }
  });
});
