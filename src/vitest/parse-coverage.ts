import path from "node:path";
import type { CoverageMetrics, CoverageSummary } from "../domain/result.js";

interface IstanbulMetric {
  pct?: number;
}

interface IstanbulEntry {
  lines?: IstanbulMetric;
  functions?: IstanbulMetric;
  branches?: IstanbulMetric;
  statements?: IstanbulMetric;
}

function metrics(entry: IstanbulEntry | undefined): CoverageMetrics {
  return {
    lines: entry?.lines?.pct ?? 0,
    functions: entry?.functions?.pct ?? 0,
    branches: entry?.branches?.pct ?? 0,
    statements: entry?.statements?.pct ?? 0,
  };
}

export function parseCoverageReport(value: unknown, projectRoot: string): CoverageSummary {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Vitest produced an invalid JSON coverage summary");
  }

  const report = value as Record<string, IstanbulEntry>;
  if (!report.total) throw new Error("Coverage summary does not contain totals");

  const files = Object.entries(report)
    .filter(([file]) => file !== "total")
    .map(([file, entry]) => ({ file: path.relative(projectRoot, file), ...metrics(entry) }))
    .sort((a, b) => a.file.localeCompare(b.file));

  return { files, totals: metrics(report.total) };
}
