/** What this daemon was told before anybody typed a flag, and where it is. */

import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { isIPv6 } from 'node:net';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { resolveConfig, type ResolvedConfig } from '@cofold/config';
import { issuerKind, type McpServer, type PluginSpec } from '@ahpd/sdk';
import type { ProxySetting } from './proxy/providers.js';

/**
 * The HTTP API, as the configuration turns it on.
 *
 * `true` serves it under `/api` on the daemon's own listener, beside the
 * WebSocket; a `port` moves it to a listener of its own, bound to the daemon's
 * `host` unless `host` says otherwise - decisions
 * `the-http-api-is-on-the-daemon-port-under-api` and
 * `http-host-binds-the-apis-own-listener`. The API is off unless this names it,
 * because an administration surface on a public port is a choice rather than a
 * default.
 */
export interface HttpSetting {
  /** The port the API is bound to. Absent is the daemon's own port. */
  port?: number;
  /** The address the API's own listener binds. Absent is the daemon's host. */
  host?: string;
}

/**
 * How this host writes down what its work cost, and where it cuts it.
 *
 * `per: 'turn'` - the default - is one record for a turn, holding what the turn
 * had used when it ended. `per: 'report'` is one record for every `chat/usage`,
 * each holding what that report added since the one before it, which keeps a
 * long turn's spending visible while it is still running.
 */
export interface UsageSetting {
  /** `turn` writes one record when a turn ends, `report` one per report. */
  per?: 'turn' | 'report';
  /**
   * The zone a day and a week start in, as `Intl` names one.
   *
   * Absent is the system's own. It is what makes a week begin on Monday where
   * the deployment is rather than where the reader happens to be.
   */
  timezone?: string;
}

/**
 * Whether this host enforces what its policies say.
 *
 * A block with one key beside `usage`, because that is the shape of a setting
 * about how work is metered rather than how the process was started, and it has
 * no flag: an operator turning the checks on wants everybody refused at once if
 * the store turns out to be empty, not one run's worth of it.
 */
export interface PoliciesSetting {
  /**
   * Whether a session and a turn are refused where no policy allows them.
   *
   * Off by default. The rows are written and listed either way - the `policy:`
   * scheme is served whatever this says - so a store can be filled in before
   * anything starts refusing.
   */
  check?: boolean;
}

/**
 * What a config file may say. Every key is what a flag would have said, or
 * `http`, `usage` and `proxy`; the keys are `configSchema`'s, which the file is
 * checked against.
 */
