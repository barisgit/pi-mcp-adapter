import type { ExtensionUIContext } from "@mariozechner/pi-coding-agent";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import {
  ElicitRequestSchema,
  type ElicitRequest,
  type ElicitResult,
} from "@modelcontextprotocol/sdk/types.js";
import { logger } from "./logger.js";
import { truncateAtWord } from "./utils.js";

export interface ElicitationHandlerOptions {
  serverName: string;
  autoApprove: boolean;
  ui?: ExtensionUIContext;
}

export type ServerElicitationConfig = Omit<ElicitationHandlerOptions, "serverName">;

export function registerElicitationHandler(client: Client, options: ElicitationHandlerOptions): void {
  client.setRequestHandler(ElicitRequestSchema, (request) => {
    return handleElicitationRequest(options, request as ElicitRequest);
  });
}

export async function handleElicitationRequest(
  options: ElicitationHandlerOptions,
  request: ElicitRequest,
): Promise<ElicitResult> {
  const params = request.params;
  const message = truncateAtWord(params.message ?? "", 1000);
  const heading = `MCP elicitation from ${options.serverName}`;

  // URL mode: ask user to navigate to a URL and confirm.
  if ("mode" in params && params.mode === "url") {
    const detail = `${message}\n\nOpen URL: ${params.url}`;
    if (options.autoApprove) {
      return { action: "accept" };
    }
    if (!options.ui) {
      logger.debug(`${options.serverName}: declined URL elicitation (no UI)`);
      return { action: "decline" };
    }
    const approved = await options.ui.confirm(heading, detail);
    return { action: approved ? "accept" : "decline" };
  }

  // Form mode (default when mode missing per spec).
  const schema = params.requestedSchema;
  const properties = (schema?.properties ?? {}) as Record<string, Record<string, unknown>>;
  const required = new Set<string>(Array.isArray(schema?.required) ? (schema.required as string[]) : []);
  const propertyNames = Object.keys(properties);

  if (options.autoApprove) {
    // Auto-approve: fill in sensible defaults so servers (e.g. Computer Use confirm prompts)
    // receive meaningful values instead of empty content. Pi gates the parent tool call,
    // so this second prompt is redundant.
    return { action: "accept", content: autoApproveContent(properties) };
  }

  if (!options.ui) {
    logger.debug(`${options.serverName}: declined form elicitation (no UI)`);
    return { action: "decline" };
  }

  // Show the overall message first so the user knows what is being requested.
  if (propertyNames.length === 0) {
    const approved = await options.ui.confirm(heading, message);
    return { action: approved ? "accept" : "decline" };
  }

  const introApproved = await options.ui.confirm(
    heading,
    `${message}\n\nThis server wants to collect ${propertyNames.length} field${propertyNames.length === 1 ? "" : "s"}. Continue?`,
  );
  if (!introApproved) {
    return { action: "decline" };
  }

  const content: Record<string, string | number | boolean | string[]> = {};

  for (const name of propertyNames) {
    const propSchema = properties[name] ?? {};
    const title = typeof propSchema.title === "string" ? propSchema.title : name;
    const description = typeof propSchema.description === "string" ? propSchema.description : "";
    const isRequired = required.has(name);
    const promptTitle = `${heading}: ${title}${isRequired ? " *required*" : ""}`;

    const enumValues = Array.isArray(propSchema.enum) ? (propSchema.enum as unknown[]).map(String) : undefined;
    const type = typeof propSchema.type === "string" ? propSchema.type : enumValues ? "string" : undefined;

    if (enumValues && enumValues.length > 0) {
      const selectTitle = description ? `${promptTitle} — ${truncateAtWord(description, 200)}` : promptTitle;
      const choice = await options.ui.select(selectTitle, enumValues);
      if (choice === undefined) {
        return { action: "cancel" };
      }
      content[name] = choice;
      continue;
    }

    if (type === "boolean") {
      const approved = await options.ui.confirm(promptTitle, description || `Accept ${name}?`);
      content[name] = approved;
      continue;
    }

    const placeholder = description || (typeof propSchema.default === "string" ? String(propSchema.default) : "");
    const answer = await options.ui.input(promptTitle, placeholder);
    if (answer === undefined) {
      return { action: "cancel" };
    }
    if (type === "number" || type === "integer") {
      const parsed = Number(answer);
      if (Number.isNaN(parsed)) {
        if (isRequired) {
          return { action: "cancel" };
        }
        continue;
      }
      content[name] = parsed;
      continue;
    }
    if (answer === "" && !isRequired) {
      continue;
    }
    content[name] = answer;
  }

  return { action: "accept", content };
}

function autoApproveContent(properties: Record<string, Record<string, unknown>>): Record<string, string | number | boolean | string[]> {
  const content: Record<string, string | number | boolean | string[]> = {};
  for (const [name, schema] of Object.entries(properties)) {
    const enumValues = Array.isArray(schema.enum) ? (schema.enum as unknown[]).map(String) : undefined;
    const type = typeof schema.type === "string" ? schema.type : enumValues ? "string" : undefined;
    if (schema.default !== undefined) {
      const def = schema.default;
      if (typeof def === "string" || typeof def === "number" || typeof def === "boolean") {
        content[name] = def;
        continue;
      }
      if (Array.isArray(def) && def.every((v) => typeof v === "string")) {
        content[name] = def as string[];
        continue;
      }
    }
    if (enumValues && enumValues.length > 0) {
      content[name] = enumValues[0];
      continue;
    }
    if (type === "boolean") {
      content[name] = true;
      continue;
    }
    if (type === "number" || type === "integer") {
      content[name] = 0;
      continue;
    }
    // strings and unknown types fall through with empty string
    content[name] = "";
  }
  return content;
}
