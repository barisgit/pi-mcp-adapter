import { describe, expect, it } from "vitest";
import { findToolByName } from "../tool-metadata.js";
import type { ToolMetadata } from "../types.js";

const metadata: ToolMetadata[] = [
  {
    name: "computer_use_list_apps",
    originalName: "list_apps",
    description: "",
  },
  {
    name: "computer_use_get_app_state",
    originalName: "get_app_state",
    description: "",
  },
  {
    name: "fs-mcp-read_file",
    originalName: "read-file",
    description: "",
  },
];

describe("findToolByName", () => {
  it("matches exact prefixed name", () => {
    expect(findToolByName(metadata, "computer_use_list_apps")?.originalName).toBe("list_apps");
  });

  it("matches hyphen-normalized prefixed name", () => {
    expect(findToolByName(metadata, "fs-mcp-read_file")?.originalName).toBe("read-file");
    expect(findToolByName(metadata, "fs_mcp_read_file")?.originalName).toBe("read-file");
  });

  it("falls back to raw upstream originalName", () => {
    expect(findToolByName(metadata, "list_apps")?.name).toBe("computer_use_list_apps");
    expect(findToolByName(metadata, "get_app_state")?.name).toBe("computer_use_get_app_state");
  });

  it("falls back to hyphen-normalized originalName", () => {
    expect(findToolByName(metadata, "read_file")?.originalName).toBe("read-file");
  });

  it("returns undefined for unknown tool names", () => {
    expect(findToolByName(metadata, "nope")).toBeUndefined();
    expect(findToolByName(undefined, "anything")).toBeUndefined();
  });
});
