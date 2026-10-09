import { afterEach, describe, expect, it, vi } from "vitest";
import type { CheckResult } from "../domain/result.js";
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

afterEach(() => vi.restoreAllMocks());

describe("VitestSessionManager", () => {
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
});
