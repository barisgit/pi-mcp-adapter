import { build } from "esbuild";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

// Keep .ts entry/chunks in jiti's source graph: native JS imports can bypass
// host aliases and load a second copy of Pi. Only local modules are bundled.
const root = resolve(import.meta.dirname, "..");
const outdir = resolve(root, "dist");
const result = await build({
  absWorkingDir: root,
  entryPoints: ["index.ts"],
  bundle: true,
  splitting: true,
  platform: "node",
  format: "esm",
  target: "node20",
  packages: "external",
  outdir,
  outExtension: { ".js": ".ts" },
  write: false,
});
const files = new Map(result.outputFiles.map(file => [file.path, file.contents]));
// ui-server's import.meta.dirname must still locate the browser-side bridge.
files.set(resolve(outdir, "app-bridge.bundle.js"), await readFile(resolve(root, "app-bridge.bundle.js")));

if (process.argv.includes("--check")) {
  const actual = (await readdir(outdir)).map(name => resolve(outdir, name));
  if (actual.length !== files.size || actual.some(path => !files.has(path))) {
    throw new Error("Stale runtime bundle; run npm run build and commit dist.");
  }
  for (const [path, contents] of files) {
    if (!Buffer.from(contents).equals(await readFile(path))) {
      throw new Error(`Stale ${path}; run npm run build and commit dist.`);
    }
  }
} else {
  await rm(outdir, { recursive: true, force: true });
  await mkdir(outdir, { recursive: true });
  await Promise.all([...files].map(([path, contents]) => writeFile(path, contents)));
}
