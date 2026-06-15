import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { capContentBlocks, capText } from "../response-cap.js";
import type { ContentBlock } from "../types.js";

describe("capText", () => {
  it("passes through text under the limit unchanged", () => {
    const result = capText("hello world", "demo");
    expect(result.truncated).toBe(false);
    expect(result.text).toBe("hello world");
    expect(result.fullOutputPath).toBeUndefined();
  });

  it("truncates text over the byte limit and writes full output to a temp file", () => {
    const big = "x".repeat(5000);
    const result = capText(big, "demo-tool", { maxResponseBytes: 1000 });
    expect(result.truncated).toBe(true);
    expect(result.text.length).toBeLessThan(big.length);
    expect(result.text).toContain("Truncated");
    expect(result.fullOutputPath).toBeDefined();
    // Full, untruncated payload is recoverable from the temp file.
    expect(readFileSync(result.fullOutputPath!, "utf-8")).toBe(big);
    expect(result.text).toContain(result.fullOutputPath!);
  });

  it("truncates by line count when lines exceed the limit", () => {
    const manyLines = Array.from({ length: 500 }, (_, i) => `line ${i}`).join("\n");
    const result = capText(manyLines, "demo", { maxResponseBytes: 1_000_000, maxResponseLines: 10 });
    expect(result.truncated).toBe(true);
    expect(result.text).toContain("Truncated");
    expect(result.fullOutputPath).toBeDefined();
  });

  it("disables capping when maxResponseBytes is 0", () => {
    const big = "y".repeat(100_000);
    const result = capText(big, "demo", { maxResponseBytes: 0 });
    expect(result.truncated).toBe(false);
    expect(result.text).toBe(big);
  });
});

describe("capContentBlocks", () => {
  it("returns the original array when nothing exceeds the limit", () => {
    const content: ContentBlock[] = [{ type: "text", text: "small" }];
    const result = capContentBlocks(content, "demo");
    expect(result.truncated).toBe(false);
    expect(result.content).toBe(content);
  });

  it("collapses multiple text blocks into one capped block when truncated", () => {
    const content: ContentBlock[] = [
      { type: "text", text: "a".repeat(2000) },
      { type: "text", text: "b".repeat(2000) },
    ];
    const result = capContentBlocks(content, "demo", { maxResponseBytes: 500 });
    expect(result.truncated).toBe(true);
    const textBlocks = result.content.filter((b) => b.type === "text");
    expect(textBlocks).toHaveLength(1);
    expect((textBlocks[0] as { text: string }).text).toContain("Truncated");
    expect(result.fullOutputPath).toBeDefined();
  });

  it("preserves image blocks in order and only caps text", () => {
    const content: ContentBlock[] = [
      { type: "text", text: "c".repeat(3000) },
      { type: "image", data: "BASE64", mimeType: "image/png" } as ContentBlock,
    ];
    const result = capContentBlocks(content, "demo", { maxResponseBytes: 500 });
    expect(result.truncated).toBe(true);
    expect(result.content.some((b) => b.type === "image")).toBe(true);
    const image = result.content.find((b) => b.type === "image") as { data: string };
    expect(image.data).toBe("BASE64");
  });

  it("does nothing for content with no text blocks", () => {
    const content: ContentBlock[] = [
      { type: "image", data: "BASE64", mimeType: "image/png" } as ContentBlock,
    ];
    const result = capContentBlocks(content, "demo", { maxResponseBytes: 1 });
    expect(result.truncated).toBe(false);
    expect(result.content).toBe(content);
  });
});
