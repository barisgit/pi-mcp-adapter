import { describe, expect, it } from "vitest";
import { executeCall, executeList, executeSearch } from "../proxy-modes.js";
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
});
