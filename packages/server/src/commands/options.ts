/**
 * The daemon's flags as one declaration, and the file underneath them.
 *
 * Every flag is a field here: `@cofold/commands` spells each one for the
 * terminal, for help, for completion and for the JSON input a command is run
 * with. `http` and `proxy` are the fields that are not flags, because only the
 * file sets them. `configSchema` is the same fields as the file writes them, and
 * `optionsFrom` checks `config.json` against it and folds the canonical input a
 * surface produced over it.
 *
 * The fields carry no `default`, deliberately: a value that came from the
 * configuration file has to be told apart from one that came from a flag, and
 * a declared default would fill the input before the file was read. The
 * defaults live in `optionsFrom`, after the fold, where the order is visible.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { ArgumentError, CofoldError, check, type Field, type JsonSchema, type OptionSpec } from '@cofold/commands';
import { isRecord, secretRef } from '@ahpd/sdk';
import type { IssuerVerify, ManagedSettingsPermissions, McpServer, PayOrder, PluginSpec, ShellEnv } from '@ahpd/sdk';
import type { Config, HttpSetting, RoutesSetting } from '../config.js';
import { asSpec, configDir, configPath, eligibilityProblems, loadConfig, managedPermissionsProblems, shellEnvProblems } from '../config.js';
import { READY_TIMEOUT_MS } from '../daemon.js';
import { ICON_LIMIT, ICON_TIMEOUT_MS } from '../icons.js';
import { sourceOf, pluginIdOf, pluginIdsOf, runPlugins } from '../plugins.js';
import { proxyConfiguration, proxyProblems, proxySchema, type ProxyConfiguration } from '../proxy/providers.js';

/**
 * A schema that names the values of a map.
 *
 * cofold 0.3.0 types `additionalProperties` as a switch, but its `check` reads a
 * schema there: it accepts one and copies each value under it without holding
 * it, so the schema is what a client draws and the host still checks each value
 * itself. `models`, `mcpServers` and `shellEnv` are held to one of these, and
 * each value is kept honest by the host's own check beside it.
 */
export type MapSchema = Omit<JsonSchema, 'additionalProperties'> & {
  additionalProperties?: boolean | JsonSchema;
};

/** A `MapSchema` as cofold's own type, which spells `additionalProperties` as a switch. */
export const asJsonSchema = (schema: MapSchema): JsonSchema => schema as unknown as JsonSchema;

/** What this daemon was told, after argv and the configuration file were folded. */
export interface Options {
  /** TCP port to bind. 0 lets the OS choose. */
  port: number;
  /** Address to bind. Loopback unless asked otherwise. */
  host: string;
  /** Serve one connection over this process's own stdin and stdout. */
  stdio: boolean;
  /** The directories whose sessions this host serves, the first being the default. */
  paths: string[];
  /**
   * The folder this run was started in, when it serves that folder because no
   * flag and no file names one. Absent when a folder is named.
   */
  startFolder?: string;
  /** Serve only `paths`, and ask about no folder at all. */
  noCwd: boolean;
  /**
   * The folder every session worktree is made under, as an absolute path.
   *
   * Absent, a tree sits at `<repo>.worktrees` beside its repository, which is
   * where VS Code's host looks for it. With one, it is `<root>/<repo>/<name>`.
   */
  worktreesRoot?: string;
  /** The secret every connection must present, given directly. */
  token?: string;
  /** A file holding that secret. Written with a fresh one if it does not exist. */
  tokenFile?: string;
  /** Accept any connection, with no secret at all. */
  open: boolean;
  /** Read this configuration instead of the one XDG names. */
  configFile?: string;
  /** The file the people who may use this host are in, when there are any. */
  users?: string;
  /** The identifier this host advertises for its own sign-in. */
  resource?: string;
  /** The origins this host also answers to, beside its own names. */
  origins?: string[];
  /** Whether the API answers to the tunnels' host names. Off unless the file says. */
  tunnelHosts: boolean;
  /** An authorization server whose tokens this host also accepts. */
  issuer?: string;
  /** How a token from that issuer is checked, absent when the deployment said nothing. */
  issuerVerify?: IssuerVerify;
  /** Whether only a token from a person's issuer signs them in. */
  requireIssuer: boolean;
  /** How many tokens one person may mint for themselves. Default 10; 0 lets nobody mint one. */
  tokensPerPerson: number;
  /** Whether a tool that declares `advancedPermission` is offered to sessions. */
  advancedTools: boolean;
  /** Whether the session tools are offered to any session at all. */
  sessionTools: boolean;
  /** The providers whose sessions are offered the session tools. Empty offers them to every provider. */
  sessionToolsProviders: string[];
  /** What closing one chat of a session does to that chat's conversation in the backend. */
  closedChats: 'hidden' | 'delete';
  /** What a turn naming a model its chat's agent does not offer does. */
  unofferedModel: 'fail' | 'keep';
  /** Where a session that names no folder works. */
  workspacelessFolder: 'first' | 'scratch';
  /** Whose work a session a root connection starts is. */
  rootOwner: 'host' | 'none';
  /** Whether a turn's sender is said on what clients read. */
  turnSenders: 'said' | 'kept';
  /** What a backend's own background work actions come to. */
  backendBackgroundWork: 'drop' | 'say';
  /** What the session tools' counts are kept per. */
  agentOrchestrationLimitsScope: 'sessionTree' | 'session';
  /** What archiving a session does with a working tree that has changes nobody committed. */
  archiveDirtyWorktree: 'keep' | 'commit';
  /** What a session on a joined node does when that node's `ahpd join` restarts. */
  nodeRestart: 'end' | 'reconnect';
  /** How the merged sessions pass learns the state of a pull request. */
  pullRequestLookup: 'url' | 'branch';
  /** How the zsh folder shell integration points zsh at is taken when it is there already. */
  zshFolder: 'owned' | 'asFound';
  /** How a plugin whose entry points outside its own package is taken. */
  pluginEntryOutside: 'refuse' | 'warn';
  /** How an object a client writes to root config is written: over what the key holds, or in its place. */
  rootConfigWrite: 'merged' | 'replaced';
  /** The most one plugin icon may be, in bytes; 0 sets no limit. */
  iconLimitBytes: number;
  /** How long one fetch of an `https:` plugin icon may take. */
  iconTimeoutMs: number;
  /** How long a start waits for the daemon to say where it listens; 0 waits for ever. */
  readyTimeoutMs: number;
  /** How long a call a client runs may wait, absent when the deployment said nothing. */
  clientToolTimeoutMs?: number;
  /** How long a gone client keeps its place and its calls, absent when the deployment said nothing. */
  clientToolCallDisconnectTimeoutMs?: number;
  /** The environment every shell this host starts is given, absent when the deployment named none. */
  shellEnv?: ShellEnv;
  /** The rules a session's commands are matched against when no window pushed any. */
  terminalAutoApproveDefaults: 'vscode' | 'none';
  /** The managed permissions every session is held to, absent when the deployment set none. */
  managedSettingsPermissions?: ManagedSettingsPermissions;
  /** The tools whose calls ask every time, by `false`, absent when the deployment named none. */
  eligibleForAutoApproval?: Record<string, boolean>;
  /** Who checks the managed rules on a tool question: the host, or the backends it hands them to. */
  managedRules: 'checked' | 'handed';
  /**
   * A module whose default export reads a session's shell commands, as the
   * file's `commandParser` names it.
   *
   * Absent is the sdk's own splitter. The path is absolute, made so against the
   * file that set it. It has no flag: naming a module is the deployment's
   * decision, and the module runs in this process when the daemon starts.
   */
  commandParser?: string;
  /** How long a streamed delta waits in the host before it is sent, absent when the deployment said nothing. */
  deltaWindowMs?: number;
  /** Minutes of quiet before a session's agent is let go, absent when the deployment said nothing. */
  sleepAfterMinutes?: number;
  /** How many sessions are resident at most, absent when the deployment said nothing. */
  sessionResidencyLimit?: number;
  /** The largest file a client is asked for, in bytes, absent when the deployment said nothing. */
  attachmentFetchLimitBytes?: number;
  /** The most bytes of one tool result's inline content kept, absent when the deployment said nothing. */
  toolResultResourceLimitBytes?: number;
  /** Where automations are kept, and whether a clock fires them. */
  automations: 'file' | 'memory';
  /** What an automation that names no owner wakes on. */
  unownedAutomations: 'every' | 'none';
  /** Where the read and archived bits and a session's settings go. */
  sessions: 'file' | 'memory';
  /**
   * Whether a turn is written down once, when it ends, or a record per report.
   *
   * `usage.per` in the file, and defaulted here: `turn` is the mode the meter
   * was written for. It has no flag, as a mode of writing a record down is the
   * deployment's rather than one run's.
   */
  usagePer: 'turn' | 'report';
  /**
   * The zone a day and a week start in, and the store keeps its days in, as
   * `Intl` names it.
   *
   * Absent is the system's own zone. A week that begins on the system's Monday
   * day is what this is for, so it has no flag, as a zone is a fact about where
   * a deployment is rather than about one run.
   */
  usageTimezone?: string;
  /**
   * Whether the policies saying who may use which agent, model and computer are
   * enforced.
   *
   * `policies.check` in the file, and off unless it says otherwise. It has no
   * flag, as the decision to refuse somebody is one an operator makes about a
   * deployment rather than about one run.
   */
  policiesCheck: boolean;
  /**
   * Which row of one scope pays first when several can.
   *
   * `policies.payOrder` in the file, `ending` unless it says otherwise. It has
   * no flag, for the same reason `check` has none: which credit is spent first
   * is the deployment's, not one run's.
   */
  policiesPayOrder: PayOrder;
  /**
   * Whether a person reads the limits whose scope holds them.
   *
   * `policies.ownLimits` in the file, `true` unless it says otherwise. It has
   * no flag, as who may read a row's limits is the deployment's.
   */
  policiesOwnLimits: boolean;
  /**
   * The name of the service that holds this daemon, for one that runs beside
   * another.
   *
   * `service.name` in the file, and absent for the plain service. It has no
   * flag, as the file a service runs is the one place both the install and the
   * daemon read.
   */
  serviceName?: string;
  /** The `PATH` the unit or the agent gives the daemon: the installing shell's, or the manager's own. */
  servicePath: 'shell' | 'manager';
  /** A file every frame is appended to, both directions, one JSON line each. */
  wire?: string;
  /**
   * Whether the HTTP API is served, and where.
   *
   * Absent is off. `{}` is the daemon's own listener under `/api`; a `port`
   * moves it to a listener of its own. It has no flag, because the
   * decision put it in the configuration.
   */
  httpApi?: HttpSetting;
  /**
   * What `/mcp` serves to a person's MCP client.
   *
   * `none`, the default, answers 404 there. `all` serves the tools that need no
   * session and that the caller's grants allow. It is read when the run starts
   * and has no flag, because it is the deployment's choice rather than one
   * run's.
   */
  mcpTools: 'none' | 'all';
  /**
   * Where the plugins' routes are served.
   *
   * Absent is the daemon's own listener. A `port` is a listener of the routes'
   * own, which serves nothing else.
   */
  routes?: RoutesSetting;
  /** The providers this proxy calls and the model names that point at them. */
  modelProxy: ProxyConfiguration;
  /**
   * The MCP servers every session is offered, and the ones that were skipped.
   *
   * The host's own, by the name a person gave them; a session merges its
   * enabled client plugins' servers over these.
   */
  mcpServers: Record<string, McpServer>;
  /** Plugins to load, in the order they apply. */
  plugins: PluginSpec[];
  /** The plugins `--plugin` named, which every reload of the file's list adds again. */
  typedPlugins: PluginSpec[];
  /** Leave the configuration file's plugins out, and load only the `--plugin` ones. */
  noPlugins: boolean;
  /** Ask npm, in the background, whether a newer version exists. */
  updateCheck: boolean;
  /** One line for each key the configuration holds that this daemon does not know. */
  warnings: string[];
  /** The configuration files read, in the order they were merged. */
  configFiles: string[];
}

