import { it } from "vitest";
it("waits", async () => new Promise((resolve) => setTimeout(resolve, 2_000)));
