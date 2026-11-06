/** What this daemon was told before anybody typed a flag, and where it is. */

import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { isIPv6 } from 'node:net';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { resolveConfig, type ResolvedConfig } from '@cofold/config';
import { isShellName, issuerKind, reason, type Icon, type IssuerVerify, type McpServer, type PluginContracts, type PluginLink, type PluginSpec, type ShellEnv } from '@ahpd/sdk';
import type { ProxySetting } from './proxy/providers.js';

/**
 * The HTTP API, as the configuration turns it on.
 *
 * `true` serves it under `/api` on the daemon's own listener, beside the
 * WebSocket; a `port` moves it to a listener of its own, bound to the daemon's
 * `host` unless `host` says otherwise. The API is off unless this names it,
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
 * Where the plugins' routes are served.
 *
 * Absent is the daemon's own listener. A `port` moves every route to a listener
 * of its own, which serves `/plugins/*` and nothing else, so a route can be on
 * a public address while AHP and the API are not.
 */
export interface RoutesSetting {
  /** The port the routes' own listener is bound to. */
  port?: number;
  /** The address the routes' own listener binds. Absent is the daemon's host. */
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
   * The zone a day and a week start in, and the store keeps its days in, as
   * `Intl` names one.
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
  /**
   * Which row of one scope pays first when several can.
   *
   * `ending` uses the row that ends soonest first, `regular` the rows with no
   * `until`, and `extra` the rows with one, the newest `from` first. Defaults
   * to `ending`, so temporary credit is spent before regular credit.
   */
  payOrder?: 'ending' | 'regular' | 'extra';
  /**
   * Whether a person reads the limits whose scope holds them.
   *
   * Defaults to `true`: a person sees the limits that apply to them, with only
   * their own figure for a limit every member has their own total of.
   */
  ownLimits?: boolean;
}

/**
 * The service that holds this daemon, for a daemon that runs beside another.
 *
 * A block beside `policies`, because it is about how the daemon is kept running
 * rather than how one run started, and it has no flag: the file `ahpd service
 * install` writes runs the daemon with this configuration file and nothing
 * else, so the file is where the install and the daemon both read it.
 */