/**
 * A value as it was typed: JSON when it parses, and the text itself otherwise.
 * A number is kept only when it reads back exactly as typed, at any depth: at
 * the top a long id or `1.0` is the text instead, and inside an object or
 * array, where it cannot be, the value is refused with words saying to quote
 * it. A JSON string, `"123"`, is always text.
 */
export const typedValue = (typed: string): unknown => {
  let value: unknown;
  try { value = JSON.parse(typed) as unknown; }
  catch { return typed; }
  if (typeof value === 'number') return String(value) !== typed ? typed : value;
  if (typeof value !== 'object' || value === null) return value;
  for (const [literal] of typed.matchAll(/"(?:[^"\\]|\\.)*"|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/gu)) {
    if (literal.startsWith('"')) continue;
    const read = Number(literal);
    if (!Number.isFinite(read)) {
      stop(`${typed} holds ${literal}, too large to be a number; write it in quotes, as a JSON string.`);
    }
    if (String(read) !== literal) {
      stop(`${typed} holds ${literal}, which would be kept as ${String(read)}; write it in quotes, as a JSON string.`);
    }
  }
  return value;
};

/*
 * The return type is on the variable rather than the arrow, which is what tells
 * TypeScript a call to this never comes back: with it, a check like
 * `if (path === undefined) stop(...)` narrows `path` for every line after.
 */
export const stop: (message: string) => never = (message) => {
  throw new ArgumentError(message);
};

/**
 * A failure of the machine's state rather than of the words typed.
 *
 * The kind keeps the exit code a script sees, which is 1; the status is what a
 * served request answers with, because `serve()` reads a numeric `status` off a
 * thrown error and a daemon with nothing running is a conflict rather than
 * evidence that the daemon broke.
 */
export const conflict: (message: string) => never = (message) => {
  throw Object.assign(new CofoldError('conflict', message), { status: 409 });
};

/**
 * The three options that decide where a command runs.
 *
 * `--remote` is the whole switch, `--token` is the credential the API checks and
 * falls back to `AHPD_TOKEN` so it need not be on the line, and `--refresh`
 * re-reads a command surface that is otherwise cached on disk. They belong to the
 * program rather than to a run, so they sit outside `serverFields`, and they are
 * declared here because `start` reads the program's option table to find its own
 * word in the line.
 */
export const programGlobals: readonly OptionSpec[] = [
  { name: '--remote', value: 'URL', description: 'Run the administration commands against a daemon over its HTTP API, rather than here.' },
  { name: '--token', value: 'SECRET', description: 'The credential --remote presents. Defaults to AHPD_TOKEN.', env: 'AHPD_TOKEN' },
  { name: '--token-file', value: 'PATH', description: 'Read the credential --remote presents from this file.' },
  { name: '--refresh', description: 'Fetch the command surface --remote cached again.' },
];

/**
 * One `mcpServers` entry, as the file writes it and as an answer shows it.
 *
 * VS Code's two shapes, with `env` and `headers` marked `writeOnly`: a value in
 * either is a credential more often than not, and a header always is, so a
 * client is told it is set and never what it says.
 *
 * Typed as it is rather than as a `JsonSchema` because that type has no
 * `writeOnly` and its `additionalProperties` is a switch; the check below is
 * given it as one, which is what it is.
 */
export const mcpServerSchema: Record<string, unknown> = {
  type: 'object',
  properties: {
    type: { type: 'string', enum: ['stdio', 'http'] },
    command: { type: 'string', minLength: 1 },
    args: { type: 'array', items: { type: 'string' } },
    env: { type: 'object', additionalProperties: { type: 'string', writeOnly: true } },
    cwd: { type: 'string' },
    url: { type: 'string', minLength: 1 },
    headers: { type: 'object', additionalProperties: { type: 'string', writeOnly: true } },
  },
  required: ['type'],
};

/**
 * A `--plugin-option` as it was written up to its `=`: the path, and nothing
 * of the value after it.
 *
 * Every refusal about one of these quotes this and not the flag as typed. What
 * is set is an option some plugin is configured with, which is a credential
 * more often than not, and a refusal is printed on a terminal and written to a
 * log - so the message names the path and never what was being set there. A
 * flag written with no `=` holds no value to leave out, and is the text itself.
 */
const pathOf = (typed: string): string => {
  const equals = typed.indexOf('=');
  return equals === -1 ? typed : typed.slice(0, equals);
};

/**
 * What a value is, for a refusal that says the kind rather than the value.
 *
 * A refusal is printed on a terminal and written to a log, and what a
 * `--plugin-option` path runs into is an option some plugin is configured with,
 * which is a credential more often than not. So the message says what the value
 * is and never what it holds.
 */
const kindOf = (value: unknown): string => {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'a list';
  if (typeof value === 'string') return 'a string';
  if (typeof value === 'number') return 'a number';
  if (typeof value === 'boolean') return 'a boolean';
  return `a ${typeof value}`;
};

/**
 * `options` with `value` set at `path`, as an object none of the input holds.
 *
 * A key on the way down that is not there is made, the way `mkdir -p` makes
 * the directories on its way, so one run can add a preset the file has never
 * heard of. One that is there and is not a plain object is refused rather than
 * replaced, because setting into it would drop whatever it holds.
 *
 * What is there is read as an own key of the options and nothing else: a path
 * through `toString` or `constructor` is a key being made, not a function being
 * read, the way the `UNSETTABLE` keys are refused rather than written.
 *
 * A key inside a `$secret` reference is refused too, because the object would
 * still be there beside the key and would no longer be a reference at all: the
 * secret would be handed to the plugin as a plain object holding its name. Set
 * whole it is a value like any other, which is the branch above.
 *
 * `spelled` is the path as it was written, which the refusal quotes: the
 * `<plugin>.<key>` and not the `=value` after it, which is what `pathOf` is
 * for.
 */
/** Keys that name an object's prototype rather than a value it holds. */
const UNSETTABLE = new Set(['__proto__', 'constructor', 'prototype']);

