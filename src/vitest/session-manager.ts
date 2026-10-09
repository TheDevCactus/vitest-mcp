import type { CheckResult } from "../domain/result.js";
import type { Telemetry } from "../telemetry/logger.js";
import { silentTelemetry } from "../telemetry/logger.js";
import type { SessionOptions } from "./session.js";
import { VitestSession } from "./session.js";

const DEFAULT_IDLE_TTL_MS = 10 * 60_000;
const HEARTBEAT_INTERVAL_MS = 5_000;

export class VitestSessionManager {
  private readonly sessions = new Map<string, Promise<VitestSession>>();
  private readonly sweepTimer: NodeJS.Timeout;
  private nextRunId = 1;

  constructor(
    private readonly idleTtlMs = DEFAULT_IDLE_TTL_MS,
    private readonly telemetry: Telemetry = silentTelemetry,
  ) {
    this.sweepTimer = setInterval(() => void this.evictIdle(), Math.min(idleTtlMs, 60_000));
    this.sweepTimer.unref();
  }

  async check(options: SessionOptions, forceRun: boolean, timeoutMs: number): Promise<CheckResult> {
    const runId = this.nextRunId++;
    const startedAt = Date.now();
    const key = JSON.stringify([options.projectRoot, options.testPattern ?? null, options.coveragePattern ?? null]);
    let sessionPromise = this.sessions.get(key);
    const reusedSession = sessionPromise !== undefined;
    this.telemetry.log("run_started", {
      runId,
      projectRoot: options.projectRoot,
      testPattern: options.testPattern ?? "all tests",
      coveragePattern: options.coveragePattern ?? "disabled",
      forceRun,
      timeoutMs,
      session: reusedSession ? "reused" : "created",
    });
    if (!sessionPromise) {
      sessionPromise = VitestSession.create(key, options);
      this.sessions.set(key, sessionPromise);
      sessionPromise.catch(() => this.sessions.delete(key));
    }
    const heartbeat = setInterval(() => {
      this.telemetry.log("run_still_running", { runId, elapsedMs: Date.now() - startedAt });
    }, HEARTBEAT_INTERVAL_MS);
    heartbeat.unref();
    try {
      const result = await (await sessionPromise).check(forceRun, timeoutMs);
      this.telemetry.log("run_finished", {
        runId,
        status: result.status,
        durationMs: Date.now() - startedAt,
        testsTotal: result.tests.total,
        testsPassed: result.tests.passed,
        testsFailed: result.tests.failed,
        testsSkipped: result.tests.skipped,
        cached: result.cached,
        invalidatedBy: result.invalidatedBy,
      });
      return result;
    } catch (error) {
      this.telemetry.log("run_error", {
        runId,
        durationMs: Date.now() - startedAt,
        message: error instanceof Error ? error.message : String(error),
      });
      throw error;
    } finally {
      clearInterval(heartbeat);
    }
  }

  private async evictIdle(): Promise<void> {
    const cutoff = Date.now() - this.idleTtlMs;
    for (const [key, sessionPromise] of this.sessions) {
      const session = await sessionPromise.catch(() => undefined);
      if (session && session.lastUsedAt < cutoff) {
        this.sessions.delete(key);
        this.telemetry.log("session_evicted", { key, idleMs: Date.now() - session.lastUsedAt });
        await session.close();
      }
    }
  }

  async close(): Promise<void> {
    clearInterval(this.sweepTimer);
    const sessions = [...this.sessions.values()];
    this.sessions.clear();
    await Promise.all(sessions.map(async (session) => (await session).close()));
    this.telemetry.log("sessions_closed", { count: sessions.length });
  }
}
