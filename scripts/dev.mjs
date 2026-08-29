import { register } from 'node:module';

/**
 * Registers the resolver, for `node --import ./scripts/dev.mjs`.
 *
 * Separate from the hooks themselves because `register` loads them into their
 * own thread: a module that registered itself would be re-entered there and
 * register again.
 */
register('./dev-hooks.mjs', import.meta.url);