const setAt = (options: Record<string, unknown> | undefined, path: readonly string[], value: unknown, spelled: string): Record<string, unknown> => {
  const [key, ...rest] = path as [string, ...string[]];
  if (UNSETTABLE.has(key)) stop(`--plugin-option sets ${spelled}, and ${key} is not a key an option can be set under.`);
  const here: Record<string, unknown> = { ...options };
  if (rest.length === 0) {
    here[key] = value;
    return here;
  }
  const where = path.slice(0, path.length - rest.length).join('.');
  const held = Object.hasOwn(here, key) ? here[key] : undefined;
  if (held !== undefined && !isRecord(held)) {
    stop(`--plugin-option sets ${spelled}, and ${where} holds ${kindOf(held)}, which is not an object the rest of the path could be set in.`);
  }
  const named = secretRef(held);
  if (named !== undefined) {
    stop(`--plugin-option sets ${spelled}, and ${where} is a reference to the secret ${named}: a key set inside it would leave the reference behind, so it is set as a whole or not at all.`);
  }
  here[key] = setAt(isRecord(held) ? held : undefined, rest, value, spelled);
  return here;
};

/**
 * The plugin one `--plugin-option` names, of the names a run loads, and the key
 * path after it.
 *
 * The name is the longest of `names` the text ahead of the `=` starts with and
 * has a dot after it, so a scoped package name and a path whose extension holds
 * a dot are both found by asking the list rather than by counting dots, and of
 * two names that both fit, such as `a` and `a.b` for `a.b.c`, the longer one is
 * the plugin and the rest is the key path - which is exactly how a start reads
 * the same flag.
 */
const pluginOptionIn = (head: string, names: readonly string[]): { plugin: string; path: string[] } | undefined => {
  let found: string | undefined;
  for (const name of names) {
    if (name === '' || !head.startsWith(`${name}.`)) continue;
    if (found === undefined || name.length > found.length) found = name;
  }
  if (found === undefined) return undefined;
  return { plugin: found, path: head.slice(found.length + 1).split('.') };
};

/**
 * One `--plugin-option` value, split the way a start splits it: the plugin it
 * names, the key path under that plugin's options, and the value.
 *
 * Split at the first `=`, so a value may hold one. The value is JSON when it
 * parses. Nothing when the text names none of `names`, and when it holds no
 * `=` or an empty key: a start refuses each of those, so a line one wrote holds
 * none of them. `plugin config` reads a recorded line with this, so what it
 * says about a flag is what a start would do with it.
 */
export const splitPluginOption = (
  typed: string,
  names: readonly string[],
): { plugin: string; path: string[]; value: unknown } | undefined => {
  const equals = typed.indexOf('=');
  const head = equals === -1 ? '' : typed.slice(0, equals);
  const named = pluginOptionIn(head, names);
  if (named === undefined || named.path.some((key) => key === '')) return undefined;
  return { ...named, value: typedValue(typed.slice(equals + 1)) };
};

/**
 * `mcpServers` as this run offers them, and what is wrong with the rest.
 *
 * The value schema on the key is for a client to draw a row from: `check`
 * copies a map value without holding it, and holding the whole map to it would
 * stop the start for one bad server. So each entry is checked on its own here,
 * and a bad entry is named and left out rather than refusing a start that would
 * have worked for every other server.
 *
 * Which shape an entry is decides what it must carry, which is the one rule a
 * single schema cannot state: a `stdio` server needs a `command` and an `http`
 * one a `url`.
 */
export const mcpServers = (
  held: unknown,
  source: (key: string) => string,
): { servers: Record<string, McpServer>; warnings: string[] } => {
  const servers: Record<string, McpServer> = {};
  const warnings: string[] = [];
  for (const [name, entry] of Object.entries(isRecord(held) ? held : {})) {
    const label = `${source('mcpServers')}: mcpServers.${name}`;
    let refused: string | undefined;
    try { check(entry, mcpServerSchema as JsonSchema, label); }
    catch (why: unknown) { refused = why instanceof Error ? why.message : String(why); }
    if (refused !== undefined) {
      warnings.push(refused);
      continue;
    }
    const shape = (entry as Record<string, unknown>)['type'];
    const needed = shape === 'stdio' ? 'command' : 'url';
    if ((entry as Record<string, unknown>)[needed] === undefined) {
      warnings.push(`${label} is a ${shape} server with no ${needed}; ignored`);
      continue;
    }
    servers[name] = entry as McpServer;
  }
  return { servers, warnings };
};

/**
 * The environment every shell this host starts is given: a variable name set to
 * its value, or to null to remove it.
 *
 * The value schema is what a client draws a row from. Each value is held by
 * `shellEnvProblems`, because `check` copies a map value without a check.
 */
const shellEnvField: MapSchema = {
  type: 'object',
  title: 'Shell environment',
  additionalProperties: { type: ['string', 'null'] },
  description: 'The environment every shell this host starts is given: a variable name set to its value, or to null to remove it, such as {"XDG_CONFIG_HOME": "/home/me/.config"}. Set in the configuration file only.',
};

/**
 * The operator's per-tool approval eligibility, with the declaration and the
 * words of VS Code's `chat.tools.eligibleForAutoApproval`, which VS Code's
 * host takes from that setting's policy value alone.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/common/agentHostManagedSettings.ts#L22-L26
 *
 * The value schema is what a client draws a row from. Each value is held by
 * `eligibilityProblems`, because `check` copies a map value without a check.
 */
const eligibleForAutoApprovalField: MapSchema = {
  type: 'object',
  title: 'Eligible for Auto Approval',
  additionalProperties: { type: 'boolean', title: 'Eligible' },
  description: "Controls which tools are eligible for automatic approval. Tools set to 'false' will always present a confirmation and will never offer the option to auto-approve. The default behavior (or setting a tool to 'true') may result in the tool offering auto-approval options. A tool is named as its backend names it, a tool this host offers as ahp/<name>, an MCP server's tool as <server>/<tool>, and every tool of a server as <server>/*. Set in the configuration file only.",
};

/**
 * The MCP servers every session is offered, by the name a person gave them.
 *
 * The value schema is one server, so a client draws a row per server; the
 * entries are still checked one at a time by `mcpServers`, so one bad server is
 * named and left out rather than stopping the start.
 */
const mcpServersField: MapSchema = {
  type: 'object',
  title: 'MCP servers',
  additionalProperties: mcpServerSchema as JsonSchema,
  description: 'The MCP servers every session is offered, by the name a person gave them: a stdio server is a command an agent starts, and an http one is an endpoint it calls. An env or a header is a credential wherever it is, so each answers <set>. A session adds the servers of its own client plugins over these. Set in the configuration file only.',
};