export interface ServiceSetting {
  /**
   * The name the service is installed under: `ahpd@<name>` on systemd and
   * `dev.ahpd.daemon.<name>` on launchd. Absent is the plain `ahpd` and
   * `dev.ahpd.daemon`.
   */
  name?: string;
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
   * where VS Code's host looks for it.
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
   * addition as it arrives.
   */
  usage?: UsageSetting;
  /**
   * Whether the policies saying who may use which agent, model and computer are
   * enforced. Off is the default, and the rows are kept either way.
   */
  policies?: PoliciesSetting;
  /** The service that holds this daemon, named for a daemon that runs beside another. */
  service?: ServiceSetting;
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
   * The origins this host also answers to, each a scheme, a host and a port.
   *
   * A host bound to a wildcard answers to no name but the loopback ones, so a
   * browser that reaches it by a public address or another name is refused.
   * Each entry here is one the deployment chose: its origin is an `Origin` the
   * API accepts and its host a `Host` the API and the plugin routes accept.
   */
  origins?: string[];
  /**
   * Whether the HTTP API answers to the host names of the tunnels on the list.
   *
   * Off, the API answers only to the names above and the ones derived from the
   * bound address, while the plugin routes answer to a tunnel's URL either
   * way, because that is the webhook a route is usually reached through. On,
   * each tunnel's host is a `Host` the API accepts too. A tunnel's name is a
   * fresh one on every start, which is why this is the list's, not a name.
   */
  tunnelHosts?: boolean;
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
   * How a token from that issuer is checked: `userinfo`, `jwt` or `auto`.
   *
   * `userinfo`, the default, is what this host has always done and the only way
   * an opaque token can be read: the token is carried to the issuer's endpoint
   * and the endpoint says who it belongs to. `jwt` checks a token here instead,
   * against the key set the issuer publishes, which is what an operator turns
   * on for a provider whose tokens this host can check itself - the token's own
   * `exp` then ends the sign-in, and no request about the token is made. `auto`
   * checks here first and asks the endpoint for a token the keys cannot answer.
   *
   * A record that names its own issuer may carry its own setting, which is what
   * lets one person sign in through a provider of their own that is checked
   * differently from the rest.
   */
  issuerVerify?: IssuerVerify;
  /**
   * Whether only a token from a person's issuer signs them in.
   *
   * False, so a person's connection token names them at the door and through
   * `authenticate`. True, a local token only opens the socket, and the token
   * their record's issuer signed is the one that signs them in. A record's own
   * `requireIssuer` overrides it.
   */
  requireIssuer?: boolean;
  /**
   * How many tokens one person may mint for themselves.
   *
   * Ten, the default, and a mint past it is refused. Zero lets nobody mint one.
   * A token that has expired does not count, so an old one does not hold a
   * place. The tokens themselves are in a file beside the users file.
   */
  tokensPerPerson?: number;
  /**
   * Whether a tool that declares `advancedPermission` is offered to sessions.
   *
   * False, so those tools are absent until this says otherwise: a plugin that
   * starts containers on this host contributes them only to a host that asked
   * for them. A tool that declares nothing is unaffected, and the reference
   * host's own set declares nothing.
   */
  advancedTools?: boolean;
  /**
   * Whether the session tools are offered at all.
   *
   * `true`, the default, offers them; `false` offers none. The session tools
   * are the nine that read and move the sessions running beside this one, so an
   * install that would rather its agents did not reach their neighbours turns
   * them off with this. Nothing else this host contributes is affected: the
   * artifact tools, `ahp_resource`, `ahp_terminals` and `schedule_wakeup` are
   * offered whatever this says.
   */
  sessionTools?: boolean;
  /**
   * The providers whose sessions are offered the session tools.
   *
   * Empty, the default, offers them to every provider's sessions; a list of
   * provider ids offers them to those providers' sessions alone. It narrows
   * `sessionTools` rather than replacing it: with `sessionTools` false no
   * session is offered them whatever this names.
   */
  sessionToolsProviders?: string[];
  /**
   * What closing one chat of a session does to that chat's conversation in the
   * backend.
   *
   * `hidden`, the default, leaves the conversation where it is and keeps the id
   * it was written under claimed, so it is never listed as a session of its
   * own. `delete` removes it through the same `Agent.delete` a disposed session
   * goes through.
   */
  closedChats?: 'hidden' | 'delete';
  /**
   * What a turn naming a model its chat's agent does not offer does.
   *
   * `fail`, the default, ends the turn saying its agent does not offer the
   * model. `keep` is VS Code's: a chat whose agent is not its session's keeps
   * the model it has, and any other chat's agent is handed the model as it is.
   */
  unofferedModel?: 'fail' | 'keep';
  /**
   * Whether a turn's sender is said on what clients read.
   *
   * `said`, the default, puts who sent each turn on its start and its message.
   * `kept` is VS Code's: the host keeps each turn's sender and says it in no
   * action and no turn a client reads.
   */
  turnSenders?: 'said' | 'kept';
  /**
   * What a backend's own background work actions come to.
   *
   * `drop`, the default, drops them, the host drawing every background row.
   * `say` is VS Code's: the backend's action is said as the host's.
   */
  backendBackgroundWork?: 'drop' | 'say';
  /**
   * What archiving a session does with a working tree that has changes nobody
   * committed.
   *
   * `keep`, the default, leaves the tree where it is. `commit` commits every
   * change on the session's branch, then removes the tree and keeps the
   * branch, so an unarchive can put the tree back.
   */
  archiveDirtyWorktree?: 'keep' | 'commit';
  /**
   * What a session on a joined node does when that node's `ahpd join` restarts.
   *
   * `end`, the default, ends the session with a sentence naming the node, and
   * the next turn resumes it by the inner host's id. `reconnect` keeps it and
   * opens it again on the socket the node dials when it comes back.
   */
  nodeRestart?: 'end' | 'reconnect';
  /**
   * How the pass that archives and deletes merged sessions learns the state of
   * a pull request.
   *
   * `url`, the default, asks GitHub for each related pull request by its page.
   * `branch` asks for the pull requests of the session's branch.
   */
  pullRequestLookup?: 'url' | 'branch';
  /**
   * How long a call a client runs may wait before it is failed.
   *
   * Unset is ten minutes; zero waits for ever, for a deployment whose clients
   * are slow rather than gone.
   */
  clientToolTimeoutMs?: number;
  /**
   * The environment every shell this host starts is given, by variable name.
   *
   * A string is what the variable is set to; `null` removes it. A deployment
   * that runs its daemon with an environment of its own - a service unit with
   * a private `XDG_CONFIG_HOME` - has no other way to say which of it reaches
   * an agent's shells. It has no flag, because a map is not one, and it is not
   * root config, because a client holding `config:change` may send root config
   * and this is the operator's decision for the whole daemon.
   */
  shellEnv?: ShellEnv;
  /**
   * The rules a session's shell commands are matched against when the window
   * that started it pushed none.
   *
   * `vscode`, the default, is VS Code's own terminal auto-approve table, so a
   * command the reference client approves runs without asking. `none` approves
   * no command, so every one asks, which is what a deployment that would rather
   * review each command runs with.
   *
   * Only a window that pushed no rules falls back to this: one that pushed an
   * empty table has said what it approves, and it approves nothing.
   */
  terminalAutoApproveDefaults?: 'vscode' | 'none';
  /**
   * How long a streamed delta waits for the next one before it is sent.
   *
   * Milliseconds, a whole number from 0 to 1000. Within the window the deltas
   * naming one part are merged into one action, which is the same text a
   * client ends up with in fewer envelopes. Unset is 75; zero sends every
   * delta as it arrives.
   */
  deltaWindowMs?: number;
  /**
   * Minutes a session with nothing in hand stays loaded before its agent is
   * let go. It stays in the catalogue and wakes when something needs it.
   * Unset is 30; zero never lets a session go for quiet.
   */
  sleepAfterMinutes?: number;
  /**
   * How many sessions are resident at most, running or with their state held.
   * Over it, the least recently used one that nothing holds is let go first,
   * with its state. Unset is 10; zero sets no limit.
   */
  sessionResidencyLimit?: number;
  /**
   * The largest file the daemon asks a client for, in bytes: an attachment
   * the daemon has no copy of is read through the client that sent it, and
   * one whose size hint is over this is left as it was sent. Unset is
   * 33554432 (32 MiB); zero sets no limit.
   */
  attachmentFetchLimitBytes?: number;
  /**
   * The most bytes the daemon keeps of one content a tool result or an
   * agent's message carries inline, read back by a `session-db-resource` URI;
   * larger content is left out. Unset is 8388608 (8 MiB), VS Code's bound;
   * zero sets no limit.
   */
  toolResultResourceLimitBytes?: number;
  /** A file every frame is appended to, both directions, as JSON lines. */
  wire?: string;
  /**
   * Whether the HTTP API is served, and where.
   *
   * `true` is the daemon's own listener under `/api`; `{ "port": N }` is a
   * listener of its own. Absent is off, which is what every install that never
   * asked for an API keeps.
   */
  httpApi?: boolean | HttpSetting;
  /**
   * What `/mcp` serves to a person's MCP client.
   *
   * `none`, the default, answers 404 there and leaves the path to nobody.
   * `all` serves every tool the caller's grants allow that needs no session,
   * which is the session tools first. The door needs `httpApi` on, because
   * `/mcp` is served on the same listener as `/api`.
   */
  mcpTools?: 'none' | 'all';
  /** Where the plugins' routes are served. Absent is the daemon's own listener. */
  routes?: RoutesSetting;
  /**
   * The providers this proxy calls, and the model names that point at them.
   *
   * A provider is an endpoint and the APIs it answers in; a model name is
   * `<maker>/<name>` and lists the providers serving it, each under that
   * provider's own model id. Three providers are built in and are there without
   * this key, so the proxy knows where it would call before anybody configures
   * anything, and an entry here replaces one of them whole or adds one that is
   * not built in. A key is named by the environment variable holding it and is
   * never written here.
   */
  modelProxy?: ProxySetting;
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
   * process with this process's permissions. That makes this and `commandParser`
   * the two keys whose value is code rather than a setting, which is why the
   * file holding it is owner-readable for the same reason the token file is,
   * and why a malformed entry refuses the start rather than being skipped.
   */
  plugins?: PluginSpec[];
  /**
   * A module whose default export reads a session's shell commands.
   *
   * A path, resolved against the file that names it. The module's default
   * export is called as `(line, shell)` and answers the split the rules are
   * matched against, or `undefined` for a line it cannot read. The sdk's own
   * splitter is the reader when this key is absent.
   *
   * A `.ts` module needs a runtime that strips types as it loads: Node 22.18 or
   * newer, Bun, or Deno. As with `plugins`, naming a module runs its code in
   * this process with this process's permissions.
   */
  commandParser?: string;
  /**
   * Ask npm whether a newer version exists, six hours apart. `false` never
   * asks. The daemon has no terminal, so this key is how it is switched off
   * where `--no-update-check` is not typed.
   */
  updateCheck?: boolean;
}

