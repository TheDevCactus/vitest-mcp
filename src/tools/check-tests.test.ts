import type { McpServer } from "@modelcontextprotocol/server";
import { describe, expect, it, vi } from "vitest";
import type { VitestSessionManager } from "../vitest/session-manager.js";
import { registerCheckTests } from "./check-tests.js";

type Handler = (input: {
  projectRoot?: string;
  testPattern?: string;
  coveragePattern?: string;
  timeoutMs: number;
  forceRun: boolean;
}) => Promise<Record<string, unknown>>;

function setup(check: ReturnType<typeof vi.fn>): Handler {
  let handler: Handler | undefined;
  const server = {
    registerTool: (_name: string, _configuration: unknown, registered: Handler) => {
      handler = registered;
    },
  };
  registerCheckTests(
    server as unknown as McpServer,
    [process.cwd()],
    { check } as unknown as VitestSessionManager,
  );
  return handler!;
}

describe("registerCheckTests", () => {
  it("validates, resolves, and returns a structured successful result", async () => {
    const result = {
      status: "passed",
      tests: { total: 1, passed: 1, failed: 0, skipped: 0, failures: [] },
      durationMs: 5,
      diagnostics: [],
      cached: false,
      lastRunAt: new Date().toISOString(),
    };
    const check = vi.fn().mockResolvedValue(result);
    const handler = setup(check);

    const response = await handler({
      projectRoot: process.cwd(),
      testPattern: "src/a.test.ts",
      coveragePattern: "src/a.ts",
      timeoutMs: 2_000,
      forceRun: true,
    });

    expect(check).toHaveBeenCalledWith({
      projectRoot: process.cwd(),
      testPattern: "src/a.test.ts",
      coveragePattern: "src/a.ts",
    }, true, 2_000);
    expect(response).toMatchObject({ structuredContent: result, isError: false });
  });

  it.each(["error", "timed_out"])("marks %s results as MCP errors", async (status) => {
    const result = {
      status,
      tests: { total: 0, passed: 0, failed: 0, skipped: 0, failures: [] },
      durationMs: 1,
      diagnostics: [],
      cached: false,
      lastRunAt: new Date().toISOString(),
    };
    const response = await setup(vi.fn().mockResolvedValue(result))({ timeoutMs: 1_000, forceRun: false });
    expect(response.isError).toBe(true);
  });

  it("converts validation exceptions into tool errors", async () => {
    const response = await setup(vi.fn())({
      testPattern: "../escape.test.ts",
      timeoutMs: 1_000,
      forceRun: false,
    });

    expect(response).toMatchObject({ isError: true });
    expect(JSON.parse((response.content as Array<{ text: string }>)[0].text)).toMatchObject({
      status: "error",
      message: "testPattern cannot traverse outside the project",
    });
  });

  it("stringifies non-Error exceptions", async () => {
    const response = await setup(vi.fn().mockRejectedValue("broken"))({
      timeoutMs: 1_000,
      forceRun: false,
    });
    expect((response.content as Array<{ text: string }>)[0].text).toContain("broken");
  });
});
