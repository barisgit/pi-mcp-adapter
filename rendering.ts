import { truncateToWidth } from "@mariozechner/pi-tui";

type ThemeLike = {
  bold?: (text: string) => string;
  fg?: (color: string, text: string) => string;
};

type RenderContextLike = {
  args?: Record<string, unknown>;
  lastComponent?: unknown;
};

type RenderResultOptionsLike = {
  isPartial?: boolean;
};

type ToolResultLike = {
  content?: Array<{ type: string; text?: string }>;
  details?: Record<string, unknown>;
};

class SimpleTextComponent {
  constructor(private text: string) {}

  setText(text: string): void {
    this.text = text;
  }

  render(width?: number): string[] {
    const lines = this.text.split("\n");
    if (!width || width <= 0) return lines;
    return lines.map((line) => truncateToWidth(line, width, "…"));
  }

  invalidate(): void {}
}

function textComponent(context: RenderContextLike | undefined, text: string): SimpleTextComponent {
  const existing = context?.lastComponent instanceof SimpleTextComponent
    ? context.lastComponent
    : new SimpleTextComponent("");
  existing.setText(text);
  return existing;
}

function style(theme: ThemeLike, color: string, text: string): string {
  return theme.fg ? theme.fg(color, text) : text;
}

function bold(theme: ThemeLike, text: string): string {
  return theme.bold ? theme.bold(text) : text;
}

function formatValue(value: unknown): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return undefined;
}

function parseJsonObject(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "string") return undefined;
  try {
    const parsed = JSON.parse(value);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    return undefined;
  }
  return undefined;
}

function summarizeArgs(args: Record<string, unknown> | undefined, maxKeys = 3): string | undefined {
  if (!args) return undefined;
  const entries = Object.entries(args).filter(([, value]) => value !== undefined);
  if (entries.length === 0) return undefined;

  const parts = entries.slice(0, maxKeys).map(([key, value]) => {
    const formatted = typeof value === "string" ? JSON.stringify(value) : JSON.stringify(value);
    return `${key}: ${formatted}`;
  });
  if (entries.length > maxKeys) parts.push(`+${entries.length - maxKeys} more`);
  return parts.join(", ");
}

function resultText(result: ToolResultLike | undefined): string | undefined {
  const text = result?.content
    ?.filter((item) => item.type === "text")
    .map((item) => item.text ?? "")
    .filter(Boolean)
    .join("\n");
  return text || undefined;
}

function formatTarget(server: unknown, tool: unknown): string | undefined {
  const serverName = formatValue(server);
  const toolName = formatValue(tool);
  if (serverName && toolName) return `${serverName}/${toolName}`;
  return toolName ?? serverName;
}

export function renderDirectMcpToolCall(
  serverName: string,
  toolName: string,
  args: Record<string, unknown> | undefined,
  theme: ThemeLike,
  context?: RenderContextLike,
): SimpleTextComponent {
  let text = `${style(theme, "toolTitle", bold(theme, "mcp"))} ${style(theme, "muted", "→")} ${style(theme, "accent", `${serverName}/${toolName}`)}`;
  const summary = summarizeArgs(args);
  if (summary) text += `\n${style(theme, "muted", summary)}`;
  return textComponent(context, text);
}

export function renderMcpProxyCall(
  params: Record<string, unknown>,
  theme: ThemeLike,
  context?: RenderContextLike,
): SimpleTextComponent {
  let title = "mcp";
  let detail: string | undefined;
  let summary: string | undefined;

  if (params.tool) {
    title = "mcp call";
    detail = formatTarget(params.server, params.tool);
    summary = summarizeArgs(parseJsonObject(params.args));
  } else if (params.connect) {
    title = "mcp connect";
    detail = formatValue(params.connect);
  } else if (params.describe) {
    title = "mcp describe";
    detail = formatValue(params.describe);
  } else if (params.search) {
    title = "mcp search";
    detail = formatValue(params.search);
  } else if (params.server) {
    title = "mcp list";
    detail = formatValue(params.server);
  } else if (params.action) {
    title = `mcp ${formatValue(params.action)}`;
  } else {
    title = "mcp status";
  }

  let text = style(theme, "toolTitle", bold(theme, title));
  if (detail) text += ` ${style(theme, "muted", "→")} ${style(theme, "accent", detail)}`;
  if (summary) text += `\n${style(theme, "muted", summary)}`;
  return textComponent(context, text);
}

export function renderMcpToolResult(
  result: ToolResultLike,
  options: RenderResultOptionsLike,
  theme: ThemeLike,
  context?: RenderContextLike,
): SimpleTextComponent {
  if (options.isPartial) {
    return textComponent(context, style(theme, "warning", "MCP tool is still running…"));
  }

  const args = context?.args;
  const target = formatTarget(
    result.details?.server ?? args?.server,
    result.details?.tool ?? args?.tool,
  );
  const mode = formatValue(result.details?.mode ?? args?.action);
  const prefix = target ? `mcp → ${target}` : mode ? `mcp ${mode}` : "mcp result";
  const header = style(theme, result.details?.error ? "error" : "success", bold(theme, prefix));
  const body = resultText(result);

  return textComponent(context, body ?? header);
}
