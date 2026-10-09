import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { VitestSession } from "./session.js";

describe("VitestSession coverage", () => {
  const cleanup: Array<() => Promise<void>> = [];

  afterEach(async () => {
    while (cleanup.length) await cleanup.pop()!();
  });

  it("reports matched source files that no test imports", async () => {
    const projectRoot = await mkdtemp(path.join(process.cwd(), ".vitest-mcp-test-"));
    cleanup.push(() => rm(projectRoot, { recursive: true, force: true }));
    await mkdir(path.join(projectRoot, "src"));
    await Promise.all([
      writeFile(path.join(projectRoot, "package.json"), JSON.stringify({ type: "module" })),
      writeFile(path.join(projectRoot, "src", "used.ts"), "export const used = () => 1;\n"),
      writeFile(path.join(projectRoot, "src", "unused.ts"), "export const unused = () => 2;\n"),
      writeFile(
        path.join(projectRoot, "src", "used.test.ts"),
        'import { expect, it } from "vitest";\nimport { used } from "./used.js";\nit("works", () => expect(used()).toBe(1));\n',
      ),
    ]);

    const session = await VitestSession.create("coverage-test", {
      projectRoot,
      coveragePattern: "src/*.ts",
    });
    cleanup.push(() => session.close());

    const result = await session.check(true, 30_000);

    expect(result.status).toBe("passed");
    expect(result.coverage?.files).toEqual(expect.arrayContaining([
      expect.objectContaining({ file: "src/used.ts", lines: 100 }),
      expect.objectContaining({ file: "src/unused.ts", lines: 0 }),
    ]));

    const cached = await session.check(false, 30_000);
    expect(cached.cached).toBe(true);
    expect(cached.lastRunAt).toBe(result.lastRunAt);

    await writeFile(path.join(projectRoot, "src", "used.ts"), "export const used = () => 1;\n// changed\n");
    await new Promise((resolve) => setTimeout(resolve, 100));
    const watched = await session.check(false, 30_000);
    expect(watched.cached).toBe(true);
    expect(watched.invalidatedBy).toContain(path.join(projectRoot, "src", "used.ts"));
  });

  it("normalizes failed and skipped tests", async () => {
    const projectRoot = await mkdtemp(path.join(process.cwd(), ".vitest-mcp-test-"));
    cleanup.push(() => rm(projectRoot, { recursive: true, force: true }));
    await mkdir(path.join(projectRoot, "src"));
    await Promise.all([
      writeFile(path.join(projectRoot, "package.json"), JSON.stringify({ type: "module" })),
      writeFile(
        path.join(projectRoot, "src", "states.test.ts"),
        'import { expect, it } from "vitest";\nit("passes", () => expect(1).toBe(1));\nit.skip("skips", () => {});\nit.todo("pending");\nit("fails", () => expect(1).toBe(2));\n',
      ),
    ]);
    const session = await VitestSession.create("states-test", { projectRoot });
    cleanup.push(() => session.close());

    const result = await session.check(true, 30_000);

    expect(result.status).toBe("failed");
    expect(result.tests).toMatchObject({ total: 4, passed: 1, failed: 1, skipped: 2 });
    expect(result.tests.failures[0]).toMatchObject({ test: "fails" });
  });

  it("cancels a run that exceeds its deadline", async () => {
    const projectRoot = await mkdtemp(path.join(process.cwd(), ".vitest-mcp-test-"));
    cleanup.push(() => rm(projectRoot, { recursive: true, force: true }));
    await mkdir(path.join(projectRoot, "src"));
    await Promise.all([
      writeFile(path.join(projectRoot, "package.json"), JSON.stringify({ type: "module" })),
      writeFile(
        path.join(projectRoot, "src", "slow.test.ts"),
        'import { it } from "vitest";\nit("waits", async () => new Promise((resolve) => setTimeout(resolve, 2_000)));\n',
      ),
    ]);
    const session = await VitestSession.create("timeout-test", { projectRoot });
    cleanup.push(() => session.close());

    const result = await session.check(true, 10);

    expect(result).toMatchObject({ status: "timed_out", durationMs: 10, cached: false });
    expect(result.diagnostics[0]).toContain("10ms timeout");
  });

  it("cleans up when a project has no local Vitest installation", async () => {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), "vitest-mcp-no-vitest-"));
    cleanup.push(() => rm(projectRoot, { recursive: true, force: true }));
    await writeFile(path.join(projectRoot, "package.json"), JSON.stringify({ type: "module" }));

    await expect(VitestSession.create("missing-vitest", { projectRoot }))
      .rejects.toThrow("No project-local Vitest installation");
  });
});
