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

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ArgumentError, CofoldError, check, type Field, type JsonSchema, type OptionSpec } from '@cofold/commands';
import { secretRef } from '@ahpd/sdk';
import type { McpServer, PluginSpec } from '@ahpd/sdk';
import type { Config, HttpSetting } from '../config.js';
import { asSpec, configPath, loadConfig } from '../config.js';
import { proxyConfiguration, proxyProblems, proxySchema, type ProxyConfiguration } from '../proxy/providers.js';

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
  /** Serve only `paths`, and ask about no folder at all. */
  noCwd: boolean;
  /**
   * The folder every session worktree is made under, as an absolute path.
   *
   * Absent, a tree sits at `<repo>.worktrees` beside its repository, which is
   * where VS Code's host looks for it. With one, it is `<root>/<repo>/<name>`
   * - decision `worktrees-can-live-under-one-root`.
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
  /** An authorization server whose tokens this host also accepts. */
  issuer?: string;
  /** Whether a person's connection token authorizes them as well as admits them. */
  trustToken: boolean;
  /** Whether a tool that declares `advancedPermission` is offered to sessions. */
  advancedTools: boolean;
  /** How long a call a client runs may wait, absent when the deployment said nothing. */
  clientToolTimeoutMs?: number;
  /** Where automations are kept, and whether a clock fires them. */
  automations: 'file' | 'memory';
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
   * The zone a day and a week start in, as `Intl` names it.
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
   * deployment rather than about one run - decision
   * `policy-checks-are-switched-on-by-a-daemon-option`.
   */
  policiesCheck: boolean;
  /** A file every frame is appended to, both directions, one JSON line each. */
  wire?: string;
  /**
   * Whether the HTTP API is served, and where.
   *
   * Absent is off. `{}` is the daemon's own listener under `/api`; a `port`
   * moves it to a listener of its own - decision
   * `the-http-api-is-on-the-daemon-port-under-api`. It has no flag, because the
   * decision put it in the configuration.
   */
  http?: HttpSetting;
  /** The providers this proxy calls and the model names that point at them. */
  proxy: ProxyConfiguration;
  /**
   * The MCP servers every session is offered, and the ones that were skipped.
   *
   * The host's own, by the name a person gave them; a session merges its
   * enabled client plugins' servers over these.
   */
  mcpServers: Record<string, McpServer>;
  /** Plugins to load, in the order they apply. */
  plugins: PluginSpec[];
  /** Load none, whatever the configuration file names. */
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

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

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
  if (held !== undefined && !isObject(held)) {
    stop(`--plugin-option sets ${spelled}, and ${where} holds ${kindOf(held)}, which is not an object the rest of the path could be set in.`);
  }
  const named = secretRef(held);
  if (named !== undefined) {
    stop(`--plugin-option sets ${spelled}, and ${where} is a reference to the secret ${named}: a key set inside it would leave the reference behind, so it is set as a whole or not at all.`);
  }
  here[key] = setAt(isObject(held) ? held : undefined, rest, value, spelled);
  return here;
};

