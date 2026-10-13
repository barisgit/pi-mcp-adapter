// ui-stream-types.ts
import { z } from "zod";
var UI_STREAM_HOST_CONTEXT_KEY = "pi-mcp-adapter/stream";
var UI_STREAM_REQUEST_META_KEY = "pi-mcp-adapter/stream-token";
var UI_STREAM_RESULT_PATCH_METHOD = "notifications/pi-mcp-adapter/ui-result-patch";
var SERVER_STREAM_RESULT_PATCH_METHOD = "notifications/pi-mcp-adapter/result-patch";
var UI_STREAM_STRUCTURED_CONTENT_KEY = "pi-mcp-adapter/stream";
var uiStreamModeSchema = z.enum(["eager", "stream-first"]);
var visualizationStreamPhaseSchema = z.enum(["shell", "narrative", "structure", "detail", "settled"]);
var visualizationStreamFrameTypeSchema = z.enum(["patch", "checkpoint", "final"]);
var visualizationStreamStatusSchema = z.enum(["ok", "error"]);
var looseRecordSchema = z.record(z.string(), z.unknown());
var looseArraySchema = z.array(z.unknown());
var uiStreamHostContextSchema = z.object({
  mode: uiStreamModeSchema,
  streamId: z.string().min(1),
  intermediateResultPatches: z.boolean(),
  partialInput: z.boolean()
});
var visualizationStreamEnvelopeSchema = z.object({
  streamId: z.string().min(1),
  sequence: z.number().int().nonnegative(),
  frameType: visualizationStreamFrameTypeSchema,
  phase: visualizationStreamPhaseSchema,
  status: visualizationStreamStatusSchema,
  message: z.string().optional(),
  spec: looseRecordSchema.optional(),
  checkpoint: looseRecordSchema.optional()
});
var uiStreamCallToolResultSchema = z.object({
  content: looseArraySchema.optional(),
  structuredContent: looseRecordSchema.optional(),
  isError: z.boolean().optional(),
  _meta: looseRecordSchema.optional()
}).passthrough();
var uiStreamResultPatchNotificationSchema = z.object({
  method: z.literal(UI_STREAM_RESULT_PATCH_METHOD),
  params: uiStreamCallToolResultSchema
});
var serverStreamResultPatchNotificationSchema = z.object({
  method: z.literal(SERVER_STREAM_RESULT_PATCH_METHOD),
  params: z.object({
    streamToken: z.string().min(1),
    result: uiStreamCallToolResultSchema
  })
});
function getVisualizationStreamEnvelope(structuredContent) {
  if (!structuredContent || typeof structuredContent !== "object" || Array.isArray(structuredContent)) {
    return void 0;
  }
  const candidate = structuredContent[UI_STREAM_STRUCTURED_CONTENT_KEY];
  const parsed = visualizationStreamEnvelopeSchema.safeParse(candidate);
  return parsed.success ? parsed.data : void 0;
}

// types.ts
function extractUiPromptText(params) {
  if (params.type === "prompt" || params.prompt) {
    const prompt = params.prompt ?? String(params.message ?? "");
    return prompt || void 0;
  }
  if (params.role === "user" && Array.isArray(params.content)) {
    const text = params.content.map((block) => block && typeof block === "object" && "text" in block ? String(block.text ?? "") : "").filter(Boolean).join("\n\n");
    return text || void 0;
  }
  return void 0;
}
function parseUiPromptHandoff(prompt) {
  const newlineIndex = prompt.indexOf("\n");
  if (newlineIndex <= 0) {
    return void 0;
  }
  const intent = prompt.slice(0, newlineIndex).trim();
  const payloadText = prompt.slice(newlineIndex + 1).trim();
  if (!intent || !payloadText) {
    return void 0;
  }
  if (!/^[A-Za-z][A-Za-z0-9_-]*$/.test(intent)) {
    return void 0;
  }
  try {
    const parsed = JSON.parse(payloadText);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return void 0;
    }
    return {
      intent,
      params: parsed,
      raw: prompt
    };
  } catch {
    return void 0;
  }
}
function getEffectiveToolDescription(definition, toolName, upstreamDescription) {
  return definition.toolOverrides?.[toolName]?.description ?? upstreamDescription ?? "";
}
function getServerPrefix(serverName, mode) {
  if (mode === "none") return "";
  if (mode === "short") {
    let short = serverName.replace(/-?mcp$/i, "").replace(/-/g, "_");
    if (!short) short = "mcp";
    return short;
  }
  return serverName.replace(/-/g, "_");
}
function formatToolName(toolName, serverName, prefix) {
  const p = getServerPrefix(serverName, prefix);
  return p ? `${p}_${toolName}` : toolName;
}
function normalizeToolName(value) {
  return value.replace(/-/g, "_");
}
function isToolExcluded(toolName, serverName, prefix, excludeTools) {
  if (!Array.isArray(excludeTools) || excludeTools.length === 0) return false;
  const candidates = /* @__PURE__ */ new Set([
    normalizeToolName(toolName),
    normalizeToolName(formatToolName(toolName, serverName, prefix)),
    normalizeToolName(formatToolName(toolName, serverName, "server")),
    normalizeToolName(formatToolName(toolName, serverName, "short"))
  ]);
  for (const excluded of excludeTools) {
    if (typeof excluded !== "string") continue;
    if (candidates.has(normalizeToolName(excluded))) {
      return true;
    }
  }
  return false;
}

export {
  UI_STREAM_HOST_CONTEXT_KEY,
  UI_STREAM_REQUEST_META_KEY,
  UI_STREAM_STRUCTURED_CONTENT_KEY,
  serverStreamResultPatchNotificationSchema,
  getVisualizationStreamEnvelope,
  extractUiPromptText,
  parseUiPromptHandoff,
  getEffectiveToolDescription,
  getServerPrefix,
  formatToolName,
  isToolExcluded
};
