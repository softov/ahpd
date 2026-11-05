/**
 * The Claude options this backend takes, each declared once.
 *
 * An option is two things: what a value of it may be, and where the value
 * goes. A value reaches the SDK in one of two places - the options `query()`
 * is built from, which the CLI takes when the session starts, or the flag
 * settings `applyFlagSettings` moves, which it takes on a session already
 * running - and a declaration says which, so whoever holds a value does not
 * have to know the option's name to place it.
 *
 * One declaration rather than two schemas and two translations, because the
 * same option is offered in a session's config and written in a record, and
 * those drifted once already.
 */

import type { Bag, BoundTool } from '@ahpd/sdk';
import { bag, fromEnvRef } from '@ahpd/sdk';
import { LOGIN_ADAPTER } from './logins.js';

/**
 * One Claude option.
 *
 * A new SDK option is a new declaration here rather than a spread of whatever
 * the SDK takes: a record is checked when it opens, and a record that could
 * set anything could set what this backend sets itself.
 */
export interface Declaration {
  /** What one value is held to, in a record and in a config bag alike. */
  schema: Bag;
  /** The `query()` options a value becomes; absent when the CLI takes it live instead. */
  toQuery?: (value: unknown) => Bag;
  /** The flag settings a value becomes; absent when the query takes it instead. */
  toFlags?: (value: unknown) => Bag;
  /** What this option is when nothing named one. */
  fallback?: unknown;
}

/**
 * The CLI's own sandbox, on the reference host's three words.
 *
 * `on` and `off` set it and `default` leaves it to the settings files. That
 * is why `default` produces nothing rather than an unset: the layer is absent,
 * so whatever those files say is what runs.
 */
export const sandbox: Declaration = {
  schema: {
    type: 'string',
    enum: ['default', 'on', 'off'],
    description: "The CLI's own sandbox for shell commands. On and off set it; default follows the settings files.",
  },
  toQuery: (value) => value === 'on' ? { settings: { sandbox: { enabled: true } } }
    : value === 'off' ? { settings: { sandbox: { enabled: false } } }
    : {},
};

/**
 * The sandbox a session was stored on, over whatever its record says.
 *
 * `sandboxEnabled` was a session's own control before the schema stopped
 * declaring it, and a store still holds what that control was left on. An
 * `on` - the word it wrote, or the `true` a client could have sent in its
 * place - is the one value that outlives the control: it turns the sandbox on
 * as the record's `sandbox: 'on'` does, so an upgrade never runs a session
 * less sandboxed than it was. `off`, `default` and `false` are the sandbox
 * being turned off or left alone, and leave the record in charge.
 */
export const storedSandbox = (settings: Record<string, unknown> | undefined): Bag => {
  const held = settings?.['sandboxEnabled'];
  return held === 'on' || held === true ? { sandbox: 'on' } : {};
};

/**
 * Extended thinking, which the query is built with.
 *
 * What every session ran on before a record could say otherwise, which is why
 * it is the one option with a fallback: an install whose record names nothing
 * is the empty record, and it has to answer as it answered before.
 */
export const thinking: Declaration = {
  schema: {
    type: 'string',
    enum: ['adaptive', 'disabled'],
    description: 'Extended thinking. The agent decides when to think, or there is none.',
  },
  fallback: 'adaptive',
  toQuery: (value) => value === 'adaptive' ? { thinking: { type: 'adaptive' } }
    : value === 'disabled' ? { thinking: { type: 'disabled' } }
    : {},
};

/**
 * The task tools Claude Code offers itself, which `hostTasks` leaves to the host.
 *
 * The tasks plugin offers `task_add` in their place, and a host tool is one road
 * into the list the host keeps and every session shares.
 */
export const OWN_TASK_TOOLS = ['TodoWrite', 'TaskCreate', 'TaskUpdate', 'TaskList', 'TaskGet'] as const;