/**
 * `mcpServers` as this run offers them, and what is wrong with the rest.
 *
 * The entries are not described by the schema on the key, because the JSON
 * Schema this family checks has no way of saying that an object is a map; each
 * one is checked on its own, so a bad entry is named and left out rather than
 * refusing a start that would have worked for every other server.
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
  for (const [name, entry] of Object.entries(isObject(held) ? held : {})) {
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

/** Every flag a run takes, as the fields help and the parser read. */
export const serverFields = {
  port: {
    type: 'integer',
    description: 'Listen here. Default 9187; 0 picks a free one.',
    cli: { value: 'N' },
  },
  host: {
    type: 'string',
    description: 'Bind here. Default 127.0.0.1. Pass 0.0.0.0 to accept from other machines, which needs a token.',
    cli: { value: 'ADDR' },
  },
  stdio: {
    type: 'boolean',
    description: 'Serve one connection over stdin and stdout instead of binding a port. This is how a host runs inside a container for another host to carry: one line of JSON per frame, no token, and the connection is this host itself.',
  },
  paths: {
    type: 'array',
    items: { type: 'string' },
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
  issuer: {
    type: 'string',
    description: 'An authorization server whose tokens are also accepted: github, or an OpenID Connect issuer.',
    cli: { value: 'GITHUB|URL' },
  },
  trustToken: {
    type: 'boolean',
    description: "A person's connection token authorizes them as well as admits them.",
  },
  advancedTools: {
    type: 'boolean',
    description: "Offer the tools that declare they need advanced permission, such as the computer's three.",
  },
  clientToolTimeoutMs: {
    type: 'integer',
    minimum: 0,
    description: 'How long a call a client runs may wait. Default ten minutes; 0 waits for ever.',
    cli: { value: 'MS' },
  },
  automations: {
    type: 'string',
    enum: ['file', 'memory'],
    description: 'file keeps automations beside the configuration and fires their schedules; memory keeps them until this process ends.',
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
    description: 'How a turn is written down: per "turn" writes one record when the turn ends, which is the default, and per "report" writes one record for every usage report a turn sends. timezone names, as Intl names one, the zone a day and a week start in, and is the system\'s own zone when it is absent. Set in the configuration file only.',
  },
  wire: {
    type: 'string',
    description: 'Append every frame, both directions, to this file as JSON lines.',
    cli: { value: 'FILE' },
  },
  policies: {
    type: 'object',
    properties: {
      check: { type: 'boolean' },
    },
    description: 'Whether the policies saying who may use which agent, model and computer are enforced: check refuses a session and a turn that no policy allows, naming the policy that refused it. Off by default, and the rows are written and listed either way. Set in the configuration file only.',
  },
  http: {
    type: ['object', 'boolean'],
    properties: {
      port: { type: 'integer', minimum: 0, maximum: 65535 },
      host: { type: 'string', pattern: '^\\S+$' },
    },
    description: "Serve the HTTP API: true under /api on the daemon's own listener, or an object whose port gives it a listener of its own and whose host binds that listener. Set in the configuration file only.",
  },
  proxy: {
    ...proxySchema,
    description: 'The providers this proxy calls and the model names that point at them: providers are keyed by the id a model entry names, and a model name is written <maker>/<name> with the entries serving it. An entry under a built-in id replaces it whole. A key is named by the environment variable holding it, never written here. sessionCalls is record (the default) or skip: whether a call made with a session\'s own token is policy-checked and recorded by the proxy. Set in the configuration file only.',
  },
  mcpServers: {
    // The entries are not described here, for the same reason `proxy`'s are
    // not: this JSON Schema cannot say that an object is a map. `mcpServers`
    // checks each of them.
    type: 'object',
    description: 'The MCP servers every session is offered, by the name a person gave them: a stdio server is a command an agent starts, and an http one is an endpoint it calls. An env or a header is a credential wherever it is, so each answers <set>. A session adds the servers of its own client plugins over these. Set in the configuration file only.',
  },
  plugins: {
    type: 'array',
    items: { type: 'string' },
    description: 'A package, a path, or a package installed in the configuration directory, loaded at startup. Repeatable. Naming one runs its code in this process with this process\'s permissions: installing a plugin is the trust decision.',
    cli: { flag: '--plugin', value: 'SPEC' },
  },
  noPlugins: {
    type: 'boolean',
    description: 'Load none, whatever the configuration file says.',
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
    description: 'Ask npm, in the background, whether a newer version exists. On by default; --no-update-check, NO_UPDATE_NOTIFIER, CI and "updateCheck": false in the configuration turn it off.',
    cli: { negatable: true },
  },
} satisfies Record<string, Field>;

/** The fields only the configuration file sets, which have no flag. */
const FILE_ONLY = ['http', 'usage', 'proxy', 'policies', 'mcpServers'] as const;

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
    name: { type: 'string' },
    options: { type: 'object' },
    enabled: { type: 'boolean' },
  },
  required: ['name'],
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
 * The flag an unset is spelled, the way `plugin config` spells one.
 *
 * A verb whose argument is positional cannot say "none of those" by leaving it
 * out, so the empty case is named rather than implied.
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
 * `proxy` is checked further than the schema reaches, because whether a model
 * name's provider exists is only known once the file's providers are over the
 * built-ins. That is a bad value rather than an unknown key, so it stops the
 * start the same way one does.
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
  const problems = proxyProblems((file as Config).proxy);
  if (problems.length > 0) stop(problems.map((one) => `${source('proxy')}: ${one}`).join('\n'));
  return warnings;
}

