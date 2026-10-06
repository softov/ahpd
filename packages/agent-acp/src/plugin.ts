/**
 * The plugin entry: what the daemon imports when the package is named.
 *
 * `index.ts` re-exports `name`, `apply` and `optionsSchema` from here, so the
 * module the manifest names is the plugin. There is deliberately no default
 * export: the loader refuses a module without a named `apply` rather than
 * guessing which export is the plugin.
 *
 * One load serves every preset. Each key of `presets` registers an agent of its
 * own, keyed by that key as its provider id, the way `agent-claude`'s variants
 * do - decision `a-plugin-loads-once-and-each-preset-is-a-variant`. A key that
 * names a shipped row takes it and a key that names none writes a spec of its
 * own, so one package serves Copilot, Codex and a server nobody has heard of at
 * once.
 */

import type { Plugin, PluginHost, SecretRef, Seed } from '@ahpd/sdk';
import { secretRef } from '@ahpd/sdk';
import { acpAgent } from './agent.js';
import { presets as shipped } from './presets.js';
import type { AcpMachine, AcpOptions } from './types.js';

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

/** One option's value in a preset's `env`: a variable, or the name of a secret it is. */
const envValue = { type: 'string', writeOnly: true, secretAtUse: true };

/**
 * The options `apply` receives, as a JSON Schema the daemon checks them against
 * before `apply` runs.
 *
 * `presets` is required: a load with no preset has no agent to register, which
 * is a configuration rather than a backend. What a preset holds is checked
 * inside `optionsOf`, because `additionalProperties` there carries a schema for
 * every key at once and a preset's own fields are what a person writes.
 */
export const optionsSchema = {
  type: 'object',
  properties: {
    presets: {
      type: 'object',
      description: 'The ACP agents this one load registers, by the id clients name. A key that names a shipped preset takes it, a key that names none writes a command of its own, and each registers an agent of its own.',
      additionalProperties: {
        type: 'object',
        properties: {
          base: { type: 'string', description: 'The shipped preset this one takes, for a key that is not itself one.' },
          name: { type: 'string', description: 'What a client reads instead of the id, which is this key. Defaults to the preset name, and to the key.' },
          command: { type: 'string', description: 'The program to spawn as the ACP server.' },
          args: { type: 'array', items: { type: 'string' }, description: 'The arguments to give it, replacing the preset\'s own.' },
          env: { type: 'object', additionalProperties: envValue, description: "Environment variables merged over the daemon's own for the child, by variable name. A variable is a credential wherever the server keeps one, so each answers <set>; a value written { \"$secret\": \"host:<name>\" } is read from the vault when this load runs." },
          cwd: { type: 'string', description: "The directory the server runs in; the session's working directory when absent." },
          description: { type: 'string', description: 'One line about what this agent is.' },
          model: { type: 'string', description: 'The model a session that names none runs on.' },
          authenticate: {
            type: 'object',
            properties: { methodId: { type: 'string' } },
            required: ['methodId'],
            description: 'The sign-in to send after the handshake, as the methodId of a method the server lists in authMethods. A value naming one it does not offer fails the turn that opened.',
          },
          hostTools: { type: 'boolean', description: "Whether this agent's sessions are offered the host's own tools, over the plugin-wide setting." },
          // Typed by `machineOf` rather than here, so a wrongly written block
          // costs its preset and not this load. A variable's value is read
          // where the machine is made, so a `$secret` reaches this plugin as
          // the name it wrote.
          machine: {
            description: 'What a machine needs to run this agent: env, variables set only inside the machine, each a string, { fromEnv: NAME } read from the daemon\'s NAME at load, or { "$secret": "<scope>:<name>" } read when the machine is made; and copy, a list of { source, target } host paths copied in.',
            properties: {
              env: { additionalProperties: { writeOnly: true, secretAtUse: true }, description: 'Variables set inside the machine, by name.' },
              copy: { description: 'Host paths copied into the machine, each { source, target }.' },
            },
          },
        },
      },
    },
    hostTools: { type: 'boolean', description: "Offer the host's own tools to each session as an MCP server, on by default." },
  },
  required: ['presets'],
};

