import { describe, expect, it } from "vitest";
import { parseTestReport } from "./parse-tests.js";

describe("parseTestReport", () => {
  it("normalizes counts and failures", () => {
    const result = parseTestReport({
      numTotalTests: 3,
      numPassedTests: 1,
      numFailedTests: 1,
      numPendingTests: 1,
      testResults: [
        {
          name: "/repo/src/math.test.ts",
          assertionResults: [
            { status: "failed", fullName: "math adds", failureMessages: ["expected 3"] },
          ],
        },
      ],
    });

    expect(result).toEqual({
      total: 3,
      passed: 1,
      failed: 1,
      skipped: 1,
      failures: [{ file: "/repo/src/math.test.ts", test: "math adds", message: "expected 3" }],
    });
  });

  it("uses fallbacks and includes todo tests in skipped", () => {
    const result = parseTestReport({
      numTodoTests: 2,
      testResults: [
        { message: "file failed", assertionResults: [{ status: "failed", title: "fallback title" }] },
        { assertionResults: [{ status: "passed", fullName: "ignored" }] },
      ],
    });

    expect(result).toEqual({
      total: 0,
      passed: 0,
      failed: 0,
      skipped: 2,
      failures: [{ file: "unknown", test: "fallback title", message: "file failed" }],
    });
  });

  it.each([null, {}, { testResults: "bad" }])("rejects invalid report %j", (report) => {
    expect(() => parseTestReport(report)).toThrow("invalid JSON test report");
  });

  it("limits failures and their message lengths", () => {
    const result = parseTestReport({
      testResults: [{
        assertionResults: Array.from({ length: 25 }, (_, index) => ({
          status: "failed",
          fullName: `failure ${index}`,
          failureMessages: ["x".repeat(5_000)],
        })),
      }],
    });

    expect(result.failures).toHaveLength(20);
    expect(result.failures[0].message).toHaveLength(4_000);
  });
});