/** Every flag a run takes, as the fields help and the parser read. */
export const serverFields = {
  port: {
    type: 'integer',
    title: 'Port',
    description: 'Listen here. Default 9187; 0 picks a free one.',
    cli: { value: 'N' },
  },
  host: {
    type: 'string',
    title: 'Bind address',
    description: 'Bind here. Default 127.0.0.1. Pass 0.0.0.0 to accept from other machines, which needs a token.',
    cli: { value: 'ADDR' },
  },
  stdio: {
    type: 'boolean',
    description: 'Serve one connection over stdin and stdout instead of binding a port. This is how a host runs inside a container for another host to carry: one line of JSON per frame, no token, and the connection is this host itself.',
  },
  paths: {
    type: 'array',
    title: 'Folders',
    items: { type: 'string', title: 'Folder' },
    description: 'A directory this host serves. Repeatable; the first is the default a client gets when it names none.',
    cli: { flag: '--path', value: 'DIR' },
  },
  noCwd: {
    type: 'boolean',
    description: 'Serve only the folders named above, and never ask about the folder this was started in. Refused when none is named.',
    cli: { negatable: false },
  },
  worktreesRoot: {
    type: 'string',
    description: 'Keep every session worktree under this folder, as <dir>/<repo>/<name>. Default: <repo>.worktrees beside each repository.',
    cli: { value: 'DIR' },
  },
  connectionToken: {
    type: 'string',
    description: 'Require this secret on every connection.',
    cli: { value: 'SECRET' },
  },
  connectionTokenFile: {
    type: 'string',
    description: 'Require the secret in this file. A fresh one is written if the file is not there.',
    cli: { value: 'PATH' },
  },
  withoutConnectionToken: {
    type: 'boolean',
    description: 'Accept any connection. Only when the port is already reachable by nobody else.',
  },
  configFile: {
    type: 'string',
    description: 'Read this instead of the file under the configuration directory.',
    cli: { value: 'PATH' },
  },
  users: {
    type: 'string',
    description: 'The people who may use this host.',
    cli: { value: 'FILE' },
  },
  resource: {
    type: 'string',
    description: 'The https identifier this host advertises for its own sign-in. Default: derived from --host and --port.',
    cli: { value: 'URL' },
  },
  origins: {
    type: 'array',
    items: { type: 'string' },
    description: 'An origin this host also answers to, such as http://203.0.113.5:9187. Repeatable.',
    cli: { flag: '--origin', value: 'URL' },
  },
  tunnelHosts: {
    type: 'boolean',
    title: 'Tunnel host names',
    description: 'Answer the HTTP API to the host names of the tunnels this host keeps, as the plugin routes always do. Off by default: a tunnel is a fresh name on every start, and the API is an administration surface. Set in the configuration file only.',
  },
  issuer: {
    type: 'string',
    description: 'An authorization server whose tokens are also accepted: github, or an OpenID Connect issuer.',
    cli: { value: 'GITHUB|URL' },
  },
  issuerVerify: {
    type: 'string',
    enum: ['userinfo', 'jwt', 'auto'],
    description: 'How a token from --issuer is checked: userinfo asks the issuer what the token means, jwt checks it against the keys the issuer publishes, and auto takes the first reading that a token shaped like a JWT allows and userinfo for the rest. Default: userinfo.',
    cli: { value: 'userinfo|jwt|auto' },
  },
  requireIssuer: {
    type: 'boolean',
    description: "Only a token from a person's issuer signs them in; a local token only opens the socket.",
  },
  tokensPerPerson: {
    type: 'integer',
    minimum: 0,
    description: 'How many tokens one person may mint for themselves. Default 10; 0 lets nobody mint one.',
    cli: { value: 'N' },
  },
  advancedTools: {
    type: 'boolean',
    title: 'Advanced tools',
    description: "Offer the tools that declare they need advanced permission, such as the computer's three.",
  },
  sessionTools: {
    type: 'boolean',
    title: 'Session tools',
    description: 'Offer the session tools. On by default; --no-session-tools offers none.',
    cli: { negatable: true },
  },
  sessionToolsProviders: {
    type: 'array',
    items: { type: 'string', title: 'Provider' },
    title: 'Session tool providers',
    description: 'Offer the session tools only to the sessions of these providers. Empty offers them to every provider.',
    cli: { value: 'PROVIDER' },
  },
  closedChats: {
    type: 'string',
    enum: ['hidden', 'delete'],
    description: 'What closing one chat of a session does to its conversation in the backend: hidden keeps it, delete removes it.',
  },
  unofferedModel: {
    type: 'string',
    enum: ['fail', 'keep'],
    description: 'What a turn naming a model its chat\'s agent does not offer does: fail ends the turn, keep keeps the chat\'s model as VS Code does.',
  },
  workspacelessFolder: {
    type: 'string',
    enum: ['first', 'scratch'],
    description: 'Where a session that names no folder works: first, the first folder this daemon serves; scratch, a folder of its own under ~/.copilot/chats, removed with the session, as VS Code does.',
  },
  rootOwner: {
    type: 'string',
    enum: ['host', 'none'],
    description: 'Whose work a session a root connection starts is, under a users directory: host, the host itself as root:<hostName>; none, no one, as VS Code does.',
  },
  turnSenders: {
    type: 'string',
    enum: ['said', 'kept'],
    description: 'Whether a turn\'s sender is said on what clients read: said puts it on each start and message, kept keeps it on the host alone as VS Code does.',
  },
  backendBackgroundWork: {
    type: 'string',
    enum: ['drop', 'say'],
    description: 'What a backend\'s own background work actions come to: drop leaves every background row to the host, say says the backend\'s action as VS Code does.',
  },
  agentOrchestrationLimitsScope: {
    type: 'string',
    enum: ['sessionTree', 'session'],
    description: 'What the session tools\' counts of sessions and chats made and messages sent are kept per: sessionTree keeps one count for a session and every session grown from it, session keeps each session\'s own as VS Code does.',
  },
  archiveDirtyWorktree: {
    type: 'string',
    enum: ['keep', 'commit'],
    description: 'What archiving a session does with a working tree that has uncommitted changes: keep leaves the tree, commit commits the changes on its branch and removes the tree.',
  },
  nodeRestart: {
    type: 'string',
    enum: ['end', 'reconnect'],
    description: 'What a session on a joined node does when that node\'s "ahpd join" restarts: end ends it with a sentence, and the next turn resumes it by id; reconnect keeps it and opens it again on the socket the node dials when it comes back. Default end.',
  },
  pullRequestLookup: {
    type: 'string',
    enum: ['url', 'branch'],
    description: 'How merged sessions learn the state of a pull request: url asks for each pull request by its page, branch asks for the pull requests of the session\'s branch.',
  },
  zshFolder: {
    type: 'string',
    enum: ['owned', 'asFound'],
    description: 'How the folder shell integration points zsh at, under the temporary folder, is taken when it is there already: owned, the default, takes only a folder of this user\'s that is not a link, since another user can make the known name first; asFound sets its mode on whatever is there, as VS Code does.',
  },
  pluginEntryOutside: {
    type: 'string',
    enum: ['refuse', 'warn'],
    description: 'How a plugin whose entry points outside its own package is taken: refuse, the default, so a manifest cannot point its own package at somebody else\'s code; warn loads it with a warning on its row, as VS Code loads an extension whose main is outside its folder.',
  },
  iconLimitBytes: {
    type: 'integer',
    minimum: 0,
    description: 'The most one plugin icon may be, in bytes, a file, a data: URI or a fetched body, since every client receives each in full. Default 32768; 0 sets no limit.',
    cli: { value: 'BYTES' },
  },
  iconTimeoutMs: {
    type: 'integer',
    minimum: 0,
    description: 'How long one fetch of an https: plugin icon may take before the icon is given up. Default 10000, VS Code\'s for an image request.',
    cli: { value: 'MS' },
  },
  readyTimeoutMs: {
    type: 'integer',
    minimum: 0,
    description: 'How long ahpd start, and a restart starting the next daemon, waits for it to say where it is listening before stopping it. Default 60000; 0 waits for ever.',
    cli: { value: 'MS' },
  },
  stopWaitMs: {
    type: 'integer',
    minimum: 0,
    description: 'How long ahpd stop gives the daemon to go before it is killed. Default 5000, as VS Code\'s CLI gives its agent host server; 0 waits for ever. Set in the configuration file only.',
  },
  rootConfigWrite: {
    type: 'string',
    enum: ['merged', 'replaced'],
    description: 'How an object a client writes to root config is written: merged, the default, over what the key holds, a null taking a key back and a <set> leaving a credential as it is; replaced, each top-level key\'s value replaced whole, as the protocol\'s reducer applies a root config change.',
  },
  daemonRecord: {
    type: 'string',
    enum: ['fields', 'schemaVersion'],
    description: 'How daemon.json, the record of the running daemon, is read by the verbs that find it: fields, the default, reads each field as it is there, so an older daemon\'s record still names its daemon in the middle of an upgrade; schemaVersion ignores a record of another schemaVersion, as VS Code\'s CLI ignores a registry entry of another version. Set in the configuration file only.',
  },
  onPath: {
    type: 'string',
    enum: ['runnable', 'findExecutable'],
    description: 'How ahpd configure and ahpd doctor find a command on PATH: runnable, the default, takes a regular file with an execute bit and skips an empty entry; findExecutable is VS Code\'s lookup, any file that is not a folder, with an entry that is not absolute read against the working directory. Set in the configuration file only.',
  },
  clientToolTimeoutMs: {
    type: 'integer',
    minimum: 0,
    description: 'How long a call a client runs may wait. Default ten minutes; 0 waits for ever.',
    cli: { value: 'MS' },
  },
  clientToolCallDisconnectTimeoutMs: {
    type: 'integer',
    minimum: 0,
    description: 'How long a client whose connections all closed keeps its place in a session and the tool calls it owes there, as VS Code does. Default thirty seconds; 0 releases it at once.',
    cli: { value: 'MS' },
  },
  shellEnv: asJsonSchema(shellEnvField),
  terminalAutoApproveDefaults: {
    type: 'string',
    enum: ['vscode', 'none'],
    description: 'The rules a session\'s shell commands are matched against when no window pushed any: vscode uses VS Code\'s terminal auto-approve table, none approves no command.',
  },
  managedSettingsPermissions: {
    type: 'object',
    title: 'Managed permissions',
    properties: {
      disableBypassPermissionsMode: { type: 'string', enum: ['disable'] },
      deny: { type: 'array', items: { type: 'string' } },
      ask: { type: 'array', items: { type: 'string' } },
      limitTo: { type: 'array', items: { type: 'string' } },
    },
    additionalProperties: false,
    description: 'The managed permissions every session on the host is held to, in VS Code\'s shape: deny and ask rules in the managed rule grammar (Shell, Read, Write, Domain), disableBypassPermissionsMode "disable" to take Allow All away, and limitTo, the Domain rules a fetch stays within, each Domain or Domain(<host>) with the host as VS Code\'s network filter normalizes it. A Domain rule names a host whatever the scheme, port or path of a URL. A rule the managed grammar refuses stops the start. The host checks each rule on the tool questions of its kind beside the session\'s permissions, and hands the whole to every backend. Set in the configuration file only.',
  },
  eligibleForAutoApproval: asJsonSchema(eligibleForAutoApprovalField),
  managedRules: {
    type: 'string',
    enum: ['checked', 'handed'],
    description: 'Who checks managedSettingsPermissions and eligibleForAutoApproval on a tool question: checked has the host check each on every question of its kind; handed hands them to the backends and checks none, putting a question a backend marked managed with Allow Once and Skip, as VS Code does.',
  },
  commandParser: {
    type: 'string',
    title: 'Command parser',
    description: 'A .js or .ts module whose default export reads a shell command before the rules match it, as (line, shell) => ({ subCommands, writeDests, unanalyzable }) or undefined for a line it cannot read. A path is relative to the configuration file. A .ts module needs Node 22.18 or newer, Bun, or Deno, which strip types as they load. Set in the configuration file only.',
  },
  deltaWindowMs: {
    type: 'integer',
    minimum: 0,
    maximum: 1000,
    description: 'How long a streamed delta waits for the next one before it is sent. Default 75; 0 sends every delta as it arrives.',
    cli: { value: 'MS' },
  },
  sleepAfterMinutes: {
    type: 'integer',
    minimum: 0,
    description: 'Minutes a session with nothing in hand stays loaded before its agent is let go. It wakes when something needs it. Default 30; 0 never lets it go for quiet.',
    cli: { value: 'MINUTES' },
  },
  sessionResidencyLimit: {
    type: 'integer',
    minimum: 0,
    description: 'How many sessions are resident at most, running or with their state held. Over it, the least recently used one that nothing holds is let go, with its state. Default 10; 0 sets no limit.',
    cli: { value: 'COUNT' },
  },
  attachmentFetchLimitBytes: {
    type: 'integer',
    minimum: 0,
    description: 'The largest file a client is asked for when a message attaches one the daemon has no copy of; a larger one is left as it was sent. Default 33554432 (32 MiB); 0 sets no limit.',
    cli: { value: 'BYTES' },
  },
  toolResultResourceLimitBytes: {
    type: 'integer',
    minimum: 0,
    description: 'The most bytes the daemon keeps of one content a tool result or an agent\'s message carries inline, which a client reads back by a session-db-resource URI; larger content is left out. Default 8388608 (8 MiB), VS Code\'s bound; 0 sets no limit.',
    cli: { value: 'BYTES' },
  },
  automations: {
    type: 'string',
    enum: ['file', 'memory'],
    description: 'file keeps automations beside the configuration and fires their schedules; memory keeps them until this process ends.',
  },
  unownedAutomations: {
    type: 'string',
    enum: ['every', 'none'],
    description: 'What an automation that names no owner wakes on. every is the default: an automation nobody made is nobody\'s work, so every session is offered to it. none wakes on nothing.',
  },
  sessions: {
    type: 'string',
    enum: ['file', 'memory'],
    description: "Where the read and archived bits and a session's settings go.",
  },
  usage: {
    type: 'object',
    properties: {
      per: { type: 'string', enum: ['turn', 'report'] },
      timezone: { type: 'string' },
    },
    description: 'How a turn is written down: per "turn" writes one record when the turn ends, which is the default, and per "report" writes one record for every usage report a turn sends. timezone names, as Intl names one, the zone a day and a week start in and the zone the store keeps its days in, and is the system\'s own zone when it is absent. Set in the configuration file only.',
  },
  wire: {
    type: 'string',
    title: 'Wire capture',
    description: 'Append every frame, both directions, to this file as JSON lines.',
    cli: { value: 'FILE' },
  },
  policies: {
    type: 'object',
    properties: {
      check: { type: 'boolean' },
      payOrder: { type: 'string', enum: ['ending', 'regular', 'extra'] },
      ownLimits: { type: 'boolean' },
    },
    description: 'Whether the policies saying who may use which agent, model and computer are enforced: check refuses a session and a turn that no policy allows, naming the policy that refused it, and refuses a turn or a proxy call whose limits have no room left. Off by default, and the rows are written and listed either way. payOrder says which row of one scope pays first: ending (the default), regular or extra. ownLimits, true by default, lets a person read the limits that apply to them. Set in the configuration file only.',
  },
  service: {
    type: 'object',
    properties: {
      name: { type: 'string', pattern: '^[a-z0-9][a-z0-9-]{0,39}$' },
      path: { type: 'string', enum: ['shell', 'manager'] },
    },
    description: 'The service that holds this daemon. name, for a daemon that runs beside another in a configuration home of its own, a lowercase letter or digit and then up to 39 letters, digits and dashes, installs it as ahpd@<name> on systemd and dev.ahpd.daemon.<name> on launchd; absent is the plain ahpd and dev.ahpd.daemon. path is the PATH the daemon is given: shell, the default, is the PATH of the shell that ran ahpd service install, and manager sets none, so the daemon runs on the manager\'s own, as VS Code\'s CLI writes its unit. Set in the configuration file only.',
  },
  httpApi: {
    type: ['object', 'boolean'],
    title: 'HTTP API',
    properties: {
      port: { type: 'integer', title: 'Port', description: "The port of the API's own listener. Absent serves the API on the daemon's port.", minimum: 0, maximum: 65535 },
      host: { type: 'string', title: 'Host', description: "The address the API's own listener binds. Needs a port.", pattern: '^\\S+$' },
    },
    description: "Serve the HTTP API: true under /api on the daemon's own listener, or an object whose port gives it a listener of its own and whose host binds that listener. Set in the configuration file only.",
  },
  mcpTools: {
    type: 'string',
    enum: ['none', 'all'],
    title: 'MCP tools',
    description: "What /mcp serves to a person's MCP client: none, the default, answers 404 there; all serves every tool the caller's grants allow that needs no session. Needs httpApi. Set in the configuration file only.",
  },
  routes: {
    type: 'object',
    title: 'Plugin routes',
    properties: {
      port: { type: 'integer', title: 'Port', description: "The port of the routes' own listener. Absent serves the routes on the daemon's port.", minimum: 0, maximum: 65535 },
      host: { type: 'string', title: 'Host', description: "The address the routes' own listener binds. Needs a port.", pattern: '^\\S+$' },
    },
    description: "Where the plugins' routes are served. Absent is the daemon's own port. A port gives them a listener of their own that serves nothing else, and a host binds that listener. Set in the configuration file only.",
  },
  modelProxy: {
    ...proxySchema,
    title: 'Model proxy',
    description: 'The model names this proxy serves: each is written <maker>/<name> and lists the entries that serve it, by connector id or adapter name. A provider is a connector, so its endpoint and key are the connectors store\'s, never this file\'s. sessionCalls is record (the default) or skip: whether a call made with a session\'s own token is policy-checked and recorded by the proxy. keyRefusal is hostError (the default), this host\'s 502 when a provider refuses its key with a 401 or 403, or passthrough, the provider\'s status and error as they came, as VS Code\'s Claude proxy re-emits an upstream error. Set in the configuration file only.',
  },
  mcpServers: asJsonSchema(mcpServersField),
  plugins: {
    type: 'array',
    items: { type: 'string' },
    description: 'A package, a path, or a package installed in the configuration directory, loaded at startup. Repeatable. On the command line, each one is added to the configuration file\'s list. Naming one runs its code in this process with this process\'s permissions: installing a plugin is the trust decision.',
    cli: { flag: '--plugin', value: 'SPEC' },
  },
  noPlugins: {
    type: 'boolean',
    description: 'Leave the configuration file\'s plugins out, and load only the ones --plugin names.',
    cli: { negatable: false },
  },
  pluginOptions: {
    type: 'array',
    items: { type: 'string' },
    description: 'Set one option of a plugin for this run, over the configuration file: <plugin>.<key>=<value>, where everything after the plugin is a key path set as deep into the plugin\'s options as it goes, a key on the way down that is not there made as it goes; the value is read as JSON when it parses and as text otherwise. Repeatable.',
    cli: { flag: '--plugin-option', value: 'PLUGIN.KEY[.KEY...]=VALUE' },
  },
  updateCheck: {
    type: 'boolean',
    title: 'Update check',
    description: 'Ask npm, in the background, whether a newer version exists. On by default; --no-update-check, NO_UPDATE_NOTIFIER, CI and "updateCheck": false in the configuration turn it off.',
    cli: { negatable: true },
  },
} satisfies Record<string, Field>;