/**
 * Whether Claude leaves its own task tools to the host's.
 *
 * On by default. A session denies its own list only when the host offers the
 * tasks plugin's `task_add`, because a host without it has nothing to put in
 * their place. The setting is read where the query's deny list is built rather
 * than turned into a query option of its own.
 */
export const hostTasks: Declaration = {
  schema: {
    type: 'boolean',
    description: "Leave Claude's own task tools to the host's, when the host offers task_add. On by default.",
  },
  fallback: true,
};

/**
 * Whether the host holds the task list instead of Claude.
 *
 * The tasks plugin's `task_add` is the tool that takes the five away, and
 * `hostTasks` is the setting that lets it. Both are needed: a host with no
 * task tool has nothing to put in their place. Read where the query is built
 * and where Claude's own calls would be translated, so the two cannot disagree
 * about whose list it is.
 */
export const hostHoldsTasks = (values: Bag, offering: BoundTool[]): boolean =>
  values['hostTasks'] !== false && offering.some((one) => one.definition.name === 'task_add');

/**
 * The host's agent terminal tool, under the name the CLI calls it.
 *
 * The host serves its own tools as the in-process MCP server `host`, and the
 * CLI names a tool of an MCP server `mcp__<server>__<tool>`.
 */
export const HOST_SHELL_TOOL = 'mcp__host__bash';

/**
 * Whether the host runs Claude's shell commands instead of Claude.
 *
 * The host offers its agent terminal tool, `bash`, only while the root
 * config's `enableCustomTerminalTool` is on, and marks it as taking the place
 * of the agent's own shell, as the reference host marks it
 * (`overridesBuiltInTool`, VS Code `node/copilot/copilotShellTools.ts`). The
 * Claude Agent SDK's own way to do that is to disallow `Bash` and alias its
 * name to the replacement (`disallowedTools` and `toolAliases`, `sdk.d.ts` in
 * 0.3.301). A tool that is not marked leaves `Bash` alone, whatever its name.
 */
export const hostRunsShell = (offering: BoundTool[]): boolean =>
  offering.some((one) => one.overridesBuiltInTool === true && one.definition.name === 'bash');

/**
 * Whether Claude's own task tools are turned on when Claude keeps them.
 *
 * On by default, and read where the CLI's environment is built: a session that
 * keeps its own tools is started with `CLAUDE_CODE_ENABLE_TASKS=1`, unless a
 * record's own `env` gives the variable a value.
 */
export const enableTasks: Declaration = {
  schema: {
    type: 'boolean',
    description: "Turn Claude's own task tools on when Claude keeps them. On by default.",
  },
  fallback: true,
};

/**
 * The voice the CLI answers in.
 *
 * The one option here the CLI takes live rather than at startup: it is in the
 * flag settings layer, and which styles exist is only known once the CLI has
 * answered, so a value is applied at the handshake rather than when the query
 * is built.
 */
export const outputStyle: Declaration = {
  schema: { type: 'string', description: 'The voice it answers in.' },
  toFlags: (value) => typeof value === 'string' && value !== '' ? { outputStyle: value } : {},
};

/** One name and value a `$secret` or a `fromEnv` reference is written as. */
const REFERENCE = (keyword: '$secret' | 'fromEnv'): Bag => ({
  type: 'object',
  properties: { [keyword]: { type: 'string' } },
  required: [keyword],
  additionalProperties: false,
});

/**
 * One value of `env`: text, an unset, or a reference to where the text comes
 * from.
 *
 * A client draws one control per branch, so the four shapes are written out
 * rather than left to a bare object.
 */
const ENV_VALUE: Bag = {
  oneOf: [
    { type: 'string' },
    { type: 'null' },
    REFERENCE('fromEnv'),
    REFERENCE('$secret'),
  ],
};

