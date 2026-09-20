import type { Plugin } from '@ahpd/sdk';
import { echo } from '../../../examples/echo/agent.ts';

/**
 * The example backend, arriving as a plugin.
 *
 * It is the same `echo` the example tests use and the same one the loader
 * loads, so the end-to-end test proves the contract rather than a second
 * implementation of it: a plugin's backend is served exactly as a literal one
 * is, because it is the same object.
 *
 * The import names the real `.ts` file, because Node does not remap a `.js`
 * specifier to a `.ts` one - the fixture has to match what the runtime
 * resolves, and `echo`'s own imports are type-only and so are erased.
 *
 * There is no default export on purpose: `apply` is the contract, and a module
 * that only had a default would be refused rather than guessed at.
 */

export const name = 'echo-plugin';

export const apply: Plugin['apply'] = (host) => {
  // `pace: 0` so the end-to-end test answers in one turn rather than streaming
  // a word at a time; the backend is the example's either way.
  host.registerAgent(echo({ path: host.path, pace: 0 }));
};
