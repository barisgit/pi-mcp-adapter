// Keep tests away from the developer's real Pi agent directory.
//
// Without this, a PI_CODING_AGENT_DIR or MCP_OAUTH_DIR exported in the shell
// sends config, cache, and OAuth writes from tests into the live ~/.pi/agent,
// and tests that isolate themselves by changing HOME silently stop being isolated.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.HOME = mkdtempSync(join(tmpdir(), "pi-mcp-test-home-"));
delete process.env.PI_CODING_AGENT_DIR;
delete process.env.MCP_OAUTH_DIR;
