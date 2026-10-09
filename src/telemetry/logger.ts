import { appendFile, mkdir, rename, stat } from "node:fs/promises";
import path from "node:path";

export interface Telemetry {
  log(event: string, details?: Record<string, unknown>): void;
  flush(): Promise<void>;
}

export const silentTelemetry: Telemetry = {
  log: () => undefined,
  flush: async () => undefined,
};

function formatValue(value: unknown): string {
  if (typeof value === "string" && /^[\w./:@-]+$/.test(value)) return value;
  return JSON.stringify(value);
}

export class FileTelemetry implements Telemetry {
  private pending: Promise<void> = Promise.resolve();

  constructor(
    readonly file: string,
    private readonly maxBytes = 5 * 1024 * 1024,
  ) {}

  log(event: string, details: Record<string, unknown> = {}): void {
    const fields = Object.entries(details)
      .filter(([, value]) => value !== undefined)
      .map(([key, value]) => `${key}=${formatValue(value)}`)
      .join(" ");
    const line = `${new Date().toISOString()} [${event}]${fields ? ` ${fields}` : ""}\n`;
    this.pending = this.pending.then(() => this.write(line)).catch((error: unknown) => {
      console.error(`vitest-mcp could not write telemetry: ${error instanceof Error ? error.message : String(error)}`);
    });
  }

  flush(): Promise<void> {
    return this.pending;
  }

  private async write(line: string): Promise<void> {
    await mkdir(path.dirname(this.file), { recursive: true });
    const size = await stat(this.file).then((value) => value.size).catch(() => 0);
    if (size + Buffer.byteLength(line) > this.maxBytes) {
      await rename(this.file, `${this.file}.1`).catch(() => undefined);
    }
    await appendFile(this.file, line, "utf8");
  }
}
