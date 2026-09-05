import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("npx-resolver cache path", () => {
  let root: string;

  beforeEach(() => {
    vi.resetModules();
    root = mkdtempSync(join(tmpdir(), "pi-mcp-npx-path-"));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(root, { recursive: true, force: true });
  });

  it("writes mcp-npx-cache.json to PI_CODING_AGENT_DIR", async () => {
    const home = join(root, "home");
    const agentDir = join(root, "agent");
    const npmCache = join(root, "npm");

    vi.stubEnv("HOME", home);
    vi.stubEnv("PI_CODING_AGENT_DIR", agentDir);
    vi.stubEnv("NPM_CONFIG_CACHE", npmCache);

    const packageDir = join(npmCache, "_npx", "fixture", "node_modules", "demo-pkg");
    mkdirSync(join(packageDir, "bin"), { recursive: true });
    writeFileSync(
      join(packageDir, "package.json"),
      JSON.stringify({ name: "demo-pkg", version: "1.0.0", bin: "bin/cli.js" }),
      "utf-8",
    );
    writeFileSync(join(packageDir, "bin", "cli.js"), "#!/usr/bin/env node\nconsole.log('ok')\n", "utf-8");

    const { resolveNpxBinary } = await import("../npx-resolver.ts");
    const result = await resolveNpxBinary("npx", ["-y", "demo-pkg"]);

    expect(result).not.toBeNull();
    expect(existsSync(join(agentDir, "mcp-npx-cache.json"))).toBe(true);
    expect(existsSync(join(home, ".pi", "agent", "mcp-npx-cache.json"))).toBe(false);
  });
});

vi.mock("node:child_process", () => ({
  spawn: vi.fn(() => { throw new Error("No subprocesses in resolver tests"); }),
  spawnSync: vi.fn(() => { throw new Error("No subprocesses in resolver tests"); }),
}));

