/**
 * The daemon's flags as one declaration, and the file underneath them.
 *
 * Every flag is a field here and every field is a flag: `@cofold/commands`
 * spells each one for the terminal, for help, for completion and for the JSON
 * input a command is run with. What `parse` used to do by hand - read argv, then
 * read `config.json` under it - is `optionsFrom`, which takes the canonical
 * input a surface produced rather than the words a person typed.
 *
 * The fields carry no `default`, deliberately: a value that came from the
 * configuration file has to be told apart from one that came from a flag, and
 * a declared default would fill the input before the file was read. The
 * defaults live in `optionsFrom`, after the fold, where the order is visible.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { ArgumentError, type Field } from '@cofold/commands';
import type { PluginSpec } from '@ahpd/sdk';
import type { HttpSetting } from '../config.js';
import { asSpec, configPath, loadConfig } from '../config.js';

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
  /** Where automations are kept, and whether a clock fires them. */
  automations: 'file' | 'memory';
  /** Where the read and archived bits and a session's settings go. */
  sessions: 'file' | 'memory';
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
  /** Plugins to load, in the order they apply. */
  plugins: PluginSpec[];
  /** Load none, whatever the configuration file names. */
  noPlugins: boolean;
  /** Ask npm, in the background, whether a newer version exists. */
  updateCheck: boolean;
}

/*
 * The return type is on the variable rather than the arrow, which is what tells
 * TypeScript a call to this never comes back: with it, a check like
 * `if (path === undefined) stop(...)` narrows `path` for every line after.
 */
export const stop: (message: string) => never = (message) => {
  process.stderr.write(`${message}\n`);
  process.exit(2);
};

/**
 * Refuse a command the way it always has, or answer a remote caller.
 *
 * `stop` assumes the process is the person's terminal. Over HTTP the process is
 * the daemon, so a refusal is thrown and `serve()` maps it to a status rather
 * than the daemon exiting under every other connection.
 */
export const refuse: (surface: string | undefined, message: string) => never = (surface, message) => {
  if (surface === 'remote') throw new ArgumentError(message);
  stop(message);
};

/**
 * Every flag a run takes, as the fields help and the parser read.
 *
 * The descriptions are the ones `--help` printed before this was a declaration,
 * so a person reading help loses nothing to the migration.
 */
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
    description: 'Serve one connection over stdin and stdout instead of binding a port.',
  },
  paths: {
    type: 'array',
    items: { type: 'string' },
    description: 'A directory this host serves. Repeatable; the first is the default a client gets when it names none.',
    cli: { flag: '--path', value: 'DIR' },
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
  wire: {
    type: 'string',
    description: 'Append every frame, both directions, to this file as JSON lines.',
    cli: { value: 'FILE' },
  },
  plugins: {
    type: 'array',
    items: { type: 'string' },
    description: 'A package, a path, or a package installed in the configuration directory, loaded at startup. Repeatable.',
    cli: { flag: '--plugin', value: 'SPEC' },
  },
  noPlugins: {
    type: 'boolean',
    description: 'Load none, whatever the configuration file says.',
  },
  updateCheck: {
    type: 'boolean',
    description: 'Never ask npm whether a newer version exists.',
    cli: { flag: '--no-update-check' },
  },
} satisfies Record<string, Field>;