/**
 * Variables for the CLI's own process.
 *
 * The SDK's `env` *replaces* the subprocess environment rather than adding to
 * it, so a lone entry is a CLI with no `PATH` and no `HOME`. The daemon's own
 * environment is the base and these are laid over it, which is also what a
 * credential pushed by a client is layered over.
 *
 * A value is a string, `null` to unset the variable, `{ "fromEnv": "<VAR>" }`
 * for the daemon's own value of another variable, or `{ "$secret": "<name>" }`
 * for a credential kept in the vault, so a key need not be written in the
 * configuration. The last is `secretAtUse` because a record's key belongs to
 * the daemon rather than to whoever wrote it down: the name reaches the plugin
 * whole and is read once, for the load, rather than by the loader on its behalf.
 */
export const env: Declaration = {
  schema: {
    type: 'object',
    additionalProperties: ENV_VALUE,
    fromEnv: true,
    secretAtUse: true,
    description: "Variables for the CLI's process, over the daemon's own environment. null unsets one; { fromEnv: NAME } reads the daemon's NAME; { \"$secret\": \"host:NAME\" } reads the vault.",
  },
  toQuery: (value) => {
    const held = variablesOf(value, true);
    if (Object.keys(held).length === 0) return {};
    const out: Record<string, string | undefined> = { ...process.env };
    for (const [name, one] of Object.entries(held)) {
      if (one === null) delete out[name];
      else out[name] = one;
    }
    return { env: out };
  },
};

/**
 * The Claude logins one agent runs on, by connector id, in the order a turn
 * tries them.
 *
 * Each names a connector of `claude-login`, which holds one account's token
 * from `claude setup-token` in the host's vault. The mark is what the agents
 * channel checks at a put: an id the host serves no login for, or another
 * person's login, is refused there. Read where the CLI's environment is built,
 * as `enableTasks` is, because the login a turn runs on is picked when the turn
 * starts and again after a failure, not once for the query:
 * `session/logins.ts` picks it.
 */
export const logins: Declaration = {
  schema: {
    type: 'array',
    items: { type: 'string', minLength: 1, 'x-ahpd-connector': { adapter: LOGIN_ADAPTER } },
    description: 'Claude logins this agent runs on, by the id of a claude-login connector, in the order a turn tries them.',
  },
};

/**
 * Arguments the CLI is started with, beyond the ones this backend builds.
 *
 * The SDK's own shape: a name without the `--`, its value, and `null` for a
 * flag that takes none. A value that is neither is JSON, because what the CLI
 * is handed is always text: `settings` is an object in the configuration and
 * `--settings '<json>'` on the command line, and a person writing a record
 * should not have to escape it themselves.
 */
export const extraArgs: Declaration = {
  schema: {
    type: 'object',
    additionalProperties: {},
    description: 'Extra CLI arguments, by name and value. null for a flag that takes none, and anything else as its JSON text.',
  },
  toQuery: (value) => {
    const held = argValuesOf(value);
    return Object.keys(held).length > 0 ? { extraArgs: held } : {};
  },
};

/** Every declared option, by the name a record gives it. */
export const DECLARED: Record<string, Declaration> = { sandbox, thinking, hostTasks, enableTasks, outputStyle, env, logins, extraArgs };

/** One model a record writes out: an id, and the name the picker draws. */
const MODEL: Bag = {
  type: 'object',
  properties: { id: { type: 'string' }, name: { type: 'string' } },
  required: ['id'],
};

/**
 * One endpoint a record fetches its model list from.
 *
 * `key` is a credential, so a form does not draw its value back: a client puts
 * a `$secret` or a `fromEnv`, and the record keeps the reference.
 */
const MODEL_SOURCE: Bag = {
  type: 'object',
  properties: {
    fetch: { type: 'string' },
    match: { type: 'string' },
    key: {
      secret: true,
      secretAtUse: true,
      oneOf: [REFERENCE('fromEnv'), { type: 'string' }],
    },
  },
  required: ['fetch'],
};

/**
 * What a record holds beside the declared options.
 *
 * These are what make a record an agent rather than a set of values: which
 * models the picker offers is this backend's question and not the channel's,
 * which is why a record's `config` may name them.
 */