describe("npx-resolver package matching", () => {
  let root: string;
  let npmCache: string;
  let agentDir: string;

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    root = mkdtempSync(join(tmpdir(), "pi-mcp-npx-matching-"));
    npmCache = join(root, "npm");
    agentDir = join(root, "agent");
    vi.stubEnv("HOME", root);
    vi.stubEnv("PI_CODING_AGENT_DIR", agentDir);
    vi.stubEnv("NPM_CONFIG_CACHE", npmCache);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(root, { recursive: true, force: true });
  });

  function cachedPackage(id: string, name: string, version: string, mtime: number): string {
    const directory = join(npmCache, "_npx", id);
    const packageDir = join(directory, "node_modules", name);
    mkdirSync(join(packageDir, "bin"), { recursive: true });
    writeFileSync(join(packageDir, "package.json"), JSON.stringify({ name, version, bin: "bin/cli.js" }));
    const binPath = join(packageDir, "bin", "cli.js");
    writeFileSync(binPath, "#!/usr/bin/env node\n");
    utimesSync(directory, mtime, mtime);
    return binPath;
  }

  it("validates manifests instead of trusting persisted versioned resolutions", async () => {
    const expected = cachedPackage("older", "demo-pkg", "1.0.0", 1000);
    const wrong = cachedPackage("newer", "demo-pkg", "2.0.0", 2000);
    const args = ["-y", "demo-pkg@1.0.0"];
    mkdirSync(agentDir, { recursive: true });
    writeFileSync(join(agentDir, "mcp-npx-cache.json"), JSON.stringify({
      version: 1,
      entries: { [JSON.stringify(["npx", ...args])]: {
        resolvedBin: wrong, resolvedAt: Date.now(), packageVersion: "1.0.0", isJs: true,
      } },
    }));
    const { resolveNpxBinary } = await import("../npx-resolver.ts");

    expect((await resolveNpxBinary("npx", args))?.binPath).toBe(expected);
    cachedPackage("older", "demo-pkg", "2.0.0", 1000);
    const replacement = cachedPackage("replacement", "demo-pkg", "1.0.0", 500);
    expect((await resolveNpxBinary("npx", args))?.binPath).toBe(replacement);
    expect(spawn).not.toHaveBeenCalled();
  });

  it.each(["^1.0.0", "~1.0.0", ">=1.0.0", "1", "1.0", "*", "latest", "next", ""])(
    "falls back without subprocesses for an uncertain version selector %s",
    async (selector) => {
      cachedPackage("fixture", "demo-pkg", "1.0.0", 1000);
      const { resolveNpxBinary } = await import("../npx-resolver.ts");

      expect(await resolveNpxBinary("npx", ["-y", `demo-pkg@${selector}`])).toBeNull();
      expect(spawn).not.toHaveBeenCalled();
      expect(spawnSync).not.toHaveBeenCalled();
    },
  );

  it.each(["demo-pkg", "demo-pkg@1.0.0"])("requires manifest identity for %s", async (spec) => {
    const expected = cachedPackage("older", "demo-pkg", "1.0.0", 1000);
    cachedPackage("newer", "demo-pkg", "1.0.0", 2000);
    writeFileSync(join(npmCache, "_npx", "newer", "node_modules", "demo-pkg", "package.json"),
      JSON.stringify({ name: "other-pkg", version: "1.0.0", bin: "bin/cli.js" }));
    const { resolveNpxBinary } = await import("../npx-resolver.ts");

    expect((await resolveNpxBinary("npx", ["-y", spec]))?.binPath).toBe(expected);
    expect(spawn).not.toHaveBeenCalled();
  });

  it.each([
    ["npx", ["-y", "@demo/pkg@1.0.0", "--stdio"]],
    ["npx", ["--package=@demo/pkg@1.0.0", "pkg", "--stdio"]],
    ["npm", ["exec", "--package", "@demo/pkg@1.0.0", "--", "pkg", "--stdio"]],
  ] as const)("matches scoped packages through %s %j", async (command, args) => {
    const expected = cachedPackage("older", "@demo/pkg", "1.0.0", 1000);
    cachedPackage("newer", "@demo/pkg", "2.0.0", 2000);
    const { resolveNpxBinary } = await import("../npx-resolver.ts");

    expect(await resolveNpxBinary(command, [...args])).toEqual({
      binPath: expected, extraArgs: ["--stdio"], isJs: true,
    });
    expect(spawn).not.toHaveBeenCalled();
  });

  it("matches exact prerelease and build versions", async () => {
    const expected = cachedPackage("older", "demo-pkg", "1.0.0-rc.1+build.2", 1000);
    cachedPackage("newer", "demo-pkg", "1.0.0", 2000);
    const { resolveNpxBinary } = await import("../npx-resolver.ts");

    expect((await resolveNpxBinary("npx", ["demo-pkg@1.0.0-rc.1+build.2"]))?.binPath).toBe(expected);
  });

  it("never returns a mismatching package when the exact version is absent", async () => {
    cachedPackage("fixture", "demo-pkg", "2.0.0", 1000);
    const { resolveNpxBinary } = await import("../npx-resolver.ts");

    expect(await resolveNpxBinary("npx", ["demo-pkg@1.0.0"])).toBeNull();
    // The existing exact-version population path is stubbed, never executed.
    expect(spawn).toHaveBeenCalledWith("npm",
      ["exec", "--yes", "--package", "demo-pkg@1.0.0", "--", "node", "-e", "1"],
      { stdio: "ignore" });
  });

  it.each(["demo-pkg", "@demo/pkg"])("preserves unversioned cached fast paths for %s", async (name) => {
    cachedPackage("older", name, "1.0.0", 1000);
    const expected = cachedPackage("newer", name, "2.0.0", 2000);
    const { resolveNpxBinary } = await import("../npx-resolver.ts");

    expect((await resolveNpxBinary("npx", [name]))?.binPath).toBe(expected);
    cachedPackage("newest", name, "3.0.0", 3000);
    expect((await resolveNpxBinary("npx", [name]))?.binPath).toBe(expected);
    expect(spawn).not.toHaveBeenCalled();
    expect(spawnSync).not.toHaveBeenCalled();
  });

  it("skips malformed and versionless candidate manifests", async () => {
    const expected = cachedPackage("older", "demo-pkg", "1.0.0", 1000);
    cachedPackage("versionless", "demo-pkg", "1.0.0", 2000);
    cachedPackage("malformed", "demo-pkg", "1.0.0", 3000);
    writeFileSync(join(npmCache, "_npx", "versionless", "node_modules", "demo-pkg", "package.json"),
      JSON.stringify({ name: "demo-pkg", bin: "bin/cli.js" }));
    writeFileSync(join(npmCache, "_npx", "malformed", "node_modules", "demo-pkg", "package.json"), "{");
    const { resolveNpxBinary } = await import("../npx-resolver.ts");

    expect((await resolveNpxBinary("npx", ["demo-pkg@1.0.0"]))?.binPath).toBe(expected);
    expect(spawn).not.toHaveBeenCalled();
  });

  it("selects the exact requested version instead of the newest cache directory", async () => {
    const expected = cachedPackage("older", "demo-pkg", "1.0.0", 1000);
    cachedPackage("newer", "demo-pkg", "2.0.0", 2000);
    const { resolveNpxBinary } = await import("../npx-resolver.ts");

    expect(await resolveNpxBinary("npx", ["-y", "demo-pkg@1.0.0", "--stdio"])).toEqual({
      binPath: expected, extraArgs: ["--stdio"], isJs: true,
    });
    expect(spawn).not.toHaveBeenCalled();
    expect(spawnSync).not.toHaveBeenCalled();
  });
});
