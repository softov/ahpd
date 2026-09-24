/**
 * The plugin entry: what the daemon imports when the package is named.
 *
 * `index.ts` re-exports `name` and `apply` from here, so the module the
 * manifest names is the plugin. There is deliberately no default export: the
 * loader refuses a module without a named `apply` rather than guessing which
 * export is the plugin.
 *
 * The daemon has no backend of its own - decision `the-daemon-bundles-no-agent`
 * - so this is how Claude Code reaches a host: one entry in `plugins`, with
 * nothing under `options` in the ordinary install.
 */

import type { PluginHost } from '@ahpd/sdk';
import { claude } from './claude.js';
import type { ClaudeOptions } from './claude.js';

/** The plugin's id, unique among the plugins one daemon loads. */
export const name = '@ahpd/agent-claude';

/**
 * What a listing prints for this package.
 *
 * The manifest's `ahpd.title` carries the same string to `ahpd plugin list`,
 * which must not import the module to read it; this export is for an embedder
 * that imports the entry directly.
 */
export const title = 'Claude';

/** One non-empty string, or nothing for a value this package cannot use. */
const str = (value: unknown): string | undefined =>
  (typeof value === 'string' && value.trim() !== '' ? value : undefined);

/** A list of strings with something in it, or nothing. */
const words = (value: unknown): string[] | undefined => {
  if (!Array.isArray(value)) return undefined;
  const out = value.filter((one): one is string => typeof one === 'string' && one !== '');
  return out.length === 0 ? undefined : out;
};

/**
 * The package's own options, out of whatever the configuration named.
 *
 * `paths` defaults to the host's, which is the whole configuration in the
 * ordinary install: the directories the daemon was started on are the ones
 * this backend lists. A deployment that wants the catalogue narrower than the
 * host names its own.
 *
 * `computerConfigDir` takes `false` as itself, because `false` is a value with
 * a meaning here - leave the image's own configuration directory alone - and
 * not the absence of one.
 */
const optionsOf = (host: PluginHost, values: Record<string, unknown>): ClaudeOptions => {
  const options: ClaudeOptions = { paths: words(values.paths) ?? host.paths };
  const provider = str(values.provider);
  if (provider !== undefined) options.provider = provider;
  const executable = str(values.computerExecutable);
  if (executable !== undefined) options.computerExecutable = executable;
  if (values.computerConfigDir === false) {
    options.computerConfigDir = false;
  } else {
    const configDir = str(values.computerConfigDir);
    if (configDir !== undefined) options.computerConfigDir = configDir;
  }
  return options;
};

/** Register the Claude backend over the directories the host serves. */
export function apply(host: PluginHost, options: Record<string, unknown>): void {
  host.registerAgent(claude(optionsOf(host, options)));
}
