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
 * One load serves every ACP agent, and each agent is a record of the engine `acp`:
 * its own program, arguments, sign-in and machine. A record whose id names a
 * shipped row takes that row's values, and a record that names none writes the
 * program it runs itself, so one package serves Copilot, Codex and a server
 * nobody has heard of at once.
 */

import type { Engine, AgentView, Plugin, PluginHost, SecretRef, Seed, ToolsChanged } from '@ahpd/sdk';
import { bag, fromEnvRef, secretRef } from '@ahpd/sdk';
import { acpAgent } from './agent.js';
import { KEY_VARIABLES, presets as shipped, templates } from './presets.js';
import type { AcpMachine, AcpOptions } from './types.js';

/** The plugin's id, unique among the plugins one daemon loads. */
export const name = 'agent-acp';

/**
 * What a listing prints for this package.
 *
 * The manifest's `ahpd.title` carries the same string to `ahpd plugin list`,
 * which must not import the module to read it; this export is for an embedder
 * that imports the entry directly.
 */
export const title = 'Agent ACP';

/** One option's value in a record's `env`: a variable, or the name of a secret it is. */
const envValue = { type: 'string', secret: true, secretAtUse: true };

/** One name a `$secret` or a `fromEnv` reference is written as. */
const referenceOf = (keyword: '$secret' | 'fromEnv'): Record<string, unknown> => ({
  type: 'object',
  properties: { [keyword]: { type: 'string' } },
  required: [keyword],
  additionalProperties: false,
});

/**
 * One value of `machine.env`: text, or a reference to where the text comes from.
 *
 * Every value is a credential wherever the server keeps one, so it is marked
 * `secret`: a client draws it and never reads it back.
 */
const MACHINE_ENV_VALUE = {
  secret: true,
  secretAtUse: true,
  oneOf: [
    { type: 'string' },
    referenceOf('fromEnv'),
    referenceOf('$secret'),
  ],
};

/** One host path copied into a machine, and where it lands. */
const COPIED = {
  type: 'object',
  properties: {
    source: { type: 'string', description: 'The host path copied in.' },
    target: { type: 'string', description: 'The absolute path inside the machine it lands at.' },
  },
  required: ['source', 'target'],
};

/** One host file a machine's state directory is seeded from. */
const SEEDED = {
  type: 'object',
  properties: {
    source: { type: 'string', description: 'The host path seeded from.' },
    target: { type: 'string', description: 'Where it lands in the state directory.' },
    keep: { type: 'array', items: { type: 'string' }, description: 'The top-level keys kept, for a JSON file.' },
    drop: { type: 'array', items: { type: 'string' }, description: 'The dotted paths removed, for a JSON file.' },
  },
  required: ['source'],
};

/**
 * One record's fields: one ACP server as this host runs it.
 *
 * A record whose id names a shipped row takes that row's values, and whatever
 * the record writes itself wins over the row. A record that names no row writes
 * the program it spawns, which is what makes a server nobody has heard of an
 * agent like any other.
 */
