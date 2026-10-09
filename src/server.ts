#!/usr/bin/env node
import path from "node:path";
import { McpServer } from "@modelcontextprotocol/server";
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import { parseAllowedRoots } from "./security/paths.js";
import { registerCheckTests } from "./tools/check-tests.js";
import { FileTelemetry } from "./telemetry/logger.js";
import { VitestSessionManager } from "./vitest/session-manager.js";

const allowedRoots = parseAllowedRoots(process.env.VITEST_MCP_ALLOWED_ROOTS, process.cwd());
const logFile = path.resolve(process.env.VITEST_MCP_LOG_FILE ?? ".vitest-mcp/server.log");
const telemetry = new FileTelemetry(logFile);
const sessions = new VitestSessionManager(undefined, telemetry);

const server = new McpServer({ name: "vitest-mcp", version: "0.1.0" });
server.server.onerror = (error) => {
  console.error("MCP protocol error", error);
  telemetry.log("protocol_error", { message: error.message });
};
registerCheckTests(server, allowedRoots, sessions);
await server.connect(new StdioServerTransport());
process.stdin.resume();
const keepAlive = setInterval(() => {}, 60_000);
telemetry.log("server_started", { pid: process.pid, roots: allowedRoots, logFile });

let shutdownPromise: Promise<void> | undefined;
function shutdown(reason: string): Promise<void> {
  if (shutdownPromise) return shutdownPromise;
  clearInterval(keepAlive);
  telemetry.log("server_stopping", { reason });
  shutdownPromise = sessions.close().then(() => telemetry.flush());
  return shutdownPromise;
}

process.stdin.on("end", () => { void shutdown("stdin ended"); });
process.on("SIGINT", () => { void shutdown("SIGINT").finally(() => process.exit(0)); });
process.on("SIGTERM", () => { void shutdown("SIGTERM").finally(() => process.exit(0)); });

console.error(`vitest-mcp serving roots: ${allowedRoots.join(", ")}`);
