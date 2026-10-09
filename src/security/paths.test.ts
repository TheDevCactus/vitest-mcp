import { mkdtemp, mkdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parseAllowedRoots, resolveAllowedProjectRoot, validatePattern } from "./paths.js";

const cleanup: string[] = [];

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("allowed project roots", () => {
  it("parses configured roots and falls back when unset", () => {
    expect(parseAllowedRoots(undefined, "relative")).toEqual([path.resolve("relative")]);
    expect(parseAllowedRoots(["one", "", "two"].join(path.delimiter), "fallback"))
      .toEqual([path.resolve("one"), path.resolve("two")]);
  });

  it("allows a canonical root and its descendants", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "vitest-mcp-paths-"));
    cleanup.push(root);
    const child = path.join(root, "child");
    await mkdir(child);

    await expect(resolveAllowedProjectRoot(root, [root])).resolves.toBe(root);
    await expect(resolveAllowedProjectRoot(child, [root])).resolves.toBe(child);
  });

  it("rejects projects outside the configured roots", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "vitest-mcp-allowed-"));
    const outside = await mkdtemp(path.join(os.tmpdir(), "vitest-mcp-outside-"));
    cleanup.push(root, outside);

    await expect(resolveAllowedProjectRoot(outside, [root])).rejects.toThrow("outside the configured allowed roots");
  });
});

describe("validatePattern", () => {
  it.each(["../secret.test.ts", "src/../../secret.ts", "--config=elsewhere.ts", "/tmp/test.ts"])(
    "rejects unsafe pattern %s",
    (pattern) => expect(() => validatePattern(pattern, "pattern")).toThrow(),
  );

  it.each(["src/math.test.ts", "src/**/*.{ts,tsx}", "math"])(
    "accepts project-relative pattern %s",
    (pattern) => expect(() => validatePattern(pattern, "pattern")).not.toThrow(),
  );

  it("accepts an omitted pattern", () => {
    expect(() => validatePattern(undefined, "pattern")).not.toThrow();
  });
});
