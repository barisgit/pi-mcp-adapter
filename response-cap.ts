import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_LINES,
  formatSize,
  truncateHead,
} from "@mariozechner/pi-coding-agent";
import type { ContentBlock, McpSettings } from "./types.js";

/**
 * Safety layer for MCP tool-call responses.
 *
 * MCP servers can return arbitrarily large text payloads. Unlike Pi's builtin
 * tools (read/bash/fetch), nothing previously capped that text before it was
 * placed in `content` and sent verbatim to the model, so a single call could
 * burn 200k+ tokens. This module truncates oversized text the same way the
 * builtin tools do: keep the head up to a byte/line limit, write the full
 * payload to a temp file, and append an actionable notice pointing at it.
 *
 * Only text is capped. Images are left untouched (their token cost is handled
 * by provider-side tiling, not raw base64 length) and preserved in order.
 */

export interface CapLimits {
  maxBytes: number;
  maxLines: number;
}

/** A maxBytes of 0 (or negative) disables capping entirely. */
function resolveLimits(settings?: McpSettings): CapLimits {
  const maxBytes = settings?.maxResponseBytes ?? DEFAULT_MAX_BYTES;
  const maxLines = settings?.maxResponseLines ?? DEFAULT_MAX_LINES;
  return { maxBytes, maxLines };
}

function cappingDisabled(limits: CapLimits): boolean {
  return limits.maxBytes <= 0;
}

function sanitizeLabel(label?: string): string {
  if (!label) return "mcp";
  const cleaned = label.replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
  return cleaned.slice(0, 40) || "mcp";
}

function writeFullOutput(label: string, fullText: string): string | undefined {
  try {
    const path = join(tmpdir(), `pi-mcp-${sanitizeLabel(label)}-${randomUUID().slice(0, 8)}.txt`);
    writeFileSync(path, fullText, "utf-8");
    return path;
  } catch {
    // If we cannot persist the full output, still return truncated text.
    return undefined;
  }
}

export interface CapTextResult {
  text: string;
  truncated: boolean;
  fullOutputPath?: string;
}

/**
 * Cap a single string. Returns the (possibly truncated) text with an appended
 * notice, plus the temp-file path holding the full output when truncated.
 */
export function capText(text: string, label?: string, settings?: McpSettings): CapTextResult {
  const limits = resolveLimits(settings);
  if (cappingDisabled(limits)) {
    return { text, truncated: false };
  }

  const truncation = truncateHead(text, { maxBytes: limits.maxBytes, maxLines: limits.maxLines });
  if (!truncation.truncated) {
    return { text, truncated: false };
  }

  const fullOutputPath = writeFullOutput(label ?? "mcp", text);
  const fullRef = fullOutputPath ? ` Full output: ${fullOutputPath}` : "";

  let notice: string;
  if (truncation.firstLineExceedsLimit) {
    notice = `[Truncated: first line exceeds ${formatSize(limits.maxBytes)} limit (line is ${formatSize(truncation.totalBytes)}).${fullRef}]`;
  } else if (truncation.truncatedBy === "lines") {
    notice = `[Truncated: showing ${truncation.outputLines} of ${truncation.totalLines} lines.${fullRef}]`;
  } else {
    notice = `[Truncated: showing ${formatSize(truncation.outputBytes)} of ${formatSize(truncation.totalBytes)} (${formatSize(limits.maxBytes)} limit).${fullRef}]`;
  }

  const body = truncation.content ? `${truncation.content}\n\n` : "";
  return { text: `${body}${notice}`, truncated: true, fullOutputPath };
}

export interface CapContentResult {
  content: ContentBlock[];
  truncated: boolean;
  fullOutputPath?: string;
}

/**
 * Cap an array of content blocks. Text blocks are joined and capped as a unit;
 * if truncation occurs they collapse into a single text block placed where the
 * first text block was. Image (and other non-text) blocks pass through in
 * order. When nothing exceeds the limit the original array is returned as-is.
 */
export function capContentBlocks(
  content: ContentBlock[],
  label?: string,
  settings?: McpSettings,
): CapContentResult {
  const limits = resolveLimits(settings);
  if (cappingDisabled(limits) || content.length === 0) {
    return { content, truncated: false };
  }

  const textBlocks = content.filter((b): b is Extract<ContentBlock, { type: "text" }> => b.type === "text");
  if (textBlocks.length === 0) {
    return { content, truncated: false };
  }

  const joined = textBlocks.map((b) => b.text ?? "").join("\n");
  const result = capText(joined, label, settings);
  if (!result.truncated) {
    return { content, truncated: false };
  }

  // Rebuild: replace the run of text blocks with one capped block at the
  // position of the first text block, keeping non-text blocks in order.
  const firstTextIndex = content.findIndex((b) => b.type === "text");
  const rebuilt: ContentBlock[] = [];
  let inserted = false;
  content.forEach((block, index) => {
    if (block.type === "text") {
      if (index === firstTextIndex && !inserted) {
        rebuilt.push({ type: "text", text: result.text });
        inserted = true;
      }
      // Drop other text blocks; their content was folded into the capped block.
      return;
    }
    rebuilt.push(block);
  });

  return { content: rebuilt, truncated: true, fullOutputPath: result.fullOutputPath };
}
