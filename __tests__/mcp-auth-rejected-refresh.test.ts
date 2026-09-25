import { createServer, type Server } from "node:http";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Real SDK auth against a local authorization server; only the callback server
// and browser are stubbed.
vi.mock("../mcp-callback-server.js", () => ({
  ensureCallbackServer: vi.fn(async () => {}),
  waitForCallback: vi.fn(),
  cancelPendingCallback: vi.fn(),
  stopCallbackServer: vi.fn(async () => {}),
}));
vi.mock("open", () => ({ default: vi.fn() }));

describe("login with a refresh token the server rejects", () => {
  let server: Server;
  let serverUrl: string;
  let tokenErrorCode: string;
  let tokenStatus: number;

  beforeEach(async () => {
    process.env.MCP_OAUTH_DIR = mkdtempSync(join(tmpdir(), "pi-mcp-rejected-refresh-"));
    vi.resetModules();
    tokenErrorCode = "invalid_request";
    tokenStatus = 400;

    server = createServer((req, res) => {
      const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
      const json = (status: number, body: unknown) => {
        res.writeHead(status, { "content-type": "application/json" });
        res.end(JSON.stringify(body));
      };
      if (req.url?.startsWith("/.well-known/oauth-protected-resource")) {
        return json(200, { resource: `${base}/mcp`, authorization_servers: [base] });
      }
      if (req.url?.startsWith("/.well-known/oauth-authorization-server")) {
        return json(200, {
          issuer: base,
          authorization_endpoint: `${base}/authorize`,
          token_endpoint: `${base}/token`,
          response_types_supported: ["code"],
          code_challenge_methods_supported: ["S256"],
        });
      }
      if (req.url === "/token") {
        // Outline answers a dead refresh token with invalid_request, not invalid_grant.
        return json(tokenStatus, { error: tokenErrorCode, error_description: "Invalid grant: refresh token is invalid" });
      }
      json(404, {});
    });
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    serverUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}/mcp`;
  });

  afterEach(async () => {
    delete process.env.MCP_OAUTH_DIR;
    await new Promise<void>(resolve => server.close(() => resolve()));
  });

  async function storeDeadTokens() {
    const { updateClientInfo, updateTokens } = await import("../mcp-auth.ts");
    updateClientInfo("wiki", { clientId: "client" }, serverUrl);
    updateTokens("wiki", { accessToken: "old", refreshToken: "dead", expiresAt: 1 }, serverUrl);
  }

  it("drops the rejected tokens and starts a fresh browser login", async () => {
    await storeDeadTokens();
    const { startAuth } = await import("../mcp-auth-flow.ts");
    const { getAuthEntry } = await import("../mcp-auth.ts");

    const { authorizationUrl } = await startAuth("wiki", serverUrl, { url: serverUrl });

    expect(authorizationUrl).toContain("/authorize");
    expect(getAuthEntry("wiki")?.tokens).toBeUndefined();
  });

  it("keeps tokens when the authorization server fails with a server error", async () => {
    tokenErrorCode = "server_error";
    tokenStatus = 500;
    await storeDeadTokens();
    const { startAuth } = await import("../mcp-auth-flow.ts");
    const { getAuthEntry } = await import("../mcp-auth.ts");

    // The SDK treats a failed refresh caused by a server error as non-fatal and
    // proceeds to a browser login without touching the stored tokens.
    await startAuth("wiki", serverUrl, { url: serverUrl });

    expect(getAuthEntry("wiki")?.tokens?.refreshToken).toBe("dead");
  });

  it("classifies credential rejections separately from server errors", async () => {
    const { isOAuthRejection } = await import("../mcp-auth-flow.ts");
    const { UnauthorizedError } = await import("@modelcontextprotocol/sdk/client/auth.js");
    const { InvalidRequestError, ServerError } = await import("@modelcontextprotocol/sdk/server/auth/errors.js");

    expect(isOAuthRejection(new UnauthorizedError("login"))).toBe(true);
    expect(isOAuthRejection(new InvalidRequestError("dead token"))).toBe(true);
    expect(isOAuthRejection(new ServerError("down"))).toBe(false);
    expect(isOAuthRejection(new Error("ECONNREFUSED"))).toBe(false);
  });

  it("cancelling a pending browser login rejects it and clears the login state", async () => {
    await storeDeadTokens();
    const callbacks = await import("../mcp-callback-server.js");
    let rejectCallback!: (error: Error) => void;
    vi.mocked(callbacks.waitForCallback).mockReturnValue(new Promise((_resolve, reject) => { rejectCallback = reject; }));
    vi.mocked(callbacks.cancelPendingCallback).mockImplementation(() => rejectCallback(new Error("Authorization cancelled")));
    const { authenticate } = await import("../mcp-auth-flow.ts");
    const { getOAuthState } = await import("../mcp-auth.ts");

    const controller = new AbortController();
    const login = authenticate("wiki", serverUrl, { url: serverUrl }, controller.signal);
    await vi.waitFor(() => expect(callbacks.waitForCallback).toHaveBeenCalled());
    controller.abort();

    await expect(login).rejects.toThrow("Authorization cancelled");
    expect(getOAuthState("wiki")).toBeUndefined();
  });
});