const RECORD_FIELDS: Record<string, Record<string, unknown>> = {
  base: { type: 'string', description: 'The shipped row this record takes, for an id that is not itself one.' },
  command: { type: 'string', description: 'The program to spawn as the ACP server.' },
  install: {
    type: 'object',
    properties: {
      all: { type: 'string', description: 'A line that installs it on every system the vendor supports.' },
      linux: { type: 'string', description: 'The install line on Linux.' },
      darwin: { type: 'string', description: 'The install line on macOS.' },
      win32: { type: 'string', description: 'The install line on Windows.' },
    },
    description: "How to install this agent, by system, as the vendor's own docs give it. A system's key wins over all, and a system with no line is left to page.",
  },
  page: { type: 'string', description: "The vendor's install page, for a system the install lines do not cover." },
  args: { type: 'array', items: { type: 'string' }, description: 'The arguments to give it, replacing the row\'s own.' },
  env: { type: 'object', additionalProperties: envValue, description: "Environment variables merged over the daemon's own for the child, by variable name. A variable is a credential wherever the server keeps one, so each answers <set>; a value written { \"$secret\": \"host:<name>\" } is read from the vault for this agent's owner." },
  cwd: { type: 'string', description: "The directory the server runs in; the session's working directory when absent." },
  authenticate: {
    type: 'object',
    properties: { methodId: { type: 'string' } },
    required: ['methodId'],
    description: 'The sign-in to send after the handshake, as the methodId of a method the server lists in authMethods. A value naming one it does not offer fails the turn that opened.',
  },
  hostTools: { type: 'boolean', description: "Whether this agent's sessions are offered the host's own tools, over the plugin-wide setting." },
  honoursTrust: { type: 'boolean', description: "Whether this agent asks before it loads a project's own settings and hooks. Absent, a session of it in a folder the host did not vouch for is refused rather than started, because ACP carries no trust field." },
  toolsChanged: {
    type: 'string',
    enum: ['notify', 'list'],
    description: "How this agent hears that the tools it listed have moved: notify holds a stream open and sends notifications/tools/list_changed down it, list says nothing and leaves it to the agent's next tools/list. Both serve the current list; defaults to notify.",
  },
  cutTurns: {
    type: 'string',
    enum: ['error', 'complete'],
    description: "How a turn the server stopped at max_tokens, max_turn_requests or by a refusal ends: error ends it in chat/error typed by the reason, complete completes it as VS Code's agents do. Defaults to error.",
  },
  stderrTail: {
    type: 'string',
    enum: ['sentence', 'log'],
    description: "Where the last of a failed server's stderr goes: sentence puts it under the failure in the error a client is shown, log leaves it to the daemon's log as VS Code's agents do. Each line is logged either way; defaults to sentence.",
  },
  modes: {
    type: 'string',
    enum: ['refreshed', 'preset'],
    description: "Where this agent's modes come from: refreshed lists the row's until a session hears its server's, then the modes the last session's server named; preset keeps the row's as declared, as VS Code's agents do. Defaults to refreshed.",
  },
  unreportedClientCalls: {
    type: 'string',
    enum: ['row', 'error'],
    description: "What a request for a client's tool that no reported call matched gets: row holds it in a row of its own and asks its owner, error answers it with an error result as VS Code's client tool server does. Defaults to row.",
  },
  // Read by `machineOf` as well as described here, so a wrongly written block
  // is refused with a line naming the field and never a value. A variable's
  // value is read where the machine is made, so a `$secret` reaches this
  // plugin as the name it wrote.
  machine: {
    type: 'object',
    description: 'What a machine needs to run this agent: env, variables set only inside the machine, each a string, { fromEnv: NAME } read from the daemon\'s NAME when the record opens, or { "$secret": "<scope>:<name>" } read when the machine is made; copy, a list of { source, target } host paths copied in; part, the id of the part its CLI comes from; state, the absolute directory it keeps its configuration in; and seed, the host files that directory is seeded from.',
    properties: {
      env: { type: 'object', additionalProperties: MACHINE_ENV_VALUE, description: 'Variables set inside the machine, by name.' },
      copy: { type: 'array', items: COPIED, description: 'Host paths copied into the machine, each { source, target }.' },
      part: { type: 'string', description: "The part the agent's CLI comes from, a string naming its id in the host's versions file." },
      state: { type: 'string', description: 'The absolute directory inside the machine the agent keeps its configuration in, as a state volume.' },
      seed: { type: 'array', items: SEEDED, description: 'The host files the state directory is seeded from, each { source, target, keep, drop }: source the host path, target where it lands in the directory, and for a JSON file keep the top-level keys kept and drop the dotted paths removed.' },
    },
  },
};

/**
 * The `acp` engine's schema: the fields a record of it may set.
 *
 * A record may set `hostTools` and `toolsChanged` as well, overriding the
 * plugin's own for itself, because those are choices about one agent rather
 * than about the daemon.
 */
const kindSchema = (): Record<string, unknown> => ({
  type: 'object',
  properties: RECORD_FIELDS,
});

/**
 * The options `apply` receives, as a JSON Schema the daemon checks them against
 * before `apply` runs.
 *
 * The schema is written in this package's package.json, at `ahpd.optionsSchema`,
 * so a listing reads it without importing this module and a plugin switched off
 * still has a form a client draws. What is left are the daemon's answers for
 * every agent: the agents themselves are records, and what one record holds is
 * checked by `optionsOfRecord`.
 */

/** One of the two ways an agent hears its list moved, for a value that says one. */
const changedOf = (value: unknown): ToolsChanged | undefined =>
  value === 'notify' || value === 'list' ? value : undefined;

/**
 * What the plugin's own options are for every agent of one load.
 *
 * `hostTools` and `toolsChanged` are the daemon's answer for every agent it
 * serves, which a record may override for itself. The log is the daemon's own,
 * so a line from a record is said where the plugin's is.
 */
interface Shared {
  log: (line: string) => void;
  hostTools?: boolean;
  toolsChanged?: ToolsChanged;
}