export interface Config {
  /** TCP port to bind. 0 lets the OS choose. */
  port?: number;
  /** Address to bind. */
  host?: string;
  /** The directories whose sessions this host serves. */
  paths?: string[];
  /**
   * The folder every session worktree is made under, as `<root>/<repo>/<name>`.
   *
   * Absent, a tree sits at `<repo>.worktrees` beside its repository, which is
   * where VS Code's host looks for it - decision
   * `worktrees-can-live-under-one-root`.
   */
  worktreesRoot?: string;
  /** The secret every connection must present. */
  connectionToken?: string;
  /** A file holding that secret, written with a fresh one if absent. */
  connectionTokenFile?: string;
  /** Accept any connection, with no secret at all. */
  withoutConnectionToken?: boolean;
  /**
   * Where automations are kept: `file` beside this configuration, or `memory`.
   *
   * `file` is the default and is the one with a clock in it. `memory` holds
   * definitions for the life of the process and fires nothing.
   */
  automations?: 'file' | 'memory';
  /**
   * What an automation that names no owner wakes on: `every` session, or `none`.
   *
   * `every` is the default, and the one that matters: an automation nobody made
   * is nobody's work, and a host with no people directory has no other kind. A
   * deployment that would rather they woke on nothing says `none`.
   */
  unownedAutomations?: 'every' | 'none';
  /**
   * Where the read and archived bits and a session's settings are kept: `file`
   * beside this configuration, or `memory` until the process ends.
   */
  sessions?: 'file' | 'memory';
  /**
   * How a turn is written down, one record per turn or one per report.
   *
   * `turn` is the default: the running sum every harness reports is held until
   * the turn ends, and one record holds it. `report` writes each report's own
   * addition as it arrives - decision
   * `the-agent-meter-writes-per-turn-or-per-report`.
   */
  usage?: UsageSetting;
  /**
   * Whether the policies saying who may use which agent, model and computer are
   * enforced. Off is the default, and the rows are kept either way.
   */
  policies?: PoliciesSetting;
  /**
   * The file the people who may use this host are in.
   *
   * Absent, there are no people: every gate this host has is inert and the
   * connection token is the whole of who may be here. A path that is not there
   * yet is a host with nobody on it rather than an error, and `ahpd user add`
   * is what writes one.
   */
  users?: string;
  /**
   * The identifier this host advertises for its own sign-in.
   *
   * RFC 9728 wants a resource identifier that uses the https scheme, and a
   * daemon derives one from the address it listens on when this names none.
   * A deployment behind a proxy names the public one instead, so what a client
   * is told is where the host actually answers.
   */
  resource?: string;
  /**
   * An authorization server whose tokens this host also accepts.
   *
   * `github`, or an issuer URL this host may reach. Absent, the host is its own
   * issuer and only secrets it minted are checked. Configured, it is the
   * default for every record that names none of its own, and the record
   * advertises it and the records' own in `authorization_servers`, so a client
   * that acquires tokens through an OAuth provider has a provider to resolve.
   */
  issuer?: string;
  /**
   * Whether a person's connection token authorizes them as well as admits them.
   *
   * False, which is the default and the whole point: the door admits and says
   * nobody, and `authenticate` is what authorizes. A host that trusts its
   * connection tokens says so once here, and a record's own `trustToken`
   * overrides it.
   */
  trustToken?: boolean;
  /**
   * Whether a tool that declares `advancedPermission` is offered to sessions.
   *
   * False, so those tools are absent until this says otherwise: a plugin that
   * starts containers on this host contributes them only to a host that asked
   * for them. A tool that declares nothing is unaffected, and the reference
   * host's own set declares nothing - decision
   * `a-tool-says-when-it-needs-advanced-permission`.
   */
  advancedTools?: boolean;
  /**
   * How long a call a client runs may wait before it is failed.
   *
   * Unset is ten minutes; zero waits for ever, for a deployment whose clients
   * are slow rather than gone.
   */
  clientToolTimeoutMs?: number;
  /**
   * How long a streamed delta waits for the next one before it is sent.
   *
   * Milliseconds, a whole number from 0 to 1000. Within the window the deltas
   * naming one part are merged into one action, which is the same text a
   * client ends up with in fewer envelopes. Unset is 75; zero sends every
   * delta as it arrives.
   */
  deltaWindowMs?: number;
  /** A file every frame is appended to, both directions, as JSON lines. */
  wire?: string;
  /**
   * Whether the HTTP API is served, and where.
   *
   * `true` is the daemon's own listener under `/api`; `{ "port": N }` is a
   * listener of its own. Absent is off, which is what every install that never
   * asked for an API keeps.
   */
  http?: boolean | HttpSetting;
  /**
   * The providers this proxy calls, and the model names that point at them.
   *
   * A provider is an endpoint and the APIs it answers in; a model name is
   * `<maker>/<name>` and lists the providers serving it, each under that
   * provider's own model id. Three providers are built in and are there without
   * this key, so the proxy knows where it would call before anybody configures
   * anything, and an entry here replaces one of them whole or adds one that is
   * not built in. A key is named by the environment variable holding it and is
   * never written here - decision
   * `a-model-is-named-by-its-maker-and-runs-on-a-provider`.
   */
  proxy?: ProxySetting;
  /**
   * The MCP servers every session is offered, by the name a person gave them.
   *
   * The host's own, rather than one backend's: a server configured here is
   * reached by whichever agent a session runs, beside whatever its client
   * plugins add. An entry that is neither shape is skipped with a warning
   * rather than refusing the start, because one server nobody can reach is a
   * gap in one agent's reach where a wrong `port` is a daemon that would not
   * run at all.
   */
  mcpServers?: Record<string, McpServer>;
  /**
   * The plugins to load, in the order they apply.
   *
   * Every entry is a package or a path, and naming one runs its code in this
   * process with this process's permissions. That makes this the one key whose
   * value is code rather than a setting, which is why the file holding it is
   * owner-readable for the same reason the token file is, and why a malformed
   * entry refuses the start rather than being skipped.
   */
  plugins?: PluginSpec[];
  /**
   * Ask npm whether a newer version exists, six hours apart. `false` never
   * asks. The daemon has no terminal, so this key is how it is switched off
   * where `--no-update-check` is not typed.
   */
  updateCheck?: boolean;
}

