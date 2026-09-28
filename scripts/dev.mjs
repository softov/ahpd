import module from 'node:module';
import { resolveSync } from './dev-hooks.mjs';

/**
 * Registers the resolver, for `node --import ./scripts/dev.mjs`.
 *
 * `registerHooks` runs the hook on this thread, so a module resolved through
 * it costs a function call. `register` is for a Node older than 22.15 or 23.5
 * that lacks it: it loads the hooks into their own thread, and every resolve
 * waits on a message to and from there.
 *
 * Separate from the hooks themselves because `register` loads them into that
 * thread: a module that registered itself would be re-entered there and
 * register again.
 */
if (typeof module.registerHooks === 'function') {
  module.registerHooks({ resolve: resolveSync });
} else {
  module.register('./dev-hooks.mjs', import.meta.url);
}
