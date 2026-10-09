import path from "node:path";
import { realpath } from "node:fs/promises";

export function parseAllowedRoots(value: string | undefined, fallback: string): string[] {
  const roots = value?.split(path.delimiter).filter(Boolean) ?? [fallback];
  return roots.map((root) => path.resolve(root));
}

export async function resolveAllowedProjectRoot(
  requestedRoot: string | undefined,
  allowedRoots: string[],
): Promise<string> {
  const resolved = await realpath(path.resolve(requestedRoot ?? process.cwd()));
  const canonicalAllowedRoots = await Promise.all(allowedRoots.map((root) => realpath(root)));
  const allowed = canonicalAllowedRoots.some(
    (root) => resolved === root || resolved.startsWith(`${root}${path.sep}`),
  );

  if (!allowed) {
    throw new Error(`Project root is outside the configured allowed roots: ${resolved}`);
  }

  return resolved;
}

export function validatePattern(pattern: string | undefined, name: string): void {
  if (!pattern) return;
  if (pattern.startsWith("-") || path.isAbsolute(pattern)) {
    throw new Error(`${name} must be a project-relative pattern and cannot start with '-'`);
  }
  if (pattern.split(/[\\/]/).includes("..")) {
    throw new Error(`${name} cannot traverse outside the project`);
  }
}
