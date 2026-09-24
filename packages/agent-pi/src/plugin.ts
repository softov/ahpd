/**
 * The plugin entry: what the daemon imports when the package is named.
 *
 * `index.ts` re-exports `name` and `apply` from here, so the module the
 * manifest names is the plugin. There is deliberately no default export: the
 * loader refuses a module without a named `apply` rather than guessing which
 * export is the plugin.
 *
 * One spec is one pi backend. Two specs with two providers would be two
 * backends on two sets of defaults rather than a collision, which is what
 * makes `provider` an option rather than a constant.
 */

import type { PluginHost } from '@ahpd/sdk';
import { piAgent } from './agent.js';
import type { PiOptions } from './types.js';

/** The plugin's id, unique among the plugins one daemon loads. */
export const name = '@ahpd/agent-pi';

/**
 * What a listing prints for this package.
 *
 * The manifest's `ahpd.title` carries the same string to `ahpd plugin list`,
 * which must not import the module to read it; this export is for an embedder
 * that imports the entry directly.
 */
export const title = 'pi';

/** What an option falls back to. */
export const defaults = {
  provider: 'pi',
  displayName: 'pi',
  projectTrust: 'trust',
} as const;

/** One non-empty string, or nothing for a value this package cannot use. */
const str = (value: unknown): string | undefined =>
  (typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined);

/**
 * The package's own options, out of whatever the configuration named.
 *
 * Every key is taken only when it has the type `PiOptions` declares for it, so
 * a misspelled value costs its own setting rather than the plugin. There is no
 * required option: pi needs a directory and a model provider, and both are
 * already its own to resolve.
 */
export const optionsOf = (values: Record<string, unknown>): PiOptions => {
  const options: PiOptions = {};
  const provider = str(values.provider);
  if (provider !== undefined) options.provider = provider;
  const displayName = str(values.displayName);
  if (displayName !== undefined) options.displayName = displayName;
  const description = str(values.description);
  if (description !== undefined) options.description = description;
  const model = str(values.model);
  if (model !== undefined) options.model = model;
  const sessionDir = str(values.sessionDir);
  if (sessionDir !== undefined) options.sessionDir = sessionDir;
  /*
   * `ask` is pi's third answer and not one a daemon can give: there is nobody
   * at a terminal, and a prompt nothing can answer is a session that never
   * starts. Anything but `deny` is `trust`, which is pi's own default.
   */
  const trust = str(values.projectTrust);
  if (trust !== undefined) options.projectTrust = trust === 'deny' ? 'deny' : 'trust';
  return options;
};

/** Register one pi backend from the plugin's own options. */
export function apply(host: PluginHost, values: Record<string, unknown>): void {
  host.registerAgent(piAgent(optionsOf(values), host.paths));
}