/**
 * What is wrong with a `shellEnv` value, one line each, or nothing.
 *
 * The key is a map of variable name to a value, and the JSON Schema this
 * daemon checks its file against has no way of saying that an object is a map
 * - so each name and each value is held on its own here, and a bad one is
 * named rather than the whole key being refused as an object.
 *
 * A name a POSIX shell cannot export is refused rather than dropped: the
 * backend that writes the lines would leave it out in silence, and a name this
 * daemon cannot read is a mistake in the file rather than a request. A value
 * that is neither text nor `null` is refused for the same reason - a number is
 * not a value a shell reads, and `null` is how the file says remove it.
 */
export const shellEnvProblems = (held: unknown): string[] => {
  if (held === undefined) return [];
  // Not a map at all is the schema's to refuse, with the key's own name.
  if (typeof held !== 'object' || held === null || Array.isArray(held)) return [];
  const problems: string[] = [];
  for (const [name, value] of Object.entries(held)) {
    if (!isShellName(name)) {
      problems.push(`shellEnv.${name} is not a shell variable name`);
      continue;
    }
    if (value !== null && typeof value !== 'string') {
      problems.push(`shellEnv.${name} must be text or null`);
    }
  }
  return problems;
};

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
    throw new Error(`${file} cannot be read, so this daemon cannot tell which machines are its own: ${reason(error)}. Fix or move that file`);
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
    throw new Error(`${file} cannot be written, so this daemon has no id of its own: ${reason(error)}`);
  }
};