/**
 * Where this tool's files live.
 *
 * XDG, and the environment variable before the fallback: `$XDG_CONFIG_HOME` is
 * what somebody sets when their configuration is not in `~/.config`, and a
 * tool that reads the fallback anyway is a tool that ignores them.
 */
export const configHome = (): string =>
  process.env.XDG_CONFIG_HOME || join(homedir(), '.config');

/** The directory this tool owns inside it. */
export const configDir = (): string => join(configHome(), 'ahpd');

/** The file a person edits. */
export const configPath = (): string => join(configDir(), 'config.json');

/**
 * Where a detached daemon records itself.
 *
 * Beside the configuration rather than in a runtime directory, so everything
 * about this tool is in one place a person can look at. It is written by the
 * daemon and not by hand, which is the one thing that makes it different from
 * its neighbour.
 */
export const daemonPath = (): string => join(configDir(), 'daemon.json');

/** The file this daemon's own id is kept in. */
export const hostIdPath = (): string => join(configDir(), 'host-id');

/** A UUID, which is what this code writes and the only thing it reads back. */
const HOST_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * This daemon's own id, the same across every restart.
 *
 * Made once on the first start and read after, so a plugin labelling a machine
 * with it has written something that survives the run that made it: an id that
 * changed with the process could not tell a daemon its own leftover from one a
 * daemon that has been and gone left behind. Owner-only, because it is a key
 * to nothing anybody else has and there is no reason to hand it round.
 *
 * It is never replaced. A machine is found by this id, so a new one written
 * where the old one was orphans every machine this daemon made - and a file
 * this daemon cannot read, or one holding something that is not an id, stops
 * the start with a sentence naming the file rather than quietly becoming a
 * different daemon from the one that wrote it.
 */
export const hostId = (): string => saidIn(hostIdPath());

/** The id that file holds, a new one made where there is nothing, and a refusal otherwise. */
const saidIn = (file: string): string => {
  const said = readIn(file);
  if (said === undefined) return made(file);
  if (!HOST_ID.test(said)) {
    throw new Error(`${file} does not hold a daemon id, and this daemon will not replace it: a machine is found by the id of the daemon that made it, so a new one here would orphan every machine this one made`);
  }
  return said;
};

/**
 * What that file says, and nothing where there is no file.
 *
 * Only nothing there is the first start. Anything else going wrong is a
 * configuration this daemon cannot act on, and reading it as missing would give
 * it a new id and orphan every machine the last run under this name made.
 */
const readIn = (file: string): string | undefined => {
  try {
    return readFileSync(file, 'utf8').trim();
  }
  catch (error) {
    if (isMissing(error)) return undefined;
    throw new Error(`${file} cannot be read, so this daemon cannot tell which machines are its own: ${why(error)}. Fix or move that file`);
  }
};

/** A new id, kept to whichever daemon gets to the file first. */
const made = (file: string): string => {
  const mine = randomUUID();
  try {
    mkdirSync(configDir(), { recursive: true });
    // Created with `wx` and not written beside and renamed: two daemons starting
    // at once would each rename their own over the other's, and the first would
    // go on running with an id nothing on disk says. The one that loses the race
    // reads the winner's instead.
    writeFileSync(file, `${mine}\n`, { mode: 0o600, flag: 'wx' });
    return mine;
  }
  catch (error) {
    if (isTaken(error)) {
      // The other daemon's id is the one that stays, and it is a file this one
      // can read: the create failed only because the file is there. Not the
      // other way round, which would leave two daemons disagreeing.
      const theirs = readIn(file);
      if (theirs !== undefined && HOST_ID.test(theirs)) return theirs;
      throw new Error(`${file} was taken by another daemon starting at the same time, and does not hold an id this one can use: fix or move that file`);
    }
    throw new Error(`${file} cannot be written, so this daemon has no id of its own: ${why(error)}`);
  }
};

/** An error from the filesystem, which carries its own code. */
const isMissing = (error: unknown): boolean => code(error) === 'ENOENT';
/** And one from creating a file that is already there, which is not a failure here. */
const isTaken = (error: unknown): boolean => code(error) === 'EEXIST';
const code = (error: unknown): string | undefined =>
  typeof error === 'object' && error !== null ? (error as { code?: unknown }).code as string | undefined : undefined;
