import { beforeEach, describe, expect, it, vi } from "vitest";
import { createDirectToolExecutor } from "../direct-tools.ts";
import { executeCall, executeReadResource } from "../proxy-modes.ts";
import type { McpExtensionState } from "../state.ts";
import type { DirectToolSpec } from "../types.ts";

const mocks = vi.hoisted(() => ({
  lazyConnect: vi.fn(),
  maybeStartUiSession: vi.fn(),
}));
vi.mock("../init.ts", () => ({
  lazyConnect: mocks.lazyConnect,
  getFailureAgeSeconds: () => null,
}));
vi.mock("../ui-session.ts", () => ({ maybeStartUiSession: mocks.maybeStartUiSession }));

function fixture(ui: boolean) {
  const callTool = vi.fn();
  const readResource = vi.fn();
  const spec: DirectToolSpec = {
    serverName: "demo", originalName: "search", prefixedName: "demo_search",
    description: "Search", inputSchema: { type: "object", properties: { query: { type: "string" } } },
    ...(ui ? { uiResourceUri: "ui://search" } : {}),
  };
  const state = {
    config: { mcpServers: { demo: { command: "demo" } } },
    sessionId: "test-session",
    toolMetadata: new Map([["demo", [{ ...spec, name: spec.prefixedName }]]]),
    manager: {
      getConnection: () => ({ status: "connected", client: { callTool, readResource } }),
      readResource, touch: vi.fn(), incrementInFlight: vi.fn(), decrementInFlight: vi.fn(),
    },
    failureTracker: new Map(),
  } as unknown as McpExtensionState;
  const direct = createDirectToolExecutor(() => state, () => null, spec);
  return {
    callTool, state,
    call: (mode: "direct" | "gateway") => mode === "direct"
      ? direct("call", {}, undefined, undefined, {} as never)
      : executeCall(state, "demo_search", {}, "demo"),
  };
}

beforeEach(() => {
  mocks.lazyConnect.mockReset().mockResolvedValue(true);
  mocks.maybeStartUiSession.mockReset().mockResolvedValue({
    sendToolResult: vi.fn(), sendToolCancelled: vi.fn(), reused: false,
  });
});

for (const mode of ["direct", "gateway"] as const) {
  describe(`${mode} tool failure contract`, () => {
    it.each([false, true])("marks MCP errors as failures (UI: %s)", async (ui) => {
      const { callTool, call, state } = fixture(ui);
      callTool.mockResolvedValue({ isError: true, content: [{ type: "text", text: "bad query" }] });
      const result = await call(mode);
      expect(result.isError).toBe(true);
      expect(result.details).toMatchObject({ error: "tool_error" });
      expect(result.content[0]).toMatchObject({ text: expect.stringContaining("bad query") });
      expect(result.content[0]).toMatchObject({ text: expect.stringContaining("Expected parameters:") });
      expect(state.manager.decrementInFlight).toHaveBeenCalledOnce();
    });

    it("marks transport exceptions as failures", async () => {
      const { callTool, call } = fixture(false);
      callTool.mockRejectedValue(new Error("connection lost"));
      const result = await call(mode);
      expect(result.isError).toBe(true);
      expect(result.details).toMatchObject({ error: "call_failed" });
      expect(result.content[0]).toMatchObject({ text: expect.stringContaining("connection lost") });
    });

    it("leaves successful results successful", async () => {
      const { callTool, call } = fixture(false);
      callTool.mockResolvedValue({ content: [{ type: "text", text: "ok" }] });
      const result = await call(mode);
      expect(result.isError).not.toBe(true);
      expect(result.content[0]).toMatchObject({ text: "ok" });
    });
  });
}

it("marks direct initialization failures as errors", async () => {
  const execute = createDirectToolExecutor(() => null, () => null, {
    serverName: "demo", originalName: "search", prefixedName: "demo_search", description: "Search",
  });
  expect((await execute("call", {}, undefined, undefined, {} as never)).isError).toBe(true);
});

it("marks gateway resource failures as errors", async () => {
  const { state } = fixture(false);
  expect((await executeReadResource(state, "missing", "file://guide")).isError).toBe(true);
});

it("marks gateway tool lookup failures as errors", async () => {
  const { state } = fixture(false);
  expect((await executeCall(state, "search", {}, "missing")).isError).toBe(true);
});
