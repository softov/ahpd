/**
 * The plugin entry: what the daemon imports when the package is named.
 *
 * `index.ts` re-exports `name`, `apply` and `optionsSchema` from here, so the
 * module the manifest names is the plugin. There is deliberately no default
 * export: the loader refuses a module without a named `apply` rather than
 * guessing which export is the plugin.
 *
 * The daemon has no backend of its own - decision `the-daemon-bundles-no-agent`
 * - so this is how Claude Code reaches a host: one entry in `plugins`, with
 * nothing under `options` in the ordinary install.
 */

import { modelsProblem } from './models.js';
import type { PluginHost } from '@ahpd/sdk';
import { claude } from './claude.js';
import type { ClaudeOptions } from './claude.js';
import { presetSchema } from './options.js';

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

/**
 * The options `apply` receives, as a JSON Schema the daemon checks them against
 * before `apply` runs.
 */
export const optionsSchema = {
  type: 'object',
  properties: {
    paths: { type: 'array', items: { type: 'string' }, description: "The directories it catalogues, and where a session goes by default. Defaults to the host's." },
    provider: { type: 'string', description: 'The id clients name. claude unless something else already is.' },
    displayName: { type: 'string', description: 'What a client reads instead of the id, default Claude Code.' },
    models: {
      type: 'array',
      description: 'The models offered: an id, { id, name }, or { fetch, match, key } reading an endpoint model list. Replaces the CLI list unless keepCliModels.',
    },
    keepCliModels: { type: 'boolean', description: 'With models, add them to the CLI model list rather than replace it.' },
    computerExecutable: { type: 'string', description: "Where the CLI is inside a machine. claude on the image's PATH by default." },
    computerConfigDir: {
      anyOf: [{ type: 'string' }, { const: false }],
      description: "The configuration directory the CLI reads inside a machine. /ahpd/claude by default; false leaves the image's own.",
    },
    workerStop: { type: 'string', enum: ['worker', 'session'], description: "What a stop given in a subagent's chat stops. worker by default." },
    presets: {
      type: 'object',
      description: 'Named sets of Claude options, by name. One is what every session runs on; two or more offer a session a choice, and the first is the default.',
    },
  },
};

/**
 * The package's own options, out of values `optionsSchema` has checked.
 *
 * `paths` defaults to the host's, which is the whole configuration in the
 * ordinary install: the directories the daemon was started on are the ones
 * this backend lists. A deployment that wants the catalogue narrower than the
 * host names its own.
 *
 * `presets` is the one option whose contents `optionsSchema` cannot check: it
 * says a preset is an object, and what a preset holds is checked here against
 * the same declarations the session keys are made of. That a wrong preset is
 * the daemon refusing to load this package rather than a session quietly
 * running on something nobody wrote.
 */
const optionsOf = (host: PluginHost, values: Record<string, unknown>): ClaudeOptions => {
  const said = values as Partial<ClaudeOptions>;
  if (said.presets !== undefined) {
    for (const [name, preset] of Object.entries(said.presets)) {
      const wrong = presetSchema(preset, `options.presets.${name}`);
      if (wrong !== undefined) throw new Error(wrong);
    }
  }
  const wrong = modelsProblem(said.models);
  if (wrong !== undefined) throw new Error(wrong);
  return { ...said, paths: said.paths ?? host.paths, log: (line) => host.log(line) };
};

/** Register the Claude backend over the directories the host serves. */
export function apply(host: PluginHost, options: Record<string, unknown>): void {
  host.registerAgent(claude(optionsOf(host, options)));
}
