import { describe, expect, it } from "vitest";
import { createMcpPanel } from "../mcp-panel.js";
import { computeServerHash, type MetadataCache } from "../metadata-cache.js";
import type { McpConfig } from "../types.js";

function stripAnsi(input: string): string {
  return input.replace(/\x1b\[[0-9;]*m/g, "");
}

describe("mcp-panel excludeTools", () => {
  it("hides excluded tools from the panel view", () => {
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

    const panel = createMcpPanel(
      config,
      cache,
      new Map(),
      {
        reconnect: async () => true,
        getConnectionStatus: () => "idle",
        refreshCacheAfterReconnect: () => null,
      },
      { requestRender: () => {} },
      () => {},
    );

    panel.handleInput("g");
    panel.handleInput("e");
    panel.handleInput("t");
    panel.handleInput("_");

    const output = stripAnsi(panel.render(120).join("\n"));

    expect(output).toContain("get_nodes");
    expect(output).not.toContain("get_screenshot");
    expect(output).not.toContain("get_figjam");

    panel.dispose();
  });

  it("uses promotedTools for panel selection and save results", () => {
    const config: McpConfig = {
      settings: { toolPrefix: "server" },
      mcpServers: {
        demo: {
          command: "npx",
          args: ["-y", "demo"],
          directTools: true,
          promotedTools: ["search"],
        },
      },
    };

    const cache: MetadataCache = {
      version: 1,
      servers: {
        demo: {
          configHash: computeServerHash(config.mcpServers.demo),
          cachedAt: Date.now(),
          tools: [
            { name: "search", description: "Search things" },
            { name: "fetch", description: "Fetch thing" },
          ],
          resources: [],
        },
      },
    };

    let saved: Map<string, string[]> | null = null;
    const panel = createMcpPanel(
      config,
      cache,
      new Map(),
      {
        reconnect: async () => true,
        getConnectionStatus: () => "idle",
        refreshCacheAfterReconnect: () => null,
      },
      { requestRender: () => {} },
      (result) => { saved = result.changes; },
    );

    let output = stripAnsi(panel.render(120).join("\n"));
    expect(output).toContain("1/2");
    expect(output).toContain("schemas");
    expect(output).not.toContain("direct");

    panel.handleInput(" "); // toggle all tools on the server row
    panel.handleInput("\x13"); // ctrl+s

    expect(saved?.get("demo")).toEqual(["search", "fetch"]);
    panel.dispose();
  });
});