/**
 * `http` as a run takes it: `true` is the daemon's own listener, `false` and
 * absent are off. `host` binds the API's own listener and has none to bind
 * without a `port`, so it is refused on its own.
 */
const httpOf = (value: Config['http'], source: string): HttpSetting | undefined => {
  if (value === undefined || value === false) return undefined;
  if (value === true) return {};
  if (value.host !== undefined && value.port === undefined) {
    return stop(`${source}: http.host names the API's own listener, so it needs an http.port to bind.`);
  }
  return value;
};

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
  const warnings = [...checkConfig(file, source), ...mcp.warnings];
  const noPlugins = input['noPlugins'] === true;
const noCwd = input['noCwd'] === true;

  /** A key as the flag gave it, or the file under it. */
  const given = <K extends ConfigKey>(key: K): Config[K] => (input[key] as Config[K] | undefined) ?? file[key];

  /*
   * The plugins, under the flags.
   *
   * A command line `--plugin` replaces the file's list rather than adding to
   * it, the way `--path` does: a flag is this run and the file is every run,
   * and a person who names one plugin meant that one. `--no-plugins` is the
   * explicit off, and passing it beside a `--plugin` is refused rather than
   * resolved, because nobody means both.
   */
  const typed = input['plugins'] as string[] | undefined;
  if (noPlugins && typed !== undefined && typed.length > 0) {
    stop('--no-plugins contradicts the --plugin you also passed.');
  }
  const plugins: PluginSpec[] = [];
  if (!noPlugins) {
    (given('plugins') ?? []).forEach((entry, index) => {
      const spec = asSpec(entry);
      if (spec === undefined) {
        stop(typed === undefined
          ? `${source('plugins')} has plugins[${String(index)}] = ${JSON.stringify(entry)}, which is not a plugin spec.`
          : `--plugin takes a name or a path, not ${String(entry)}.`);
      }
      plugins.push(spec);
    });
  }

  /*
   * `--plugin-option`, over the options of the plugin it names.
   *
   * Split at the first `=`, so a value may hold one, and what is left of it is
   * `<plugin>.<key path>`, the path set as deep into the entry's options as it
   * goes. The value is JSON when it parses. The plugin must be one this run
   * loads, enabled, because an option for a plugin that is not loaded is a
   * setting nobody would see take effect.
   */
  // An entry switched off is one this run does not load.
  const loadedName = (spec: PluginSpec): string | undefined =>
    typeof spec === 'string' ? spec : spec.enabled === false ? undefined : spec.name;
  for (const typedOption of (input['pluginOptions'] as string[] | undefined) ?? []) {
    const equals = typedOption.indexOf('=');
    const head = equals === -1 ? '' : typedOption.slice(0, equals);
    /*
     * The plugin is the longest name this run loads that the text ahead of the
     * `=` starts with, so a scoped package name and a path whose extension
     * holds a dot are both found by asking the list rather than by counting
     * dots, and everything after that name is the key path.
     */
    let at = -1;
    let named = '';
    plugins.forEach((spec, index) => {
      const name = loadedName(spec);
      if (name !== undefined && name !== '' && head.startsWith(`${name}.`) && name.length > named.length) {
        at = index;
        named = name;
      }
    });
    /*
     * What the flag was written as, up to its `=`. Every refusal about this
     * one quotes the path and never the value: what is being set is an option
     * a plugin is configured with, which is a credential more often than not,
     * and a refusal is printed on a terminal and written to a log.
     */
    const spelled = pathOf(typedOption);
    if (at === -1) {
      // Nothing this run loads is named here, so the first dot says which name was meant.
      const dot = head.indexOf('.');
      if (equals === -1 || dot <= 0) stop(`--plugin-option takes <plugin>.<key>=<value>, not ${spelled === '' ? 'an empty path' : spelled}.`);
      stop(`--plugin-option names ${head.slice(0, dot)}, which is not a plugin this run loads.`);
    }
    const spec = plugins[at] as PluginSpec;
    const path = head.slice(named.length + 1).split('.');
    if (path.some((key) => key === '')) stop(`--plugin-option takes <plugin>.<key>=<value>, not ${spelled}.`);
    const value = typedValue(typedOption.slice(equals + 1));
    plugins[at] = typeof spec === 'string'
      ? { name: spec, options: setAt(undefined, path, value, spelled) }
      : { ...spec, options: setAt(spec.options, path, value, spelled) };
  }

  const paths = [...given('paths') ?? []];
  if (paths.length === 0) {
    /*
     * `--no-cwd` with nothing named would serve nothing at all, which is not a
     * daemon anybody meant to start. Refused rather than answered with the
     * current folder, since that is the one folder the flag says not to serve.
     */
    if (noCwd) {
      stop('--no-cwd serves only what --path or "paths" names, and neither does. Pass --path, or run ahpd configure.');
    }
    paths.push(process.cwd());
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
  const issuer = given('issuer');
  const wire = given('wire');
  const clientToolTimeoutMs = given('clientToolTimeoutMs');
  const usageZone = given('usage')?.timezone;
  const http = httpOf(file.http, source('http'));
  const proxy = proxyConfiguration(given('proxy'));

  return {
    port: given('port') ?? 9187,
    host: given('host') ?? '127.0.0.1',
    stdio: input['stdio'] === true,
    paths,
    noCwd,
    ...(worktreesRoot === undefined ? {} : { worktreesRoot }),
    ...(token === undefined ? {} : { token }),
    ...(tokenFile === undefined ? {} : { tokenFile }),
    open: given('withoutConnectionToken') ?? false,
    ...(configFile === undefined ? {} : { configFile }),
    ...(users === undefined ? {} : { users }),
    ...(resource === undefined ? {} : { resource }),
    ...(issuer === undefined ? {} : { issuer }),
    trustToken: given('trustToken') ?? false,
    advancedTools: given('advancedTools') ?? false,
    ...(clientToolTimeoutMs === undefined ? {} : { clientToolTimeoutMs }),
    automations: given('automations') ?? 'file',
    sessions: given('sessions') ?? 'file',
    usagePer: given('usage')?.per ?? 'turn',
    ...(usageZone === undefined ? {} : { usageTimezone: usageZone }),
    policiesCheck: given('policies')?.check ?? false,
    ...(wire === undefined ? {} : { wire }),
    ...(http === undefined ? {} : { http }),
    proxy,
    mcpServers: mcp.servers,
    plugins,
    noPlugins,
    updateCheck: given('updateCheck') ?? true,
    warnings,
    configFiles: loaded.files,
  };
}

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
    return { token: options.token, from: 'token: from --connection-token' };
  }
  if (options.tokenFile !== undefined) {
    if (existsSync(options.tokenFile)) {
      const held = readFileSync(options.tokenFile, 'utf8').trim();
      if (held === '') stop(`${options.tokenFile} is empty.`);
      return { token: held, from: `token: read from ${options.tokenFile}` };
    }
    const made = crypto.randomUUID().replaceAll('-', '');
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
