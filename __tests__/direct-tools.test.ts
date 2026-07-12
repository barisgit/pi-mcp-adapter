import { afterEach, describe, expect, it } from "vitest";
import { homedir } from "node:os";
import { join } from "node:path";
import { buildProxyDescription, resolveDirectTools } from "../direct-tools.js";
import { computeServerHash, type MetadataCache } from "../metadata-cache.js";
import { buildToolMetadata } from "../tool-metadata.js";
import type { McpConfig } from "../types.js";
import { reconstructToolMetadata } from "../metadata-cache.js";

const originalHashEnv = {
  MCP_HASH_CWD: process.env.MCP_HASH_CWD,
  MCP_HASH_ENV: process.env.MCP_HASH_ENV,
  MCP_HASH_HEADER: process.env.MCP_HASH_HEADER,
  MCP_HASH_TOKEN: process.env.MCP_HASH_TOKEN,
};

afterEach(() => {
  for (const [key, value] of Object.entries(originalHashEnv)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
});

describe("buildProxyDescription", () => {
  it("uses tool description overrides in promoted schemas", () => {
    const config: McpConfig = {
      mcpServers: {
        auggie: {
          command: "auggie",
          promotedTools: ["codebase-retrieval"],
          toolOverrides: {
            "codebase-retrieval": { description: "Search the current codebase semantically" },
          },
        },
      },
    };
    const cache: MetadataCache = {
      version: 1,
      servers: {
        auggie: {
          configHash: computeServerHash(config.mcpServers.auggie),
          cachedAt: Date.now(),
          tools: [{
            name: "codebase-retrieval",
            description: "Vendor description that must not leak",
            inputSchema: { type: "object", properties: { query: { type: "string" } } },
          }],
          resources: [],
        },
      },
    };

    const description = buildProxyDescription(config, cache, []);

    expect(description).toContain("Search the current codebase semantically");
    expect(description).not.toContain("Vendor description that must not leak");
    expect(description).toContain("query (string)");
  });

  it("documents the ui-messages action", () => {
    const config: McpConfig = {
      mcpServers: {
        demo: {
          command: "npx",
          args: ["-y", "demo-server"],
        },
      },
    };

    const cache: MetadataCache = {
      version: 1,
      servers: {
        demo: {
          configHash: "hash",
          cachedAt: Date.now(),
          tools: [
            {
              name: "launch_app",
              description: "Launch the demo app",
              inputSchema: { type: "object", properties: {} },
            },
          ],
          resources: [],
        },
      },
    };

    const description = buildProxyDescription(config, cache, []);

    expect(description).toContain('mcp({ action: "ui-messages" })');
    expect(description).toContain("Retrieve accumulated messages from completed UI sessions");
    expect(description).toContain("Search MCP tools by name/description");
    expect(description).toContain("Non-MCP Pi tools should be called directly, not through mcp.");
    expect(description).not.toContain("MCP + pi");
  });

  it("includes configured server descriptions in proxy summaries", () => {
    const config: McpConfig = {
      mcpServers: {
        demo: {
          command: "npx",
          args: ["-y", "demo-server"],
          description: "Demo server summary",
        },
      },
    };

    const cache: MetadataCache = {
      version: 1,
      servers: {
        demo: {
          configHash: computeServerHash(config.mcpServers.demo),
          cachedAt: Date.now(),
          tools: [{ name: "launch_app", description: "Launch app" }],
          resources: [],
        },
      },
    };

    const description = buildProxyDescription(config, cache, []);

    expect(description).toContain("<mcp_servers>");
    expect(description).toContain("demo (1 tools) - Demo server summary");
  });

  it("renders promoted tool schemas in the proxy description", () => {
    const config: McpConfig = {
      settings: { toolPrefix: "server" },
      mcpServers: {
        github: {
          command: "npx",
          args: ["-y", "github"],
          promotedTools: ["search_repositories"],
        },
      },
    };

    const cache: MetadataCache = {
      version: 1,
      servers: {
        github: {
          configHash: computeServerHash(config.mcpServers.github),
          cachedAt: Date.now(),
          tools: [
            {
              name: "search_repositories",
              description: "Search repositories",
              inputSchema: {
                type: "object",
                properties: { query: { type: "string", description: "Search query" } },
                required: ["query"],
              },
            },
          ],
          resources: [],
        },
      },
    };

    const description = buildProxyDescription(config, cache, []);

    expect(description).toContain("<mcp_tool_schemas>");
    expect(description).toContain('<mcp_tool name="github_search_repositories" server="github">');
    expect(description).toContain("Search repositories");
    expect(description).toContain("query (string) *required* - Search query");
    expect(description).toContain('mcp({ tool: "name", args:');
  });

  it("excludes configured tools from proxy summaries and promoted schemas", () => {
    const config: McpConfig = {
      settings: { toolPrefix: "server" },
      mcpServers: {
        figma: {
          command: "npx",
          args: ["-y", "figma"],
          promotedTools: ["get_screenshot", "get_nodes"],
          excludeTools: ["get_figjam", "figma_get_screenshot"],
        },
      },
    };

    const cache: MetadataCache = {
      version: 1,
      servers: {
        figma: {
          configHash: computeServerHash(config.mcpServers.figma),
          cachedAt: Date.now(),
          tools: [
            { name: "get_screenshot", description: "Take screenshot" },
            { name: "get_nodes", description: "Get nodes" },
          ],
          resources: [
            { name: "figjam", uri: "ui://figjam", description: "FigJam" },
          ],
        },
      },
    };

    const description = buildProxyDescription(config, cache, []);

    expect(description).toContain("figma (1 tools)");
    expect(description).not.toContain("figma (3 tools)");
    expect(description).toContain('<mcp_tool name="figma_get_nodes" server="figma">');
    expect(description).toContain("Get nodes");
    expect(description).not.toContain("figma_get_screenshot");
  });

  it("renders promoted resource schemas in the proxy description", () => {
    const config: McpConfig = {
      settings: { toolPrefix: "server" },
      mcpServers: {
        docs: {
          command: "npx",
          args: ["-y", "docs"],
          promotedTools: ["get_project_guide"],
        },
      },
    };

    const cache: MetadataCache = {
      version: 1,
      servers: {
        docs: {
          configHash: computeServerHash(config.mcpServers.docs),
          cachedAt: Date.now(),
          tools: [],
          resources: [
            { name: "Project Guide", uri: "file://guide.md", description: "Read the project guide" },
          ],
        },
      },
    };

    const description = buildProxyDescription(config, cache, []);

    expect(description).toContain('<mcp_tool name="docs_get_project_guide" server="docs">');
    expect(description).toContain("Read the project guide");
    expect(description).toContain("Parameters:");
  });

  it("does not treat promoted tools as direct/native tools", () => {
    const config: McpConfig = {
      settings: { toolPrefix: "server" },
      mcpServers: {
        github: {
          command: "npx",
          args: ["-y", "github"],
          promotedTools: ["search_repositories"],
        },
      },
    };

    const cache: MetadataCache = {
      version: 1,
      servers: {
        github: {
          configHash: computeServerHash(config.mcpServers.github),
          cachedAt: Date.now(),
          tools: [{ name: "search_repositories", description: "Search repositories" }],
          resources: [],
        },
      },
    };

    const specs = resolveDirectTools(config, cache, "server");
    const description = buildProxyDescription(config, cache, specs);

    expect(specs).toEqual([]);
    expect(description).not.toContain("Direct tools available");
    expect(description).toContain('<mcp_tool name="github_search_repositories" server="github">');
    expect(description).toContain("Search repositories");
  });
});

describe("metadata cache hashing", () => {
  it("hashes interpolated cwd", () => {
    process.env.MCP_HASH_CWD = "/tmp/mcp-one";
    const first = computeServerHash({ command: "node", cwd: "${MCP_HASH_CWD}/server" });

    process.env.MCP_HASH_CWD = "/tmp/mcp-two";
    const second = computeServerHash({ command: "node", cwd: "${MCP_HASH_CWD}/server" });

    expect(first).not.toBe(second);
    expect(computeServerHash({ command: "node", cwd: "${MCP_HASH_CWD}/server" })).toBe(
      computeServerHash({ command: "node", cwd: "/tmp/mcp-two/server" }),
    );
  });

  it("hashes interpolated env values", () => {
    process.env.MCP_HASH_ENV = "/tmp/data-one";
    const first = computeServerHash({ command: "node", env: { DATA_DIR: "${MCP_HASH_ENV}" } });

    process.env.MCP_HASH_ENV = "/tmp/data-two";
    const second = computeServerHash({ command: "node", env: { DATA_DIR: "${MCP_HASH_ENV}" } });

    expect(first).not.toBe(second);
    expect(computeServerHash({ command: "node", env: { DATA_DIR: "${MCP_HASH_ENV}" } })).toBe(
      computeServerHash({ command: "node", env: { DATA_DIR: "/tmp/data-two" } }),
    );
  });

  it("hashes interpolated header values", () => {
    process.env.MCP_HASH_HEADER = "header-one";
    const first = computeServerHash({ url: "https://example.test/mcp", headers: { "x-root": "$env:MCP_HASH_HEADER" } });

    process.env.MCP_HASH_HEADER = "header-two";
    const second = computeServerHash({ url: "https://example.test/mcp", headers: { "x-root": "$env:MCP_HASH_HEADER" } });

    expect(first).not.toBe(second);
    expect(computeServerHash({ url: "https://example.test/mcp", headers: { "x-root": "$env:MCP_HASH_HEADER" } })).toBe(
      computeServerHash({ url: "https://example.test/mcp", headers: { "x-root": "header-two" } }),
    );
  });

  it("hashes tilde cwd as the home directory", () => {
    expect(computeServerHash({ command: "node", cwd: "~/server" })).toBe(
      computeServerHash({ command: "node", cwd: join(homedir(), "server") }),
    );
  });

  it("hashes the effective bearerTokenEnv value", () => {
    process.env.MCP_HASH_TOKEN = "token-one";
    const first = computeServerHash({ url: "https://example.test/mcp", auth: "bearer", bearerTokenEnv: "MCP_HASH_TOKEN" });

    process.env.MCP_HASH_TOKEN = "token-two";
    const second = computeServerHash({ url: "https://example.test/mcp", auth: "bearer", bearerTokenEnv: "MCP_HASH_TOKEN" });

    expect(first).not.toBe(second);
    expect(computeServerHash({ url: "https://example.test/mcp", auth: "bearer", bearerTokenEnv: "MCP_HASH_TOKEN" })).toBe(
      computeServerHash({ url: "https://example.test/mcp", auth: "bearer", bearerToken: "token-two", bearerTokenEnv: "MCP_HASH_TOKEN" }),
    );
  });
});

describe("excludeTools filtering", () => {
  it("uses tool description overrides for live, cached, and direct metadata", () => {
    const definition = {
      command: "auggie",
      directTools: true,
      toolOverrides: {
        "codebase-retrieval": { description: "Search the current codebase semantically" },
      },
    };
    const upstreamTool = {
      name: "codebase-retrieval",
      description: "Vendor description that must not leak",
      inputSchema: { type: "object", properties: { query: { type: "string" } } },
    };
    const cache: MetadataCache = {
      version: 1,
      servers: {
        auggie: {
          configHash: computeServerHash(definition),
          cachedAt: Date.now(),
          tools: [upstreamTool],
          resources: [],
        },
      },
    };

    const live = buildToolMetadata([upstreamTool], [], definition, "auggie", "server").metadata[0];
    const cached = reconstructToolMetadata("auggie", cache.servers.auggie, "server", definition)[0];
    const direct = resolveDirectTools({ mcpServers: { auggie: definition } }, cache, "server")[0];

    expect(live.description).toBe("Search the current codebase semantically");
    expect(cached.description).toBe("Search the current codebase semantically");
    expect(direct.description).toBe("Search the current codebase semantically");
    expect(live.inputSchema).toEqual(upstreamTool.inputSchema);
    expect(cached.inputSchema).toEqual(upstreamTool.inputSchema);
    expect(direct.inputSchema).toEqual(upstreamTool.inputSchema);
  });

  it("filters excluded tools from live and cached metadata", () => {
    const definition = {
      command: "npx",
      args: ["-y", "figma"],
      excludeTools: ["figma_get_screenshot", "get_figjam"],
    };

    const { metadata } = buildToolMetadata(
      [
        { name: "get_screenshot", description: "Screenshot" },
        { name: "get_nodes", description: "Nodes" },
      ] as any,
      [
        { name: "figjam", uri: "ui://figjam", description: "FigJam" },
      ] as any,
      definition,
      "figma",
      "server",
    );

    expect(metadata.map((tool) => tool.name)).toEqual(["figma_get_nodes"]);

    const reconstructed = reconstructToolMetadata(
      "figma",
      {
        configHash: computeServerHash(definition),
        cachedAt: Date.now(),
        tools: [
          { name: "get_screenshot", description: "Screenshot" },
          { name: "get_nodes", description: "Nodes" },
        ],
        resources: [{ name: "figjam", uri: "ui://figjam", description: "FigJam" }],
      },
      "server",
      definition,
    );

    expect(reconstructed.map((tool) => tool.name)).toEqual(["figma_get_nodes"]);
  });

  it("filters excluded tools during direct tool registration from cache", () => {
    const config: McpConfig = {
      settings: { toolPrefix: "server" },
      mcpServers: {
        figma: {
          command: "npx",
          args: ["-y", "figma"],
          directTools: true,
          excludeTools: ["figma_get_screenshot", "get_figjam"],
        },
      },
    };

    const cache: MetadataCache = {
      version: 1,
      servers: {
        figma: {
          configHash: computeServerHash(config.mcpServers.figma),
          cachedAt: Date.now(),
          tools: [
            { name: "get_screenshot", description: "Screenshot" },
            { name: "get_nodes", description: "Nodes" },
          ],
          resources: [
            { name: "figjam", uri: "ui://figjam", description: "FigJam" },
          ],
        },
      },
    };

    const specs = resolveDirectTools(config, cache, "server");

    expect(specs.map((spec) => spec.prefixedName)).toEqual(["figma_get_nodes"]);
  });

  it("matches prefixed exclusions even when toolPrefix is none", () => {
    const config: McpConfig = {
      settings: { toolPrefix: "none" },
      mcpServers: {
        figma: {
          command: "npx",
          args: ["-y", "figma"],
          directTools: true,
          excludeTools: ["figma_get_screenshot"],
        },
      },
    };

    const cache: MetadataCache = {
      version: 1,
      servers: {
        figma: {
          configHash: computeServerHash(config.mcpServers.figma),
          cachedAt: Date.now(),
          tools: [
            { name: "get_screenshot", description: "Screenshot" },
            { name: "get_nodes", description: "Nodes" },
          ],
          resources: [],
        },
      },
    };

    const specs = resolveDirectTools(config, cache, "none");

    expect(specs.map((spec) => spec.prefixedName)).toEqual(["get_nodes"]);
  });
});
