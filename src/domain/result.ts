export type CheckStatus = "passed" | "failed" | "error" | "timed_out";

export interface TestFailure {
  file: string;
  test: string;
  message: string;
}

export interface TestSummary {
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  failures: TestFailure[];
}

export interface CoverageMetrics {
  lines: number;
  functions: number;
  branches: number;
  statements: number;
}

export interface FileCoverage extends CoverageMetrics {
  file: string;
}

export interface CoverageSummary {
  files: FileCoverage[];
  totals: CoverageMetrics;
}

export interface CheckResult {
  status: CheckStatus;
  tests: TestSummary;
  coverage?: CoverageSummary;
  durationMs: number;
  diagnostics: string[];
  cached: boolean;
  lastRunAt: string;
  invalidatedBy?: string[];
}

export const emptyTests = (): TestSummary => ({
  total: 0,
  passed: 0,
  failed: 0,
  skipped: 0,
  failures: [],
});
