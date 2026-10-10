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
 * same option is offered in a session's config and written in a preset, and
 * those drifted once already - decision
 * `claude-options-are-declared-once-for-sessions-and-presets`.
 */

import type { Bag } from '@ahpd/sdk';
import { bag, fromEnvRef, secretRef } from '@ahpd/sdk';
import { modelsProblem } from './models.js';

/**
 * One Claude option.
 *
 * A new SDK option is a new declaration here rather than a spread of whatever
 * the SDK takes: a preset is checked when the plugin loads, and a preset that
 * could set anything could set what this backend sets itself.
 */
export interface Declaration {
  /** What one value is held to, in a preset and in a config bag alike. */
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
 * The sandbox a session was stored on, over whatever its preset says.
 *
 * `sandboxEnabled` was a session's own control before the schema stopped
 * declaring it, and a store still holds what that control was left on. An
 * `on` - the word it wrote, or the `true` a client could have sent in its
 * place - is the one value that outlives the control: it turns the sandbox on
 * as the preset's `sandbox: 'on'` does, so an upgrade never runs a session
 * less sandboxed than it was. `off`, `default` and `false` are the sandbox
 * being turned off or left alone, and leave the preset in charge.
 */
export const storedSandbox = (settings: Record<string, unknown> | undefined): Bag => {
  const held = settings?.['sandboxEnabled'];
  return held === 'on' || held === true ? { sandbox: 'on' } : {};
};

/**
 * Extended thinking, which the query is built with.
 *
 * What every session ran on before a preset could say otherwise, which is why
 * it is the one option with a fallback: an install that names no preset is
 * the empty preset, and it has to answer as it answered before.
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
 * configuration. The last is `secretAtUse` because a preset's key belongs to
 * the daemon rather than to whoever wrote it down: the name reaches the plugin
 * whole and is read once, for the load, rather than by the loader on its behalf.
 */
export const env: Declaration = {
  schema: {
    type: 'object',
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
 * Arguments the CLI is started with, beyond the ones this backend builds.
 *
 * The SDK's own shape: a name without the `--`, its value, and `null` for a
 * flag that takes none. A value that is neither is JSON, because what the CLI
 * is handed is always text: `settings` is an object in the configuration and
 * `--settings '<json>'` on the command line, and a person writing a preset
 * should not have to escape it themselves.
 */
export const extraArgs: Declaration = {
  schema: { type: 'object', description: 'Extra CLI arguments, by name and value. null for a flag that takes none, and anything else as its JSON text.' },
  toQuery: (value) => {
    const held = argValuesOf(value);
    return Object.keys(held).length > 0 ? { extraArgs: held } : {};
  },
};

/** Every declared option, by the name a preset gives it. */
export const DECLARED: Record<string, Declaration> = { sandbox, thinking, outputStyle, env, extraArgs };

/**
 * What a preset holds beside the declared options, by the name it gives them.
 *
 * These three are what make a preset a variant rather than a set of values: its
 * name is what a client reads instead of the id, and its models are what the
 * picker offers. They belong inside the preset, because two presets of one
 * plugin are two agents and each of them is one of these.
 */
const OF_A_VARIANT: Record<string, Bag> = {
  name: { type: 'string', description: 'What a client reads instead of the id, which is the preset key.' },
  models: { type: 'array', description: 'The models this preset offers.' },
  keepCliModels: { type: 'boolean', description: 'With models, add them to the CLI model list rather than replace it.' },
};

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
 * What is wrong with a preset, named; nothing when it holds.
 *
 * The plugin's own options are held to a JSON Schema by the daemon, and that
 * schema cannot say that every value of one object is itself a shape:
 * `additionalProperties` there is a yes or a no and never carries a schema,
 * so `presets` is declared an object and what is inside one of its names is
 * checked here instead - against the same declarations, so a preset and a
 * config key cannot disagree about what an option may be, and against the
 * list `modelsProblem` reads, so a preset's models are held as strictly as a
 * harness's own are.
 */
export const presetSchema = (value: unknown, by: string): string | undefined => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return `${by} is not an object of Claude options`;
  for (const [name, given] of Object.entries(value)) {
    if (name === 'models') {
      const wrong = modelsProblem(given, `${by}.models`);
      if (wrong !== undefined) return wrong;
      continue;
    }
    const one = DECLARED[name];
    const held = one?.schema ?? OF_A_VARIANT[name];
    if (held === undefined) return `${by}.${name} is not an option a preset holds`;
    const wrong = heldTo(held, given, name);
    if (wrong !== undefined) return `${by}.${name}${wrong.startsWith('.') ? '' : ' '}${wrong}`;
  }
  return undefined;
};

/** What one value is held to by one field's schema, in the words a person reads. */
const heldTo = (schema: Bag, value: unknown, option: string): string | undefined => {
  const listed = Array.isArray(schema.enum) ? schema.enum : undefined;
  if (listed !== undefined) return listed.includes(value) ? undefined : `is not one of ${listed.map(String).join(', ')}`;
  if (schema.type === 'string') return typeof value === 'string' ? undefined : 'is not a string';
  if (schema.type === 'boolean') return typeof value === 'boolean' ? undefined : 'is not true or false';
  if (schema.type === 'object') {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return 'is not an object';
    for (const [key, held] of Object.entries(value)) {
      const named = schema.fromEnv === true ? fromEnvRef(held) : undefined;
      if (named !== undefined) {
        if (process.env[named] === undefined) return `.${key} reads ${named}, which the daemon's environment does not have`;
        continue;
      }
      // A name the plugin reads itself is held here whatever it will answer:
      // whether the vault has it is not a question this check can ask.
      if (schema.secretAtUse === true && secretRef(held) !== undefined) continue;
      // An argument is text whatever it was written as, so anything the CLI can
      // be handed as JSON is held. `{ fromEnv }` is not: it reads the daemon's
      // own variables, which is what `env` is for and no argument has use of.
      if (option === 'extraArgs') {
        if (fromEnvRef(held) !== undefined) return `.${key} reads the daemon's environment only under env`;
        continue;
      }
      if (typeof held !== 'string' && held !== null) return `.${key} is not a string`;
    }
    return undefined;
  }
  return undefined;
};

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