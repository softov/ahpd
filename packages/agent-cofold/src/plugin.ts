/**
 * The plugin entry: what the daemon imports when the package is named.
 *
 * `index.ts` re-exports `name`, `apply` and `title` from here, so the module
 * the manifest names is the plugin. There is deliberately no default export:
 * the loader refuses a module without a named `apply` rather than guessing
 * which export is the plugin, and a silent guess is worse than a refusal.
 *
 * The options schema is in this package's package.json, at `ahpd.optionsSchema`,
 * and is read from there rather than exported: the daemon reads it without
 * importing the module, so a plugin switched off still has a form.
 *
 * The plugin registers the engine `cofold`, and each record of it is one agent
 * with its own endpoint, key and model. The plugin's own options are the
 * defaults every record starts from; nothing is registered as an agent here.
 *
 * The model adapter is not a configuration option in practice. A configuration
 * file is JSON and cannot carry a function or an object with methods, so the
 * only caller that puts one in `options` is an embedder or a test; the real
 * path is the OpenAI-compatible endpoint a record selects, and the API key for
 * it belongs in the daemon's environment or in a record's write-only field
 * rather than in a setting a client reads back.
 */

import { check } from '@cofold/commands';
import { TOOLS_SCHEMA } from '@cofold/tools';
import type { Engine, AgentView, PluginHost } from '@ahpd/sdk';
import manifest from '../package.json' with { type: 'json' };
import { cofoldAgent } from './agent.js';
import type { CofoldOptions } from './agent.js';

/** The plugin's id, unique among the plugins one daemon loads. */
export const name = 'agent-cofold';

/**
 * What a listing prints for this package.
 *
 * The manifest's `ahpd.title` carries the same string to `ahpd plugin list`,
 * which must not import the module to read it; this export is for an embedder
 * that imports the entry directly.
 */
export const title = 'Agent Cofold';

/**
 * The options `apply` receives, as a JSON Schema the daemon checks them against
 * before `apply` runs.
 *
 * The schema is written in this package's package.json, at `ahpd.optionsSchema`,
 * so a listing reads it without importing this module and a plugin switched off
 * still has a form a client draws. These are the defaults for every record of
 * the engine: a record that names one of them wins, and a record that names
 * none runs on what is here. `adapter` and `policy` are not here at all: a
 * model adapter is an object of methods and a policy is a function, which JSON
 * cannot carry, so only an embedder calling `apply` passes them, in code.
 *
 * `provider`, `displayName` and `description` are deliberately not there: an
 * agent is named by its record's id, name and description, and a plugin that
 * could still set them would be describing one agent while serving many.
 */
const optionsSchema = manifest.ahpd.optionsSchema;

/**
 * The package's own options, out of values `optionsSchema` has checked.
 *
 * The `tools` option is held to cofold's own `TOOLS_SCHEMA`, which is the
 * schema the harness validates its configuration file against: a key cofold
 * does not know, or a value of the wrong type, is a person who meant something
 * else, and a session that quietly ran the default in its place would be one
 * that did not do what the file said. `strictTools: false` is the way back, for
 * a configuration written for a later cofold - the loose reading `toolsOf`
 * takes then drops what it cannot use.
 */
const optionsOf = (values: Record<string, unknown>): CofoldOptions => {
  if (values.strictTools !== false && values.tools !== undefined) {
    check(values.tools, TOOLS_SCHEMA, 'tools');
  }
  return values as CofoldOptions;
};

/**
 * The fields a record does not carry, and the two only an embedder can set.
 *
 * The channel owns an agent's id, name, description and model, so a record
 * does not name them again; `provider` is the record's id and `displayName`
 * its name. `adapter` is an object with methods and `strictTools` is how the
 * plugin forgives a configuration written for a later cofold: both are the
 * plugin's own, not something a JSON record can carry or usefully say.
 */
const NOT_A_RECORD = new Set(['provider', 'displayName', 'description', 'model', 'adapter', 'strictTools']);

/**
 * The `tools` a record may name.
 *
 * A search provider's `apiKey` is a credential, and the channel vaults a
 * record's top-level `secret` fields only: a key nested under
 * `tools.web.search` would be kept in the record itself. So a record chooses
 * the capabilities and DuckDuckGo, and a keyed provider stays a plugin option,
 * which is a configuration file the daemon's own owner writes.
 */
const TOOLS_OF_RECORD = {
  type: 'object',
  additionalProperties: false,
  properties: {
    files: {
      anyOf: [
        { type: 'boolean' },
        { type: 'object', properties: { requireRead: { type: 'boolean' } }, additionalProperties: false },
      ],
    },
    shell: { type: 'boolean' },
    web: {
      anyOf: [
        { type: 'boolean' },
        {
          type: 'object',
          additionalProperties: false,
          properties: {
            search: {
              type: 'object',
              additionalProperties: false,
              properties: { duckduckgo: { type: 'boolean' } },
            },
          },
        },
      ],
    },
    memory: { type: 'boolean' },
  },
};

