/*
 * A fixture whose entry must never run.
 *
 * It declares `@ahpd/sdk@^0.11.0`, which the daemon this checkout builds does
 * not satisfy, so the range check has to refuse it before `import()` is
 * reached. Setting a global as the very first thing is how the test knows the
 * check came first: if this module ever runs, the flag is there.
 */

(globalThis as Record<string, unknown>).__pluginIncompatibleImported = true;

export const name = 'incompatible';

export function apply(): void {
  throw new Error('the incompatible fixture must never be imported');
}
