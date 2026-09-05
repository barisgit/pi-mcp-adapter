import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ clients: [] as any[], transports: [] as any[] }));

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

vi.mock("@modelcontextprotocol/sdk/client/index.js", () => ({
  Client: vi.fn().mockImplementation(function (this: any) {
    this.ready = deferred();
    this.connect = vi.fn(() => this.ready.promise);
    this.setNotificationHandler = vi.fn();
    this.listTools = vi.fn(async () => ({ tools: [] }));
    this.listResources = vi.fn(async () => ({ resources: [] }));
    this.listResourceTemplates = vi.fn(async () => ({ resourceTemplates: [] }));
    this.close = vi.fn(async () => undefined);
    mocks.clients.push(this);
  }),
}));
vi.mock("@modelcontextprotocol/sdk/client/stdio.js", () => ({
  StdioClientTransport: vi.fn().mockImplementation(function (this: any) {
    this.close = vi.fn(async () => undefined);
    mocks.transports.push(this);
  }),
}));
vi.mock("@modelcontextprotocol/sdk/client/streamableHttp.js", () => ({
  StreamableHTTPClientTransport: vi.fn().mockImplementation(function (this: any) {
    this.close = vi.fn(async () => undefined);
    mocks.transports.push(this);
  }),
}));
vi.mock("@modelcontextprotocol/sdk/client/sse.js", () => ({ SSEClientTransport: vi.fn() }));
vi.mock("../npx-resolver.js", () => ({ resolveNpxBinary: vi.fn(async () => null) }));

import { McpServerManager } from "../server-manager.js";
import { resolveNpxBinary } from "../npx-resolver.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";

beforeEach(() => {
  mocks.clients.length = 0;
  mocks.transports.length = 0;
  vi.mocked(resolveNpxBinary).mockReset().mockResolvedValue(null);
  vi.mocked(SSEClientTransport).mockClear();
});

