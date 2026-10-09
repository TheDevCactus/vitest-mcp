import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FileTelemetry, silentTelemetry } from "./logger.js";

const cleanup: string[] = [];

afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(cleanup.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("FileTelemetry", () => {
  it("provides a no-op telemetry implementation", async () => {
    silentTelemetry.log("ignored");
    await expect(silentTelemetry.flush()).resolves.toBeUndefined();
  });

  it("writes timestamped, human-readable events in order", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-09T12:00:00.000Z"));
    const directory = await mkdtemp(path.join(os.tmpdir(), "vitest-mcp-telemetry-"));
    cleanup.push(directory);
    const file = path.join(directory, "nested", "server.log");
    const telemetry = new FileTelemetry(file);

    telemetry.log("run_started", { run: 1, pattern: "src/**/*.test.ts", optional: undefined });
    telemetry.log("run_finished", { status: "passed", cached: false });
    await telemetry.flush();

    expect(await readFile(file, "utf8")).toBe(
      '2026-10-09T12:00:00.000Z [run_started] run=1 pattern="src/**/*.test.ts"\n'
      + "2026-10-09T12:00:00.000Z [run_finished] status=passed cached=false\n",
    );
  });

  it("rotates an oversized log before appending", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "vitest-mcp-telemetry-"));
    cleanup.push(directory);
    const file = path.join(directory, "server.log");
    await writeFile(file, "old contents");
    const telemetry = new FileTelemetry(file, 12);

    telemetry.log("new_event");
    await telemetry.flush();

    expect(await readFile(`${file}.1`, "utf8")).toBe("old contents");
    expect(await readFile(file, "utf8")).toContain("[new_event]");
  });

  it("reports write failures without rejecting flush", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "vitest-mcp-telemetry-"));
    cleanup.push(directory);
    const file = path.join(directory, "is-a-directory");
    await mkdir(file);
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const telemetry = new FileTelemetry(file);

    telemetry.log("cannot_write");
    await expect(telemetry.flush()).resolves.toBeUndefined();

    expect(error).toHaveBeenCalledWith(expect.stringContaining("could not write telemetry"));
    error.mockRestore();
  });
});
