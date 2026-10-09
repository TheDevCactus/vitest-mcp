#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/server";
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import { parseAllowedRoots } from "./security/paths.js";
import { registerCheckTests } from "./tools/check-tests.js";
import { VitestSessionManager } from "./vitest/session-manager.js";

const allowedRoots = parseAllowedRoots(process.env.VITEST_MCP_ALLOWED_ROOTS, process.cwd());
const sessions = new VitestSessionManager();

const server = new McpServer({ name: "vitest-mcp", version: "0.1.0" });
server.server.onerror = (error) => console.error("MCP protocol error", error);
registerCheckTests(server, allowedRoots, sessions);
await server.connect(new StdioServerTransport());
process.stdin.resume();
const keepAlive = setInterval(() => {}, 60_000);

process.stdin.on("end", () => {
  clearInterval(keepAlive);
  void sessions.close();
});
process.on("SIGINT", () => { void sessions.close().finally(() => process.exit(0)); });
process.on("SIGTERM", () => { void sessions.close().finally(() => process.exit(0)); });

console.error(`vitest-mcp serving roots: ${allowedRoots.join(", ")}`);
