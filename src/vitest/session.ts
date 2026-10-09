import { createRequire } from "node:module";
import { Writable } from "node:stream";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { CheckResult, TestFailure, TestSummary } from "../domain/result.js";
import { emptyTests } from "../domain/result.js";
import { createProjectVitest, initializeVitest, type VitestFactory } from "./compat.js";
import { parseCoverageReport } from "./parse-coverage.js";

interface ReportedError {
  message?: string;
  stack?: string;
}

interface ReportedTest {
  fullName: string;
  result(): { state: "passed" | "failed" | "skipped" | "pending"; errors?: readonly ReportedError[] };
}

interface ReportedModule {
  moduleId: string;
  children: { allTests(): Iterable<ReportedTest> };
  errors(): readonly ReportedError[];
}

interface TestSpecification {
  moduleId: string;
}

interface TestRunResult {
  testModules: ReportedModule[];
  unhandledErrors: ReportedError[];
}

interface VitestInstance {
  standalone?: () => Promise<void>;
  init?: () => Promise<void>;
  globTestSpecifications(filters?: string[]): Promise<TestSpecification[]>;
  runTestSpecifications(specifications: TestSpecification[], allTestsRun?: boolean): Promise<TestRunResult>;
  rerunTestSpecifications(specifications: TestSpecification[], allTestsRun?: boolean): Promise<TestRunResult>;
  waitForTestRunEnd(): Promise<void>;
  cancelCurrentRun(reason: string): Promise<void>;
  onTestsRerun(handler: (specifications: TestSpecification[]) => void | Promise<void>): void;
  onFilterWatchedSpecification(handler: (specification: TestSpecification) => boolean): void;
  onServerRestart(handler: (reason?: string) => void | Promise<void>): void;
  onClose(handler: () => void | Promise<void>): void;
  close(): Promise<void>;
  vite: { watcher: { on(event: "all", handler: (event: string, file: string) => void): void } };
}

interface VitestNodeModule {
  createVitest: VitestFactory<VitestInstance>;
}

export interface SessionOptions {
  projectRoot: string;
  testPattern?: string;
  coveragePattern?: string;
}

const MAX_FAILURES = 20;
const MAX_MESSAGE_LENGTH = 4_000;
const MAX_DIAGNOSTIC_LENGTH = 8_000;
const WATCH_SETTLE_MS = 250;

class BoundedOutput extends Writable {
  private value = "";

  override _write(chunk: Buffer | string, _encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
    this.value = (this.value + chunk.toString()).slice(-MAX_DIAGNOSTIC_LENGTH);
    callback();
  }

  take(): string {
    const value = this.value.trim();
    this.value = "";
    return value;
  }
}

function errorMessage(error: ReportedError): string {
  return (error.stack ?? error.message ?? "Unknown Vitest error").slice(0, MAX_MESSAGE_LENGTH);
}

function normalizeModules(modules: readonly ReportedModule[]): TestSummary {
  const tests = emptyTests();
  for (const module of modules) {
    for (const test of module.children.allTests()) {
      const result = test.result();
      tests.total += 1;
      if (result.state === "passed") tests.passed += 1;
      else if (result.state === "failed") {
        tests.failed += 1;
        if (tests.failures.length < MAX_FAILURES) {
          tests.failures.push({
            file: module.moduleId,
            test: test.fullName,
            message: (result.errors ?? []).map(errorMessage).join("\n").slice(0, MAX_MESSAGE_LENGTH),
          });
        }
      } else if (result.state === "skipped") tests.skipped += 1;
    }
    if (module.errors().length && tests.failures.length < MAX_FAILURES) {
      const failure: TestFailure = {
        file: module.moduleId,
        test: "Module setup/collection",
        message: module.errors().map(errorMessage).join("\n").slice(0, MAX_MESSAGE_LENGTH),
      };
      tests.failures.push(failure);
      if (tests.failed === 0) tests.failed = 1;
    }
  }
  return tests;
}