const why = (error: unknown): string => error instanceof Error ? error.message : String(error);

/**
 * Where a detached daemon's output goes.
 *
 * It has to go somewhere real. A background process whose stdout is a pipe
 * dies the moment the thing holding the other end exits, and one whose stdout
 * is discarded leaves nothing to read when it misbehaves.
 */
export const daemonLog = (): string => join(configDir(), 'daemon.log');

/**
 * Where automations are kept.
 *
 * Beside the configuration and not inside it: `config.json` is a file a person
 * edits and this one is written by the daemon every time somebody adds an
 * automation, and a tool that rewrites a hand-edited file loses the comments
 * and the ordering somebody put there.
 */
export const automationsPath = (): string => join(configDir(), 'automations.json');

/**
 * Where what this host adds on top of a backend is kept.
 *
 * The `IsRead` and `IsArchived` bits every client shares, and the settings a
 * session is running under. Beside the automations for the same reason: this
 * one is written whenever somebody archives a row, and `config.json` is a file
 * a person edits.
 */
export const sessionsPath = (): string => join(configDir(), 'sessions.json');

/**
 * Where the policies saying who may use which agent, model and computer are
 * kept.
 *
 * Beside the sessions and the automations for the same reason as those two: one
 * small file beside a hand-edited `config.json`, written whenever an operator
 * changes a policy through the `policy:` scheme.
 */
export const policiesPath = (): string => join(configDir(), 'policies.json');

/**
 * Where the secrets this host's work needs are kept.
 *
 * Beside the configuration for the same reason as the policies: one small file
 * a person knows the path of, holding what `config.json` names and no longer
 * carries - decision `the-local-vault-is-a-plain-file-until-it-is-encrypted`.
 * It is plain JSON and nothing reads it as a secret, so it is kept like any
 * other file holding a credential.
 */
export const vaultPath = (): string => join(configDir(), 'vault.json');

/**
 * Where what this host adds on top of a backend is kept, one file per session.
 *
 * A folder rather than the single file beside it, and the same reasoning: what
 * the daemon keeps follows the sessions that exist rather than every session it
 * ever saw, and a change to one of them is one write. `sessions.json` is what
 * a daemon before this layout left behind, and is read once on the way here.
 */
export const sessionsDir = (): string => join(configDir(), 'sessions');

/**
 * Where what npm last said about this package is kept.
 *
 * Written by the daemon after it asks the registry, and read by the startup
 * line and `ahpd status` without asking again. Beside the configuration for
 * the same reason as the two above: a person edits `config.json`, and this
 * one is rewritten four times a day.
 */
export const updatePath = (): string => join(configDir(), 'update.json');

/** Make sure the directory is there, so a write into it can succeed. */
export const ensureConfigDir = (): void => { mkdirSync(configDir(), { recursive: true }); };

/** The configuration as it was read: the merged values, the files and who set what. */
export interface LoadedConfig {
  /** Every file merged, later winning, with relative paths made absolute. Unchecked. */
  values: Config;
  /** The files read, in the order they were merged. Empty when there were none. */
  files: string[];
  /** The file that set a key, or nothing when no file did. */
  sourceOf(key: string): string | undefined;
}

/**
 * `values` with every relative path made absolute against the directory of the
 * file that set it: `paths`, `worktreesRoot`, `users` and `connectionTokenFile`.
 * A plugin spec is left as written, for the loader to try against the working
 * directory and then the configuration directory. A value of the wrong type is
 * left as it is for the schema to refuse.
 */
const anchored = (values: Record<string, unknown>, sourceOf: (key: string) => string | undefined): Config => {
  const out: Record<string, unknown> = { ...values };
  const at = (key: string, path: string): string => {
    const file = sourceOf(key);
    return file === undefined || isAbsolute(path) ? path : resolve(dirname(file), path);
  };
  for (const key of ['users', 'connectionTokenFile', 'worktreesRoot']) {
    const value = out[key];
    if (typeof value === 'string') out[key] = at(key, value);
  }
  if (Array.isArray(out.paths)) {
    out.paths = out.paths.map((one: unknown) => (typeof one === 'string' ? at('paths', one) : one));
  }
  return out as Config;
};

/**
 * Read the configuration, or answer that there was nothing to read.
 *
 * Without a name: the user file, then the file `$AHPD_CONFIG` names merged over
 * it, and no project file. With one: that file alone. A user file that is not
 * there is not an error - most people have none; a file that was named and is
 * not there, or one that is there and broken, is one.
 */