/** An error from the filesystem, which carries its own code. */
const isMissing = (error: unknown): boolean => code(error) === 'ENOENT';
/** And one from creating a file that is already there, which is not a failure here. */
const isTaken = (error: unknown): boolean => code(error) === 'EEXIST';
const code = (error: unknown): string | undefined =>
  typeof error === 'object' && error !== null ? (error as { code?: unknown }).code as string | undefined : undefined;

/**
 * Where a detached daemon's output goes.
 *
 * It has to go somewhere real. A background process whose stdout is a pipe
 * dies the moment the thing holding the other end exits, and one whose stdout
 * is discarded leaves nothing to read when it misbehaves.
 */
export const daemonLog = (): string => join(configDir(), 'daemon.log');

/**
 * Where automations are kept: one `<id>.md` per automation.
 *
 * Beside the configuration and not inside it: `config.json` is a file a person
 * edits and a file here is written whenever somebody adds or changes an
 * automation, and a tool that rewrites a hand-edited file loses the comments
 * and the ordering somebody put there.
 */
export const automationsDir = (): string => join(configDir(), 'automations');

/**
 * Where the run state of every automation is kept.
 *
 * The one file a run writes, kept apart from the automations themselves: what
 * changes on every occurrence - how many runs an allowance has paid for, and
 * when the next one is - must not be in the file a person edits.
 */