async function loadProjectVitest(projectRoot: string): Promise<VitestNodeModule> {
  const requireFromProject = createRequire(path.join(projectRoot, "package.json"));
  let modulePath: string;
  try {
    modulePath = requireFromProject.resolve("vitest/node");
  } catch {
    throw new Error(`No project-local Vitest installation found in ${projectRoot}`);
  }
  return import(pathToFileURL(modulePath).href) as Promise<VitestNodeModule>;
}

export class VitestSession {
  readonly key: string;
  lastUsedAt = Date.now();
  private readonly tempDir: string;
  private readonly coverageDir: string;
  private readonly output: BoundedOutput;
  private readonly errors: BoundedOutput;
  private readonly vitest: VitestInstance;
  private readonly specifications: TestSpecification[];
  private latest?: CheckResult;
  private dirtyFiles = new Set<string>();
  private capturedRun?: {
    modules: readonly ReportedModule[];
    errors: readonly ReportedError[];
    durationMs: number;
    completedAt: number;
  };
  private operation: Promise<void> = Promise.resolve();
  private closed = false;

  private constructor(
    key: string,
    private readonly options: SessionOptions,
    tempDir: string,
    vitest: VitestInstance,
    specifications: TestSpecification[],
    output: BoundedOutput,
    errors: BoundedOutput,
  ) {
    this.key = key;
    this.tempDir = tempDir;
    this.coverageDir = path.join(tempDir, "coverage");
    this.vitest = vitest;
    this.specifications = specifications;
    this.output = output;
    this.errors = errors;
  }