const OF_A_VARIANT: Record<string, Bag> = {
  models: {
    type: 'array',
    items: MODEL,
    description: 'The models this record offers, by id and name.',
  },
  modelSources: {
    type: 'array',
    items: MODEL_SOURCE,
    description: "Endpoints whose model lists this record offers, each filtered by match. key is the bearer token, written as { fromEnv } or { \"$secret\" }.",
  },
  keepCliModels: { type: 'boolean', description: 'With models, add them to the CLI model list rather than replace it.' },
};

/**
 * The form a client draws for a record of this engine.
 *
 * The fields a record's `config` may hold, without `name`, `description`, `icon`
 * and `model`: the agents channel owns those four on every agent, so a
 * record's `config` holds
 * what this backend runs and nothing a second kind could spell differently.
 * `models`, `modelSources` and `keepCliModels` stay, because which models a
 * record offers is this backend's question and not the channel's.
 */
export const kindSchema = (): Bag => ({
  type: 'object',
  properties: {
    ...Object.fromEntries(Object.entries(DECLARED).map(([name, one]) => [name, one.schema])),
    ...OF_A_VARIANT,
  },
});

/** The options of one declaration, gathered into a single bag. */
const through = (values: Bag, member: 'toQuery' | 'toFlags'): Bag => {
  const out: Bag = {};
  for (const [name, one] of Object.entries(DECLARED)) Object.assign(out, one[member]?.(values[name]) ?? {});
  return out;
};

/**
 * What each declared option is when nothing named one.
 *
 * Under everything else a session says, so a value somebody chose is a value
 * somebody chose.
 */
export const optionDefaults = (): Bag => Object.fromEntries(
  Object.entries(DECLARED).filter(([, one]) => one.fallback !== undefined).map(([name, one]) => [name, one.fallback]),
);

/** The `query()` options a set of declared values produces. */
export const queryOptionsOf = (values: Bag): Bag => through(values, 'toQuery');

/**
 * A variant's own `env`, each `{ fromEnv }` read, and `null` for a variable it
 * unsets; none of the daemon's environment under it.
 *
 * What a CLI in a machine is started with, where the daemon's `HOME`, `PATH`
 * and keys are this host's and not the variant's to hand on.
 */
export const ownEnvOf = (values: Bag): Record<string, string | null> => variablesOf(values['env'], true);

/** The flag settings a set of declared values produces. */
export const flagSettingsOf = (values: Bag): Bag => through(values, 'toFlags');

/**
 * The name-and-value pairs of an `env`, and nothing else.
 *
 * With `resolve`, a `{ fromEnv }` value is the daemon's value of that variable.
 * A value that is neither a string nor `null` is dropped: the CLI's subprocess
 * takes variables as text, and a preset's `$secret` has been read into one by
 * the time this runs.
 */
const variablesOf = (value: unknown, resolve = false): Record<string, string | null> => Object.fromEntries(
  Object.entries(bag(value))
    .map(([name, one]): [string, unknown] => {
      const named = resolve ? fromEnvRef(one) : undefined;
      return [name, named === undefined ? one : process.env[named]];
    })
    .filter((entry): entry is [string, string | null] => typeof entry[1] === 'string' || entry[1] === null),
);

/**
 * The name-and-value pairs of an `extraArgs`, each value as the CLI takes it.
 *
 * Its own reader rather than a flag on the one above, because the two hold
 * different things: an `env` value is a variable and is dropped unless it is
 * text, while an argument is text by the time it is started and whatever it was
 * written as becomes its JSON. `null` is a flag that takes no value and passes
 * as it is, which is why it is neither stringified nor dropped.
 */
const argValuesOf = (value: unknown): Record<string, string | null> => Object.fromEntries(
  Object.entries(bag(value))
    .map(([name, one]): [string, string | null] => [name, one === null || typeof one === 'string' ? one : JSON.stringify(one)]),
);