/** The fields a person is managed with, which every `user` sub-command accepts. */
export const userFields = {
  configFile: serverFields.configFile,
  users: serverFields.users,
  host: serverFields.host,
  port: serverFields.port,
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
  url: {
    type: 'boolean',
    description: 'Print the whole ws:// URL a client can be given.',
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

/** A string that was actually given, which a canonical input may not have. */
const said = (value: unknown): string | undefined => (typeof value === 'string' ? value : undefined);

/** A value from the flags, or the file under them, or nothing. */
const under = (input: Readonly<Record<string, unknown>>, key: string, file: unknown): string | undefined =>
  said(input[key]) ?? said(file);

const isOneOf = (value: unknown, ...allowed: readonly string[]): boolean =>
  typeof value === 'string' && allowed.includes(value);

/**
 * `http` as the configuration may spell it.
 *
 * `true` and an object are both on; `false` and absent are off. A value that is
 * neither refuses the start rather than being guessed at, because a person who
 * wrote `"port": "8080"` meant something and a daemon that quietly dropped it
 * would serve the API where they were not looking.
 */
const httpOf = (value: unknown): HttpSetting | undefined => {
  if (value === undefined || value === false) return undefined;
  if (value === true) return {};
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return stop(`"http" must be true, false, or { "port": N }, not ${JSON.stringify(value)}.`);
  }
  const held = (value as { port?: unknown }).port;
  if (held === undefined) return {};
  if (typeof held !== 'number' || !Number.isInteger(held) || held < 0 || held > 65535) {
    return stop(`http.port must be a number from 0 to 65535, not ${JSON.stringify(held)}.`);
  }
  return { port: held };
};

/**
 * The canonical input and the configuration file, as the options a run takes.
 *
 * The order is the one `parse` kept: what was typed, then the file, then the
 * default, because a flag is this run and a file is every run until somebody
 * edits it. An input field is present only when a flag (or its environment)
 * named it, which is what the fields carrying no default buys.
 */
export function optionsFrom(input: Readonly<Record<string, unknown>>): Options {
  const configFile = said(input['configFile']);
  const file = loadConfig(configFile);
  const noPlugins = input['noPlugins'] === true;

  const namedPlugins = Array.isArray(input['plugins']) ? input['plugins'] as string[] : [];
  const plugins: PluginSpec[] = [];
  for (const named of namedPlugins) {
    const spec = asSpec(named);
    if (spec === undefined) stop(`--plugin takes a name or a path, not ${named}.`);
    plugins.push(spec);
  }

  /*
   * The plugins, under the flags.
   *
   * A command line `--plugin` replaces the file's list rather than adding to
   * it, the way `--path` does: a flag is this run and the file is every run,
   * and a person who names one plugin meant that one. `--no-plugins` is the
   * explicit off, and passing it beside a `--plugin` is refused rather than
   * resolved, because nobody means both.
   */
  if (noPlugins && plugins.length > 0) {
    stop('--no-plugins contradicts the --plugin you also passed.');
  }
  if (plugins.length === 0 && !noPlugins && Array.isArray(file.plugins)) {
    file.plugins.forEach((entry, index) => {
      const spec = asSpec(entry);
      if (spec === undefined) {
        stop(`${configFile ?? configPath()} has plugins[${String(index)}] = ${JSON.stringify(entry)}, which is not a plugin spec.`);
      }
      plugins.push(spec);
    });
  }

  const paths = Array.isArray(input['paths'])
    ? [...input['paths'] as string[]]
    : Array.isArray(file.paths) ? [...file.paths] : [];
  if (paths.length === 0) paths.push(process.cwd());

  const port = typeof input['port'] === 'number' ? input['port'] : file.port;
  const host = under(input, 'host', file.host);
  const token = under(input, 'connectionToken', file.connectionToken);
  const tokenFile = under(input, 'connectionTokenFile', file.connectionTokenFile);
  const users = under(input, 'users', file.users);
  const resource = under(input, 'resource', file.resource);
  const issuer = under(input, 'issuer', file.issuer);
  const wire = under(input, 'wire', file.wire);
  const http = httpOf(file.http);
  const automations = isOneOf(input['automations'], 'file', 'memory') ? input['automations'] as 'file' | 'memory'
    : isOneOf(file.automations, 'file', 'memory') ? file.automations as 'file' | 'memory' : 'file';
  const sessions = isOneOf(input['sessions'], 'file', 'memory') ? input['sessions'] as 'file' | 'memory'
    : isOneOf(file.sessions, 'file', 'memory') ? file.sessions as 'file' | 'memory' : 'file';

  return {
    port: typeof port === 'number' ? port : 9187,
    host: host ?? '127.0.0.1',
    stdio: input['stdio'] === true,
    paths,
    ...(token === undefined ? {} : { token }),
    ...(tokenFile === undefined ? {} : { tokenFile }),
    open: input['withoutConnectionToken'] === true || file.withoutConnectionToken === true,
    ...(configFile === undefined ? {} : { configFile }),
    ...(users === undefined ? {} : { users }),
    ...(resource === undefined ? {} : { resource }),
    ...(issuer === undefined ? {} : { issuer }),
    trustToken: input['trustToken'] === true || file.trustToken === true,
    advancedTools: input['advancedTools'] === true || file.advancedTools === true,
    automations,
    sessions,
    ...(wire === undefined ? {} : { wire }),
    ...(http === undefined ? {} : { http }),
    plugins,
    noPlugins,
    updateCheck: input['updateCheck'] !== true && file.updateCheck !== false,
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
