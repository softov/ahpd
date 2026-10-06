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
import type { Plugin, PluginHost } from '@ahpd/sdk';
import { secretRef } from '@ahpd/sdk';
import { claude } from './claude.js';
import type { ClaudeOptions } from './claude.js';
import { sharedCatalogue as oneListing } from './catalog.js';
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
      description: "The configuration directory the CLI reads inside a machine. /ahpd/<variant> by default, /ahpd/claude for the built-in; false leaves the image's own.",
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
          // keeps one, so each answers `<set>` rather than what it is. Held at
          // use rather than read here, so a `{ "$secret": "host:<name>" }`
          // reaches this plugin as the name it wrote and one preset's missing
          // credential costs that preset and not this load.
          env: { type: 'object', additionalProperties: { type: ['string', 'null'], writeOnly: true, secretAtUse: true }, description: 'Environment the CLI is run with, by variable name.' },
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
 * One preset's `env`, with every `{ "$secret": "<name>" }` read through the host.
 *
 * Read here and not by the loader because a preset's credential is the
 * daemon's, not a person's: the name is in `host:` scope or it belongs to work
 * this load is not doing, and a vault this daemon does not have is a host that
 * cannot answer. Whichever of those it is, the caller is told which preset it
 * was for and the other presets carry on.
 */
const secretsOf = async (host: PluginHost, env: unknown, by: string): Promise<Record<string, unknown>> => {
  const out: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(bagOf(env))) {
    const referenced = secretRef(value);
    if (referenced === undefined) {
      out[name] = value;
      continue;
    }
    try {
      out[name] = await host.secret(referenced);
    }
    catch (error) {
      throw new Error(`${by}.${name} names ${referenced}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return out;
};

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
 * the same declarations the session keys are made of. A failure belongs to the
 * preset it came from, so one that is wrongly written, whose `fromEnv` variable
 * is not there or whose `$secret` cannot be read is left out with one line
 * naming it and the rest of the presets register. The load fails only when
 * nothing is left to register an agent for, because a daemon with no Claude at
 * all is not a daemon somebody configured.
 */
const optionsOf = async (host: PluginHost, values: Record<string, unknown>): Promise<ClaudeOptions[]> => {
  for (const key of ['provider', 'displayName', 'models', 'keepCliModels']) {
    if (values[key] !== undefined) throw new Error(`options.${key} is written per variant, as presets.<id>.${key}`);
  }
  const said = values as Partial<ClaudeOptions> & { presets?: Record<string, unknown> };
  const presets = said.presets ?? {};
  const variants: Variant[] = [];
  const dropped: string[] = [];
  for (const one of variantsOf(presets)) {
    const { id, ...preset } = one;
    try {
      const wrong = presetSchema(preset, `options.presets.${id}`);
      if (wrong !== undefined) throw new Error(wrong);
      // Read once the preset is known to hold, so a wrongly written one says so
      // rather than a name inside it being asked for first.
      const env = preset['env'] === undefined
        ? undefined
        : await secretsOf(host, preset['env'], `options.presets.${id}.env`);
      variants.push(env === undefined ? one : { ...one, env });
    }
    catch (error) {
      // Said once, and the terminal prints it above the line that says this
      // load failed; the refusal below names the presets, not the messages.
      host.problem(`${name}: ${error instanceof Error ? error.message : String(error)}`);
      dropped.push(id);
    }
  }
  if (variants.length === 0) {
    throw new Error(dropped.length === 0
      ? 'presets names no variant left to register an agent for'
      : `presets names no variant left to register an agent for: ${dropped.join(', ')}`);
  }
  // The options every variant of one load shares, whatever the presets say.
  const paths = said.paths ?? host.paths;
  const shared = {
    log: (line: string) => host.log(line),
    // One listing for all of them, and one load's worth of it: every variant
    // below reads the same `paths` out of the same configuration directory, so
    // there is one pass over the projects directory for the lot.
    sharedCatalogue: oneListing(paths),
    ...(said.computerExecutable === undefined ? {} : { computerExecutable: said.computerExecutable }),
    ...(said.computerConfigDir === undefined ? {} : { computerConfigDir: said.computerConfigDir }),
    ...(said.workerStop === undefined ? {} : { workerStop: said.workerStop }),
  };
  return variants.map(({ id, name, models, keepCliModels, ...preset }) => ({
    ...shared,
    paths,
    provider: id,
    displayName: name,
    ...(id === BUILT_IN ? {} : { variant: true }),
    ...(models === undefined ? {} : { models: models as ModelEntry[] }),
    ...(keepCliModels === undefined ? {} : { keepCliModels: keepCliModels as boolean }),
    ...(Object.keys(preset).length === 0 ? {} : { preset }),
  }));
};

/** Register one Claude agent per variant, over the directories the host serves. */
export const apply: Plugin['apply'] = async (host, options) => {
  for (const one of await optionsOf(host, options)) host.registerAgent(claude(one));
};