export const automationStatePath = (): string => join(configDir(), 'automations-state.json');

/**
 * Where the on/off decisions about customizations are kept.
 *
 * Beside the automations and the sessions for the same reason as those: one
 * small file beside a hand-edited `config.json`, written whenever somebody
 * switches a plugin off for every session or for a folder. It is the two
 * decisions that outlive a session, and not the session's own, which is that
 * session's business.
 */
export const customizationStatePath = (): string => join(configDir(), 'customizations-state.json');

/**
 * The one file an earlier daemon kept every automation in.
 *
 * Nothing writes it any more. Named here rather than beside the conversion
 * that reads it, because that has to say where it looked whether or not there
 * was anything there.
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
 * carries.
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
 * Where the plugins a client hands a session are copied to.
 *
 * A folder this host writes and a client never sees: a plugin a client
 * announces is a URI it serves, and the backend that has to run it opens a
 * path on this machine. Kept under the configuration directory because it is
 * the one place this host is known to be able to write, and read again at
 * startup so a daemon that started over does not copy what it already has.
 */
export const agentPluginsDir = (): string => join(configDir(), 'agentPlugins');

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

/**
 * The settings that were renamed, each with the name it has now.
 *
 * The old name is still read, so a file written before the rename keeps
 * working, and the daemon says which name to use rather than rewriting the
 * file behind the person. A file holding both names is refused: they are one
 * setting, and which of them wins is not something to guess.
 */
export const RENAMED_KEYS = [
  { was: 'http', now: 'httpApi' },
  { was: 'proxy', now: 'modelProxy' },
] as const;

/** The name a setting had before it was renamed, or nothing when it was not. */
export const oldNameOf = (key: string): string | undefined =>
  RENAMED_KEYS.find((one) => one.now === key)?.was;

/** The configuration as it was read: the merged values, the files and who set what. */
export interface LoadedConfig {
  /** Every file merged, later winning, with relative paths made absolute. Unchecked. */
  values: Config;
  /** The files read, in the order they were merged. Empty when there were none. */
  files: string[];
  /** The file that set a key, or nothing when no file did. */
  sourceOf(key: string): string | undefined;
  /** What a person should change about the file, one line each. */
  warnings: string[];
}

/**
 * `values` with every relative path made absolute against the directory of the
 * file that set it: `paths`, `worktreesRoot`, `users`, `connectionTokenFile`
 * and `commandParser`.
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
  for (const key of ['users', 'connectionTokenFile', 'worktreesRoot', 'commandParser']) {
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
  /*
   * The old names are read under the new ones, and the file is left as it is.
   *
   * A file with both names for one setting is refused rather than resolved:
   * they are one setting, and which of the two a person meant is not something
   * the daemon can guess. The sentence names the old one to remove.
   */
  const read = resolved.values as Record<string, unknown>;
  const values: Record<string, unknown> = { ...read };
  const warnings: string[] = [];
  for (const { was, now } of RENAMED_KEYS) {
    if (read[was] === undefined) continue;
    const where = resolved.sourceOf(was) ?? 'the configuration';
    if (read[now] !== undefined) {
      const other = resolved.sourceOf(now) ?? 'the configuration';
      throw new Error(other === where
        ? `${where} holds both ${was} and ${now}, and they name the same setting: remove ${was}, the old name of ${now}.`
        : `${where} holds ${was} and ${other} holds ${now}, and they name the same setting: remove ${was}, the old name of ${now}.`);
    }
    delete values[was];
    values[now] = read[was];
    warnings.push(`${was} is now ${now}; rename it in ${where}.`);
  }
  const sourceOf = (key: string): string | undefined => {
    const now = resolved.sourceOf(key);
    if (now !== undefined) return now;
    const was = oldNameOf(key);
    return was === undefined ? undefined : resolved.sourceOf(was);
  };
  return {
    values: anchored(values, sourceOf),
    files: resolved.layers.map((layer) => layer.path),
    sourceOf,
    warnings,
  };
}

