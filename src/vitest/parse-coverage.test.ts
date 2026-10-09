import { describe, expect, it } from "vitest";
import { parseCoverageReport } from "./parse-coverage.js";

describe("parseCoverageReport", () => {
  it("normalizes totals and project-relative files", () => {
    const metric = (pct: number) => ({ pct });
    const entry = (pct: number) => ({
      lines: metric(pct), functions: metric(pct), branches: metric(pct), statements: metric(pct),
    });
    const result = parseCoverageReport(
      { total: entry(75), "/repo/src/math.ts": entry(100) },
      "/repo",
    );
    expect(result.totals.lines).toBe(75);
    expect(result.files[0]).toMatchObject({ file: "src/math.ts", lines: 100 });
  });

  it("sorts files and defaults missing metrics to zero", () => {
    const result = parseCoverageReport({
      total: {},
      "/repo/z.ts": { lines: { pct: 10 } },
      "/repo/a.ts": undefined,
    }, "/repo");

    expect(result.files.map((file) => file.file)).toEqual(["a.ts", "z.ts"]);
    expect(result.files[0]).toMatchObject({ lines: 0, functions: 0, branches: 0, statements: 0 });
    expect(result.totals.lines).toBe(0);
  });

  it.each([null, [], "bad"])("rejects invalid report %j", (report) => {
    expect(() => parseCoverageReport(report, "/repo")).toThrow("invalid JSON coverage summary");
  });

  it("requires totals", () => {
    expect(() => parseCoverageReport({}, "/repo")).toThrow("does not contain totals");
  });
});
