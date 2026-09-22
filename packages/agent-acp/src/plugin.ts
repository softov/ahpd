/**
 * The plugin entry: what the daemon imports when the package is named.
 *
 * `index.ts` re-exports `name` and `apply` from here, so the module the
 * manifest names is the plugin. There is deliberately no default export: the
 * loader refuses a module without a named `apply` rather than guessing which
 * export is the plugin.
 *
 * One spec is one ACP server. The command is what tells two of them apart, so
 * two specs with two commands and two providers are two backends rather than a
 * collision - which is how one package serves Copilot and Codex at once.
 */

import type { PluginHost } from '@ahpd/sdk';
import { acpAgent } from './agent.js';
import type { AcpOptions } from './types.js';

/** The plugin's id, unique among the plugins one daemon loads. */
export const name = '@ahpd/agent-acp';

/**
 * What a listing prints for this package.
 *
 * The manifest's `ahpd.title` carries the same string to `ahpd plugin list`,
 * which must not import the module to read it; this export is for an embedder
 * that imports the entry directly.
 */
export const title = 'ACP';

/** One non-empty string, or nothing for a value this package cannot use. */
const str = (value: unknown): string | undefined =>
  (typeof value === 'string' && value.trim() !== '' ? value : undefined);

/** A list of strings with something in it, or nothing. */
const words = (value: unknown): string[] | undefined => {
  if (!Array.isArray(value)) return undefined;
  const out = value.filter((one): one is string => typeof one === 'string' && one !== '');
  return out.length === 0 ? undefined : out;
};

/** The string entries of an object, or nothing when it has none. */
const strings = (value: unknown): Record<string, string> | undefined => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const out: Record<string, string> = {};
  for (const [key, held] of Object.entries(value as Record<string, unknown>)) {
    if (typeof held === 'string') out[key] = held;
  }
  return Object.keys(out).length === 0 ? undefined : out;
};

/**
 * The package's own options, out of whatever the configuration named.
 *
 * Every key but `command` is taken only when it has the type `AcpOptions`
 * declared for it, so a value the configuration misspelled is dropped rather
 * than thrown over. `command` is the exception and the reason is plain: a
 * backend with nothing to spawn is not a backend that runs badly, it is one
 * that cannot run at all, and saying so at load is better than failing on the
 * first turn.
 */
const optionsOf = (values: Record<string, unknown>): AcpOptions => {
  const command = str(values.command);
  if (command === undefined) {
    throw new Error('@ahpd/agent-acp needs a "command": the ACP server program to spawn');
  }

  const options: AcpOptions = { command };
  const args = words(values.args);
  if (args !== undefined) options.args = args;
  const env = strings(values.env);
  if (env !== undefined) options.env = env;
  const cwd = str(values.cwd);
  if (cwd !== undefined) options.cwd = cwd;
  const provider = str(values.provider);
  if (provider !== undefined) options.provider = provider;
  const displayName = str(values.displayName);
  if (displayName !== undefined) options.displayName = displayName;
  const description = str(values.description);
  if (description !== undefined) options.description = description;
  const model = str(values.model);
  if (model !== undefined) options.model = model;
  return options;
};

/**
 * Register one ACP backend from the plugin's own options.
 *
 * The provider is per registration rather than per package, so two specs with
 * two commands and two providers are two backends that do not collide.
 */
export function apply(host: PluginHost, options: Record<string, unknown>): void {
  host.registerAgent(acpAgent(optionsOf(options)));
}
