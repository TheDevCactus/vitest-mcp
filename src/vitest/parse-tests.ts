import type { TestFailure, TestSummary } from "../domain/result.js";

interface JsonAssertion {
  fullName?: string;
  title?: string;
  status?: string;
  failureMessages?: string[];
}

interface JsonTestResult {
  name?: string;
  assertionResults?: JsonAssertion[];
  message?: string;
}

interface JsonReport {
  numTotalTests?: number;
  numPassedTests?: number;
  numFailedTests?: number;
  numPendingTests?: number;
  numTodoTests?: number;
  testResults?: JsonTestResult[];
}

const MAX_FAILURES = 20;
const MAX_MESSAGE_LENGTH = 4_000;

export function parseTestReport(value: unknown): TestSummary {
  const report = value as JsonReport;
  if (!report || typeof report !== "object" || !Array.isArray(report.testResults)) {
    throw new Error("Vitest produced an invalid JSON test report");
  }

  const failures: TestFailure[] = [];
  for (const fileResult of report.testResults) {
    for (const assertion of fileResult.assertionResults ?? []) {
      if (assertion.status !== "failed" || failures.length >= MAX_FAILURES) continue;
      const message = (assertion.failureMessages ?? [fileResult.message ?? "Test failed"])
        .join("\n")
        .slice(0, MAX_MESSAGE_LENGTH);
      failures.push({
        file: fileResult.name ?? "unknown",
        test: assertion.fullName ?? assertion.title ?? "unknown",
        message,
      });
    }
  }

  return {
    total: report.numTotalTests ?? 0,
    passed: report.numPassedTests ?? 0,
    failed: report.numFailedTests ?? 0,
    skipped: (report.numPendingTests ?? 0) + (report.numTodoTests ?? 0),
    failures,
  };
}