describe("McpServerManager teardown", () => {
  it("does not start a transport when command resolution finishes after teardown", async () => {
    const resolved = deferred();
    vi.mocked(resolveNpxBinary).mockImplementation(async () => { await resolved.promise; return null; });
    const manager = new McpServerManager();
    const result = manager.connect("demo", { command: "npx", args: ["fake"] }).catch(error => error);
    await manager.closeAll();
    expect(await result).toBeInstanceOf(Error);
    resolved.resolve();
    await vi.waitFor(() => expect(mocks.transports[0]?.close).toHaveBeenCalled());
    expect(mocks.clients[0].connect).not.toHaveBeenCalled();
    expect(manager.getAllConnections().size).toBe(0);
  });

  it("cleans up failed attempts for all callers and permits retry", async () => {
    const manager = new McpServerManager();
    const first = manager.connect("demo", { command: "fake" }).catch(error => error);
    const second = manager.connect("demo", { command: "fake" }).catch(error => error);
    const failure = new Error("discovery failed");
    mocks.clients[0].listTools.mockRejectedValue(failure);
    mocks.clients[0].ready.resolve();
    expect(await first).toBe(failure);
    expect(await second).toBe(failure);
    expect(mocks.transports[0].close).toHaveBeenCalled();
    const next = manager.connect("demo", { command: "fake" });
    mocks.clients[1].ready.resolve();
    expect(manager.getConnection("demo")).toBeUndefined();
    const connection = await next;
    expect(await manager.connect("demo", { command: "fake" })).toBe(connection);
    await manager.closeAll();
  });

  it("keeps normal HTTP probing and connection reuse working", async () => {
    const manager = new McpServerManager();
    const result = manager.connect("demo", { url: "https://example.invalid/mcp", oauth: false });
    mocks.clients[1].ready.resolve();
    await vi.waitFor(() => expect(mocks.clients[0].connect).toHaveBeenCalled());
    mocks.clients[0].ready.resolve();
    const connection = await result;
    expect(mocks.transports).toHaveLength(2);
    expect(mocks.transports[0].close).toHaveBeenCalled();
    expect(mocks.transports[1].close).not.toHaveBeenCalled();
    expect(manager.getConnection("demo")).toBe(connection);
    await manager.closeAll();
    expect(mocks.transports[1].close).toHaveBeenCalled();
  });
  it("cancels discovery requests and keeps a newer pending generation deduplicated", async () => {
    const manager = new McpServerManager();
    const old = manager.connect("demo", { command: "fake" }).catch(error => error);
    const discovery = deferred();
    const client = mocks.clients[0];
    client.listTools.mockImplementation(async () => { await discovery.promise; return { tools: [] }; });
    client.ready.resolve();
    await vi.waitFor(() => expect(client.listTools).toHaveBeenCalled());
    await manager.close("demo");
    expect(await old).toBeInstanceOf(Error);
    for (const list of [client.listTools, client.listResources, client.listResourceTemplates]) {
      expect(list.mock.calls[0][1]?.signal.aborted).toBe(true);
    }
    const next = manager.connect("demo", { command: "fake" });
    discovery.resolve();
    await new Promise(resolve => setImmediate(resolve));
    const duplicate = manager.connect("demo", { command: "fake" });
    expect(mocks.clients).toHaveLength(2);
    mocks.clients[1].ready.resolve();
    expect(await duplicate).toBe(await next);
    expect(manager.getConnection("demo")).toBe(await next);
    await manager.closeAll();
  });
  it("repeated shutdown waits for established cleanup and does not delete a later reconnect", async () => {
    const manager = new McpServerManager();
    const initial = manager.connect("demo", { command: "fake" });
    mocks.clients[0].ready.resolve();
    await initial;
    const closing = deferred();
    mocks.clients[0].close.mockImplementation(() => closing.promise);
    const first = manager.closeAll();
    const repeated = vi.fn();
    const second = manager.closeAll().then(repeated);
    const third = manager.close("demo").then(repeated);
    await new Promise(resolve => setImmediate(resolve));
    expect(repeated).not.toHaveBeenCalled();
    expect(mocks.clients[0].close).toHaveBeenCalledTimes(1);
    const next = manager.connect("demo", { command: "fake" });
    mocks.clients[1].ready.resolve();
    const connection = await next;
    closing.resolve();
    await Promise.all([first, second, third]);
    expect(manager.getConnection("demo")).toBe(connection);
    expect(mocks.transports[0].close).toHaveBeenCalledTimes(1);
    await manager.closeAll();
    await manager.closeAll();
    expect(manager.getAllConnections().size).toBe(0);
  });
  it("cancels a hung HTTP probe and closes its late success without fallback or a fresh transport", async () => {
    const manager = new McpServerManager();
    const result = manager.connect("demo", { url: "https://example.invalid/mcp", oauth: false }).catch(error => error);
    const probe = mocks.clients[1];
    await manager.closeAll();
    expect(await result).toBeInstanceOf(Error);
    expect(mocks.transports[0].close).toHaveBeenCalled();
    expect(probe.connect.mock.calls[0][1].signal.aborted).toBe(true);
    probe.ready.resolve();
    await vi.waitFor(() => expect(mocks.transports[0].close.mock.calls.length).toBeGreaterThan(1));
    expect(mocks.transports).toHaveLength(1);
    expect(SSEClientTransport).not.toHaveBeenCalled();
    expect(mocks.clients[0].connect).not.toHaveBeenCalled();
    expect(manager.getAllConnections().size).toBe(0);
  });
  it("rejects deduplicated hung connects promptly and requests SDK cancellation", async () => {
    const manager = new McpServerManager();
    const first = manager.connect("demo", { command: "fake" }).catch(error => error);
    const second = manager.connect("demo", { command: "fake" }).catch(error => error);
    const client = mocks.clients[0];
    const closing = deferred();
    client.close.mockImplementation(() => closing.promise);
    await manager.closeAll();
    await expect(first).resolves.toBeInstanceOf(Error);
    expect(await second).toBeInstanceOf(Error);
    expect(client.connect.mock.calls[0][1].signal.aborted).toBe(true);
    expect(client.close).toHaveBeenCalled();
    expect(mocks.transports[0].close).toHaveBeenCalled();
    closing.resolve();
    client.ready.resolve();
    await vi.waitFor(() => expect(mocks.transports[0].close.mock.calls.length).toBeGreaterThan(1));
    expect(manager.getAllConnections().size).toBe(0);
  }, 1000);
  it.each(["close", "closeAll"] as const)("%s rejects and closes a late connection without replacing a reconnect", async method => {
    const manager = new McpServerManager();
    const old = manager.connect("demo", { command: "fake" }).catch(error => error);
    await manager[method]("demo");
    const current = manager.connect("demo", { command: "fake" });
    mocks.clients.at(-1).ready.resolve();
    const connection = await current;
    mocks.clients[0].ready.resolve();
    expect(await old).toBeInstanceOf(Error);
    expect(manager.getConnection("demo")).toBe(connection);
    expect(mocks.transports[0].close).toHaveBeenCalled();
    await manager.closeAll();
  });
});