/** The fields only the configuration file sets, which have no flag. */
const FILE_ONLY = ['httpApi', 'mcpTools', 'routes', 'usage', 'modelProxy', 'policies', 'service', 'mcpServers', 'shellEnv', 'commandParser', 'tunnelHosts', 'onPath', 'daemonRecord', 'stopWaitMs'] as const;

/** The flags that mean something only when typed, which the file does not set. */
const TYPED_ONLY = ['stdio', 'configFile', 'noPlugins', 'noCwd', 'pluginOptions'] as const;

/** A copy of `fields` without the keys named. */
const without = <T extends Record<string, Field>, K extends keyof T>(fields: T, keys: readonly K[]): Omit<T, K> =>
  Object.fromEntries(Object.entries(fields).filter(([key]) => !(keys as readonly string[]).includes(key))) as Omit<T, K>;

/** Every flag a run takes: `serverFields` less the ones only the file sets. */
export const flagFields = without(serverFields, FILE_ONLY);

/** A key `config.json` may hold. */
export type ConfigKey = Exclude<keyof typeof serverFields, typeof TYPED_ONLY[number]>;

/** A field as a plain schema, without its terminal spelling and environment variable. */
const schemaOf = ({ cli: _cli, env: _env, ...schema }: Field): JsonSchema => schema;

