/**
 * The plugin entry: what the daemon imports when the package is named.
 *
 * `index.ts` re-exports `name`, `apply` and `optionsSchema` from here, so the
 * module the manifest names is the plugin. There is deliberately no default
 * export: the loader refuses a module without a named `apply` rather than
 * guessing which export is the plugin.
 *
 * One spec is one pi backend. Two specs with two providers would be two
 * backends on two sets of defaults rather than a collision, which is what
 * makes `provider` an option rather than a constant.
 */

import type { PluginHost } from '@ahpd/sdk';
import { piAgent } from './agent.js';
import { loadPi } from './pi.js';
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

/**
 * The options `apply` receives, as a JSON Schema the daemon checks them against
 * before `apply` runs.
 *
 * `projectTrust` has no `ask`, pi's third answer: there is nobody at a
 * terminal, and a prompt nothing can answer is a session that never starts.
 */
export const optionsSchema = {
  type: 'object',
  properties: {
    provider: { type: 'string', description: 'The id a client names in createSession. pi by default.' },
    displayName: { type: 'string', description: 'What a person reads instead of the id. pi by default.' },
    description: { type: 'string', description: 'One line about this backend.' },
    model: { type: 'string', description: 'The model a new session runs on, as provider/modelId.' },
    projectTrust: {
      type: 'string',
      enum: ['trust', 'deny'],
      description: "Whether a project's own pi extensions, skills and prompts are loaded. trust by default.",
    },
    sessionDir: { type: 'string', description: "Where pi keeps its sessions. pi's own by default." },
  },
};

/**
 * The package's own options, out of values `optionsSchema` has checked.
 *
 * There is no required option: pi needs a directory and a model provider, and
 * both are already its own to resolve.
 */
export const optionsOf = (values: Record<string, unknown>): PiOptions => values as PiOptions;

/**
 * Register one pi backend from the plugin's own options.
 *
 * pi's SDK starts loading here and is not waited for, so the daemon does not
 * start seconds later for it; the first call that needs pi waits instead. A
 * load that fails here is tried again by that call.
 */
export function apply(host: PluginHost, values: Record<string, unknown>): void {
  host.registerAgent(piAgent(optionsOf(values), host.paths));
  loadPi().catch(() => {});
}