/**
 * The engine's form: what a record may set, and nothing a second engine spells.
 *
 * Everything is closed with `additionalProperties: false`, so a field the engine
 * does not have is refused where it is written rather than kept and ignored.
 */
const kindSchema = (): Record<string, unknown> => ({
  type: 'object',
  additionalProperties: false,
  properties: {
    ...Object.fromEntries(Object.entries(optionsSchema.properties).filter(([key]) => !NOT_A_RECORD.has(key))),
    // A record's key is kept in the vault, so a record's form says `secret`.
    // The plugin's own option stays `writeOnly`: it is the daemon's key, which
    // the plugin reads and no record carries.
    apiKey: { ...(optionsSchema.properties['apiKey'] as Record<string, unknown>), secret: true },
    tools: TOOLS_OF_RECORD,
  },
});

/** The fields of a record that become an option a turn runs on. */
const RECORD_FIELDS = [
  'baseUrl',
  'models',
  'instructions',
  'computerConfigDir',
  'store',
  'memory',
  'tools',
  'apiKey',
  'resource',
  'autoCompactTokens',
] as const;

/** A non-blank string, or nothing for a blank or missing one. */
const text = (value: unknown): string | undefined =>
  (typeof value === 'string' && value.trim() !== '' ? value : undefined);

/**
 * One record's options: what the record names, over the plugin's defaults.
 *
 * Every record opens the same store, cofold's own home unless the plugin or the
 * record names another, as ahpd's Claude agents on one host share the CLI's
 * store and each lists every session in it. Agents that must not see each
 * other's sessions run in machines of their own, where cofold's home is the
 * machine's. A record's model is the channel's `model`, and it wins over the
 * plugin's default the same way every other field does.
 *
 * A record that cannot be built is refused with a sentence naming the field,
 * never with the value: `check` says `tools is not a field`, and the rest of
 * this says nothing about what the record holds.
 */
const optionsOfRecord = (defaults: CofoldOptions, record: AgentView): CofoldOptions => {
  const config = record.config;
  const named = Object.fromEntries(
    RECORD_FIELDS.filter((field) => config[field] !== undefined).map((field) => [field, config[field]]),
  );
  const merged: CofoldOptions = {
    ...defaults,
    ...named,
    provider: record.id,
    displayName: record.name,
    ...(record.description === undefined ? {} : { description: record.description }),
    ...(record.model === undefined ? {} : { model: record.model }),
    store: text(config.store) ?? defaults.store,
  } as CofoldOptions;
  if (merged.tools !== undefined) check(merged.tools, TOOLS_SCHEMA, 'tools');
  return merged;
};

/**
 * The `cofold` engine: one record per endpoint and key, each its own agent.
 *
 * `open` builds the backend once and hands it a reader for the record, which
 * the session calls at the start of each turn. The record the reader sees is
 * the channel's own live view: an edit replaces what `config` answers, and the
 * next turn runs on it, while the turn already running ends on what it started
 * with.
 */
const engineOf = (defaults: CofoldOptions): Engine => ({
  name: 'cofold',
  title: 'Cofold',
  description: 'Cofold over an OpenAI-compatible endpoint, one record per agent with its own endpoint, key and model.',
  schema: kindSchema(),
  templates: [{
    name: 'Cofold',
    description: 'Cofold on the harness configuration papo reads, ~/.config/papo/config.json and a project\'s .papo.json, with nothing set here.',
    config: {},
  }],
  hostOnly: ['computerConfigDir', 'store', 'memory'],
  open: (record) => cofoldAgent({
    ...optionsOfRecord(defaults, record),
    recordOf: () => optionsOfRecord(defaults, record),
  }),
});

/**
 * Register the engine `cofold`, whose records are the agents.
 *
 * `provider`, `displayName` and `description` are refused rather than ignored:
 * a configuration that still names one is asking for the single backend this
 * plugin used to register, and a person who wrote one should be told that an
 * agent is a record now rather than run a daemon whose agents ignore half of
 * what the file says.
 */
export function apply(host: PluginHost, values: Record<string, unknown>): void {
  const perRecord: Record<string, string> = {
    provider: "the record's id",
    displayName: "the record's name",
    description: "the record's description",
  };
  for (const [key, where] of Object.entries(perRecord)) {
    if (values[key] !== undefined) throw new Error(`options.${key} is written per record now, as ${where}`);
  }
  host.registerEngine(engineOf(optionsOf(values)));
}
