import { afterEach, describe, expect, it, vi } from "vitest";
import type { CheckResult } from "../domain/result.js";
import type { Telemetry } from "../telemetry/logger.js";
import { VitestSession } from "./session.js";
import { VitestSessionManager } from "./session-manager.js";

const result: CheckResult = {
  status: "passed",
  tests: { total: 0, passed: 0, failed: 0, skipped: 0, failures: [] },
  durationMs: 1,
  diagnostics: [],
  cached: false,
  lastRunAt: new Date().toISOString(),
};

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("VitestSessionManager", () => {
  it("logs run lifecycle events and heartbeats", async () => {
    vi.useFakeTimers();
    let finish!: (value: CheckResult) => void;
    const running = new Promise<CheckResult>((resolve) => { finish = resolve; });
    const fake = { check: vi.fn().mockReturnValue(running), close: vi.fn(), lastUsedAt: Date.now() };
    vi.spyOn(VitestSession, "create").mockResolvedValue(fake as unknown as VitestSession);
    const telemetry = { log: vi.fn(), flush: vi.fn() } as unknown as Telemetry;
    const manager = new VitestSessionManager(60_000, telemetry);

    const check = manager.check({ projectRoot: "/repo", testPattern: "unit" }, true, 10_000);
    await vi.advanceTimersByTimeAsync(5_000);
    finish(result);
    await check;

    expect(telemetry.log).toHaveBeenCalledWith("run_started", expect.objectContaining({
      runId: 1,
      testPattern: "unit",
      session: "created",
    }));
    expect(telemetry.log).toHaveBeenCalledWith("run_still_running", expect.objectContaining({
      runId: 1,
      elapsedMs: 5_000,
    }));
    expect(telemetry.log).toHaveBeenCalledWith("run_finished", expect.objectContaining({
      runId: 1,
      status: "passed",
    }));
    await manager.close();
  });

  it("logs run errors and rethrows them", async () => {
    const fake = {
      check: vi.fn().mockRejectedValue(new Error("run exploded")),
      close: vi.fn(),
      lastUsedAt: Date.now(),
    };
    vi.spyOn(VitestSession, "create").mockResolvedValue(fake as unknown as VitestSession);
    const telemetry = { log: vi.fn(), flush: vi.fn() } as unknown as Telemetry;
    const manager = new VitestSessionManager(60_000, telemetry);

    await expect(manager.check({ projectRoot: "/repo" }, false, 1_000)).rejects.toThrow("run exploded");
    expect(telemetry.log).toHaveBeenCalledWith("run_error", expect.objectContaining({
      runId: 1,
      message: "run exploded",
    }));
    await manager.close();
  });

  it("reuses equal sessions and separates different selections", async () => {
    const fake = { check: vi.fn().mockResolvedValue(result), close: vi.fn(), lastUsedAt: Date.now() };
    const create = vi.spyOn(VitestSession, "create").mockResolvedValue(fake as unknown as VitestSession);
    const manager = new VitestSessionManager();

    await manager.check({ projectRoot: "/repo" }, false, 1_000);
    await manager.check({ projectRoot: "/repo" }, true, 2_000);
    await manager.check({ projectRoot: "/repo", testPattern: "one" }, false, 1_000);

    expect(create).toHaveBeenCalledTimes(2);
    expect(fake.check).toHaveBeenNthCalledWith(2, true, 2_000);
    await manager.close();
    expect(fake.close).toHaveBeenCalledTimes(2);
  });

  it("removes failed session creation so a later check can retry", async () => {
    const fake = { check: vi.fn().mockResolvedValue(result), close: vi.fn(), lastUsedAt: Date.now() };
    const create = vi.spyOn(VitestSession, "create")
      .mockRejectedValueOnce(new Error("startup failed"))
      .mockResolvedValueOnce(fake as unknown as VitestSession);
    const manager = new VitestSessionManager();

    await expect(manager.check({ projectRoot: "/repo" }, false, 1_000)).rejects.toThrow("startup failed");
    await expect(manager.check({ projectRoot: "/repo" }, false, 1_000)).resolves.toBe(result);
    expect(create).toHaveBeenCalledTimes(2);
    await manager.close();
  });

  it("evicts idle sessions", async () => {
    const fake = { check: vi.fn().mockResolvedValue(result), close: vi.fn(), lastUsedAt: 0 };
    vi.spyOn(VitestSession, "create").mockResolvedValue(fake as unknown as VitestSession);
    const manager = new VitestSessionManager(1);
    await manager.check({ projectRoot: "/repo" }, false, 1_000);

    await (manager as unknown as { evictIdle(): Promise<void> }).evictIdle();
    expect(fake.close).toHaveBeenCalledOnce();
    await manager.close();
  });

  it("periodically sweeps idle sessions", async () => {
    vi.useFakeTimers();
    const fake = { check: vi.fn().mockResolvedValue(result), close: vi.fn(), lastUsedAt: 0 };
    vi.spyOn(VitestSession, "create").mockResolvedValue(fake as unknown as VitestSession);
    const manager = new VitestSessionManager(10);
    await manager.check({ projectRoot: "/repo" }, false, 1_000);

    await vi.advanceTimersByTimeAsync(10);

    expect(fake.close).toHaveBeenCalledOnce();
    await manager.close();
  });
});