/** One `plugins` entry as the file writes it: a spec, or an object naming one. */
const pluginEntry: JsonSchema = {
  type: ['string', 'object'],
  properties: {
    source: { type: 'string' },
    // What a listing prints. An entry written before `source` named the module
    // with this key, so one with no `source` still reads it as the module.
    name: { type: 'string' },
    // A plugin's own options are any JSON: the plugin checks them against its
    // own schema, and this one only says that an object stands there and that
    // its values are a plugin's to name.
    options: asJsonSchema({ type: 'object', additionalProperties: {} }),
    enabled: { type: 'boolean' },
    // What the plugin may do on this host when it acts as a client of its own:
    // `<subject>:<operation>`, checked by the loader, which drops what is not
    // one and says so. Empty or absent, it may do nothing.
    grants: { type: 'array', items: { type: 'string' } },
  },
};

/**
 * Every object entry of `plugins` that names no module, as a sentence each.
 *
 * The schema cannot say "one of these two keys", and `source` is the key a new
 * entry is written with while `name` alone is the old form, so the presence of
 * either is held here.
 */
const pluginProblems = (plugins: unknown): string[] => {
  if (!Array.isArray(plugins)) return [];
  return plugins.flatMap((entry, at) => {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) return [];
    const held = entry as Record<string, unknown>;
    return held.source === undefined && held.name === undefined ? [`plugins[${String(at)}].source is required`] : [];
  });
};

/**
 * What `config.json` may hold, as one object schema.
 *
 * Built from `serverFields`, so a flag added there is checked in the file too.
 * `plugins` takes objects as well as the strings `--plugin` does.
 */
export const configSchema: { type: 'object'; properties: Record<ConfigKey, JsonSchema> } = {
  type: 'object',
  properties: {
    ...Object.fromEntries(Object.entries(without(serverFields, TYPED_ONLY)).map(([key, field]) => [key, schemaOf(field)])) as Record<ConfigKey, JsonSchema>,
    plugins: { ...schemaOf(serverFields.plugins), items: pluginEntry },
  },
};

/**
 * Where a person is managed: the file and the address every `user` verb reads.
 *
 * What a record is written with is not here: those are on the verb that writes
 * them, so a flag is never offered where it is read by nothing.
 */
export const userAt = {
  configFile: serverFields.configFile,
  users: serverFields.users,
} satisfies Record<string, Field>;

/** The record fields a whole person is created with, in one go. */
const recordFields = {
  membership: {
    type: 'array',
    items: { type: 'string' },
    description: 'What their work may be charged to, written team, team:* or team:project. Repeatable; user member replaces the whole list.',
    cli: { value: 'TEAM[:PROJECT]' },
  },
  primary: {
    type: 'string',
    description: 'The one of those that work naming no scope of its own is charged to.',
    cli: { value: 'TEAM[:PROJECT]' },
  },
} satisfies Record<string, Field>;

/**
 * What `user add` takes: where the file is, the roles and the issuer, and the
 * whole record, in one call.
 */
export const userAddFields = {
  ...userAt,
  issuer: {
    type: 'string',
    description: "A provider of their own, rather than this host's default.",
    cli: { value: 'NAME' },
  },
  role: {
    type: 'array',
    items: { type: 'string' },
    description: 'A role to give them. Repeatable.',
    cli: { value: 'NAME' },
  },
  ...recordFields,
} satisfies Record<string, Field>;

/**
 * What `user token` takes: where the file is, the flag it prints the whole URL
 * with, and the address that URL names.
 *
 * The address is this verb's alone: a daemon started with `--host` and `--port`
 * rather than with a configuration file is named by nothing else, and a verb
 * that took one and read it by nothing would accept a port that means nothing.
 */
export const userTokenFields = {
  ...userAt,
  host: serverFields.host,
  port: serverFields.port,
  url: {
    type: 'boolean',
    description: 'Print the whole ws:// URL a client can be given.',
  },
} satisfies Record<string, Field>;

/**
 * The flag an unset is spelled, the way `user member` and `user primary` use it.
 *
 * A verb whose argument is positional cannot say "none of those" by leaving it
 * out, so the empty case is named rather than implied. A verb that can spare a
 * word declares a removal of its own instead, as `plugin config unset` does.
 */
export const unsetField = {
  type: 'boolean',
  description: 'Take it away, rather than setting one.',
} satisfies Field;

/** What `user primary` takes, which is a flag rather than a second way to name one. */
export const userPrimaryFields = {
  ...userAt,
  unset: { ...unsetField, description: 'Take their primary away, rather than setting one.' },
} satisfies Record<string, Field>;

/** Where a team or a project is managed: the file every verb naming one reads. */
export const teamAt = {
  configFile: serverFields.configFile,
  users: serverFields.users,
} satisfies Record<string, Field>;

/** What naming a team or a project takes: where the file is, and the title it is given. */
export const teamFields = {
  ...teamAt,
  title: {
    type: 'string',
    description: 'What a client shows for it. Without one, its id is what it shows.',
    cli: { value: 'TEXT' },
  },
} satisfies Record<string, Field>;

/** The fields installing and removing a plugin take, which are its own. */
export const pluginWriteFields = {
  configFile: serverFields.configFile,
  noEnable: {
    type: 'boolean',
    description: 'Install it without naming it in the file.',
  },
  keep: {
    type: 'boolean',
    description: 'Take it out of the configuration and leave the package installed.',
  },
} satisfies Record<string, Field>;

/**
 * Where the vault is: the configuration the file is kept beside.
 *
 * The vault belongs to the configuration directory the process reads, so the
 * configuration file is the one flag that names it, and no other daemon flag is
 * read here.
 */
export const vaultAt = {
  configFile: serverFields.configFile,
} satisfies Record<string, Field>;

/**
 * The `user add` fields a request may set: the roles, the issuer and the whole
 * record.
 *
 * The file and the address are the daemon's own, so they are absent here: a
 * served `user` verb reads them from the process answering, which is what keeps
 * a request from naming another file to write.
 */
export const servedUserAddFields = {
  issuer: userAddFields.issuer,
  role: userAddFields.role,
  ...recordFields,
} satisfies Record<string, Field>;

/** The `user token` field a request may set, which is the one it prints with. */
export const servedUserTokenFields = {
  url: userTokenFields.url,
} satisfies Record<string, Field>;

/** The `user primary` fields a request may set, which is the unset. */
export const servedUserPrimaryFields = {
  unset: userPrimaryFields.unset,
} satisfies Record<string, Field>;

/** The team and project fields a request may set; the file is the daemon's. */
export const servedTeamFields = {
  title: teamFields.title,
} satisfies Record<string, Field>;

/** The plugin-write fields a request may set; the configuration file is the daemon's. */
export const servedPluginWriteFields = {
  noEnable: pluginWriteFields.noEnable,
  keep: pluginWriteFields.keep,
} satisfies Record<string, Field>;

/**
 * The merged configuration, held to `configSchema`.
 *
 * A key the schema names with a value it refuses stops the start with
 * `<file>: <key> must be ...`, naming the file `source` says set it. A key it
 * does not name answers one line, and the caller carries on without it.
 *
 * `modelProxy` is checked further than the schema reaches, because a model name
 * is `<maker>/<name>` and the entries under it are held one by one; a file that
 * still writes `providers` is refused too. That is a bad value rather than an
 * unknown key, so it stops the start the same way one does. `shellEnv` is checked the same way for
 * the same reason: its names and values are held on their own, because the
 * schema cannot say that an object is a map, and so is
 * `eligibleForAutoApproval`, whose every value is a boolean.
 * `managedSettingsPermissions` is too, for its rules: a rule of the managed
 * grammar, and a `Domain` boundary rule with its host written as VS Code's
 * network filter normalizes one, are more than a schema pattern says.
 */