/** The plugin's own options, read out of the values one load was given. */
const defaultsOf = (host: PluginHost, values: Record<string, unknown>): Shared => {
  const hostTools = typeof values.hostTools === 'boolean' ? values.hostTools : undefined;
  const toolsChanged = changedOf(values.toolsChanged);
  return {
    log: (line) => host.log(line),
    ...(hostTools === undefined ? {} : { hostTools }),
    ...(toolsChanged === undefined ? {} : { toolsChanged }),
  };
};

/**
 * One record's `machine`, with every `{ fromEnv }` read and every `$secret` kept.
 *
 * A variable read from the daemon's environment is settled each time the record
 * opens, and one the daemon does not have refuses the record, as a record's own
 * `env` does in `agent-claude`. A `$secret` is not read: the machine it is for
 * has an owner, and the computer plugin reads it for that owner when it makes
 * the machine. Every refusal names the field and never a value.
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
      const named = fromEnvRef(value);
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
      const { source, target } = bag(one);
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

/** The fields a record's `machine` takes. */
export const MACHINE_KEYS = ['env', 'copy', 'part', 'state', 'seed'];

/** A part id, as the versions file names one. */
const PART_ID = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

/** A `machine.seed` list, each entry a host `source` with an optional `target`, `keep` and `drop`. */
const seedsOf = (said: unknown, at: string): Seed[] => {
  if (!Array.isArray(said)) throw new Error(`${at} is not a list`);
  return said.map((one: unknown, index): Seed => {
    const { source, target, keep, drop } = bag(one);
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
 * A record's machine: its row's, with the record's own laid over it by key, and
 * each variable of `env` by name.
 */
const machineUnder = (row: AcpMachine | undefined, own: AcpMachine | undefined): AcpMachine | undefined => {
  if (row === undefined) return own;
  if (own === undefined) return row;
  const env = { ...row.env, ...own.env };
  return { ...row, ...own, ...(Object.keys(env).length === 0 ? {} : { env }) };
};

/**
 * One record's options, out of the values its engine's schema held it to and the
 * plugin's own.
 *
 * The channel owns the record's name, description and model, so those come
 * from the record rather than from its config; the id is the provider. What is
 * left is the engine's own fields, each taken as the type its schema declares,
 * because a record written straight into the collection is not a value that
 * was checked at the door.
 *
 * A record whose id names a shipped row takes that row's command, arguments,
 * environment, sign-in and machine, and whatever the record writes itself wins
 * over the row. A record that names no row writes the program it spawns, and a
 * record with neither is refused, naming itself and no value.
 *
 * An empty `env` value is dropped rather than set: a template names its
 * vendor's key variables as empty fields, and a variable set to nothing is a
 * variable the server reads as set. A `machine` is read with every `{ fromEnv }`
 * settled and every `$secret` kept; a record's live view has already had each
 * `{ $secret }` under `env` read from the vault.
 *
 * Nothing here logs or says a value: the errors name a field, and the env is
 * only ever handed to the spawn.
 */
const optionsOfRecord = (shared: Shared, record: AgentView): AcpOptions => {
  const config = record.config;
  const base = typeof config['base'] === 'string' ? config['base'] : undefined;
  const row = shipped[record.id] ?? (base === undefined ? undefined : shipped[base]);
  if (base !== undefined && row === undefined) {
    throw new Error(`${record.id}.base names a row this plugin does not ship; the shipped rows are: ${Object.keys(shipped).join(', ')}`);
  }
  const command = typeof config['command'] === 'string' && config['command'] !== ''
    ? config['command']
    : row?.command;
  if (command === undefined) {
    throw new Error(`${record.id} names no command, and an acp record names the program its sessions run`);
  }
  const env: Record<string, string> = { ...(row?.env ?? {}) };
  for (const [variable, value] of Object.entries(bag(config['env']))) {
    if (typeof value === 'string' && value !== '') env[variable] = value;
  }
  const args = Array.isArray(config['args'])
    ? config['args'].filter((one): one is string => typeof one === 'string')
    : row?.args;
  const own = config['authenticate'] === undefined ? undefined : bag(config['authenticate']);
  const authenticate = own !== undefined && typeof own['methodId'] === 'string' && own['methodId'] !== ''
    ? { methodId: own['methodId'] as string }
    : undefined;
  /*
   * A row's sign-in is decided after its `env` is settled, because a variable
   * written as a `$secret` is only a variable once it has been read.
   */
  const wanted = row?.authenticate;
  const signedIn = authenticate ?? (wanted !== undefined && wanted.fromEnv.some((one) => process.env[one] !== undefined || env[one] !== undefined)
    ? { methodId: wanted.methodId }
    : undefined);
  const cwd = typeof config['cwd'] === 'string' && config['cwd'] !== '' ? config['cwd'] : undefined;
  const hostTools = typeof config['hostTools'] === 'boolean' ? config['hostTools'] : shared.hostTools;
  const toolsChanged = changedOf(config['toolsChanged']) ?? shared.toolsChanged;
  const honoursTrust = typeof config['honoursTrust'] === 'boolean' ? config['honoursTrust'] : row?.honoursTrust;
  const cutTurns = config['cutTurns'] === 'error' || config['cutTurns'] === 'complete' ? config['cutTurns'] : undefined;
  const stderrTail = config['stderrTail'] === 'sentence' || config['stderrTail'] === 'log' ? config['stderrTail'] : undefined;
  const modesFrom = config['modes'] === 'refreshed' || config['modes'] === 'preset' ? config['modes'] : undefined;
  const unreported = config['unreportedClientCalls'];
  const unreportedClientCalls = unreported === 'row' || unreported === 'error' ? unreported : undefined;
  const machine = machineUnder(row?.machine, config['machine'] === undefined ? undefined : machineOf(config['machine'], record.id));
  // A machine also has the block's variables, so a row's variable written
  // there signs a session in that machine in. Only the name is looked for.
  const inMachine = own === undefined && signedIn === undefined && wanted !== undefined
    && wanted.fromEnv.some((one) => machine?.env?.[one] !== undefined)
    ? { methodId: wanted.methodId }
    : undefined;
  return {
    command,
    provider: record.id,
    displayName: record.name,
    log: shared.log,
    ...(Object.keys(env).length === 0 ? {} : { env }),
    ...(args === undefined ? {} : { args }),
    ...(cwd === undefined ? {} : { cwd }),
    // The record's own `authenticate`, else the row's once a variable it names
    // is set: the sign-in the row documents is not a second option.
    ...(signedIn === undefined ? {} : { authenticate: signedIn }),
    ...(hostTools === undefined ? {} : { hostTools }),
    ...(honoursTrust === undefined ? {} : { honoursTrust }),
    ...(toolsChanged === undefined ? {} : { toolsChanged }),
    ...(cutTurns === undefined ? {} : { cutTurns }),
    ...(stderrTail === undefined ? {} : { stderrTail }),
    ...(modesFrom === undefined ? {} : { modesFrom }),
    ...(unreportedClientCalls === undefined ? {} : { unreportedClientCalls }),
    // The row's known modes, copied so each agent holds a list of its own.
    ...(row?.modes === undefined ? {} : { modes: row.modes.map((one) => ({ ...one })) }),
    ...(machine === undefined ? {} : { machine }),
    ...(inMachine === undefined ? {} : { authenticateInMachine: inMachine }),
    ...(record.description === undefined ? {} : { description: record.description }),
    ...(record.model === undefined ? {} : { model: record.model }),
  };
};

/**
 * The `acp` engine: the form a record of it fills in, the rows a new record
 * starts from, and the backend each record opens.
 *
 * A record names a shipped row, or writes its own program. The row the record
 * takes, the command, the arguments, the directory and the machine are
 * host-only: a team's or a person's record that set one could run a program of
 * its choosing. The vendor key variables are key fields, so any owner may carry
 * its own key in the vault while every other variable stays the host's to set.
 *
 * `open` builds one backend from the record and hands it a `presetOf` that
 * reads the record again, so a session spawned after an edit is built from
 * what the record says then.
 */
const engineOf = (host: PluginHost, values: Record<string, unknown>): Engine => {
  const shared = defaultsOf(host, values);
  return {
    name: 'acp',
    title: 'Agent Client Protocol',
    description: 'An ACP server as an agent, with one record per server: its own command, arguments, sign-in and machine.',
    schema: kindSchema(),
    templates: templates(),
    templateOf: (record, made) => {
      const base = typeof record.config['base'] === 'string' ? record.config['base'] : undefined;
      const row = shipped[record.id] ?? (base === undefined ? undefined : shipped[base]);
      return row === undefined ? undefined : made.find((one) => one.name === row.name);
    },
    hostOnly: ['base', 'command', 'args', 'cwd', 'machine', 'install'],
    keyVariables: KEY_VARIABLES,
    open: (record) => acpAgent({
      ...optionsOfRecord(shared, record),
      presetOf: () => optionsOfRecord(shared, record),
    }),
  };
};

/**
 * Register the `acp` engine.
 *
 * The agents are records of it: one load serves every ACP server, and each
 * record says which one it runs.
 */
export const apply: Plugin['apply'] = (host, options) => {
  host.registerEngine(engineOf(host, options));
};
