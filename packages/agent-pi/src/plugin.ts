/**
 * The plugin entry: what the daemon imports when the package is named.
 *
 * `index.ts` re-exports `name`, `apply` and `title` from here, so the module
 * the manifest names is the plugin. There is deliberately no default export:
 * the loader refuses a module without a named `apply` rather than guessing
 * which export is the plugin.
 *
 * The options schema is in this package's package.json, at `ahpd.optionsSchema`,
 * and is read from there rather than exported: the daemon reads it without
 * importing the module, so a plugin switched off still has a form.
 *
 * The plugin registers the engine `pi`, and each record of it is one pi agent
 * with its own model, project trust, session directory and variables. The
 * plugin's own options are the defaults every record starts from; nothing is
 * registered as an agent here.
 *
 * A record's key is one of pi's own variables in `keyVariables`: the channel
 * vaults it and the session puts the record's variables on pi's runtime at
 * each turn, so a person's or a team's agent answers with its own key and the
 * daemon's environment is only what a record does not name.
 */

import { bag } from '@ahpd/sdk';
import type { Engine, AgentView, PluginHost } from '@ahpd/sdk';
import manifest from '../package.json' with { type: 'json' };
import { piAgent } from './agent.js';
import { PI_KEY_VARIABLES } from './machine.js';
import { loadPi } from './pi.js';
import type { PiOptions } from './types.js';

/** The plugin's id, unique among the plugins one daemon loads. */
export const name = 'agent-pi';

/**
 * What a listing prints for this package.
 *
 * The manifest's `ahpd.title` carries the same string to `ahpd plugin list`,
 * which must not import the module to read it; this export is for an embedder
 * that imports the entry directly.
 */
export const title = 'Agent pi';

/** What an option falls back to. */
export const defaults = {
  projectTrust: 'trust',
} as const;

/**
 * The options `apply` receives, as a JSON Schema the daemon checks them against
 * before `apply` runs.
 *
 * The schema is written in this package's package.json, at `ahpd.optionsSchema`,
 * so a listing reads it without importing this module and a plugin switched off
 * still has a form a client draws. These are the defaults for every record of
 * the engine: a record that names one of them wins, and a record that names
 * none runs on what is here.
 *
 * `provider`, `displayName` and `description` are deliberately not there: an
 * agent is named by its record's id, name and description, and a plugin that
 * could still set them would be describing one agent while serving many.
 *
 * `projectTrust` has no `ask`, pi's third answer: there is nobody at a
 * terminal, and a prompt nothing can answer is a session that never starts.
 */
const optionsSchema = manifest.ahpd.optionsSchema;

/**
 * The package's own options, out of values `optionsSchema` has checked.
 *
 * There is no required option: pi needs a directory and a model provider, and
 * both are already its own to resolve.
 */
export const optionsOf = (values: Record<string, unknown>): PiOptions => values as PiOptions;

/**
 * The fields a record does not carry.
 *
 * The channel owns an agent's id, name, description and model, so a record
 * does not name them again; `provider` is the record's id and `displayName` its
 * name. `model` is left in the plugin's options as the default a record that
 * names none runs on, but a record's own model is the channel's field.
 */
const NOT_A_RECORD = new Set(['provider', 'displayName', 'description', 'model']);

/** The fields of a record that become an option a turn runs on. */
const RECORD_FIELDS = ['projectTrust', 'sessionDir', 'hostTools'] as const;

/**
 * The engine's form: what a record may set, and nothing a second engine spells.
 *
 * Every variable pi takes a key from is declared `secret`, so a client is
 * told it is a credential and never what it is. The channel vaults those by
 * `keyVariables`; a host record may also set any other variable, which stays a
 * plain string and is refused to a team's or a person's record, because a free
 * environment can run a program.
 *
 * Everything is closed with `additionalProperties: false`, so a field the engine
 * does not have is refused where it is written rather than kept and ignored.
 */
const kindSchema = (): Record<string, unknown> => ({
  type: 'object',
  additionalProperties: false,
  properties: {
    ...Object.fromEntries(Object.entries(optionsSchema.properties).filter(([key]) => !NOT_A_RECORD.has(key))),
    hostTools: { type: 'boolean', description: "Whether this agent's sessions are offered the host's own tools, over the plugin-wide setting." },
    env: {
      type: 'object',
      description: "Variables pi is given, by name. One pi takes a key from is kept in the vault and never shown again; only a host record may set any other.",
      properties: Object.fromEntries(PI_KEY_VARIABLES.map((name) => [name, { type: 'string', secret: true }])),
      additionalProperties: { type: 'string' },
    },
  },
});

/** A record's variables as pi's runtime takes them: string values only. */
const envOf = (value: unknown): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const [name, one] of Object.entries(bag(value))) if (typeof one === 'string') out[name] = one;
  return out;
};

/**
 * One record's options: what the record names, over the plugin's defaults.
 *
 * `provider` is the record's id and `displayName` its name, because the channel
 * addresses an agent by its record and serves it under no other id. The
 * record's own `model` wins over the plugin's default, and its `env` is the
 * whole of what a turn puts on pi's runtime: what it does not name stays the
 * daemon's own environment, which pi reads by itself.
 */
const optionsOfRecord = (shared: PiOptions, record: AgentView): PiOptions => {
  const config = record.config;
  const named = Object.fromEntries(
    RECORD_FIELDS.filter((field) => config[field] !== undefined).map((field) => [field, config[field]]),
  );
  return {
    ...shared,
    ...named,
    provider: record.id,
    displayName: record.name,
    ...(record.description === undefined ? {} : { description: record.description }),
    ...(record.model === undefined ? {} : { model: record.model }),
    env: envOf(config.env),
  } as PiOptions;
};

/**
 * The `pi` engine: one record per pi agent, each its own backend.
 *
 * `open` builds the backend once and hands it a reader for the record, which
 * the session calls at the start of each turn. The record the reader sees is
 * the channel's own live view: an edit replaces what `config` answers, and the
 * next turn runs on it, while the turn already running ends on what it started
 * with.
 *
 * `sessionDir` is host-only because it is where on this host pi writes, and
 * `projectTrust` is everyone's because it can only narrow: the host's own
 * answer about the folder is asked as well.
 */
const engineOf = (shared: PiOptions, paths: readonly string[]): Engine => ({
  name: 'pi',
  title: 'pi',
  description: 'pi, embedded in this host, with one record per agent: its own model, project trust, sessions and variables.',
  schema: kindSchema(),
  templates: [{
    name: 'pi',
    description: "pi as this host runs it, on pi's own agent directory and credentials, with nothing set here.",
    config: {},
  }],
  hostOnly: ['sessionDir'],
  keyVariables: [...PI_KEY_VARIABLES],
  open: (record) => piAgent({
    ...optionsOfRecord(shared, record),
    recordOf: () => optionsOfRecord(shared, record),
  }, paths),
});

/**
 * Register the engine `pi`, whose records are the agents.
 *
 * `provider`, `displayName` and `description` are refused rather than ignored:
 * a configuration that still names one is asking for the single backend this
 * plugin used to register, and a person who wrote one should be told that an
 * agent is a record now rather than run a daemon whose agents ignore half of
 * what the file says.
 *
 * pi's SDK starts loading here and is not waited for, so the daemon does not
 * start seconds later for it; the first call that needs pi waits instead. A
 * load that fails here is tried again by that call.
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
  host.registerEngine(engineOf({ ...optionsOf(values), log: (line) => { host.log(line); } }, host.paths));
  loadPi().catch(() => {});
}