export function checkConfig(file: object, source: (key: string) => string): string[] {
  const warnings: string[] = [];
  for (const [key, value] of Object.entries(file)) {
    if (!Object.hasOwn(configSchema.properties, key)) {
      warnings.push(`${source(key)}: ${key} is not a setting ahpd knows; ignored`);
      continue;
    }
    try {
      check(value, configSchema.properties[key as ConfigKey], key);
    }
    catch (error) {
      stop(`${source(key)}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  const problems = proxyProblems((file as Config).modelProxy);
  if (problems.length > 0) stop(problems.map((one) => `${source('modelProxy')}: ${one}`).join('\n'));
  const pluginsNamed = pluginProblems((file as Config).plugins);
  if (pluginsNamed.length > 0) stop(pluginsNamed.map((one) => `${source('plugins')}: ${one}`).join('\n'));
  const shellEnvBad = shellEnvProblems((file as Config).shellEnv);
  if (shellEnvBad.length > 0) stop(shellEnvBad.map((one) => `${source('shellEnv')}: ${one}`).join('\n'));
  const managedBad = managedPermissionsProblems((file as Config).managedSettingsPermissions);
  if (managedBad.length > 0) stop(managedBad.map((one) => `${source('managedSettingsPermissions')}: ${one}`).join('\n'));
  const eligibleBad = eligibilityProblems((file as Config).eligibleForAutoApproval);
  if (eligibleBad.length > 0) stop(eligibleBad.map((one) => `${source('eligibleForAutoApproval')}: ${one}`).join('\n'));
  return warnings;
}

/**
 * `httpApi` as a run takes it: `true` is the daemon's own listener, `false` and
 * absent are off. `host` binds the API's own listener and has none to bind
 * without a `port`, so it is refused on its own.
 */
const httpOf = (value: Config['httpApi'], source: string): HttpSetting | undefined => {
  if (value === undefined || value === false) return undefined;
  if (value === true) return {};
  if (value.host !== undefined && value.port === undefined) {
    return stop(`${source}: httpApi.host names the API's own listener, so it needs an httpApi.port to bind.`);
  }
  return value;
};

/**
 * `routes` as a run takes it. `host` binds the routes' own listener and has
 * none to bind without a `port`, so it is refused on its own.
 */
const routesOf = (value: Config['routes'], source: string): RoutesSetting | undefined => {
  if (value === undefined) return undefined;
  if (value.host !== undefined && value.port === undefined) {
    return stop(`${source}: routes.host names the routes' own listener, so it needs a routes.port to bind.`);
  }
  return value;
};

/**
 * One `origins` entry as the origin it names, or the start stops.
 *
 * An origin is a scheme, a host and a port and nothing else, because that is
 * exactly what a browser sends: a path or a query is a mistake that would
 * otherwise be dropped in silence, leaving the page refused with no reason.
 * `source` is the file that set it, and absent when `--origin` did.
 */
const originOf = (entry: string, source: string | undefined): string => {
  const said = source === undefined ? `--origin ${entry}` : `${source} has origins entry ${JSON.stringify(entry)}`;
  let url: URL;
  try {
    url = new URL(entry);
  }
  catch {
    return stop(`${said}, which is not an origin: an origin is a scheme, a host and a port, such as http://203.0.113.5:9187.`);
  }
  if ((url.protocol !== 'http:' && url.protocol !== 'https:') || url.origin !== entry.replace(/\/$/, '')) {
    return stop(`${said}, which is not an origin: an origin is http or https, a host and a port, such as http://203.0.113.5:9187.`);
  }
  return url.origin;
};

/**
 * `optionsFrom`, after the plugins it names are imported to read their ids, so
 * that `--plugin-option` can name a plugin by the name its module exports.
 *
 * Nothing is imported when no `--plugin-option` is given.
 */
export async function namedOptionsFrom(input: Readonly<Record<string, unknown>>): Promise<Options> {
  const typed = input['pluginOptions'] as string[] | undefined;
  if (typed !== undefined && typed.length > 0) {
    await pluginIdsOf(optionsFrom({ ...input, pluginOptions: [] }).plugins, { configDir: configDir(), cwd: process.cwd() });
  }
  return optionsFrom(input);
}

/**
 * The canonical input and the configuration files, as the options a run takes.
 *
 * The merged files are checked first, then the order is what was typed, then
 * the files, then the default, because a flag is this run and a file is every
 * run until somebody edits it; the defaults live here, after the files, rather
 * than on the fields. The canonical input has already been checked against the
 * same fields.
 */
export function optionsFrom(input: Readonly<Record<string, unknown>>): Options {
  const configFile = input['configFile'] as string | undefined;
  const loaded = loadConfig(configFile);
  const file = loaded.values;
  /** The file that set a key, which every sentence about that key names. */
  const source = (key: string): string => loaded.sourceOf(key) ?? configFile ?? configPath();
  // A server this run cannot offer is warned about rather than refused, so the
  // file's other keys are read whatever one entry says.
  const mcp = mcpServers(file.mcpServers, source);
  const warnings = [...checkConfig(file, source), ...mcp.warnings, ...loaded.warnings];
  const noPlugins = input['noPlugins'] === true;
const noCwd = input['noCwd'] === true;

  /** A key as the flag gave it, or the file under it. */
  const given = <K extends ConfigKey>(key: K): Config[K] => (input[key] as Config[K] | undefined) ?? file[key];

  /*
   * The plugins, under the flags.
   *
   * A command line `--plugin` adds to the file's list, and `--no-plugins`
   * leaves the file's list out, so the two together load only what the line
   * names. `runPlugins` says how a `--plugin` the file also lists is set up.
   */
  const typedPlugins = ((input['plugins'] as string[] | undefined) ?? []).map((entry) => {
    const spec = asSpec(entry);
    if (spec === undefined) stop(`--plugin takes a name or a path, not ${String(entry)}.`);
    return spec;
  });
  // Under `--no-plugins` the file's list is not loaded, so an entry that is not
  // a spec is skipped rather than refused; the others still set up a `--plugin`.
  const filedPlugins = (file.plugins ?? []).flatMap((entry, index) => {
    const spec = asSpec(entry);
    if (spec !== undefined) return [spec];
    if (!noPlugins) stop(`${source('plugins')} has plugins[${String(index)}] = ${JSON.stringify(entry)}, which is not a plugin spec.`);
    return [];
  });
  const plugins = runPlugins(filedPlugins, typedPlugins, noPlugins);

  /*
   * `--plugin-option`, over the options of the plugin it names: each one is
   * split by `pluginOptionIn` into the plugin and the key path, which is set as
   * deep into that entry's options as it goes. The plugin is named by its id or
   * by its spec as written, and must be one this run loads, enabled, because an
   * option for a plugin that is not loaded is a setting nobody would see take
   * effect.
   */
  const typedOptions = (input['pluginOptions'] as string[] | undefined) ?? [];
  const where = { configDir: configDir(), cwd: process.cwd() };
  // An entry switched off is one this run does not load, so it has no names.
  const loadedNames = (spec: PluginSpec): string[] =>
    typeof spec !== 'string' && spec.enabled === false ? [] : [sourceOf(spec), pluginIdOf(spec, where)];
  const names = typedOptions.length === 0 ? [] : plugins.flatMap(loadedNames);
  for (const typedOption of typedOptions) {
    const equals = typedOption.indexOf('=');
    const head = equals === -1 ? '' : typedOption.slice(0, equals);
    /*
     * What the flag was written as, up to its `=`. Every refusal about this
     * one quotes the path and never the value: what is being set is an option
     * a plugin is configured with, which is a credential more often than not,
     * and a refusal is printed on a terminal and written to a log.
     */
    const spelled = pathOf(typedOption);
    const named = pluginOptionIn(head, names);
    if (named === undefined) {
      // Nothing this run loads is named here, so the first dot says which name was meant.
      const dot = head.indexOf('.');
      if (equals === -1 || dot <= 0) stop(`--plugin-option takes <plugin>.<key>=<value>, not ${spelled === '' ? 'an empty path' : spelled}.`);
      stop(`--plugin-option names ${head.slice(0, dot)}, which is not a plugin this run loads.`);
    }
    const { plugin, path } = named;
    if (path.some((key) => key === '')) stop(`--plugin-option takes <plugin>.<key>=<value>, not ${spelled}.`);
    const value = typedValue(typedOption.slice(equals + 1));
    const at = plugins.findIndex((spec) => loadedNames(spec).includes(plugin));
    const spec = plugins[at] as PluginSpec;
    plugins[at] = typeof spec === 'string'
      ? { source: spec, options: setAt(undefined, path, value, spelled) }
      : { ...spec, options: setAt(spec.options, path, value, spelled) };
  }

  const paths = [...given('paths') ?? []];
  let startFolder: string | undefined;
  if (paths.length === 0) {
    /*
     * `--no-cwd` with nothing named would serve nothing at all, which is not a
     * daemon anybody meant to start. Refused rather than answered with the
     * current folder, since that is the one folder the flag says not to serve.
     */
    if (noCwd) {
      stop('--no-cwd serves only what --path or "paths" names, and neither does. Pass --path, or run ahpd configure.');
    }
    startFolder = process.cwd();
    paths.push(startFolder);
  }

  /*
   * A worktrees root is answered absolute, unlike `paths`.
   *
   * A folder a host serves is also the folder it was started in, so a typed one
   * is left as written and read against the working directory by whatever opens
   * it. A root is a base other paths are joined to - `git worktree add` makes
   * `<root>/<repo>/<name>` - and a relative one would follow whatever the
   * working directory happened to be when a session started. The file's value
   * was already made absolute against the file it came from.
   */
  const typedRoot = given('worktreesRoot');
  const worktreesRoot = typedRoot === undefined ? undefined : resolve(typedRoot);

  const token = given('connectionToken');
  const tokenFile = given('connectionTokenFile');
  const users = given('users');
  const resource = given('resource');
  const origins = (given('origins') ?? []).map((entry) => originOf(entry, input['origins'] === undefined ? source('origins') : undefined));
  const issuer = given('issuer');
  const issuerVerify = given('issuerVerify');
  const wire = given('wire');
  const clientToolTimeoutMs = given('clientToolTimeoutMs');
  const clientToolCallDisconnectTimeoutMs = given('clientToolCallDisconnectTimeoutMs');
  const shellEnv = given('shellEnv');
  const managedSettingsPermissions = given('managedSettingsPermissions');
  const eligibleForAutoApproval = given('eligibleForAutoApproval');
  // File-only, and already absolute: `anchored` resolved it against the file.
  const commandParser = file.commandParser;
  const deltaWindowMs = given('deltaWindowMs');
  const sleepAfterMinutes = given('sleepAfterMinutes');
  const sessionResidencyLimit = given('sessionResidencyLimit');
  const attachmentFetchLimitBytes = given('attachmentFetchLimitBytes');
  const toolResultResourceLimitBytes = given('toolResultResourceLimitBytes');
  const usageZone = given('usage')?.timezone;
  const serviceName = given('service')?.name;
  const httpApi = httpOf(file.httpApi, source('httpApi'));
  const mcpTools = given('mcpTools') ?? 'none';
  const routes = routesOf(file.routes, source('routes'));
  const modelProxy = proxyConfiguration(given('modelProxy'));

  return {
    port: given('port') ?? 9187,
    host: given('host') ?? '127.0.0.1',
    stdio: input['stdio'] === true,
    paths,
    ...(startFolder === undefined ? {} : { startFolder }),
    noCwd,
    ...(worktreesRoot === undefined ? {} : { worktreesRoot }),
    ...(token === undefined ? {} : { token }),
    ...(tokenFile === undefined ? {} : { tokenFile }),
    open: given('withoutConnectionToken') ?? false,
    ...(configFile === undefined ? {} : { configFile }),
    ...(users === undefined ? {} : { users }),
    ...(resource === undefined ? {} : { resource }),
    ...(origins.length === 0 ? {} : { origins }),
    tunnelHosts: given('tunnelHosts') ?? false,
    ...(issuer === undefined ? {} : { issuer }),
    ...(issuerVerify === undefined ? {} : { issuerVerify }),
    requireIssuer: given('requireIssuer') ?? false,
    tokensPerPerson: given('tokensPerPerson') ?? 10,
    advancedTools: given('advancedTools') ?? false,
    sessionTools: given('sessionTools') ?? true,
    sessionToolsProviders: given('sessionToolsProviders') ?? [],
    closedChats: given('closedChats') ?? 'hidden',
    unofferedModel: given('unofferedModel') ?? 'fail',
    workspacelessFolder: given('workspacelessFolder') ?? 'first',
    rootOwner: given('rootOwner') ?? 'host',
    turnSenders: given('turnSenders') ?? 'said',
    backendBackgroundWork: given('backendBackgroundWork') ?? 'drop',
    agentOrchestrationLimitsScope: given('agentOrchestrationLimitsScope') ?? 'sessionTree',
    archiveDirtyWorktree: given('archiveDirtyWorktree') ?? 'keep',
    nodeRestart: given('nodeRestart') ?? 'end',
    pullRequestLookup: given('pullRequestLookup') ?? 'url',
    zshFolder: given('zshFolder') ?? 'owned',
    pluginEntryOutside: given('pluginEntryOutside') ?? 'refuse',
    rootConfigWrite: given('rootConfigWrite') ?? 'merged',
    iconLimitBytes: given('iconLimitBytes') ?? ICON_LIMIT,
    iconTimeoutMs: given('iconTimeoutMs') ?? ICON_TIMEOUT_MS,
    readyTimeoutMs: given('readyTimeoutMs') ?? READY_TIMEOUT_MS,
    ...(clientToolTimeoutMs === undefined ? {} : { clientToolTimeoutMs }),
    ...(clientToolCallDisconnectTimeoutMs === undefined ? {} : { clientToolCallDisconnectTimeoutMs }),
    ...(shellEnv === undefined ? {} : { shellEnv }),
    terminalAutoApproveDefaults: given('terminalAutoApproveDefaults') ?? 'vscode',
    ...(managedSettingsPermissions === undefined ? {} : { managedSettingsPermissions }),
    ...(eligibleForAutoApproval === undefined ? {} : { eligibleForAutoApproval }),
    managedRules: given('managedRules') ?? 'checked',
    ...(commandParser === undefined ? {} : { commandParser }),
    ...(deltaWindowMs === undefined ? {} : { deltaWindowMs }),
    ...(sleepAfterMinutes === undefined ? {} : { sleepAfterMinutes }),
    ...(sessionResidencyLimit === undefined ? {} : { sessionResidencyLimit }),
    ...(attachmentFetchLimitBytes === undefined ? {} : { attachmentFetchLimitBytes }),
    ...(toolResultResourceLimitBytes === undefined ? {} : { toolResultResourceLimitBytes }),
    automations: given('automations') ?? 'file',
    unownedAutomations: given('unownedAutomations') ?? 'every',
    sessions: given('sessions') ?? 'file',
    usagePer: given('usage')?.per ?? 'turn',
    ...(usageZone === undefined ? {} : { usageTimezone: usageZone }),
    policiesCheck: given('policies')?.check ?? false,
    policiesPayOrder: given('policies')?.payOrder ?? 'ending',
    policiesOwnLimits: given('policies')?.ownLimits ?? true,
    ...(serviceName === undefined ? {} : { serviceName }),
    servicePath: given('service')?.path ?? 'shell',
    ...(wire === undefined ? {} : { wire }),
    ...(httpApi === undefined ? {} : { httpApi }),
    mcpTools,
    ...(routes === undefined ? {} : { routes }),
    modelProxy,
    mcpServers: mcp.servers,
    plugins,
    typedPlugins,
    noPlugins,
    updateCheck: given('updateCheck') ?? true,
    warnings,
    configFiles: loaded.files,
  };
}

/**
 * The characters a connection token is made of, as VS Code's agent host
 * server holds one, refused in its words otherwise.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentHostServerMain.ts#L67
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentHostServerMain.ts#L139-L156
 */
const CONNECTION_TOKEN = /^[0-9A-Za-z_-]+$/;

/**
 * The secret this host will require, and where it came from.
 *
 * A token file that is not there is written rather than refused: the flag is
 * how a supervisor points several processes at one secret, and requiring the
 * person to invent one first makes the convenient spelling the unusable one.
 */
export function secret(options: Options): { token?: string; from: string } {
  if (options.open) {
    if (options.token !== undefined || options.tokenFile !== undefined) {
      stop('--without-connection-token contradicts the token you also passed.');
    }
    return { from: 'no token: any connection is accepted' };
  }
  if (options.token !== undefined && options.tokenFile !== undefined) {
    stop('Pass --connection-token or --connection-token-file, not both.');
  }
  if (options.token !== undefined) {
    if (options.token === '') stop('--connection-token was empty.');
    // The source is named and never the value, as everything this prints says
    // where the secret came from and not what it is.
    if (!CONNECTION_TOKEN.test(options.token)) {
      stop('The connection token from --connection-token does not adhere to the characters 0-9, a-z, A-Z, _, or -.');
    }
    return { token: options.token, from: 'token: from --connection-token' };
  }
  if (options.tokenFile !== undefined) {
    if (existsSync(options.tokenFile)) {
      const held = readFileSync(options.tokenFile, 'utf8').trim();
      if (held === '') stop(`${options.tokenFile} is empty.`);
      if (!CONNECTION_TOKEN.test(held)) {
        stop(`The connection token in '${options.tokenFile}' does not adhere to the characters 0-9, a-z, A-Z, _, or -.`);
      }
      return { token: held, from: `token: read from ${options.tokenFile}` };
    }
    const made = crypto.randomUUID().replaceAll('-', '');
    // A first run may name a folder nothing has made yet.
    mkdirSync(dirname(options.tokenFile), { recursive: true });
    // Owner-only, because the file is the credential.
    writeFileSync(options.tokenFile, `${made}\n`, { mode: 0o600 });
    return { token: made, from: `token: written to ${options.tokenFile}` };
  }
  // Loopback needs no secret - anything reaching it is already on this
  // machine. Any other address does, and starting without one there would be
  // a host on the network that anybody can drive.
  const loopback = options.host === '127.0.0.1' || options.host === '::1' || options.host === 'localhost';
  if (!loopback) {
    stop(`Binding ${options.host} exposes this host beyond this machine.\n`
      + 'Pass --connection-token, --connection-token-file, or --without-connection-token.');
  }
  return { from: 'no token: loopback only' };
}
