// resource-tools.ts
import { createHash, randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
function resourceNameToToolName(name) {
  let result = name.replace(/[^a-zA-Z0-9]/g, "_").replace(/_+/g, "_").replace(/^_+/, "").replace(/_+$/, "").toLowerCase();
  if (!result || /^\d/.test(result)) {
    result = "resource" + (result ? "_" + result : "");
  }
  return result;
}
function resourceToolBaseNames(resources, reservedNames = []) {
  const sanitized = resources.map((resource) => resourceNameToToolName(resource.name));
  const counts = /* @__PURE__ */ new Map();
  for (const name of sanitized) counts.set(name, (counts.get(name) ?? 0) + 1);
  const used = new Set(reservedNames);
  return resources.map((resource, index) => {
    const plain = `get_${sanitized[index]}`;
    if (counts.get(sanitized[index]) === 1 && !used.has(plain)) {
      used.add(plain);
      return plain;
    }
    const digest = createHash("sha256").update(resource.uri).digest("hex").slice(0, 8);
    let candidate = `${plain}_${digest}`;
    let suffix = 2;
    while (used.has(candidate)) candidate = `${plain}_${digest}_${suffix++}`;
    used.add(candidate);
    return candidate;
  });
}
function resourceContentsToBlocks(contents, label = "resource") {
  const files = [];
  const content = contents.map((item) => {
    if (typeof item.text === "string") {
      return { type: "text", text: item.text };
    }
    if (typeof item.blob === "string") {
      const safeLabel = label.replace(/[^a-zA-Z0-9_-]+/g, "-").slice(0, 40) || "resource";
      const path = join(tmpdir(), `pi-mcp-${safeLabel}-${randomUUID()}.bin`);
      writeFileSync(path, Buffer.from(item.blob, "base64"), { mode: 384, flag: "wx" });
      files.push(path);
      return {
        type: "text",
        text: `Binary resource (${item.mimeType ?? "application/octet-stream"}) saved to ${path}`
      };
    }
    return { type: "text", text: JSON.stringify(item) };
  });
  return { content, files };
}

export {
  resourceToolBaseNames,
  resourceContentsToBlocks
};
