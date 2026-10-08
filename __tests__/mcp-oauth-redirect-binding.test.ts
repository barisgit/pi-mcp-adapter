import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { auth, UnauthorizedError } from "@modelcontextprotocol/sdk/client/auth.js";
import { McpOAuthProvider, getOAuthCallbackPort, setOAuthCallbackPort } from "../mcp-oauth-provider.js";
import { getAuthEntry, saveAuthEntry } from "../mcp-auth.js";

// Exercise real SDK discovery, registration, refresh and authorization using only
// in-memory HTTP responses. No callback listener, browser or live service is used.
describe("DCR callback binding through SDK auth", () => {
  const serverUrl = "https://example.com/mcp";
  const redirect = "http://localhost:19877/callback";
  const originalPort = getOAuthCallbackPort();
  let dir: string;
  let refreshResult: "success" | "invalid_grant" | "server_error";
  let registrations: number;
  let redirectUrl: URL | undefined;
  let provider: McpOAuthProvider;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "mcp-redirect-binding-"));
    process.env.MCP_OAUTH_DIR = dir;
    setOAuthCallbackPort(19877);
    refreshResult = "success";
    registrations = 0;
    redirectUrl = undefined;
    provider = new McpOAuthProvider("test", serverUrl, {}, { onRedirect: url => { redirectUrl = url; } });
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    delete process.env.MCP_OAUTH_DIR;
    setOAuthCallbackPort(originalPort);
  });

  const fetchFn: typeof fetch = async (input, init) => {
    const url = String(input);
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
      status, headers: { "content-type": "application/json" },
    });
    if (url.includes("oauth-protected-resource")) {
      return json({ resource: serverUrl, authorization_servers: ["https://example.com"] });
    }
    if (url.includes("oauth-authorization-server")) {
      return json({
        issuer: "https://example.com", authorization_endpoint: "https://example.com/authorize",
        token_endpoint: "https://example.com/token", registration_endpoint: "https://example.com/register",
        response_types_supported: ["code"], code_challenge_methods_supported: ["S256"],
      });
    }
    if (url === "https://example.com/register") {
      registrations++;
      const metadata = JSON.parse(String(init?.body));
      expect(metadata.redirect_uris).toEqual([redirect]);
      return json({ ...metadata, client_id: "new-client" }, 201);
    }
    if (url === "https://example.com/token") {
      const body = new URLSearchParams(String(init?.body));
      expect(body.get("client_id")).toBe("old-client");
      expect(body.get("refresh_token")).toBe("refresh");
      return refreshResult === "success"
        ? json({ access_token: "new-access", refresh_token: "new-refresh", token_type: "Bearer" })
        : json({ error: refreshResult }, refreshResult === "server_error" ? 500 : 400);
    }
    throw new Error(`Unexpected request: ${url}`);
  };

  it.each([undefined, ["http://localhost:19876/callback"]])("re-registers a fresh login with legacy or changed binding %j", async redirectUris => {
    saveAuthEntry("test", { clientInfo: { clientId: "old-client", redirectUris }, oauthState: "state" }, serverUrl);
    expect(await auth(provider, { serverUrl, fetchFn })).toBe("REDIRECT");
    expect(registrations).toBe(1);
    expect(redirectUrl?.searchParams.get("client_id")).toBe("new-client");
    expect(redirectUrl?.searchParams.get("redirect_uri")).toBe(redirect);
    expect(getAuthEntry("test")?.clientInfo?.redirectUris).toEqual([redirect]);
  });

  it("reuses a matching registration", async () => {
    saveAuthEntry("test", { clientInfo: { clientId: "old-client", redirectUris: [redirect] }, oauthState: "state" }, serverUrl);
    expect(await auth(provider, { serverUrl, fetchFn })).toBe("REDIRECT");
    expect(registrations).toBe(0);
    expect(redirectUrl?.searchParams.get("client_id")).toBe("old-client");
  });

  it.each([undefined, ["http://localhost:19876/callback"]])("refreshes under the original client despite binding %j", async redirectUris => {
    saveAuthEntry("test", {
      clientInfo: { clientId: "old-client", redirectUris },
      tokens: { accessToken: "old-access", refreshToken: "refresh" },
    }, serverUrl);
    expect(await auth(provider, { serverUrl, fetchFn })).toBe("AUTHORIZED");
    expect(registrations).toBe(0);
    expect(redirectUrl).toBeUndefined();
    expect(getAuthEntry("test")?.tokens?.accessToken).toBe("new-access");
  });

  it("re-registers after a rejected refresh instead of authorizing with a stale client", async () => {
    refreshResult = "invalid_grant";
    saveAuthEntry("test", {
      clientInfo: { clientId: "old-client", redirectUris: ["http://localhost:19876/callback"] },
      tokens: { accessToken: "old-access", refreshToken: "refresh" }, oauthState: "state",
    }, serverUrl);
    expect(await auth(provider, { serverUrl, fetchFn })).toBe("REDIRECT");
    expect(registrations).toBe(1);
    expect(redirectUrl?.searchParams.get("client_id")).toBe("new-client");
    expect(getAuthEntry("test")?.tokens).toBeUndefined();
  });

  it("retains tokens and blocks an invalid redirect after a transient refresh failure", async () => {
    refreshResult = "server_error";
    saveAuthEntry("test", {
      clientInfo: { clientId: "old-client" },
      tokens: { accessToken: "old-access", refreshToken: "refresh" }, oauthState: "state",
    }, serverUrl);
    await expect(auth(provider, { serverUrl, fetchFn })).rejects.toBeInstanceOf(UnauthorizedError);
    expect(registrations).toBe(0);
    expect(redirectUrl).toBeUndefined();
    expect(getAuthEntry("test")?.tokens?.refreshToken).toBe("refresh");
  });
});