  static async create(key: string, options: SessionOptions): Promise<VitestSession> {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "vitest-mcp-session-"));
    const output = new BoundedOutput();
    const errors = new BoundedOutput();
    let runStartedAt = Date.now();
    let session: VitestSession | undefined;
    const reporter = {
      onTestRunStart: () => { runStartedAt = Date.now(); },
      onTestRunEnd: (modules: readonly ReportedModule[], runErrors: readonly ReportedError[]) => {
        session?.recordRun(modules, runErrors, Date.now() - runStartedAt);
      },
    };

    try {
      const { createVitest } = await loadProjectVitest(options.projectRoot);
      const vitest = await createProjectVitest(
        createVitest,
        {
          root: options.projectRoot,
          watch: true,
          reporters: [reporter],
          silent: true,
          passWithNoTests: true,
          coverage: options.coveragePattern
            ? {
                enabled: true,
                include: [options.coveragePattern],
                reporter: ["json-summary"],
                reportsDirectory: path.join(tempDir, "coverage"),
                cleanOnRerun: true,
              }
            : { enabled: false },
        },
        { stdout: output, stderr: errors },
      );
      await initializeVitest(vitest);
      const specifications = await vitest.globTestSpecifications(
        options.testPattern ? [options.testPattern] : undefined,
      );
      const createdSession = new VitestSession(
        key, options, tempDir, vitest, specifications, output, errors,
      );
      session = createdSession;

      const selected = new Set(specifications.map((specification) => specification.moduleId));
      vitest.onFilterWatchedSpecification((specification) => selected.has(specification.moduleId));
      vitest.onServerRestart((reason) => {
        createdSession.dirtyFiles.add(reason ?? "Vitest configuration changed");
      });
      vitest.vite.watcher.on("all", (_event, file) => createdSession.dirtyFiles.add(file));

      return createdSession;
    } catch (error) {
      await rm(tempDir, { recursive: true, force: true });
      throw error;
    }
  }

  async check(forceRun: boolean, timeoutMs: number): Promise<CheckResult> {
    this.lastUsedAt = Date.now();
    let result!: CheckResult;
    await this.enqueue(async () => {
      if (forceRun) {
        result = await this.runWithTimeout(timeoutMs);
        return;
      }

      if (this.dirtyFiles.size) {
        await new Promise((resolve) => setTimeout(resolve, WATCH_SETTLE_MS));
        await this.vitest.waitForTestRunEnd();
        if (
          this.capturedRun
          && (!this.latest || this.capturedRun.completedAt > Date.parse(this.latest.lastRunAt))
        ) {
          result = await this.finalizeCapturedRun();
          return;
        }
        // The changed file was unrelated to this session's selected tests.
        this.dirtyFiles.clear();
      }

      if (!this.latest) result = await this.runWithTimeout(timeoutMs);
      else result = { ...this.latest, cached: true };
    });
    return result;
  }

  private async runWithTimeout(timeoutMs: number): Promise<CheckResult> {
    const invalidatedBy = [...this.dirtyFiles].slice(0, 20);
    const run = this.execute(true);
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<"timed_out">((resolve) => {
      timer = setTimeout(() => {
        resolve("timed_out");
      }, timeoutMs);
    });
    const outcome = await Promise.race([run, timeout]);
    if (timer) clearTimeout(timer);
    if (outcome !== "timed_out") return outcome;

    // Keep this session's queue locked until Vitest has actually stopped. An
    // in-process runner cannot be killed safely without killing the MCP server.
    await this.vitest.cancelCurrentRun("Vitest MCP timeout");
    await run.catch(() => undefined);
    return {
      status: "timed_out",
      tests: emptyTests(),
      durationMs: timeoutMs,
      diagnostics: [`Vitest exceeded the ${timeoutMs}ms timeout`],
      cached: false,
      lastRunAt: new Date().toISOString(),
      invalidatedBy,
    };
  }

  private async execute(rerun: boolean): Promise<CheckResult> {
    const startedAt = Date.now();
    const invalidatedBy = [...this.dirtyFiles].slice(0, 20);
    const collectAllIncludedCoverage = this.options.coveragePattern !== undefined;
    const run = rerun
      ? await this.vitest.rerunTestSpecifications(this.specifications, collectAllIncludedCoverage)
      : await this.vitest.runTestSpecifications(this.specifications, collectAllIncludedCoverage);
    const tests = normalizeModules(run.testModules);
    const unhandled = run.unhandledErrors.map(errorMessage);
    let coverage;
    if (this.options.coveragePattern) {
      coverage = parseCoverageReport(
        JSON.parse(await readFile(path.join(this.coverageDir, "coverage-summary.json"), "utf8")),
        this.options.projectRoot,
      );
    }
    const capturedOutput = this.output.take();
    const capturedErrors = this.errors.take();
    const diagnostics = [...unhandled, capturedErrors, capturedOutput].filter(Boolean).slice(0, 10);
    const result: CheckResult = {
      status: unhandled.length ? "error" : tests.failed ? "failed" : "passed",
      tests,
      coverage,
      durationMs: Date.now() - startedAt,
      diagnostics,
      cached: false,
      lastRunAt: new Date().toISOString(),
      ...(invalidatedBy.length ? { invalidatedBy } : {}),
    };
    this.latest = result;
    this.dirtyFiles.clear();
    this.capturedRun = undefined;
    return result;
  }

  private recordRun(
    modules: readonly ReportedModule[],
    errors: readonly ReportedError[],
    durationMs: number,
  ): void {
    this.capturedRun = { modules, errors, durationMs, completedAt: Date.now() };
  }

  private async finalizeCapturedRun(): Promise<CheckResult> {
    const capture = this.capturedRun!;
    const invalidatedBy = [...this.dirtyFiles].slice(0, 20);
    const tests = normalizeModules(capture.modules);
    const unhandled = capture.errors.map(errorMessage);
    let coverage;
    if (this.options.coveragePattern) {
      coverage = parseCoverageReport(
        JSON.parse(await readFile(path.join(this.coverageDir, "coverage-summary.json"), "utf8")),
        this.options.projectRoot,
      );
    }
    const result: CheckResult = {
      status: unhandled.length ? "error" : tests.failed ? "failed" : "passed",
      tests,
      coverage,
      durationMs: capture.durationMs,
      diagnostics: [...unhandled, this.errors.take(), this.output.take()].filter(Boolean).slice(0, 10),
      cached: true,
      lastRunAt: new Date(capture.completedAt).toISOString(),
      ...(invalidatedBy.length ? { invalidatedBy } : {}),
    };
    this.latest = result;
    this.capturedRun = undefined;
    this.dirtyFiles.clear();
    return result;
  }

  private async enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.operation;
    let release!: () => void;
    this.operation = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    try {
      return await operation();
    } finally {
      release();
    }
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    await this.vitest.close();
    await rm(this.tempDir, { recursive: true, force: true });
  }
}
