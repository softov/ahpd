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
  /** What this option is when nothing named one: the spec's `default` of a config property. */
  default?: unknown;
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
 * Adaptive by default: an install whose record names nothing is the empty
 * record, and it answers with thinking the agent decides on.
 */
export const thinking: Declaration = {
  schema: {
    type: 'string',
    enum: ['adaptive', 'disabled'],
    description: 'Extended thinking. The agent decides when to think, or there is none.',
  },
  default: 'adaptive',
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
  default: true,
};

/**
 * Whether the host's own tools reach a session of this agent.
 *
 * On by default. Read by `clienttools.ts` where the CLI's in-process servers
 * are declared: off leaves the `host` server out and keeps the `client` one, so
 * a client's tools still reach the agent.
 */
export const hostTools: Declaration = {
  schema: {
    type: 'boolean',
    description: "Whether this agent's sessions are offered the host's own tools, over the plugin-wide setting.",
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
 * Whether Claude's own task tools are on when Claude keeps them.
 *
 * On by default, as the CLI's Task tools are, and read where the CLI's
 * environment is built: a session that keeps its own tools with this off is
 * started with `CLAUDE_CODE_ENABLE_TASKS=0`, which gives it the legacy
 * `TodoWrite` instead, unless a record's own `env` gives the variable a value.
 * https://code.claude.com/docs/en/env-vars
 */
export const enableTasks: Declaration = {
  schema: {
    type: 'boolean',
    description: "Whether Claude's own Task tools are on when Claude keeps them; off gives it TodoWrite instead. On by default.",
  },
  default: true,
};

/**
 * Whether the Approvals control offers the SDK's `dontAsk` beside VS Code's
 * five modes.
 *
 * On by default, so a session nobody watches can refuse rather than wait on a
 * person (decision claude-approvals-keeps-dont-ask: "`permissionMode` keeps
 * its six values, `dontAsk` included"); off offers VS Code's five alone. Read
 * by the schema and by the session's `setConfig`.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/claude/claudeAgent.ts#L2273-L2309
 */
export const dontAsk: Declaration = {
  schema: {
    type: 'boolean',
    description: "Whether the Approvals control offers the SDK's dontAsk beside VS Code's five modes; off offers VS Code's five alone. On by default.",
  },
  default: true,
};

/**
 * The first wait and the longest between the reads that follow a background
 * shell's output, in milliseconds: VS Code's output monitor's 500 ms and 10 s
 * by default, read where the follow starts.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/workbench/contrib/terminalContrib/chatAgentTools/browser/tools/monitoring/types.ts#L45-L51
 */
export const taskOutputFirstWaitMs: Declaration = {
  schema: { type: 'integer', minimum: 1, description: "The first wait between the reads that follow a background shell's output, in milliseconds. 500 by default, as VS Code's output monitor." },
  default: 500,
};

export const taskOutputLongestWaitMs: Declaration = {
  schema: { type: 'integer', minimum: 1, description: "The longest wait between the reads that follow a background shell's output, in milliseconds. 10000 by default, as VS Code's output monitor." },
  default: 10_000,
};

/**
 * How many reads in a row of a background shell's output that find nothing
 * new count it quiet, so its next output brings the wait back to the first:
 * VS Code's output monitor's `MinIdleEvents`, 2, by default.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/workbench/contrib/terminalContrib/chatAgentTools/browser/tools/monitoring/types.ts#L45-L51
 */
export const taskOutputQuietReads: Declaration = {
  schema: { type: 'integer', minimum: 1, description: "How many reads in a row of a background shell's output that find nothing new count it quiet, so its next output brings the wait back to the first. 2 by default, as VS Code's output monitor." },
  default: 2,
};

/**
 * The longest title a worker chat takes from its task before it is cut, in
 * characters: VS Code's `SUBAGENT_CHAT_TITLE_MAX_LENGTH`, 60, by default.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/common/agent.ts#L1192
 */
export const subagentTitleMax: Declaration = {
  schema: { type: 'integer', minimum: 1, description: "The longest title, in characters, a worker chat takes from its task before it is cut. 60 by default, as VS Code's." },
  default: 60,
};

/**
 * How long a worker's start is waited for before its frames go unparented, in
 * milliseconds: VS Code's `SUBAGENT_START_TIMEOUT`, 30 s, by default.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentSideEffects.ts#L146
 */
export const subagentStartTimeoutMs: Declaration = {
  schema: { type: 'integer', minimum: 1, description: "How long, in milliseconds, a worker's frames are held for its spawn to be recorded. 30000 by default, as VS Code's." },
  default: 30_000,
};

/**
 * The longest shell init script a client may send, in characters: VS Code's
 * `MAX_SHELL_INIT_SCRIPT_LENGTH`, 64 KiB, by default.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/common/shellInitScript.ts#L111
 */
export const maxShellInitScript: Declaration = {
  schema: { type: 'integer', minimum: 1, description: "The longest shell init script, in characters, a client may send. 65536 by default, as VS Code's." },
  default: 64 * 1024,
};

/**
 * The largest saved shell output a call names a terminal for, in bytes: VS
 * Code's limit on a kept terminal output, 10 MiB, by default.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/common/sessionDataService.ts#L19
 */
export const maxTerminalOutputBytes: Declaration = {
  schema: { type: 'integer', minimum: 1, description: "The largest saved shell output, in bytes, a call names a terminal for. 10485760 by default, as VS Code's." },
  default: 10 * 1024 * 1024,
};

/** How many call ids framed for a late handler are kept, 64 by default, as upstream planned it. */
export const keepFramed: Declaration = {
  schema: { type: 'integer', minimum: 1, description: "How many ids of the client tool calls the CLI framed are kept for a handler that runs late. 64 by default." },
  default: 64,
};

/**
 * The quiet before the customization folders' watch calls, in milliseconds:
 * VS Code's Claude customization watcher's 300 ms by default.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/claude/customizations/claudeSessionCustomizationDiscovery.ts#L474
 */
export const watchWaitMs: Declaration = {
  schema: { type: 'integer', minimum: 0, description: "How long, in milliseconds, the customization folders' watch waits after a change before it reads them again. 300 by default, as VS Code's Claude watcher." },
  default: 300,
};

/** The most of a customization file read for its frontmatter, in bytes, 64 KiB by default, as upstream planned it. */
export const fileMostBytes: Declaration = {
  schema: { type: 'integer', minimum: 1, description: "The most of a customization file, in bytes, read for its frontmatter. 65536 by default." },
  default: 64 * 1024,
};

/** How deep the rules folders are walked, 32 by default, as upstream planned it. */
export const ruleDepth: Declaration = {
  schema: { type: 'integer', minimum: 0, description: 'How many folders deep a rules folder is walked. 32 by default.' },
  default: 32,
};

/** The most rule files read from one folder, 1000 by default, as upstream planned it. */
export const ruleMost: Declaration = {
  schema: { type: 'integer', minimum: 1, description: 'The most rule files read from one rules folder. 1000 by default.' },
  default: 1000,
};

/**
 * What a stop ends.
 *
 * `turn`, the default, interrupts the turn through the SDK's `interrupt()`
 * and keeps the CLI, ending only the workers the stopped turn spawned, so
 * background work from earlier turns keeps running (Softov 2026-09-26: "End
 * only the workers spawned in the cancelled turn; background workers from
 * earlier turns keep running."). `query` aborts the query as VS Code's agent
 * does, its workers and tasks with it. Read by the session's stop.
 * https://code.claude.com/docs/en/agent-sdk/typescript#query-object
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/claude/claudeSdkPipeline.ts#L487-L495
 */
export const stopEnds: Declaration = {
  schema: {
    type: 'string',
    enum: ['turn', 'query'],
    description: "What a stop ends: turn interrupts the turn and ends only the workers it spawned; query aborts the query, its workers and tasks with it, as VS Code's agent does. turn by default.",
  },
  default: 'turn',
};

/**
 * Where a restored session's worker chats are read from.
 *
 * `meta`, the default, reads each worker's file beside the session and links
 * it by the `toolUseId` its meta file names, which links two identical
 * delegations exactly (`.project/decisions/subagent-chats-are-restored-from-the-cli-meta-file.md`);
 * `sdk` reads the workers through the SDK's `listSubagents` and
 * `getSubagentMessages` and links them as VS Code's Claude resolver does.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/claude/claudeSubagentResolver.ts#L384-L396
 */
export const subagentsFrom: Declaration = {
  schema: {
    type: 'string',
    enum: ['meta', 'sdk'],
    description: "Where a restored session's worker chats are read from: meta reads the CLI's worker files and links each by its meta file; sdk reads them through the SDK's listSubagents and getSubagentMessages and links them as VS Code does. meta by default.",
  },
  default: 'meta',
};

/**
 * How a machine's port that could not start the CLI is said.
 *
 * `spawn`, the default, files the port's failure as a failure to start, so the
 * turn fails in the SDK's one sentence for that, which names no path on the
 * host (plan claude/22: "a spawn failure names its cause without a path");
 * `message` passes the failure on as it is, its own message the turn's error,
 * as VS Code's host shows a failed send's own message.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentSideEffects.ts#L2564-L2573
 */
export const portFailures: Declaration = {
  schema: {
    type: 'string',
    enum: ['spawn', 'message'],
    description: "How a machine's port that could not start the CLI is said: spawn files it as a failure to start, said in the SDK's sentence with no host path; message passes on its own message, as VS Code does. spawn by default.",
  },
  default: 'spawn',
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
export const DECLARED: Record<string, Declaration> = {
  sandbox, thinking, hostTasks, hostTools, enableTasks, stopEnds, dontAsk, portFailures, subagentsFrom,
  taskOutputFirstWaitMs, taskOutputLongestWaitMs, taskOutputQuietReads, subagentTitleMax, subagentStartTimeoutMs,
  maxShellInitScript, maxTerminalOutputBytes, keepFramed, watchWaitMs, fileMostBytes, ruleDepth, ruleMost,
  outputStyle, env, logins, extraArgs,
};

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
  Object.entries(DECLARED).filter(([, one]) => one.default !== undefined).map(([name, one]) => [name, one.default]),
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