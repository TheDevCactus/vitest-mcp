export interface InitializableVitest {
  standalone?: () => Promise<void>;
  init?: () => Promise<void>;
}

export type VitestFactory<T> = (...args: unknown[]) => Promise<T>;

export async function initializeVitest(vitest: InitializableVitest): Promise<void> {
  if (vitest.standalone) await vitest.standalone();
  else if (vitest.init) await vitest.init();
  else throw new Error("Project Vitest does not expose a supported initialization API");
}

export function createProjectVitest<T>(
  createVitest: VitestFactory<T>,
  options: Record<string, unknown>,
  runtimeOptions: Record<string, unknown>,
): Promise<T> {
  // Vitest 4 takes (mode, options, viteOverrides, runtimeOptions). Vitest 5
  // removed the mode argument. Function.length distinguishes those releases.
  return createVitest.length >= 2
    ? createVitest("test", options, {}, runtimeOptions)
    : createVitest(options, {}, runtimeOptions);
}
