import { expect, it, vi } from "vitest";

const loaded = vi.hoisted(() => vi.fn());

vi.mock("@earendil-works/pi-ai/compat", () => {
  loaded("completion providers");
  return { complete: vi.fn() };
});
vi.mock("@modelcontextprotocol/sdk/client/stdio.js", () => {
  loaded("stdio transport");
  return { StdioClientTransport: vi.fn() };
});
vi.mock("@modelcontextprotocol/sdk/client/streamableHttp.js", () => {
  loaded("HTTP transport");
  return { StreamableHTTPClientTransport: vi.fn() };
});
vi.mock("../ui-server.js", () => {
  loaded("HTML host");
  return { startUiServer: vi.fn() };
});
vi.mock("@modelcontextprotocol/sdk/client/sse.js", () => {
  loaded("SSE transport");
  return { SSEClientTransport: vi.fn() };
});

it.each(["../index.ts", "../dist/index.ts"])("registers %s without loading call-only dependencies", async (entry) => {
  const { default: adapter } = await import(entry);
  const registerTool = vi.fn();
  adapter({
    registerTool,
    registerCommand: vi.fn(),
    registerFlag: vi.fn(),
    on: vi.fn(),
    getAllTools: () => [],
  });

  expect(registerTool).toHaveBeenCalled();
  expect(loaded).not.toHaveBeenCalled();
});
