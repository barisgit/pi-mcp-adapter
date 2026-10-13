import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { preProcessFile } from "typescript";
import { expect, it, vi } from "vitest";

it("uses exact TypeScript paths in source and runtime bundle imports", () => {
  const root = resolve(import.meta.dirname, "..");
  for (const directory of [root, resolve(root, "dist")]) {
    const files = readdirSync(directory).filter(name => name.endsWith(".ts") && !name.endsWith(".test.ts"));
    for (const name of files) {
      const file = resolve(directory, name);
      const { importedFiles } = preProcessFile(readFileSync(file, "utf8"));
      for (const { fileName } of importedFiles.filter(imported => /^\.\.?\//.test(imported.fileName))) {
        expect(fileName, `${file}: ${fileName}`).toMatch(/\.ts$/);
        expect(existsSync(resolve(dirname(file), fileName)), `${file}: ${fileName}`).toBe(true);
      }
    }
  }
});

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
vi.mock("../ui-server.ts", () => {
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
