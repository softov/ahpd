/**
 * The plugin entry: what the daemon imports when the package is named.
 *
 * `index.ts` re-exports `name` and `apply` from here, so the module the
 * manifest names is the plugin. There is deliberately no default export: the
 * loader refuses a module without a named `apply` rather than guessing which
 * export is the plugin, and a silent guess is worse than a refusal.
 *
 * The model adapter is not a configuration option in practice. A configuration
 * file is JSON and cannot carry a function or an object with methods, so the
 * only caller that puts one in `options` is an embedder or a test; the real
 * path is the OpenAI-compatible endpoint the session config selects, and the
 * API key for it belongs in the daemon's environment rather than in a setting
 * a client sends.
 */

import type { ModelAdapter, Policy } from '@cofold/agents';
import type { PluginHost } from '@ahpd/sdk';
import { cofoldAgent } from './agent.js';
import type { CofoldOptions } from './agent.js';

/** The plugin's id, unique among the plugins one daemon loads. */
export const name = '@ahpd/agent-cofold';

/**
 * What a listing prints for this package.
 *
 * The manifest's `ahpd.title` carries the same string to `ahpd plugin list`,
 * which must not import the module to read it; this export is for an embedder
 * that imports the entry directly.
 */
export const title = 'Cofold';

/** One non-empty string, or nothing for a value this package cannot use. */
const str = (value: unknown): string | undefined =>
  (typeof value === 'string' && value.trim() !== '' ? value : undefined);

/**
 * The package's own options, out of whatever the configuration named.
 *
 * Every key is taken only when it has the type `cofoldAgent` declared for it,
 * so a value the configuration misspelled is dropped rather than thrown over:
 * `apply` must not fail over an option it does not understand. A key this
 * does not name is ignored the same way, which leaves any option cofold adds
 * later to cofold's own handling instead of this file's.
 */
const optionsOf = (values: Record<string, unknown>): CofoldOptions => {
  const options: CofoldOptions = {};

  const provider = str(values.provider);
  if (provider !== undefined) options.provider = provider;
  const displayName = str(values.displayName);
  if (displayName !== undefined) options.displayName = displayName;
  const description = str(values.description);
  if (description !== undefined) options.description = description;
  const baseUrl = str(values.baseUrl);
  if (baseUrl !== undefined) options.baseUrl = baseUrl;
  const model = str(values.model);
  if (model !== undefined) options.model = model;
  const instructions = str(values.instructions);
  if (instructions !== undefined) options.instructions = instructions;
  const store = str(values.store);
  if (store !== undefined) options.store = store;
  const resource = str(values.resource);
  if (resource !== undefined) options.resource = resource;

  if (typeof values.memory === 'boolean') options.memory = values.memory;

  // A key is either a literal or a function asked once per request, so an
  // expired one is not cached; both are things JSON cannot carry.
  const apiKey = values.apiKey;
  if (typeof apiKey === 'string') options.apiKey = apiKey;
  else if (typeof apiKey === 'function') options.apiKey = apiKey as () => string | Promise<string>;

  /*
   * The two seams an embedder has and a configuration does not: a model
   * adapter to use instead of the OpenAI-compatible one, and the run-level
   * policy an approval comes from. Both are checked only for being objects,
   * because the contracts are structural and cofold is what will use them.
   */
  if (typeof values.adapter === 'object' && values.adapter !== null) {
    options.adapter = values.adapter as ModelAdapter;
  }
  if (typeof values.policy === 'object' && values.policy !== null && !Array.isArray(values.policy)) {
    options.policy = values.policy as Partial<Policy>;
  }

  return options;
};

/**
 * Register provider `cofold` from the plugin's own options.
 *
 * The provider is per registration rather than per package, so two specs with
 * two providers and two stores are two backends that do not collide, which is
 * how one package serves several endpoints at once.
 */
export function apply(host: PluginHost, options: Record<string, unknown>): void {
  host.registerAgent(cofoldAgent(optionsOf(options)));
}
