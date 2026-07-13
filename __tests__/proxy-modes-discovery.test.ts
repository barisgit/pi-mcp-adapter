import { describe, expect, it } from "vitest";
import { readFileSync, rmSync } from "node:fs";
import { executeCall, executeConnect, executeDescribe, executeList, executeReadResource, executeSearch } from "../proxy-modes.js";
import { buildToolMetadata } from "../tool-metadata.js";
import type { McpExtensionState } from "../state.js";

function createState(): McpExtensionState {
  return {
    config: {
      mcpServers: {
        demo: { command: "npx", args: ["demo"] },
      },
    },
    toolMetadata: new Map([
      [
        "demo",
        [
          {
            name: "demo_search",
            originalName: "search",
            description: "Search demo records",
            inputSchema: { type: "object", properties: {} },
          },
        ],
      ],
    ]),
    manager: {
      getConnection: () => undefined,
    },
    failureTracker: new Map(),
  } as unknown as McpExtensionState;
}

function createConnectedStateWithoutMetadata(): McpExtensionState {
  const connection = {
    status: "connected",
    tools: [
      {
        name: "resolve-library-id",
        description: "Resolve a package name to a Context7-compatible library ID",
        inputSchema: {
          type: "object",
          properties: {
            libraryName: { type: "string" },
            query: { type: "string" },
          },
        },
      },
      {
        name: "query-docs",
        description: "Retrieve documentation for any programming library",
        inputSchema: { type: "object", properties: {} },
      },
    ],
    resources: [],
  };

  return {
    config: {
      mcpServers: {
        context7: { command: "npx", args: ["context7"] },
      },
    },
    toolMetadata: new Map(),
    manager: {
      getConnection: (name: string) => name === "context7" ? connection : undefined,
    },
    failureTracker: new Map(),
  } as unknown as McpExtensionState;
}

describe("proxy discovery", () => {
  it("uses overridden descriptions for list, describe, and search", async () => {
    const state = createState();
    const definition = {
      command: "auggie",
      toolOverrides: {
        "codebase-retrieval": { description: "Search the current codebase semantically" },
      },
    };
    state.config.mcpServers.auggie = definition;
    state.toolMetadata.set("auggie", buildToolMetadata([
      { name: "codebase-retrieval", description: "Vendor description that must not leak" },
    ], [], definition, "auggie", "server").metadata);

    const list = await executeList(state, "auggie");
    const describe = executeDescribe(state, "auggie_codebase-retrieval");
    const search = await executeSearch(state, "semantically");
    const output = [list, describe, search].map((result) => result.content[0].text).join("\n");

    expect(output).toContain("Search the current codebase semantically");
    expect(output).not.toContain("Vendor description that must not leak");
    expect(search.details).toMatchObject({ count: 1 });
  });

  it("searches MCP tools only", async () => {
    const result = await executeSearch(createState(), "read");

    expect(result.content[0].text).toBe('No tools matching "read"');
    expect(result.details).toMatchObject({ count: 0, matches: [] });
  });

  it("hydrates missing server metadata before filtered search", async () => {
    const result = await executeSearch(createConnectedStateWithoutMetadata(), "context7 resolve library", false, "context7");

    expect(result.details).toMatchObject({ count: 1, matches: [{ server: "context7", tool: "context7_resolve-library-id" }] });
    expect(result.content[0].text).toContain("context7_resolve-library-id");
  });

  it("hydrates missing server metadata before listing a server", async () => {
    const result = await executeList(createConnectedStateWithoutMetadata(), "context7");

    expect(result.details).toMatchObject({ count: 2, tools: ["context7_resolve-library-id", "context7_query-docs"] });
    expect(result.content[0].text).toContain("context7 (2 tools):");
  });

  it("ranks all-term name matches before broader single-term matches", async () => {
    const state = createState();
    state.config.mcpServers.context7 = { command: "npx", args: ["context7"] };
    state.toolMetadata.set("context7", [
      {
        name: "context7_query-docs",
        originalName: "query-docs",
        description: "Retrieve documentation for any programming library",
      },
      {
        name: "context7_resolve-library-id",
        originalName: "resolve-library-id",
        description: "Resolve a package name to a Context7-compatible library ID",
      },
    ]);

    const result = await executeSearch(state, "resolve library");

    expect(result.details).toMatchObject({
      count: 2,
      matches: [
        { server: "context7", tool: "context7_resolve-library-id" },
        { server: "context7", tool: "context7_query-docs" },
      ],
    });
  });

  it("tells callers to invoke native Pi tools directly", async () => {
    const result = await executeCall(
      createState(),
      "read",
      undefined,
      undefined,
      () => [{ name: "read", description: "Read a file" } as any],
    );

    expect(result.content[0].text).toBe(
      '"read" is a native Pi tool. Call read directly instead of using mcp({ tool: "read" }).',
    );
    expect(result.details).toMatchObject({ error: "native_tool", requestedTool: "read" });
  });

  it("reads explicit resource URIs and saves binary content as a private file", async () => {
    const state = createState();
    state.manager = {
      getConnection: () => ({ status: "connected" }),
      readResource: async () => ({
        contents: [
          { uri: "docs://guide", text: "guide text", mimeType: "text/plain" },
          { uri: "docs://asset", blob: Buffer.from("binary data").toString("base64"), mimeType: "application/octet-stream" },
        ],
      }),
    } as unknown as McpExtensionState["manager"];

    const result = await executeReadResource(state, "demo", "docs://guide");
    const details = result.details as { mode: string; files: string[] };

    expect(result.content[0].text).toBe("guide text");
    expect(details.mode).toBe("resource");
    expect(details.files).toHaveLength(1);
    expect(readFileSync(details.files[0], "utf8")).toBe("binary data");
    rmSync(details.files[0], { force: true });
  });

  it("reports aborted and failed explicit resource reads", async () => {
    const state = createState();
    state.manager = {
      getConnection: () => ({ status: "connected" }),
      readResource: async () => { throw new Error("resource unavailable"); },
    } as unknown as McpExtensionState["manager"];
    const controller = new AbortController();
    controller.abort();

    const aborted = await executeReadResource(state, "demo", "docs://guide", controller.signal);
    const failed = await executeReadResource(state, "demo", "docs://guide");

    expect(aborted.details).toMatchObject({ mode: "resource", error: "aborted" });
    expect(failed.details).toMatchObject({ mode: "resource", error: "read_failed", message: "resource unavailable" });
  });

  it("delegates registered resource tools to the explicit resource reader", async () => {
    const state = createState();
    state.toolMetadata.set("demo", [{
      name: "demo_get_guide",
      originalName: "get_guide",
      description: "Read guide",
      resourceUri: "docs://guide",
    }]);
    state.manager = {
      getConnection: () => ({ status: "connected" }),
      readResource: async () => ({ contents: [{ uri: "docs://guide", text: "guide" }] }),
      touch: () => undefined,
      incrementInFlight: () => undefined,
      decrementInFlight: () => undefined,
    } as unknown as McpExtensionState["manager"];

    const result = await executeCall(state, "demo_get_guide", {}, "demo");

    expect(result.content[0].text).toBe("guide");
    expect(result.details).toMatchObject({ mode: "resource", uri: "docs://guide" });
  });
});
