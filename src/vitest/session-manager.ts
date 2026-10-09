import type { CheckResult } from "../domain/result.js";
import type { SessionOptions } from "./session.js";
import { VitestSession } from "./session.js";

const DEFAULT_IDLE_TTL_MS = 10 * 60_000;

export class VitestSessionManager {
  private readonly sessions = new Map<string, Promise<VitestSession>>();
  private readonly sweepTimer: NodeJS.Timeout;

  constructor(private readonly idleTtlMs = DEFAULT_IDLE_TTL_MS) {
    this.sweepTimer = setInterval(() => void this.evictIdle(), Math.min(idleTtlMs, 60_000));
    this.sweepTimer.unref();
  }

  async check(options: SessionOptions, forceRun: boolean, timeoutMs: number): Promise<CheckResult> {
    const key = JSON.stringify([options.projectRoot, options.testPattern ?? null, options.coveragePattern ?? null]);
    let sessionPromise = this.sessions.get(key);
    if (!sessionPromise) {
      sessionPromise = VitestSession.create(key, options);
      this.sessions.set(key, sessionPromise);
      sessionPromise.catch(() => this.sessions.delete(key));
    }
    return (await sessionPromise).check(forceRun, timeoutMs);
  }

  private async evictIdle(): Promise<void> {
    const cutoff = Date.now() - this.idleTtlMs;
    for (const [key, sessionPromise] of this.sessions) {
      const session = await sessionPromise.catch(() => undefined);
      if (session && session.lastUsedAt < cutoff) {
        this.sessions.delete(key);
        await session.close();
      }
    }
  }

  async close(): Promise<void> {
    clearInterval(this.sweepTimer);
    const sessions = [...this.sessions.values()];
    this.sessions.clear();
    await Promise.all(sessions.map(async (session) => (await session).close()));
  }
}
