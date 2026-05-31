import { describe, expect, it, vi } from "vitest";

function createOptions(overrides: Record<string, unknown> = {}) {
  return {
    serverName: "computer-use",
    autoApprove: false,
    ui: undefined,
    ...overrides,
  } as any;
}

describe("elicitation handler", () => {
  it("declines form requests with no UI and no autoApprove", async () => {
    const { handleElicitationRequest } = await import("../elicitation-handler.ts");
    const result = await handleElicitationRequest(createOptions(), {
      method: "elicitation/create",
      params: {
        message: "Need a value",
        requestedSchema: { type: "object", properties: { name: { type: "string" } } },
      },
    } as any);
    expect(result).toEqual({ action: "decline" });
  });

  it("auto-approves form requests with default-filled content when autoApprove is set", async () => {
    const { handleElicitationRequest } = await import("../elicitation-handler.ts");
    const result = await handleElicitationRequest(createOptions({ autoApprove: true }), {
      method: "elicitation/create",
      params: {
        message: "Need values",
        requestedSchema: {
          type: "object",
          properties: {
            name: { type: "string" },
            ok: { type: "boolean" },
            count: { type: "number", default: 3 },
            color: { type: "string", enum: ["red", "blue"] },
          },
        },
      },
    } as any);
    expect(result.action).toBe("accept");
    expect(result.content).toEqual({ name: "", ok: true, count: 3, color: "red" });
  });

  it("collects form values from UI prompts and returns accept", async () => {
    const { handleElicitationRequest } = await import("../elicitation-handler.ts");
    const ui = {
      confirm: vi.fn(async () => true),
      input: vi.fn(async () => "Alice"),
      select: vi.fn(async () => "red"),
    };
    const result = await handleElicitationRequest(createOptions({ ui }), {
      method: "elicitation/create",
      params: {
        message: "Need a few things",
        requestedSchema: {
          type: "object",
          required: ["name"],
          properties: {
            name: { type: "string", description: "Your name" },
            ok: { type: "boolean", description: "Proceed?" },
            color: { type: "string", enum: ["red", "blue"] },
            age: { type: "number" },
          },
        },
      },
    } as any);

    // Intro confirm + boolean confirm = 2 calls
    expect(ui.confirm).toHaveBeenCalledTimes(2);
    expect(ui.input).toHaveBeenCalled();
    expect(ui.select).toHaveBeenCalledWith(expect.stringContaining("color"), ["red", "blue"]);
    expect(result.action).toBe("accept");
    // age field is skipped because Number("Alice") is NaN and field is optional
    expect(result.content).toEqual({ name: "Alice", ok: true, color: "red" });
  });

  it("cancels when a required input is dismissed", async () => {
    const { handleElicitationRequest } = await import("../elicitation-handler.ts");
    const ui = {
      confirm: vi.fn(async () => true),
      input: vi.fn(async () => undefined),
      select: vi.fn(),
    };
    const result = await handleElicitationRequest(createOptions({ ui }), {
      method: "elicitation/create",
      params: {
        message: "Need name",
        requestedSchema: {
          type: "object",
          required: ["name"],
          properties: { name: { type: "string" } },
        },
      },
    } as any);
    expect(result).toEqual({ action: "cancel" });
  });

  it("handles URL elicitation with a single confirm", async () => {
    const { handleElicitationRequest } = await import("../elicitation-handler.ts");
    const ui = { confirm: vi.fn(async () => true), input: vi.fn(), select: vi.fn() };
    const result = await handleElicitationRequest(createOptions({ ui }), {
      method: "elicitation/create",
      params: {
        mode: "url",
        message: "Please authorize",
        elicitationId: "abc",
        url: "https://example.com/auth",
      },
    } as any);
    expect(ui.confirm).toHaveBeenCalledTimes(1);
    expect(ui.confirm.mock.calls[0][1]).toContain("https://example.com/auth");
    expect(result).toEqual({ action: "accept" });
  });

  it("declines URL elicitation without UI", async () => {
    const { handleElicitationRequest } = await import("../elicitation-handler.ts");
    const result = await handleElicitationRequest(createOptions(), {
      method: "elicitation/create",
      params: { mode: "url", message: "auth", elicitationId: "abc", url: "https://example.com" },
    } as any);
    expect(result).toEqual({ action: "decline" });
  });
});
