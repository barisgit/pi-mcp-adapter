import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { UnauthorizedError } from "@modelcontextprotocol/sdk/client/auth.js";
import { McpOAuthProvider, getOAuthCallbackPort, setOAuthCallbackPort } from "../mcp-oauth-provider.js";
import { getAuthEntry, saveAuthEntry, updateOAuthState } from "../mcp-auth.js";

describe("McpOAuthProvider authorization fallback", () => {
  const originalOAuthDir = process.env.MCP_OAUTH_DIR;
  const serverUrl = "https://api.example.com/mcp";
  let authDir: string;
  const originalPort = getOAuthCallbackPort();

  beforeEach(() => {
    authDir = mkdtempSync(join(tmpdir(), "pi-mcp-oauth-provider-"));
    process.env.MCP_OAUTH_DIR = authDir;
  });

  afterEach(() => {
    setOAuthCallbackPort(originalPort);
    rmSync(authDir, { recursive: true, force: true });
    if (originalOAuthDir === undefined) {
      delete process.env.MCP_OAUTH_DIR;
    } else {
      process.env.MCP_OAUTH_DIR = originalOAuthDir;
    }
  });

  it("persists the DCR redirect binding and re-registers after callback port fallback", async () => {
    setOAuthCallbackPort(19876);
    const provider = new McpOAuthProvider("dynamic", serverUrl, {}, { onRedirect: async () => {} });
    await provider.saveClientInformation({ client_id: "old-client", redirect_uris: ["http://localhost:19876/callback"] });
    expect((await provider.clientInformation())?.client_id).toBe("old-client");

    setOAuthCallbackPort(19877);
    const restarted = new McpOAuthProvider("dynamic", serverUrl, {}, { onRedirect: async () => {} });
    expect(await restarted.clientInformation()).toBeUndefined();
    expect(getAuthEntry("dynamic")?.clientInfo).toMatchObject({ redirectUris: ["http://localhost:19876/callback"] });
    await restarted.saveClientInformation({ client_id: "new-client", redirect_uris: ["http://localhost:19877/callback"] });
    expect((await restarted.clientInformation())?.client_id).toBe("new-client");
  });

  it("does not trust legacy redirect bindings for a fresh authorization", async () => {
    saveAuthEntry("legacy", { clientInfo: { clientId: "legacy-client" } }, serverUrl);
    const provider = new McpOAuthProvider("legacy", serverUrl, {}, { onRedirect: async () => {} });
    expect(await provider.clientInformation()).toBeUndefined();
  });

  it("keeps the original client and tokens for refresh even with a legacy binding", async () => {
    saveAuthEntry("refresh", {
      clientInfo: { clientId: "original-client" },
      tokens: { accessToken: "access", refreshToken: "refresh", expiresAt: 1 },
    }, serverUrl);
    const provider = new McpOAuthProvider("refresh", serverUrl, {}, { onRedirect: async () => {} });
    expect((await provider.clientInformation())?.client_id).toBe("original-client");
    expect((await provider.tokens())?.refresh_token).toBe("refresh");
  });

  it("never falls through from a failed refresh to authorization with an unverified redirect", async () => {
    saveAuthEntry("fallback", {
      clientInfo: { clientId: "original-client" },
      tokens: { accessToken: "access", refreshToken: "refresh" },
      oauthState: "state",
    }, serverUrl);
    const provider = new McpOAuthProvider("fallback", serverUrl, {}, { onRedirect: async () => {} });
    await expect(provider.state()).rejects.toBeInstanceOf(UnauthorizedError);
    expect(getAuthEntry("fallback")?.tokens?.refreshToken).toBe("refresh");
  });

  it("leaves configured clients and client_credentials independent of redirect bindings", async () => {
    saveAuthEntry("configured", { clientInfo: { clientId: "legacy-client" } }, serverUrl);
    const configured = new McpOAuthProvider("configured", serverUrl, { clientId: "configured-id" }, { onRedirect: async () => {} });
    expect((await configured.clientInformation())?.client_id).toBe("configured-id");
    const service = new McpOAuthProvider("configured", serverUrl, { grantType: "client_credentials" }, { onRedirect: async () => {} });
    expect((await service.clientInformation())?.client_id).toBe("legacy-client");
  });

  it("throws UnauthorizedError when state is requested outside a user-initiated flow", async () => {
    const provider = new McpOAuthProvider("state-missing", serverUrl, {}, { onRedirect: async () => {} });

    await expect(provider.state()).rejects.toBeInstanceOf(UnauthorizedError);
    await expect(provider.state()).rejects.toThrow(/Re-authentication required/);
  });

  it("throws UnauthorizedError before redirecting when no OAuth flow is in progress", async () => {
    let redirected = false;
    const provider = new McpOAuthProvider("redirect-missing", serverUrl, {}, {
      onRedirect: async () => {
        redirected = true;
      },
    });

    await expect(provider.redirectToAuthorization(new URL("https://auth.example.com/authorize")))
      .rejects.toBeInstanceOf(UnauthorizedError);
    expect(redirected).toBe(false);
  });

  it("still redirects when startAuth has seeded OAuth state", async () => {
    const authUrl = new URL("https://auth.example.com/authorize");
    let redirected: URL | undefined;
    updateOAuthState("redirect-active", "state-abc");
    const provider = new McpOAuthProvider("redirect-active", serverUrl, {}, {
      onRedirect: async (url) => {
        redirected = url;
      },
    });

    await provider.redirectToAuthorization(authUrl);

    expect(redirected).toBe(authUrl);
  });
});
