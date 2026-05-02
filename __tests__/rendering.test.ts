import { visibleWidth } from "@mariozechner/pi-tui";
import { describe, expect, it } from "vitest";
import { renderDirectMcpToolCall, renderMcpProxyCall, renderMcpToolResult } from "../rendering.ts";

const theme = {
  bold: (text: string) => `<b>${text}</b>`,
  fg: (_color: string, text: string) => text,
};

function lines(component: { render: (width?: number) => string[] }): string[] {
  return component.render();
}

function expectFitsWidth(component: { render: (width: number) => string[] }, width: number): void {
  for (const line of component.render(width)) {
    expect(visibleWidth(line)).toBeLessThanOrEqual(width);
  }
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

  it("renders result content without repeating the call header", () => {
    const rendered = renderMcpToolResult({
      content: [{ type: "text", text: "ok" }],
      details: { server: "sessionloom", tool: "working_memory" },
    }, {}, theme);

    expect(lines(rendered)).toEqual(["ok"]);
  });

  it("falls back to a result label when there is no content", () => {
    const rendered = renderMcpToolResult({
      content: [],
      details: {},
    }, {}, theme, { args: { server: "sessionloom", tool: "working_memory" } });

    expect(lines(rendered)).toEqual(["<b>mcp → sessionloom/working_memory</b>"]);
  });

  it("truncates long MCP call summaries to the render width", () => {
    const rendered = renderDirectMcpToolCall("auggie", "codebase-retrieval", {
      directory_path: "/Users/blaz/Programming_local/Projects/pi-extensions/pi-mcp-adapter",
      information_request: "Find custom TUI components or render functions in this extension that return string lines, especially recent MCP adapter UI rendering/status/footer/widgets",
    }, theme);

    expect(visibleWidth(rendered.render()[1])).toBeGreaterThan(138);
    expectFitsWidth(rendered, 138);
  });

  it("counts tabs like the TUI when truncating MCP results", () => {
    const rendered = renderMcpToolResult({
      content: [{
        type: "text",
        text: '   114\tArchived tasks are appended to `.pi/dag-tasks/archive.jsonl` and are available through `task_manage` with `action: "history"`. History is shown newest-first with archive time and reason (`manual archive` or `completed sweep`). Archived context is hidden by default; pass includeContext to show it.',
      }],
      details: { server: "grep", tool: "search" },
    }, {}, theme);

    expect(visibleWidth(rendered.render()[0])).toBeGreaterThan(278);
    expectFitsWidth(rendered, 278);
  });
});