export function loadConfig(named?: string): LoadedConfig {
  let resolved: ResolvedConfig;
  try {
    resolved = resolveConfig(named === undefined
      ? { name: 'ahpd', env: { ...process.env, XDG_CONFIG_HOME: configHome() } }
      : { name: 'ahpd', path: named, user: false, environment: false });
  }
  catch (error) {
    throw new Error(error instanceof Error ? error.message : String(error));
  }
  const sourceOf = (key: string): string | undefined => resolved.sourceOf(key);
  return {
    values: anchored(resolved.values as Record<string, unknown>, sourceOf),
    files: resolved.layers.map((layer) => layer.path),
    sourceOf,
  };
}

/**
 * One configuration entry as a `PluginSpec`, or nothing when it is not one.
 *
 * A string is the specifier on its own; an object names one and may carry the
 * options `apply` receives and whether the plugin is switched on. Anything
 * else answers `undefined` rather than a half-built spec, so the caller can
 * refuse the start with a message naming the entry instead of loading
 * something nobody wrote.
 */
export const asSpec = (value: unknown): PluginSpec | undefined => {
  if (typeof value === 'string') return value.trim() === '' ? undefined : value;
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const held = value as Record<string, unknown>;
  if (typeof held.name !== 'string' || held.name.trim() === '') return undefined;
  if (held.options !== undefined && (typeof held.options !== 'object' || held.options === null || Array.isArray(held.options))) {
    return undefined;
  }
  if (held.enabled !== undefined && typeof held.enabled !== 'boolean') return undefined;

  const spec: PluginSpec = { name: held.name };
  if (held.options !== undefined) spec.options = held.options as Record<string, unknown>;
  if (held.enabled !== undefined) spec.enabled = held.enabled;
  return spec;
};

/**
 * The identifier a host advertises for its own sign-in.
 *
 * The operator's when they named one, and otherwise one derived from where the
 * daemon listens: RFC 9728 wants a resource identifier that uses the https
 * scheme, and a LAN daemon has no other name to offer. A wildcard address is
 * not a name, so the machine's own stands in for it, and port `0`, which asks
 * the OS to choose one, is left out rather than advertised as a zero.
 *
 * Pure and given the machine name, so what a client will be told is testable
 * without binding a port.
 */
export const signInIdentifier = (
  options: { resource?: string; host: string; port: number },
  machine: string,
): string => {
  if (options.resource !== undefined) return options.resource;
  const wildcard = options.host === '' || options.host === '0.0.0.0' || options.host === '::';
  const named = wildcard ? machine : options.host;
  return `https://${named}${options.port === 0 ? '' : `:${options.port}`}/`;
};

/** Whether a value is the identifier the record requires: https, and no fragment. */
export const isIdentifier = (value: string): boolean => /^https:\/\/[^\s#]+$/.test(value);

/**
 * An issuer named in the configuration, as the kind it is.
 *
 * `github` is the preset a stock client can resolve with no work at all, and a
 * URL this host may reach is an OpenID Connect issuer whose metadata is
 * discovered. Anything else answers nothing, so the daemon refuses the start
 * with a sentence rather than discovering a typo on the first sign-in.
 *
 * The rule itself is `issuerKind` in the SDK, beside `issuerFrom`, because a
 * record's own `issuer` is resolved by the same rule and the two must not
 * disagree.
 */
export const namedIssuer = issuerKind;

/**
 * A host as a URL writes it: an IPv6 address in brackets, any other host as it is.
 */
export const urlHost = (host: string): string => (isIPv6(host) ? `[${host}]` : host);

/**
 * The URL a person pastes where a client asks for a host.
 *
 * The token in the query, which is the shape this daemon's door and the
 * reference client's remote-host prompt both speak. A wildcard bind address is
 * not a name a client can reach, so the machine's own stands in for it. Pure
 * and given the machine name, so the line `ahpd user token --url` prints is
 * testable without a daemon.
 */
export const personalUrl = (secret: string, host: string, port: number, machine: string): string => {
  const wildcard = host === '' || host === '0.0.0.0' || host === '::';
  return `ws://${wildcard ? machine : urlHost(host)}:${port}/?tkn=${encodeURIComponent(secret)}`;
};