/** The keys that belong to a preset rather than to the load, and are refused above one. */
const PER_PRESET = ['command', 'args', 'env', 'cwd', 'provider', 'displayName', 'description', 'model', 'authenticate', 'machine'] as const;

/** A preset as an object, however it was written. */
const bagOf = (value: unknown): Record<string, unknown> =>
  (typeof value === 'object' && value !== null && !Array.isArray(value) ? value : {}) as Record<string, unknown>;

/**
 * One preset's `env`, with every `{ "$secret": "<name>" }` read through the host.
 *
 * Read here and not by the loader because a preset's credential is the
 * daemon's, not a person's: the name is in `host:` scope or it belongs to work
 * this load is not doing, and a vault this daemon does not have is a host that
 * cannot answer. Whichever of those it is, the caller is told which preset it
 * was for and the other presets carry on.
 */
const secretsOf = async (host: PluginHost, env: unknown, by: string): Promise<Record<string, string>> => {
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(bagOf(env))) {
    const referenced = secretRef(value);
    if (referenced === undefined) {
      out[name] = value as string;
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

/** The variable a `{ "fromEnv": "<VAR>" }` value names, or nothing for any other value. */
const fromEnvOf = (value: unknown): string | undefined => {
  const held = bagOf(value);
  const named = held.fromEnv;
  return Object.keys(held).length === 1 && typeof named === 'string' && named !== '' ? named : undefined;
};

/**
 * One preset's `machine`, with every `{ fromEnv }` read and every `$secret` kept.
 *
 * A variable read from the daemon's environment is settled here, once, and one
 * the daemon does not have refuses the preset, as a preset's own `env` does in
 * `agent-claude`. A `$secret` is not read: the machine it is for has an owner,
 * and the computer plugin reads it for that owner when it makes the machine.
 * Every refusal names the field and never a value.
 */
const machineOf = (said: unknown, by: string): AcpMachine => {
  const at = `${by}.machine`;
  if (typeof said !== 'object' || said === null || Array.isArray(said)) throw new Error(`${at} is not an object`);
  const block = said as Record<string, unknown>;
  for (const key of Object.keys(block)) {
    if (!MACHINE_KEYS.includes(key)) throw new Error(`${at}.${key} is not a field; a machine takes env, copy, part, state and seed`);
  }
  const env: Record<string, string | SecretRef> = {};
  if (block.env !== undefined) {
    if (typeof block.env !== 'object' || block.env === null || Array.isArray(block.env)) throw new Error(`${at}.env is not an object`);
    for (const [variable, value] of Object.entries(block.env)) {
      if (typeof value === 'string') {
        env[variable] = value;
        continue;
      }
      const referenced = secretRef(value);
      if (referenced !== undefined) {
        env[variable] = { $secret: referenced };
        continue;
      }
      const named = fromEnvOf(value);
      if (named === undefined) throw new Error(`${at}.env.${variable} is not a string, { fromEnv } or { $secret }`);
      const held = process.env[named];
      if (held === undefined) throw new Error(`${at}.env.${variable} reads ${named}, which the daemon's environment does not have`);
      env[variable] = held;
    }
  }
  const copy: { source: string; target: string }[] = [];
  if (block.copy !== undefined) {
    if (!Array.isArray(block.copy)) throw new Error(`${at}.copy is not a list`);
    block.copy.forEach((one: unknown, index) => {
      const { source, target } = bagOf(one);
      if (typeof source !== 'string' || source === '' || typeof target !== 'string' || target === '') {
        throw new Error(`${at}.copy[${String(index)}] needs a source and a target`);
      }
      // A path inside the machine, where no working directory makes a
      // relative one mean what the person who wrote it could see.
      if (!target.startsWith('/')) throw new Error(`${at}.copy[${String(index)}].target is not an absolute path`);
      copy.push({ source, target });
    });
  }
  if (block.part !== undefined && (typeof block.part !== 'string' || !PART_ID.test(block.part))) throw new Error(`${at}.part is not a part id`);
  if (block.state !== undefined && (typeof block.state !== 'string' || !block.state.startsWith('/'))) throw new Error(`${at}.state is not an absolute path`);
  const seed = block.seed === undefined ? undefined : seedsOf(block.seed, `${at}.seed`);
  return {
    ...(Object.keys(env).length === 0 ? {} : { env }),
    ...(copy.length === 0 ? {} : { copy }),
    ...(block.part === undefined ? {} : { part: block.part as string }),
    ...(block.state === undefined ? {} : { state: block.state as string }),
    ...(seed === undefined ? {} : { seed }),
  };
};

/** The fields a preset's `machine` takes. */
const MACHINE_KEYS = ['env', 'copy', 'part', 'state', 'seed'];

/** A part id, as the versions file names one. */
const PART_ID = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

/** A `machine.seed` list, each entry a host `source` with an optional `target`, `keep` and `drop`. */
const seedsOf = (said: unknown, at: string): Seed[] => {
  if (!Array.isArray(said)) throw new Error(`${at} is not a list`);
  return said.map((one: unknown, index): Seed => {
    const { source, target, keep, drop } = bagOf(one);
    const where = `${at}[${String(index)}]`;
    if (typeof source !== 'string' || source === '') throw new Error(`${where} needs a source`);
    if (target !== undefined && typeof target !== 'string') throw new Error(`${where}.target is not a string`);
    const words = (value: unknown, key: string): string[] | undefined => {
      if (value === undefined) return undefined;
      if (!Array.isArray(value) || value.some((word) => typeof word !== 'string')) throw new Error(`${where}.${key} is not a list of strings`);
      return value as string[];
    };
    const kept = words(keep, 'keep');
    const dropped = words(drop, 'drop');
    return {
      source,
      ...(target === undefined ? {} : { target: target as string }),
      ...(kept === undefined ? {} : { keep: kept }),
      ...(dropped === undefined ? {} : { drop: dropped }),
    };
  });
};

/**
 * A preset's machine: its row's, with the preset's own laid over it by key, and
 * each variable of `env` by name.
 */
const machineUnder = (row: AcpMachine | undefined, own: AcpMachine | undefined): AcpMachine | undefined => {
  if (row === undefined) return own;
  if (own === undefined) return row;
  const env = { ...row.env, ...own.env };
  return { ...row, ...own, ...(Object.keys(env).length === 0 ? {} : { env }) };
};

/**
 * One agent's options, out of a preset and the row it took.
 *
 * Everything a preset can be refused for is refused here and named by its own
 * key, so the caller says one line about it and the other presets carry on: a
 * `base` that names no row, no row and no `command`, an `authenticate` with no
 * `methodId`, a `$secret` the host cannot read, and a `machine` that is
 * wrongly written or reads a variable the daemon does not have.
 */
const presetOf = async (host: PluginHost, id: string, said: Record<string, unknown>, shared: unknown): Promise<AcpOptions> => {
  const by = `options.presets.${id}`;
  const listed = Object.keys(shipped).join(', ');
  const base = said.base;
  const row = typeof base === 'string' ? shipped[base] : undefined;
  if (base !== undefined && row === undefined) throw new Error(`${by}.base names ${String(base)}, which is not one of: ${listed}`);
  const taken = shipped[id] ?? row;
  const command = said.command ?? taken?.command;
  if (command === undefined) throw new Error(`${by} names no shipped preset and writes no command; the shipped presets are: ${listed}`);

  // Read before the preset's own `env`, which asks the vault: a block that
  // cannot be used refuses the preset without a secret being read for it.
  const machine = machineUnder(taken?.machine, said.machine === undefined ? undefined : machineOf(said.machine, by));
  const env = { ...(taken?.env ?? {}), ...await secretsOf(host, said.env, `${by}.env`) };
  // Checked here rather than by the schema, which says this key is an object
  // and cannot say the id inside it is the sign-in to a method of no name.
  const own = said.authenticate === undefined ? undefined : bagOf(said.authenticate);
  if (own !== undefined && (typeof own.methodId !== 'string' || own.methodId === '')) {
    throw new Error(`${by}.authenticate.methodId is required`);
  }
  /*
   * A row's sign-in is decided after its `env` is resolved, because a variable
   * written as a `$secret` is only a variable once it has been read.
   */
  const wanted = taken?.authenticate;
  const authenticate = own ?? (wanted !== undefined && wanted.fromEnv.some((one) => process.env[one] !== undefined || env[one] !== undefined)
    ? { methodId: wanted.methodId }
    : undefined);
  // A machine also has the block's variables, so a row's variable written
  // there signs a session in that machine in. Only the name is looked for.
  const inMachine = own === undefined && authenticate === undefined && wanted !== undefined
    && wanted.fromEnv.some((one) => machine?.env?.[one] !== undefined)
    ? { methodId: wanted.methodId }
    : undefined;

  const args = said.args ?? taken?.args;
  const cwd = said.cwd;
  const description = said.description;
  const model = said.model;
  const hostTools = typeof said.hostTools === 'boolean' ? said.hostTools : (typeof shared === 'boolean' ? shared : undefined);
  return {
    command: command as string,
    provider: id,
    variant: true,
    displayName: (typeof said.name === 'string' ? said.name : taken?.name) ?? id,
    // The log is the daemon's own - the same line `agent-claude` writes its
    // warnings to.
    log: (line) => host.log(line),
    ...(Object.keys(env).length === 0 ? {} : { env }),
    ...(args === undefined ? {} : { args: args as string[] }),
    ...(cwd === undefined ? {} : { cwd: cwd as string }),
    ...(description === undefined ? {} : { description: description as string }),
    ...(model === undefined ? {} : { model: model as string }),
    ...(authenticate === undefined ? {} : { authenticate: authenticate as NonNullable<AcpOptions['authenticate']> }),
    ...(hostTools === undefined ? {} : { hostTools }),
    ...(machine === undefined ? {} : { machine }),
    ...(inMachine === undefined ? {} : { authenticateInMachine: inMachine }),
  };
};

/**
 * One `AcpOptions` per preset that resolved, out of values `optionsSchema` has
 * checked.
 *
 * `presets` is the one option whose contents the schema cannot check per key,
 * and a failure belongs to the preset it came from: one whose `base` names no
 * row, whose own `authenticate` carries no `methodId`, whose `$secret` cannot
 * be read, or whose `machine` cannot be resolved is left out with one line
 * naming it and the rest register.
 * The load fails only when nothing is left, because a daemon with no ACP agent
 * at all is not a daemon somebody configured.
 */
export const optionsOf = async (host: PluginHost, values: Record<string, unknown>): Promise<AcpOptions[]> => {
  for (const key of PER_PRESET) {
    if (values[key] !== undefined) throw new Error(`options.${key} is written per preset, as presets.<id>.${key}`);
  }
  const held: AcpOptions[] = [];
  const dropped: string[] = [];
  for (const [id, given] of Object.entries(bagOf(values.presets))) {
    try {
      held.push(await presetOf(host, id, bagOf(given), values.hostTools));
    }
    catch (error) {
      // Said twice, once where it is asked for and once where a start reads
      // what it came up without; the refusal below names the presets, not the
      // messages.
      const line = `${name}: ${error instanceof Error ? error.message : String(error)}`;
      host.log(line);
      host.problem(line);
      dropped.push(id);
    }
  }
  if (held.length === 0) {
    throw new Error(dropped.length === 0
      ? 'presets names no preset left to register an agent for'
      : `presets names no preset left to register an agent for: ${dropped.join(', ')}`);
  }
  return held;
};

/** Register one ACP agent per preset, from the options of this one load. */
export const apply: Plugin['apply'] = async (host, options) => {
  for (const one of await optionsOf(host, options)) host.registerAgent(acpAgent(one));
};