/**
 * One configuration entry as a `PluginSpec`, or nothing when it is not one.
 *
 * A string is the specifier on its own; an object names one with `source` and
 * may carry the options `apply` receives and whether the plugin is switched on.
 * An object whose `name` stands alone is the old form, and its `name` is the
 * specifier. Anything else answers `undefined` rather than a half-built spec, so
 * the caller can refuse the start with a message naming the entry instead of
 * loading something nobody wrote.
 */
export const asSpec = (value: unknown): PluginSpec | undefined => {
  if (typeof value === 'string') return value.trim() === '' ? undefined : value;
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const held = value as Record<string, unknown>;
  /*
   * `source` names the module. An entry written before `source` named it with
   * `name`, so a `name` with no `source` is the old form and its value is the
   * module; a `name` beside a `source` is what a listing prints.
   */
  const source = typeof held.source === 'string'
    ? held.source
    : typeof held.name === 'string' ? held.name : undefined;
  if (source === undefined || source.trim() === '') return undefined;
  if (held.source !== undefined && typeof held.source !== 'string') return undefined;
  if (held.options !== undefined && (typeof held.options !== 'object' || held.options === null || Array.isArray(held.options))) {
    return undefined;
  }
  if (held.enabled !== undefined && typeof held.enabled !== 'boolean') return undefined;
  /*
   * The grants, kept only when every one of them is a string.
   *
   * A list holding anything else is a half-read answer about what a plugin may
   * do, which is worse than none: the loader would drop the one bad entry and
   * grant the rest, and an operator who wrote a number would be told about the
   * number and not about the list they meant to write. So the whole list goes
   * and the entry is refused, the way a wrong `enabled` is.
   */
  if (held.grants !== undefined && !(Array.isArray(held.grants) && held.grants.every((one) => typeof one === 'string'))) {
    return undefined;
  }

  // The display name, which only the form carrying `source` has.
  if (held.name !== undefined && typeof held.name !== 'string') return undefined;
  /*
   * The manifest a standalone plugin carries in its own entry, which the loader
   * reads with no import. A field of the wrong kind is refused with the entry,
   * as a wrong `enabled` is; the structured ones are kept as written, because
   * the loader's manifest check is what names the field that is badly shaped.
   */
  for (const key of ['id', 'version', 'description'] as const) {
    if (held[key] !== undefined && typeof held[key] !== 'string') return undefined;
  }
  const spec: PluginSpec = { source };
  if (typeof held.source === 'string' && typeof held.name === 'string') spec.name = held.name;
  if (held.options !== undefined) spec.options = held.options as Record<string, unknown>;
  if (held.enabled !== undefined) spec.enabled = held.enabled;
  if (held.grants !== undefined) spec.grants = held.grants as string[];
  if (typeof held.id === 'string') spec.id = held.id;
  if (typeof held.version === 'string') spec.version = held.version;
  if (typeof held.description === 'string') spec.description = held.description;
  if (held.categories !== undefined) spec.categories = held.categories as string[];
  if (held.links !== undefined) spec.links = held.links as PluginLink[];
  if (held.contracts !== undefined) spec.contracts = held.contracts as PluginContracts;
  if (held.icons !== undefined) spec.icons = held.icons as Icon[];
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
