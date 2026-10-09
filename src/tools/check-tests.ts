import * as z from "zod/v4";
import type { McpServer } from "@modelcontextprotocol/server";
import { resolveAllowedProjectRoot, validatePattern } from "../security/paths.js";
import type { VitestSessionManager } from "../vitest/session-manager.js";

const inputSchema = z.object({
  projectRoot: z.string().optional().describe("Project directory; defaults to the MCP process directory"),
  testPattern: z.string().min(1).max(1_000).optional().describe("Vitest test-file filter"),
  coveragePattern: z.string().min(1).max(1_000).optional().describe("Glob selecting source files for coverage"),
  timeoutMs: z.number().int().min(1_000).max(600_000).default(120_000),
  forceRun: z.boolean().default(false).describe("Execute tests even when the watched result is still valid"),
});

export function registerCheckTests(
  server: McpServer,
  allowedRoots: string[],
  sessions: VitestSessionManager,
): void {
  server.registerTool(
    "check_tests",
    {
      title: "Check Vitest tests and coverage",
      description:
        "Run the project-local Vitest once and return normalized pass/fail details. testPattern selects tests; coveragePattern independently selects source files to measure.",
      inputSchema,
    },
    async ({ projectRoot, testPattern, coveragePattern, timeoutMs, forceRun }) => {
      try {
        validatePattern(testPattern, "testPattern");
        validatePattern(coveragePattern, "coveragePattern");
        const resolvedRoot = await resolveAllowedProjectRoot(projectRoot, allowedRoots);
        const result = await sessions.check(
          { projectRoot: resolvedRoot, testPattern, coveragePattern },
          forceRun,
          timeoutMs,
        );
        return {
          content: [{ type: "text", text: JSON.stringify(result) }],
          structuredContent: result,
          isError: result.status === "error" || result.status === "timed_out",
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: "text", text: JSON.stringify({ status: "error", message }) }],
          isError: true,
        };
      }
    },
  );
}
