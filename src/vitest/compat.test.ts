import { describe, expect, it, vi } from "vitest";
import { createProjectVitest, initializeVitest } from "./compat.js";

describe("Vitest version compatibility", () => {
  it("uses the Vitest 5 standalone initializer when present", async () => {
    const standalone = vi.fn();
    const init = vi.fn();
    await initializeVitest({ standalone, init });
    expect(standalone).toHaveBeenCalledOnce();
    expect(init).not.toHaveBeenCalled();
  });

  it("falls back to the Vitest 4 initializer", async () => {
    const init = vi.fn();
    await initializeVitest({ init });
    expect(init).toHaveBeenCalledOnce();
  });

  it("rejects unsupported initialization APIs", async () => {
    await expect(initializeVitest({})).rejects.toThrow("supported initialization API");
  });

  it("calls the four-argument Vitest 4 factory", async () => {
    const factory = vi.fn(async function vitest4(_mode: unknown, _options: unknown) { return "v4"; });
    await expect(createProjectVitest(factory, { root: "/repo" }, { stdout: "stream" })).resolves.toBe("v4");
    expect(factory).toHaveBeenCalledWith("test", { root: "/repo" }, {}, { stdout: "stream" });
  });

  it("calls the three-argument Vitest 5 factory", async () => {
    const factory = vi.fn(async (_options: unknown) => "v5");
    await expect(createProjectVitest(factory, { root: "/repo" }, { stdout: "stream" })).resolves.toBe("v5");
    expect(factory).toHaveBeenCalledWith({ root: "/repo" }, {}, { stdout: "stream" });
  });
});
