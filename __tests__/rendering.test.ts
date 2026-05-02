import { describe, expect, it } from "vitest";
import { renderDirectMcpToolCall, renderMcpProxyCall, renderMcpToolResult } from "../rendering.ts";

const theme = {
  bold: (text: string) => `<b>${text}</b>`,
  fg: (_color: string, text: string) => text,
};

function lines(component: { render: () => string[] }): string[] {
  return component.render();
}

describe("MCP tool rendering", () => {
  it("renders direct MCP tool calls with server and original tool name", () => {
    const rendered = renderDirectMcpToolCall("sessionloom", "working_memory", { action: "get" }, theme);

    expect(lines(rendered)).toEqual([
      "<b>mcp</b> → sessionloom/working_memory",
      'action: "get"',
    ]);
  });

  it("renders proxy tool calls with downstream target and parsed args", () => {
    const rendered = renderMcpProxyCall({
      tool: "working_memory",
      server: "sessionloom",
      args: JSON.stringify({ action: "update", body: "from-pi" }),
    }, theme);

    expect(lines(rendered)).toEqual([
      "<b>mcp call</b> → sessionloom/working_memory",
      'action: "update", body: "from-pi"',
    ]);
  });

  it("renders proxy non-call modes distinctly", () => {
    expect(lines(renderMcpProxyCall({ search: "memory" }, theme))).toEqual(["<b>mcp search</b> → memory"]);
    expect(lines(renderMcpProxyCall({}, theme))).toEqual(["<b>mcp status</b>"]);
  });

  it("renders results with resolved downstream target before content", () => {
    const rendered = renderMcpToolResult({
      content: [{ type: "text", text: "ok" }],
      details: { server: "sessionloom", tool: "working_memory" },
    }, {}, theme);

    expect(lines(rendered)).toEqual([
      "<b>mcp → sessionloom/working_memory</b>",
      "ok",
    ]);
  });

  it("falls back to call args when result details do not include target", () => {
    const rendered = renderMcpToolResult({
      content: [{ type: "text", text: "ok" }],
      details: {},
    }, {}, theme, { args: { server: "sessionloom", tool: "working_memory" } });

    expect(lines(rendered)).toEqual([
      "<b>mcp → sessionloom/working_memory</b>",
      "ok",
    ]);
  });
});
