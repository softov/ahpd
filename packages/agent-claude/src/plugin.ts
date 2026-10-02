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

import type { ModelEntry } from './models.js';
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
    computerExecutable: { type: 'string', description: "Where the CLI is inside a machine. claude on the image's PATH by default." },
    computerConfigDir: {
      anyOf: [{ type: 'string' }, { const: false }],
      description: "The configuration directory the CLI reads inside a machine. /ahpd/claude by default; false leaves the image's own.",
    },
    workerStop: { type: 'string', enum: ['worker', 'session'], description: "What a stop given in a subagent's chat stops. worker by default." },
    presets: {
      type: 'object',
      description: 'The variants this package registers an agent for, by the id clients name. The built-in claude is here unless it is false, and each key registers an agent of its own with its own name, models and options.',
      // A preset is a bag of options by whatever name it is given, so what a
      // preset holds is the declaration below rather than `properties`. The two
      // types are one shape written two ways: `false` drops the variant, and
      // the object says what it holds.
      additionalProperties: {
        type: ['object', 'boolean'],
        properties: {
          name: { type: 'string', description: 'What a client reads instead of the id, which is this key. Defaults to the key.' },
          models: {
            type: 'array',
            description: 'The models offered: an id, { id, name }, or { fetch, match, key } reading an endpoint model list. Replaces the CLI list unless keepCliModels.',
          },
          keepCliModels: { type: 'boolean', description: 'With models, add them to the CLI model list rather than replace it.' },
          // The variables of a preset's `env` are credentials wherever the CLI
          // keeps one, so each answers `<set>` rather than what it is.
          env: { type: 'object', additionalProperties: { type: ['string', 'null'], writeOnly: true }, description: 'Environment the CLI is run with, by variable name.' },
        },
      },
    },
  },
};

/** What a preset is before it is split into the agent's own fields. */
interface Variant extends Record<string, unknown> {
  /** The id clients name, which is the preset's key. */
  id: string;
  /** What a client reads instead of the id. */
  name: string;
}

/** The key of the built-in, which is registered unless a preset says otherwise. */
const BUILT_IN = 'claude';

/**
 * The variants a load registers an agent for, the built-in first.
 *
 * The built-in is `claude` as Claude Code has always run here, kept unless it is
 * written `false`, with an object under its key laid over it. Every other key is
 * a variant of its own, named after itself, in the order it was written.
 */
const variantsOf = (presets: Record<string, unknown>): Variant[] => {
  const out: Variant[] = [];
  const builtIn = bagOf(presets[BUILT_IN]);
  if (presets[BUILT_IN] !== false) out.push({ ...builtIn, id: BUILT_IN, name: named(builtIn, 'Claude Code') });
  for (const [id, given] of Object.entries(presets)) {
    if (id === BUILT_IN || given === false) continue;
    const variant = bagOf(given);
    out.push({ ...variant, id, name: named(variant, id) });
  }
  return out;
};

/** A preset as an object, however it was written. */
const bagOf = (value: unknown): Record<string, unknown> =>
  (typeof value === 'object' && value !== null && !Array.isArray(value) ? value : {}) as Record<string, unknown>;

/** The name a variant was given, or the one it defaults to. */
const named = (variant: Record<string, unknown>, fallback: string): string =>
  typeof variant['name'] === 'string' ? variant['name'] : fallback;

/**
 * One agent's options per variant, out of values `optionsSchema` has checked.
 *
 * `paths` defaults to the host's, which is the whole configuration in the
 * ordinary install: the directories the daemon was started on are the ones
 * this backend lists. A deployment that wants the catalogue narrower than the
 * host names its own.
 *
 * `presets` is the one option whose contents `optionsSchema` cannot check: it
 * says a preset is an object, and what a preset holds is checked here against
 * the same declarations the session keys are made of. That a wrong preset is
 * the daemon refusing to load this package rather than an agent quietly
 * running as something nobody wrote.
 */
const optionsOf = (host: PluginHost, values: Record<string, unknown>): ClaudeOptions[] => {
  for (const key of ['provider', 'displayName', 'models', 'keepCliModels']) {
    if (values[key] !== undefined) throw new Error(`options.${key} is written per variant, as presets.<id>.${key}`);
  }
  const said = values as Partial<ClaudeOptions> & { presets?: Record<string, unknown> };
  const presets = said.presets ?? {};
  for (const [id, preset] of Object.entries(presets)) {
    if (preset === false) continue;
    const wrong = presetSchema(preset, `options.presets.${id}`);
    if (wrong !== undefined) throw new Error(wrong);
  }
  const variants = variantsOf(presets);
  if (variants.length === 0) throw new Error('presets names no variant left to register an agent for');
  // The options every variant of one load shares, whatever the presets say.
  const paths = said.paths ?? host.paths;
  const shared = {
    log: (line: string) => host.log(line),
    ...(said.computerExecutable === undefined ? {} : { computerExecutable: said.computerExecutable }),
    ...(said.computerConfigDir === undefined ? {} : { computerConfigDir: said.computerConfigDir }),
    ...(said.workerStop === undefined ? {} : { workerStop: said.workerStop }),
  };
  return variants.map(({ id, name, models, keepCliModels, ...preset }) => ({
    ...shared,
    paths,
    provider: id,
    displayName: name,
    ...(models === undefined ? {} : { models: models as ModelEntry[] }),
    ...(keepCliModels === undefined ? {} : { keepCliModels: keepCliModels as boolean }),
    ...(Object.keys(preset).length === 0 ? {} : { preset }),
  }));
};

/** Register one Claude agent per variant, over the directories the host serves. */
export function apply(host: PluginHost, options: Record<string, unknown>): void {
  for (const one of optionsOf(host, options)) host.registerAgent(claude(one));
}
