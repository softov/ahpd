/**
 * The foreground daemon, and the one command every flag is declared on.
 *
 * `ahpd [options]` means "run it here, in this terminal", and a program has no
 * word for that. The declaration below is that command, and `main.ts` gives it
 * its word when a line has no command in it. The body is the whole daemon: the
 * announcement, the update check, the record a detached daemon writes about
 * itself, and the shutdown both signals reach.
 */

import { hostname } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { canonicalFromCli, check, createRegistry, optionTable, optionsOf, tokenize } from '@cofold/commands';
import type { Command, JsonSchema, Registry } from '@cofold/commands';
import type { Agent, Alert, AutomationStore, AutomationsOptions, CommandSplitter, Connected, Contribution, DoorOptions, HostOptions, Loaded, Opened, Peer, Principal, Raw, RequestHandler, Route, ServedAdapter, ServedEngine, SessionStore, Tap, Usage, Vault } from '@ahpd/sdk';
import {
  adaptersChannel,
  enginesChannel,
  agentsChannel,
  clientPluginsIn,
  connectorsChannel,
  createHost,
  createMinuteMeter,
  doorOf,
  fileResources,
  fileSessions,
  fileUsage,
  filePolicies,
  policyChannels,
  fileUsers,
  fileNodes,
  liveNodes,
  nodesFileOf,
  gitBranches,
  gitChanges,
  gitWorktrees,
  githubPullRequests,
  hostTools,
  issuerFrom,
  JOIN_PATH,
  listen,
  memoryAutomations,
  memorySessions,
  migrateSessions,
  overStdio,
  ownerOf,
  peopleChannels,
  pluginTriggerTypes,
  raise,
  reason,
  servedRecords,
  shellTerminals,
  signInRecord,
  meMethods,
  tokenMethods,
  toolServers,
  usageMethods,
  usageProvider,
  AGENT_RECORD_VARIABLE,
} from '@ahpd/sdk';
import { CONTROL_ENV, DETACHED_ENV, SERVICE_ENV, claim, forget, recordOf, running, serviceIn, start as startDaemon, sweepTemps } from '../daemon.js';
import { controlIn, controlServer } from '../control.js';
import type { ControlServer } from '../control.js';
import { here } from '../ask.js';
import { offerConfigure, askToServe } from './configure.js';
import { agentPluginsDir, automationsDir, automationsPath, automationStatePath, configDir, configPath, customizationStatePath, daemonLog, hostId, isIdentifier, namedIssuer, policiesPath, sessionsDir, sessionsPath, signInIdentifier, urlHost, vaultPath } from '../config.js';
import { API_PREFIX, apiHandler, json, listenApi, plainRequests, pluginRoutes, withoutApi, type ApiListener, type ApiOrigins } from '../http.js';
import { servedRegistry, type ServedFacts } from './served.js';
import { updateMethod } from './update.js';
import { connectorModels, proxyHandler, type ProxyOptions } from '../proxy/listener.js';
import { modelCatalog } from '../proxy/catalog.js';
import { hostAdapters } from '../proxy/adapters.js';
import { loadPlugins, pluginSet, type LoadOptions } from '../plugins.js';
import { applyPlugins, type Applied } from '../applyplugins.js';
import { pluginsChannel } from '../pluginschannel.js';
import { fileRecords } from '../records.js';
import { applyPresets, planPresets, splitModels } from '../agents/migrate.js';
import { handedAgent } from '../agents/handed.js';
import { fileVault } from '../vault.js';
import { daemonRootConfig } from '../rootconfig.js';
import { pty } from '../pty.js';
import { realManager } from '../service.js';
import { migrateAutomations, scheduledAutomations } from '../scheduled.js';
import { fileEnablement } from '../enablement.js';
import { filesOf, lineFor, writerFor } from '../wire.js';
import { MAX_AGE_MS, checkingUpdates, readUpdate, refreshUpdate, registry as npmRegistry, stale, updateLine } from '../update.js';
import { manifest, version } from '../version.js';
import { conflict, namedOptionsFrom, secret, flagFields, stop } from './options.js';
import { FORCED_SIGNAL, RESTART_SIGNAL, answerRestartSignal, checkedRestart, lifecycle, restartMethod, successorTakes } from './restart.js';
import type { Options } from './options.js';

/**
 * The names the API answers to.
 *
 * The loopback names at the bound port are always the daemon's own, because a
 * client on this machine reaches it by one of them. A specific bound address
 * adds itself, bracketed when it is IPv6 so that the authority and the origin
 * are ones a URL parser reads back, and a wildcard bind adds nothing: every
 * address is the daemon's to answer on but none of them is a name it can tell
 * its own from. `resource` is the public identifier a deployment behind a proxy
 * names, so its hostname is one of them too, alone, at the bound port, and with
 * the port the resource names when it names one. Each of `extra`,
 * the origins a deployment named, adds exactly its origin and its host, which
 * are what a browser that reached it there sends.
 */
export function apiOrigins(host: string, resource: string | undefined, port: number, extra: readonly string[] = []): ApiOrigins {
  const names = ['127.0.0.1', 'localhost', '[::1]'];
  if (host !== '0.0.0.0' && host !== '::') names.push(urlHost(host));
  const authorities = names.map((one) => `${one}:${port}`);
  const origins = names.map((one) => `http://${one}:${port}`);
  if (resource !== undefined) {
    const at = new URL(resource);
    authorities.push(at.hostname, `${at.hostname}:${port}`, ...(at.port === '' ? [] : [at.host]));
    origins.push(at.origin);
  }
  for (const one of extra) {
    const at = new URL(one);
    authorities.push(at.host);
    origins.push(at.origin);
  }
  return { authorities, origins };
}

/**
 * The names a plugin's own announcements add to what this daemon answers to.
 *
 * A plugin that made the daemon reachable somewhere else - a tunnel, a name on
 * a network - says so through `say`, and a webhook that arrives through it
 * sends the `Host` of that address rather than a loopback name. So every
 * `scheme://` URL a line holds contributes both its `host` and its `hostname`:
 * the first for a caller that sends the port the tunnel is reached on, the
 * second for one that sends none.
 *
 * Read out of the announcement rather than configured, because a tunnel's host
 * is a fresh name on every run and the plugin that made it is the only thing
 * that knows it. A word a line holds that a URL parser refuses is prose around
 * the URL, and is left to the reader rather than failing the whole line.
 */
export function announcedNames(lines: readonly string[]): string[] {
  const names: string[] = [];
  for (const line of lines) {
    for (const found of line.matchAll(/[a-zA-Z][\w+.-]*:\/\/[^\s,;()]+/gu)) {
      if (found[0] === undefined) continue;
      let at: URL;
      try { at = new URL(found[0]); }
      catch { continue; }
      names.push(at.host, at.hostname);
    }
  }
  return names;
}

/**
 * A problem as the one line it is announced as.
 *
 * Whatever a plugin threw may hold a newline of its own, and a line is what
 * says which problem a `skipped: ` line is: a second line would answer to
 * nothing and be dropped by the reader that took the first.
 */
const oneLine = (problem: string): string => problem.replace(/\s*[\r\n]+\s*/gu, ' ');

/**
 * What this daemon keeps between restarts, over whatever an earlier one left.
 *
 * `sessions.json` is split into a file per session once, before the store
 * opens, so a daemon that carried every session it ever saw does not go on
 * carrying the one file that held them as well. The split is this daemon's
 * business because where its files live is, and the store this version opens
 * only knows the folder.
 */
export function daemonSessions(told: (message: string) => void): SessionStore {
  migrateSessions({ dir: sessionsDir(), file: sessionsPath(), onProblem: told });
  return fileSessions({ dir: sessionsDir(), onProblem: told });
}

/**
 * The automations this daemon keeps, over whatever an earlier one left.
 *
 * `automations.json` is split into a file per automation once, before the store
 * opens, so a daemon that carried every automation it ever saw does not go on
 * carrying the one file that held them - and so a person editing an automation
 * has a file to edit rather than a row in a document. The split is this
 * daemon's business because where its files live is, and the store this version
 * opens only knows the folder and the state file.
 */
export function daemonAutomations(told: (message: string) => void, store?: AutomationsOptions): AutomationStore {
  migrateAutomations({ file: automationsPath(), dir: automationsDir(), state: automationStatePath(), onProblem: told });
  return scheduledAutomations({
    dir: automationsDir(), state: automationStatePath(), onProblem: told,
    ...(store === undefined ? {} : { store }),
  });
}

/**
 * Every file this daemon writes whole, beside which a writer that died leaves
 * its scratch.
 *
 * The users file is wherever the operator pointed `--users`; the rest are under
 * the configuration directory, the machine owners and the vault included. The
 * owners file is the computer plugin's and the vault is this daemon's own port
 * until a plugin registers one, and this daemon's own start is the only place
 * that knows all five at once - which is why the sweep happens here rather than
 * beside any one of the writers.
 */
export const wholeFiles = (users?: string): string[] => [
  ...(users === undefined ? [] : [users]),
  policiesPath(),
  automationStatePath(),
  customizationStatePath(),
  join(configDir(), 'computers.json'),
  vaultPath(),
];

/**
 * The reader a `commandParser` module exports, or the start stops.
 *
 * Imported by file URL, as a plugin is, so a relative path was already made
 * absolute against the file that named it. A file that cannot be imported, or
 * one whose default export is not a function, refuses the start: the key names
 * code this daemon runs, and a parser nobody can call would leave every command
 * asking with no sentence saying why.
 */
export async function commandParserFrom(file: string): Promise<CommandSplitter> {
  let module: unknown;
  try {
    module = await import(pathToFileURL(file).href);
  }
  catch (error) {
    stop(`commandParser names ${file}, which could not be imported: ${reason(error)}`);
  }
  const parser = (module as { default?: unknown }).default;
  if (typeof parser !== 'function') {
    stop(`commandParser names ${file}, whose default export is not a function. Export the reader as \`export default (line, shell) => split\`.`);
  }
  return parser as CommandSplitter;
}

/**
 * The sentence a configured parser and a plugin that also set the port answer,
 * or nothing when only one of them did.
 *
 * Two readers of one line is one too many, and the configuration's module is
 * the deployment's own, so a plugin that sets the port over it refuses the
 * start rather than winning by load order. `'replace'` is how the plugin says
 * it meant to take it over. With no configured parser this answers nothing:
 * the fold's own rule for two plugins is what applies then.
 */
export const parserConflict = (named: boolean, contributions: readonly Contribution[]): string | undefined => {
  if (!named) return undefined;
  const other = contributions.find((one) => one.ports.commandParser !== undefined && one.ports.commandParser.replace !== true);
  if (other === undefined) return undefined;
  return `plugin ${other.by} also sets commandParser, which "commandParser" in the configuration already set; pass 'replace' to take it over`;
};

/**
 * One host, one working directory, one port.
 *
 * A second directory is a second daemon rather than a flag, because the working
 * directory is what the catalogue *is* - a host that served several would have
 * to answer "which sessions" before it could answer anything, and the protocol
 * has no place to ask.
 */
export async function runForeground(options: Options, typed: Readonly<Record<string, unknown>> = {}): Promise<void> {
  const { token, from } = secret(options);
  /*
   * Whether `ahpd start` spawned this process, and so will record it. Taken out
   * of the environment at once, so a shell a session runs does not inherit it.
   */
  const detached = process.env[DETACHED_ENV] === '1';
  delete process.env[DETACHED_ENV];
  /*
   * Where this daemon takes a stop and a restart, on Windows, made by the
   * `start` that spawned it. Taken out of the environment at once like the flag
   * above, so a shell a session runs inherits neither - and so the key is held
   * by this process alone.
   */
  const control = controlIn(process.env[CONTROL_ENV]);
  delete process.env[CONTROL_ENV];
  /*
   * Whether a service manager started this process, and which one. Taken out of
   * the environment at once like the two above, so a shell a session runs
   * inherits none of them.
   */
  const service = serviceIn(process.env[SERVICE_ENV]);
  delete process.env[SERVICE_ENV];
  // The name its configuration gives that service, which only a held daemon has.
  const serviceName = service === undefined ? undefined : options.serviceName;

  /*
   * Whether a clock is running, decided once and then said out loud.
   *
   * Both stores take a schedule trigger and only one of them ever fires it, and
   * what tells a client which it got is a `nextRunAt` that is simply absent.
   * That is too quiet for somebody who has just written a schedule, so the
   * startup line says it in words and `ahpd status` repeats it.
   */
  const memory = options.automations === 'memory';

  /*
   * One timestamped writer for everything this daemon says outside the protocol.
   *
   * The daemon's own lines had no times on them, so a log read after something
   * went wrong said what happened in order and nothing about how far apart -
   * which is most of what is worth knowing when a process died a minute after
   * starting. It is also what makes this log line up against a client's, since
   * the two are separate programs and the only thing they share is a clock.
   */
  const stamp = (line: string): void => { process.stderr.write(`${new Date().toISOString()} ${line}\n`); };
  for (const warning of options.warnings) stamp(warning);

  /*
   * What this host calls its own sign-in resource.
   *
   * The operator's identifier when they named one, and otherwise one derived
   * from where this daemon listens. `signInIdentifier` does the deriving, so
   * what a client will be told is testable without binding a port, and this
   * only refuses an identifier the format would not accept.
   */
  const advertisedResource = (): string => {
    const named = options.resource;
    if (named !== undefined && !isIdentifier(named)) {
      stop('--resource must be an https URL with no fragment, for example https://ahpd.example.com/');
    }
    return signInIdentifier({ ...(named === undefined ? {} : { resource: named }), host: options.host, port: options.port }, hostname());
  };

  /*
   * The authorization server this host accepts tokens from, when one is named.
   *
   * `github` is the preset a stock client can resolve with no client work, and a
   * URL this host may reach is an OpenID Connect issuer whose metadata is
   * discovered. Absent, the host is its own issuer and only secrets it minted are
   * checked. What is built here is only for the startup line: the directory
   * builds its own from the same name, and a record may name another.
   */
  const named = options.issuer === undefined ? undefined : namedIssuer(options.issuer);
  if (options.issuer !== undefined && named === undefined) {
    stop('--issuer takes github or an issuer URL this host may reach.');
  }
  const issuer = options.issuer === undefined ? undefined : issuerFrom(options.issuer);

  /*
   * The people who may use this host, built once.
   *
   * One port answers two doors: `createHost` asks whether a command may proceed,
   * and `listen` asks whose a connection token is. One instance, so a token is
   * asked one question and there is no second opinion about who somebody is.
   * Absent, the host advertises no sign-in resource and every gate is inert.
   *
   * The path is read once here: the directory itself re-reads the file on every
   * question, so the directory stays current even though the record is built
   * once. The record is this host's own identifier, because RFC 9728 wants an
   * https URL and a client is told where the host actually answers.
   */
  const users = options.users === undefined
    ? undefined
    : fileUsers({
      path: options.users,
      // The directory fills `authorization_servers` itself, because the file is
      // where a record's own issuer is written and the directory is what reads
      // it. A record that names none uses the host's name, passed below.
      resource: signInRecord(advertisedResource()),
      // The identifier a token checked here has to have been issued for, which
      // is the one a client was told to sign in against.
      audience: advertisedResource(),
      ...(options.issuer === undefined ? {} : { issuer: options.issuer }),
      ...(options.issuerVerify === undefined ? {} : { issuerVerify: options.issuerVerify }),
      requireIssuer: options.requireIssuer,
      tokensPerPerson: options.tokensPerPerson,
      onProblem: (line) => process.stderr.write(`${line}\n`),
    });

  /*
   * The nodes that may join this host, and the ones that have.
   *
   * One registry answers both halves: the file beside the users says who may,
   * and the same object says who is connected now and hands a session's socket
   * to the proxy. It is the join path's credential check and the place a node's
   * sockets go, which are the same thing seen from the door and from inside.
   *
   * A host with no directory has no file to keep them in and no join path:
   * there is no record of who may join, so nobody may.
   */
  const nodes = options.users === undefined
    ? undefined
    : liveNodes({ file: fileNodes({ path: nodesFileOf(options.users), onProblem: stamp }), log: stamp });

  /*
   * The scratch of writers that are gone, cleared once at the start.
   *
   * Every one of these files is written whole beside itself and renamed over,
   * so a process killed between the write and the rename leaves
   * `<file>.<pid>.tmp` behind, and nothing else ever removes it - the users
   * file among them, which holds token hashes in a file nobody reads. The
   * daemon's own record is swept where it is written, in `claim`.
   */
  sweepTemps(wholeFiles(options.users));

  /*
   * The HTTP API, when the configuration asked for one.
   *
   * The same registry the terminal renders, under `/api`: `httpApi: true` puts
   * it on this listener beside the WebSocket, and `httpApi.port` puts it on one
   * of its own. Off, the daemon still answers plain requests so `/api` is a 404
   * rather than the 426 this listener gives everything else.
   *
   * Built before the socket is opened, because a shared port is handed to
   * `listen` as its request handler and a port of its own has to be bound
   * before the announcement names it.
   */
  if (options.httpApi !== undefined && options.stdio) {
    stop('httpApi needs a listening port, and --stdio serves one connection on this process\'s own pipes.');
  }
  /*
   * A host with no gate is not one the API may be served from.
   *
   * With neither a deployment token nor a directory there is nothing to hold a
   * request against, so `httpApi` here would be an administration surface
   * anybody who reaches the port may drive.
   */
  if (options.httpApi !== undefined && token === undefined && users === undefined) {
    stop('httpApi needs a credential: pass --connection-token, --connection-token-file or --users.');
  }
  if (options.routes !== undefined && options.stdio) {
    stop('routes needs a listening port, and --stdio serves one connection on this process\'s own pipes.');
  }
  const ownPort = options.httpApi?.port;
  /** The port of the routes' own listener, when `routes.port` gives them one. */
  const routesPort = options.routes?.port;
  // The routes' own listener binds where `routes.host` says, and on the
  // daemon's address otherwise.
  const routesHost = options.routes?.host ?? options.host;
  // The API's own listener binds where `httpApi.host` says, and on the
  // daemon's address otherwise.
  const apiHost = options.httpApi?.host ?? options.host;
  /*
   * What this host's work cost: a folder of monthly JSONL files beside the
   * sessions and the automations.
   *
   * One store, because three things ask for it: the host, the `usage:` scheme it
   * serves, and the `ahpd usage` this daemon serves. Two would have the command
   * and the scheme answer from different records.
   */
  /*
   * What a store could not read is written to stderr, never to stdout: a
   * `--stdio` daemon serves the protocol on stdout, so a problem line there is
   * a frame the client cannot parse.
   */
  /*
   * What each key used in this minute, which a `minute` limit reads.
   *
   * One meter, because three things ask for it: the store below adds each
   * record's `usd`, `tokens` and `hours`, and the proxy and the turn check count
   * a call as it is allowed. Two meters would let a call be counted in one and
   * read in the other.
   */
  const meter = createMinuteMeter();
  const store = fileUsage({
    folder: join(configDir(), 'usage'),
    // The same zone the `usage:` scheme cuts its periods in, so the day a total
    // is kept under and the day it is read over are the same day.
    ...(options.usageTimezone === undefined ? {} : { timezone: options.usageTimezone }),
    meter,
    onProblem: (message) => process.stderr.write(`${message}\n`),
  });
  // This daemon's own once a plugin has folded in a store of its own; before
  // the host is built, a request finds the daemon's.
  let metered: Usage = store;
  /*
   * The secrets this host's work needs, one plain file beside the
   * configuration.
   *
   * One vault, because two things ask for it as well: a plugin's options are
   * resolved against it as it loads, and `ahpd vault` answers from it once a
   * daemon is serving. It is read on every call rather than at construction,
   * which is when a daemon reads no file here but the ones it needs to answer
   * at once.
   */
  const vault = fileVault({ file: vaultPath() });
  // This daemon's own once a plugin has folded in a vault of its own.
  let held: Vault = vault;
  // The store the host was built over, once it is: a plugin may have replaced
  // the daemon's own, and before the host exists a request finds none.
  let kept: AutomationStore | undefined;
  /*
   * The policies saying who may use which agent, model and computer.
   *
   * One file beside the configuration, held whatever `policies.check` says: the
   * store and the gate are separate, so a daemon switched off still serves the
   * `policy:` scheme a client writes through, and an operator can fill the store
   * in before turning anything on. The store is read at construction, which is
   * when a daemon reads one small file and never again.
   */
  const policies = filePolicies({
    file: policiesPath(),
    onProblem: (message) => process.stderr.write(`${message}\n`),
  });
  /*
   * What a daemon with the checks on says once at start.
   *
   * An empty store refuses everybody but root, which is worth saying before
   * the first refusal rather than at it. A limit counts the records tagged
   * with its key, and usage written before the checks were on has no key, so
   * every limit starts at zero and the daemon says that too.
   */
  const startingChecks = async (): Promise<void> => {
    if (!options.policiesCheck) return;
    if ((await policies.list()).length === 0)
      stamp('the policy checks are on and the store holds no policy, so every session and turn but root\'s is refused');
    stamp('policy limits count the usage recorded from now, so what was recorded before is not counted');
  };

  /*
   * The daemon's own facts, for the commands it serves.
   *
   * A request names no file, no directory and no plugin: the declarations it
   * reaches read these instead. The bound address is read per request, because
   * the socket is opened after the registry is built.
   */
  const startedAt = new Date().toISOString();
  let boundHost = '';
  let boundPort = 0;
  // Both are this daemon's once the host is built and the socket is open; a
  // request before then finds no turn and nothing to restart.
  let turning = (): string[] => [];
  let restart = async (_argv: string[], _force: boolean): Promise<void> => { conflict('It is still starting; restart it once it has.'); };
  const facts: ServedFacts = {
    options,
    configFile: options.configFile ?? configPath(),
    ...(users === undefined ? {} : { users }),
    ...(nodes === undefined ? {} : { nodes }),
    running: () => ({
      pid: process.pid,
      url: `ws://${urlHost(boundHost)}:${boundPort}`,
      host: boundHost,
      port: boundPort,
      paths: options.paths,
      ...(options.startFolder === undefined ? {} : { startFolder: options.startFolder }),
      startedAt,
      automations: memory ? 'in memory, schedules do not fire' : `in ${automationsDir()}, schedules fire`,
      // The manager that started this process, so a served `ahpd status` says
      // what a local one says about the same daemon.
      ...(service === undefined ? {} : { service }),
    }),
    turning: () => turning(),
    usage: () => metered,
    vault: () => held,
    automations: () => kept,
    restart: (argv, force) => restart(argv, force),
    /*
     * The live apply, for a served command that writes the plugin list itself.
     *
     * An install, a remove, an update, an option write, an enable and a disable
     * all write the file through the same turn, and each asks this before it
     * answers, so a client is told whether the change needed a restart rather
     * than being told to restart for every one of them. A reload names the
     * plugins to import again, which is the one change the file does not show.
     */
    apply: async (reload?: string[]) => {
      const answer = await appliedAfterWrite(reload);
      return { restart: answer.restart, changed: answer.changed };
    },
    valuesMoved: () => valuesMoved(),
    // The Windows update's own way down: the helper it started runs npm once
    // this process is gone, so there is no successor to start from here.
    down: () => { wayDown?.(); },
  };
  /*
   * The port the API answers on: its own when `httpApi.port` gave it one, and
   * the daemon's otherwise. Read per request, because both listeners are bound
   * after the handler is built.
   */
  let apiBoundPort = 0;
  const api = options.httpApi === undefined ? undefined : apiHandler({
    registry: servedRegistry(facts),
    ...(token === undefined ? {} : { token }),
    ...(users === undefined ? {} : { users }),
    program: { name: 'ahpd', version: version(), description: 'An Agent Host Protocol server for Claude, pi, ACP agents and any agent a plugin adds' },
    origins: () => apiOrigins(apiHost, options.resource, apiBoundPort, options.origins),
  });
  /*
   * The host's own tools as an MCP server, one endpoint per session.
   *
   * Served on this daemon's own listener, beside the upgrade and the API,
   * because a backend that cannot call the tools in process reaches them over a
   * URL and a token the session is handed.
   *
   * Over stdio there is nothing to serve on and no address to hand out, so
   * `origin` says so and a session is offered no tools server at all.
   */
  const toolsServers = toolServers({
    origin: () => (options.stdio || boundPort === 0 ? undefined : `http://${urlHost(boundHost)}:${boundPort}`),
    name: 'ahpd',
    version: version(),
  });
  /*
   * The model proxy, under `/v1` in front of the API on whichever listener
   * carries it, and only while `httpApi` is on. Its model names are the
   * configuration read at startup; the open provider connectors, the users
   * file and the usage store are read per call. The connectors channel is
   * built below, so its list is read through the closure each time. The same
   * options answer the channel's `x-ahpd/connectors/models`, whether or not
   * the proxy is served.
   */
  const proxied: ProxyOptions = {
    proxy: () => options.modelProxy,
    providers: () => connectorLists.providers(),
    // The provider lists are kept below, once the channel they read exists.
    catalog: () => catalogue,
    note: (id, outcome) => { connectorLists.note(id, outcome); },
    ...(token === undefined ? {} : { token }),
    ...(users === undefined ? {} : { users }),
    policies,
    policiesCheck: options.policiesCheck,
    policiesPayOrder: options.policiesPayOrder,
    ...(options.usageTimezone === undefined ? {} : { usageTimezone: options.usageTimezone }),
    usage: () => metered,
    meter,
    hostName: hostname(),
    origins: () => apiOrigins(apiHost, options.resource, apiBoundPort, options.origins),
    // Asked only by the handler, which is built only when the API is.
    otherwise: api ?? (async () => new Response(null, { status: 404 })),
    onProblem: stamp,
  };
  const served = api === undefined ? undefined : proxyHandler(proxied);
  /*
   * Who may open a connection on the daemon's own port: the deployment's own
   * token, which is the host, and a person's token that the directory knows.
   * A token the directory trusts names its person at the door; one where the
   * record requires the issuer opens the socket and names nobody.
   * The same options build the door of the handshake and of a plain request.
   */
  const door: DoorOptions = {
    ...(token !== undefined ? { token } : {}),
    // The join path takes a node's own token and nothing else, so a node never
    // holds the deployment's key.
    ...(nodes === undefined ? {} : { join: { path: JOIN_PATH, verify: (presented: string) => nodes.verify(presented) } }),
    ...(users === undefined
      ? {}
      : {
        identify: async (presented: string) => {
          const who = await users.verify(presented);
          if (who === undefined) return undefined;
          return who.trusted === true ? { principal: who } : {};
        },
        root: true,
      }),
  };
  // On the daemon's own port: a session's tools endpoint where it is, then a
  // plugin's route where it is, then the proxy and the API where they are, the
  // 404 that says they are not where `httpApi.port` moved them, and the answer to
  // a token everywhere else.
  const below = withoutApi(doorOf(door), ownPort === undefined ? served : undefined);
  /*
   * A plugin's own route, on this listener.
   *
   * A variable and not a value, because this chain is built before any plugin
   * has applied: the listener is handed `daemonRequest` below, and the plugins
   * are loaded further down still. `below` is what answers until the mount
   * exists, which is what this daemon answered for a route before a route could
   * be registered - and it is never what answers one after, because
   * `loadPlugins` assigns the mount before the socket is bound.
   */
  let pluginRequests: RequestHandler = below;
  const daemonRequest = async (request: globalThis.Request): Promise<Response> =>
    (await toolsServers.request(request)) ?? pluginRequests(request);
  const apiListener: ApiListener | undefined = served === undefined || ownPort === undefined
    ? undefined
    : await listenApi(served, { port: ownPort, host: apiHost });
  apiBoundPort = apiListener?.port ?? 0;

  /*
   * The wire, written down as it happens.
   *
   * One line per frame, appended synchronously so the file is whole at the
   * moment anything else is read: a capture that lags the crash it is meant to
   * explain is no capture. `wire.ts` builds the line, in the shape VS Code's
   * agent host writes, and bounds the file it goes into.
   *
   * Held here rather than where the listener is built, because a root config
   * write of `wire` starts the capture, moves it to another file or stops it
   * while this daemon runs, and the listener is handed its tap once.
   */
  const transport = options.stdio ? 'stdio' : 'websocket';
  const capture: { at: string | undefined; write: ReturnType<typeof writerFor> | undefined } = { at: undefined, write: undefined };
  /** The file the capture is written to, none when there is none. */
  const openWire = (at: string | undefined): void => {
    if (at === capture.at) return;
    capture.at = at;
    capture.write = at === undefined ? undefined : writerFor(at);
  };
  openWire(options.wire);
  /** The MCP servers the next session is offered, replaced by a root config write. */
  let mcpServers = options.mcpServers;
  const tap: Tap = (from, text, peer) => { capture.write?.(lineFor(from, text, peer, transport)); };

  /*
   * The host the plugins are folded into.
   *
   * It is the literal this daemon is built from, named so a plugin's
   * contributions can be folded into it rather than built beside it. It keeps
   * every field, so a daemon with no plugins gets the same host either way, and
   * it is a value the fold never mutates.
   */
  /*
   * People, teams, projects, roles and policies, each as an `x-ahpd-<domain>`
   * channel and `x-ahpd/<domain>/put` and `remove` commands beside its scheme.
   *
   * A change to the users file refreshes the four people channels and the
   * policy one, so a reader whose grant went is sent `removed`. The watch is
   * closed once `stopping` has been raised.
   */
  /*
   * A problem a list could not answer is written to stderr: on a `--stdio`
   * daemon stdout is the protocol, and a line there is a frame a client cannot
   * parse.
   */
  const listProblem = (message: string): void => { process.stderr.write(`${message}\n`); };
  const policyLists = policyChannels(policies, {
    onProblem: listProblem,
    // The limits of a row are read from the same usage store the scheme is, so
    // `policy://<id>/limits` answers what a key has used in the same zone. The
    // meter is the same one the walk reads, so a minute limit agrees with it.
    usage: store,
    meter,
    ...(options.usageTimezone === undefined ? {} : { timezone: options.usageTimezone }),
  });
  const peopleLists = users === undefined
    ? undefined
    : peopleChannels(users, { onChange: () => { void policyLists.refresh(); }, onProblem: listProblem });
  /*
   * The plugins as a channel, built here rather than after the load, because
   * the host is built over this list and the plugins fold into the host.
   *
   * `loaded` is filled in below, when the load has run; the channel reads it
   * through the closure, so a listing taken before then answers the rows the
   * file holds and no manifest, which is what a client sees before the first
   * load finishes anyway.
   */
  let loaded: Loaded[] = [];
  let alerts: Record<string, Alert[]> = {};
  /*
   * The host's restart mark, once there is a host: the channel is built before
   * `createHost`, and a command that writes calls this through the closure.
   */
  let markRestart: () => void = () => {};
  /*
   * The host's root told of the daemon values a plugin or paths command wrote,
   * once there is a host, through the same closure.
   */
  let valuesMoved: () => Promise<void> = async () => {};
  /*
   * The file a plugin is configured in, which the channel edits and the live
   * apply reads back: one path for both, so a change and the load that answers
   * it are about the same list.
   */
  const pluginFile = options.configFile ?? configPath();
  /*
   * What loads, unloads or reconfigures the plugins once the file has changed.
   *
   * Assigned once the base options and the set exist, below. Until then a
   * request cannot arrive: the listener is bound after the host is built.
   */
  let applyNow: (reload?: string[]) => Promise<Applied> = async () => ({
    restart: true,
    changed: false,
    problems: [`${pluginFile} changed before this daemon finished starting; restart it to load the plugins`],
    loaded: [],
    alerts: {},
    routes: {},
  });
  /*
   * The apply after a plugin command wrote the file, over the plugins channel
   * or at the terminal: no client's `root/configChanged` made that write, so
   * the root hears the daemon values it moved from here. A client's own push
   * applies through the root config port, and its echo says them.
   */
  const appliedAfterWrite = async (reload?: string[]): Promise<Applied> => {
    const answer = await applyNow(reload);
    await valuesMoved();
    return answer;
  };
  const pluginLists = pluginsChannel({
    configFile: pluginFile,
    where: { configDir: configDir(), cwd: process.cwd() },
    loaded: () => loaded,
    alerts: () => alerts,
    // Read through the set rather than kept here: a view changes with no
    // answer to take it from, and the row has to carry the one there is now.
    views: () => pluginHoldings.views(),
    restartNeeded: () => markRestart(),
    apply: (reload) => appliedAfterWrite(reload),
    onProblem: listProblem,
  });
  /*
   * Where each plugin keeps its own records: a folder per collection beside the
   * configuration. One store, because the host is built over it below and the
   * connectors channel reads the same records a plugin would: two would answer
   * from different folders. A plugin may still take it over with
   * `registerRecords(store, 'replace')`, and this channel keeps reading the
   * daemon's `connectors` collection, which is where a connector is kept.
   */
  const recordStore = fileRecords(configDir(), { onProblem: listProblem });
  const connectorRecords = await recordStore.collection('connectors', { format: 'json' });
  /*
   * The agents, each one a record of an engine a plugin registers.
   *
   * The same store as the connectors: a plugin takes the store over as a whole,
   * and a channel reading another folder would answer from records nobody
   * writes.
   */
  const agentRecords = await recordStore.collection('agents', { format: 'json' });
  /*
   * The adapters the load folds in, read through the closure: both channels
   * are built before the plugins are loaded, and an adapter row answers from
   * the first listing after it, as the plugin channel's manifest does.
   */
  let adapters: Record<string, ServedAdapter> = {};
  /*
   * The automation store, read by the connectors channel before it exists and
   * by the store's own checks before the plugins are loaded.
   *
   * Both are getters for that reason: the channel is built first, the store is
   * built over this `base`, and the plugin trigger types are known only after
   * the load - so each reads the binding as it stands when a save or a put
   * arrives rather than what was known when it was built.
   */
  let automationsStore: AutomationStore | undefined;
  let pluginTypes: ReturnType<typeof pluginTriggerTypes> = [];
  const adapterLists = adaptersChannel({
    adapters: () => adapters,
    pluginIcons: (name) => loaded.find((one) => one.name === name)?.manifest?.icons,
    onProblem: listProblem,
  });
  const connectorLists = connectorsChannel({
    collection: connectorRecords,
    adapters: () => adapters,
    // The vault a plugin may have replaced, so a secret is written where
    // `ahpd vault` reads it once the host exists.
    vault: () => held,
    // The checker the command line and the tools are held to, so an adapter's
    // schema means one thing everywhere it is asked.
    check: (value, schema, label) => { check(value, schema as JsonSchema, label); },
    // The automation a field marked `x-ahpd-automation` names. A bare id is
    // what a connector holds; the whole URI is accepted too, because that is
    // what a person copying one out of the catalogue has.
    automations: (id) => {
      const entry = automationsStore?.get(id.startsWith('ahp-automation:/') ? id : `ahp-automation:/${id}`);
      if (entry === undefined) return undefined;
      return { owner: ownerOf(entry._meta?.['ahpd.owner']) };
    },
    // A connector's models as the proxy's catalog keeps them, asked of the
    // proxy for this reader. A host serving no proxy calls none of them, so it
    // says nothing of whether one is callable.
    models: async (connector, reader) => {
      const listed = await connectorModels(proxied, connector, reader === undefined ? { kind: 'root' } : { kind: 'person', principal: reader });
      if (served !== undefined) return listed;
      return { ...listed, models: listed.models.map(({ callable: _callable, ...rest }) => rest) };
    },
    onProblem: listProblem,
  });
  /*
   * The engines the load folds in, and the agents the records opened.
   *
   * Both are read through closures: the channel is built before the plugins are
   * loaded and before the host exists, and an engine registered later, or an agent
   * folded later, reaches the listing that follows it.
   */
  let engines: Record<string, ServedEngine> = {};
  /** The agents of the records, as the last fold took them. */
  let recordAgents: Agent[] = [];
  /**
   * The agent of the record this host was handed in `AGENT_RECORD_VARIABLE`,
   * when it is a host inside a machine. Folded in beside the records, and
   * never written to their collection.
   */
  let handed: Agent[] = [];
  /*
   * The engines channel, beside the adapters one: both are built before the load
   * and answer from the fold as it stands when a listing arrives.
   */
  const engineLists = enginesChannel({
    engines: () => engines,
    pluginIcons: (name) => loaded.find((one) => one.name === name)?.manifest?.icons,
    onProblem: listProblem,
  });
  /**
   * What serves an agent id the records do not hold.
   *
   * A put of a new record asks this before writing: an id is unique across
   * every agent, so a record under an id the daemon or a plugin already serves
   * would be folded away while its row stayed in the list. Read from the
   * loaded plugins and the daemon's own fold rather than the host, because a
   * name is what the answer needs and the host keeps only the backends.
   */
  const agentHolder = (id: string): string | undefined => {
    for (const one of pluginHoldings.loaded()) {
      const held = pluginHoldings.held(one.name);
      if (held?.contribution.agents.some((agent) => agent.provider === id) === true) return `plugin ${one.name}`;
    }
    if (recordAgents.some((agent) => agent.provider === id)) return 'an agent record';
    return folded.agents.some((agent) => agent.provider === id) ? 'the daemon' : undefined;
  };
  /*
   * The agents made from records, beside the connectors.
   *
   * `refold` and `endSessionsOf` are the host's, and the host is built over
   * this channel's channel below: both are closures because a channel is made
   * before the host it asks.
   */
  const agentLists = agentsChannel({
    collection: agentRecords,
    engines: () => engines,
    vault: () => held,
    // The same checker a connector's and a plugin's config is held to.
    check: (value, schema, label) => { check(value, schema as JsonSchema, label); },
    refold: (agents) => refoldAgents(agents),
    endSessionsOf: (id) => host.endSessionsOf(id),
    holderOf: agentHolder,
    // What a field marked `x-ahpd-connector` is checked against at a put.
    connectors: () => connectorLists.refs(),
    onProblem: listProblem,
  });
  /*
   * The models each open provider connector lists, read once now and again
   * each hour. The first read is not awaited: a provider slow to answer must
   * not hold the daemon's start, and a call works before the first read ends.
   */
  const catalogue = modelCatalog({ providers: () => connectorLists.providers(), onProblem: stamp });
  void catalogue.refresh();
  /*
   * The four provider adapters the host ships, beside the plugins' adapters.
   * A model provider is a connector, so these are not a plugin: the host
   * registers them itself, and the proxy calls whatever they opened. Their
   * icons are read once, in the adapters module.
   */
  const hostAdapterSet: Record<string, ServedAdapter> = Object.fromEntries(
    Object.entries(hostAdapters({ onProblem: stamp })).map(([name, adapter]) => [name, { ...adapter, by: 'host' }]),
  );
  /** A plugin adapter whose name a host adapter takes, already said. */
  const adapterClashes = new Set<string>();
  /**
   * The plugins' adapters with the host's over them.
   *
   * The host's four are not something a plugin replaces: a plugin that
   * registers one of the names is said in the log once, and its adapter is not
   * the one a connector is checked against.
   */
  const withHostAdapters = (from: Record<string, ServedAdapter> | undefined): Record<string, ServedAdapter> => {
    for (const [name, adapter] of Object.entries(from ?? {})) {
      if (!Object.hasOwn(hostAdapterSet, name) || adapter.by === 'host') continue;
      const clash = `${adapter.by}:${name}`;
      if (adapterClashes.has(clash)) continue;
      adapterClashes.add(clash);
      stamp(`plugin ${adapter.by} registers the ${name} adapter, which the host ships, so the host's adapter is used`);
    }
    return { ...from, ...hostAdapterSet };
  };
  const lists = servedRecords(
    'ahpd',
    [...(peopleLists?.channels ?? []), ...policyLists.channels, pluginLists.channel, adapterLists.channel, engineLists.channel, connectorLists.channel, agentLists.channel],
    { ...peopleLists?.methods, ...policyLists.methods, ...pluginLists.methods, ...connectorLists.methods, ...agentLists.methods },
  );

  /*
   * Where a `shutdown` request goes, once this daemon has a way down.
   *
   * `diagnostics` is a field of the host below, and the lifecycle is built from
   * the host, so neither can be made first: the host is handed a shutdown that
   * reads this, and the line after the lifecycle is made is what fills it in.
   * The socket is bound in between the two, so a request that arrives early has
   * no way down to run and is answered the way it always was.
   */
  let wayDown: (() => void) | undefined;

  /*
   * The stages of a start, each said before it begins.
   *
   * One line per stage, written first rather than last, so the last line in
   * the log of a start killed at `READY_TIMEOUT_MS` is the stage that did not
   * finish.
   */
  stamp('start: terminals');
  const terminalBinding = await pty();

  /*
   * The reader `commandParser` names, if the deployment named one.
   *
   * Imported before the host is built, and by the same rule a plugin module is:
   * naming one runs its code in this process. A file that does not import, or
   * one that exports no reader, is refused here rather than left to the first
   * command line, where nobody would see the reason.
   */
  let commandParser: CommandSplitter | undefined;
  if (options.commandParser !== undefined) {
    stamp('start: parser');
    commandParser = await commandParserFrom(options.commandParser);
  }

  /*
   * The automation store, built before the host it is an option of.
   *
   * Its checks read the plugin types the fold knows and the connectors the
   * channel has listed, both through getters: the store is built before the
   * plugins are loaded and before the connectors are opened, and what a save
   * is held to is what is known when the save arrives.
   */
  const automations = memory
    ? memoryAutomations({
      pluginTypes: () => pluginTypes,
      connectors: () => connectorLists.refs(),
      agents: () => agentLists.owners(),
      hasUsers: () => users !== undefined,
    })
    : daemonAutomations((message) => process.stderr.write(`${message}\n`), {
      pluginTypes: () => pluginTypes,
      connectors: () => connectorLists.refs(),
      agents: () => agentLists.owners(),
      hasUsers: () => users !== undefined,
    });
  automationsStore = automations;

  const base: HostOptions = {
    path: options.paths[0] as string,
    /*
     * The machine's name, which is what a root connection's work is charged to.
     *
     * A session started on the deployment's own token belongs to the host
     * rather than to a person, and `root:<host>` says nothing at all unless the
     * host part is the name somebody knows this box by.
     */
    hostName: hostname(),
    /*
     * No backend of its own.
     *
     * Every agent this daemon serves is a plugin's, `@ahpd/agent-claude`
     * included - decision `the-daemon-bundles-no-agent-and-starts-without-one`.
     * A configuration that names none still starts, and says so below.
     */
    agents: [],
    /*
     * Whose each stored agent is, read from the records' channel.
     *
     * What decides which agents one caller is told about and may start a
     * session on: a record's owner, a membership for a team's and the person
     * for a person's. An id the records do not hold is the daemon's own or a
     * plugin's, and takes `session:write`.
     */
    agentOwners: () => agentLists.owners(),
    // The plugin and the record a host inside a machine serves a record agent with.
    handedAgent: (provider) => agentLists.handed(provider),
    /*
     * What this daemon can do that the protocol cannot.
     *
     * All three touch the machine - a file, a subprocess, a `git` binary - and
     * all three are handed in rather than reached for, so `createHost` stays the
     * protocol and nothing else. A host embedded somewhere with its own notion
     * of a file passes its own; one with no shell passes no terminals and says
     * `-32601` when asked for one.
     */
    resources: fileResources(),
    /*
     * The shells this host opens, with the operator's environment when there
     * is one. A daemon run as a service has an environment of its own, and
     * `shellEnv` is how the operator says which of it an agent's shells get.
     */
    terminals: shellTerminals({
      ...terminalBinding,
      ...(options.shellEnv === undefined ? {} : { shellEnv: options.shellEnv }),
    }),
    directories: gitBranches(),
    changes: gitChanges(),
    worktrees: gitWorktrees(),
    /*
     * Where those trees go, when the operator named a folder.
     *
     * Absent stays absent, which is the reference's own `<repo>.worktrees`
     * beside each repository.
     * One root for the machine is what a deployment with many repositories
     * wants, and the daemon sets it from `worktreesRoot` or --worktrees-root.
     */
    ...(options.worktreesRoot === undefined ? {} : { worktreesRoot: options.worktreesRoot }),
    github: githubPullRequests(),
    /*
     * The directory built above, handed to the host as its `users` port.
     *
     * Absent stays absent, which is the install that never configured people.
     */
    ...(users === undefined ? {} : { users }),
    /*
     * The hosts that joined this one, handed to every plugin as `host.nodes`.
     *
     * The registry built above, so `@ahpd/computer` lists a node as a machine
     * and starts a session in it without knowing it is a join, and every plugin
     * reads the same one. Absent on a daemon with no users file, which has no
     * join path and therefore no node.
     */
    ...(nodes === undefined ? {} : { nodes }),
    /*
     * People, teams, projects and roles, as four resource schemes, and the
     * policies beside them as a fifth.
     *
     * The same directory the gate above asks, served the way `computer:` is: a
     * client lists `team://` and writes `team://backend`, and the host answers
     * `team:read` and `team:write` for it as it does for any other scheme. The people
     * schemes are absent with no directory, so an install that never configured
     * people advertises no screen over an empty root.
     *
     * `policy:` is served either way, because the store and the gate are
     * separate: a daemon whose checks are off, or that has nobody to check,
     * still holds the rows and still lets an operator write them. One object
     * rather than two spreads of the same key, which would leave `policy:` off
     * the install that has people and turn it on everywhere else.
     */
    resourceProviders: {
      ...peopleLists?.providers,
      ...policyLists.providers,
    },
    channels: lists.channels,
    methods: lists.methods,
    /*
     * The host's own tools, offered to every session's model.
     *
     * What a session cannot see from inside itself: the sessions running beside
     * it and the terminals the person has open. Both read-only, and both facts
     * only the host has.
     */
    tools: hostTools(),
    /*
     * Where a session's own tools are served as an MCP server, and the same
     * registry the listener above mounts. One object on both sides, so what a
     * backend is handed is what this daemon answers on.
     */
    toolsServers,
    /*
     * The MCP servers `config.json` names, offered to every session's agent.
     *
     * The host's own, beside whatever a session's client plugins add. A getter
     * over what root config last wrote, so an edit is in force for the next
     * session without a restart.
     */
    get mcpServers() { return mcpServers; },
    /*
     * Where a plugin a client announces is copied, so a backend can open it.
     *
     * The clients are read through the host rather than handed in, because the
     * host is what knows which client ids are connected and the port is built
     * before it exists. The copy itself is the sdk's: this daemon names the
     * folder under its configuration directory and nothing else.
     */
    clientPlugins: clientPluginsIn(agentPluginsDir(), () => host.clients),
    /*
     * Whether a tool that declares it needs advanced permission is offered.
     *
     * The host's own answer, and false unless the operator says otherwise, so a
     * plugin cannot decide for the operator that a model may start containers
     * here.
     */
    advancedTools: options.advancedTools,
    /*
     * Which sessions are offered the session tools.
     *
     * The host's own answer, from the file or the line. `sessionTools` is the
     * on/off - every session unless the operator says otherwise - and
     * `sessionToolsProviders` narrows it to the providers it names. An install
     * whose agents should not reach the sessions beside them says so with
     * either: off entirely, or only for the providers it trusts to.
     */
    sessionTools: options.sessionTools,
    sessionToolsProviders: options.sessionToolsProviders,
    /*
     * What closing one chat of a session does to its conversation.
     *
     * Defaulted here rather than left off, because the host's own answer is the
     * same one and the root config is where an operator changes it: the key is
     * a daemon setting, not a per-session one.
     */
    closedChats: options.closedChats,
    archiveDirtyWorktree: options.archiveDirtyWorktree,
    pullRequestLookup: options.pullRequestLookup,
    // What a session on a joined node does when that node's join restarts.
    nodeRestart: options.nodeRestart,
    /*
     * How long a session's client calls may wait, when this deployment said.
     *
     * Left off rather than defaulted here, because the host's own ten minutes
     * is the same answer and one place should hold it.
     */
    ...(options.clientToolTimeoutMs === undefined ? {} : { clientToolTimeoutMs: options.clientToolTimeoutMs }),
    /*
     * The environment the operator names for the shells this host starts.
     *
     * Left off rather than defaulted, because there is no default: a daemon
     * that names none gives its shells the environment it runs with, which is
     * the same answer as an empty map. The host hands it to each backend on
     * `Start`, so an agent's own shell gets it too.
     */
    ...(options.shellEnv === undefined ? {} : { shellEnv: options.shellEnv }),
    /*
     * The rules a session's commands are matched against when its window
     * pushed none.
     *
     * Handed on rather than defaulted here: `vscode` is what the key means
     * when the file says nothing, and the host reads an absent one the same
     * way.
     */
    terminalAutoApproveDefaults: options.terminalAutoApproveDefaults,
    /*
     * The reader a configured module exports, which takes the sdk's own
     * splitter's place.
     *
     * Left off when the file names no module, because the host's own splitter
     * is the same answer and one place should hold it.
     */
    ...(commandParser === undefined ? {} : { commandParser }),
    /*
     * How long the host gathers a streamed delta before it sends it.
     *
     * Left off rather than defaulted here, for the reason above: the host's
     * own 75 milliseconds is the same answer and one place should hold it.
     */
    ...(options.deltaWindowMs === undefined ? {} : { deltaWindowMs: options.deltaWindowMs }),
    ...(options.sleepAfterMinutes === undefined ? {} : { sleepAfterMinutes: options.sleepAfterMinutes }),
    ...(options.sessionResidencyLimit === undefined ? {} : { sessionResidencyLimit: options.sessionResidencyLimit }),
    /*
     * The daemon's own settings, as the keys root config carries.
     *
     * Handed over rather than left in `config.json`, so a client holding
     * `config:read` can draw a form for them and a client holding
     * `config:write` can send it back. The port knows the file and the flags;
     * the host only shows what it is given and hands writes on.
     */
    rootConfig: daemonRootConfig(options, typed, openWire, (servers) => { mcpServers = servers as typeof mcpServers; }, async () => (await applyNow()).restart),
    /*
     * What this host adds on top of a backend, kept between restarts.
     *
     * The bits every client shares and the settings a session runs under. A
     * daemon is exactly the case the port was written for: it is restarted for
     * an upgrade, and without this every archived session comes back into the
     * catalogue and every read one is unread, for everybody, with nothing said.
     */
    sessions: options.sessions === 'memory'
      ? memorySessions()
      : daemonSessions((message) => process.stderr.write(`${message}\n`)),
    /*
     * Automations, with a clock unless asked otherwise.
     *
     * A daemon is the case the port was written for: it is already running at
     * nine in the morning, which is the only way an automation fires with
     * nobody connected. Definitions live in a file beside the configuration and
     * come back on a restart; the runs do not, because they name sessions that
     * went when the process did.
     *
     * `--automations memory` is the same store without either half: nothing is
     * written and nothing fires. Both are an `AutomationStore`, so the host is
     * not told which it was given - a host embedded in something that already
     * schedules passes a third of its own.
     */
    automations: automations,
    /*
     * Whether a customization is on, for every session or for one folder.
     *
     * Kept between restarts for the same reason the sessions are: a daemon is
     * restarted for an upgrade, and a plugin somebody switched off for every
     * session would come back on for everybody with nothing said about it.
     */
    enablement: fileEnablement({
      file: customizationStatePath(),
      onProblem: (message) => process.stderr.write(`${message}\n`),
    }),
    /*
     * What an automation that names no owner wakes on, which is a decision
     * about this deployment rather than about the automation: the key reads
     * `every` or `none`, and a daemon that has not been told wakes them on
     * every session.
     */
    unownedAutomations: options.unownedAutomations,
    // What this host's work cost, built above so the scheme and the command
    // read the same records this host charges to.
    usage: store,
    // The minute totals a `minute` limit reads, which the store above fills and
    // a turn counts itself in as it is allowed.
    meter,
    // The secrets a plugin's options are resolved against, and what
    // `host.secret` reads. The file above, read on every call.
    vault,
    /*
     * Where each plugin keeps its own records: a folder per collection beside
     * the configuration, a Markdown file per record, read again when a person
     * edits one. A plugin takes it over with `registerRecords(store, 'replace')`.
     * The same store the connectors channel reads its JSON collection from.
     */
    records: recordStore,
    // Whether that is one record per turn or one per report, which `usage.per`
    // in the configuration file chose.
    usagePer: options.usagePer,
    // The zone the store below keeps its days in, so a period walked for a
    // limit reads the days the store wrote.
    ...(options.usageTimezone === undefined ? {} : { usageTimezone: options.usageTimezone }),
    // The policies themselves, and whether anything is refused by them. The
    // store is always there so the `policy:` scheme above has somewhere to
    // write; the switch is off unless `policies.check` in the configuration
    // said otherwise.
    policies,
    policiesCheck: options.policiesCheck,
    // Which row of one scope pays first: `policies.payOrder`.
    policiesPayOrder: options.policiesPayOrder,
    /*
     * When, as well as what.
     *
     * The timestamp is added here rather than in `createHost`, because a host
     * embedded in something else has its own log with its own format and
     * `onEvent` hands it the message to do that with.
     */
    onEvent: stamp,
    /*
     * What the window's diagnostics get from this daemon.
     *
     * The version out of the manifest, the log a detached daemon writes to and
     * every file of the wire capture when there is one - a capture that stops
     * at the last roll is missing its start - and a shutdown that runs the same
     * way down `ahpd stop` does, so it stops the daemon gracefully on every
     * platform rather than signalling itself.
     */
    diagnostics: {
      version: version(),
      logs: () => [daemonLog(), ...(capture.at === undefined ? [] : filesOf(capture.at))],
      shutdown: daemonShutdown(() => wayDown),
    },
  };

  /*
   * Usage, as a resource scheme.
   *
   * One store, because three things ask for it: the host, the `usage:` scheme
   * it serves, and the `ahpd usage` this daemon serves. Two would have the
   * command and the scheme answer from different records. It is registered only
   * where there is a store: a host with no `usage` port serves no `usage:` scheme
   * and leaves the key out of the advertisement rather than answering one that is
   * not there.
   *
   * The zone is `usage.timezone`, and a week cut on the system's Monday day is
   * what it is for. An unresolvable one is said here, where the provider is
   * built, and the system's own is used - which is the same sentence the
   * provider says for itself, so `ahpd usage` and the scheme agree about which
   * zone they are reading in.
   *
   * A person reads their own pools without `usage:read`, which is the provider's
   * own `authorize` rather than a rule in the host.
   */
  const usageScheme = usageProvider({
    usage: store,
    ...(options.usageTimezone === undefined ? {} : { timezone: options.usageTimezone }),
    // The rows `usage://limits` answers. A person reads the limits their scopes
    // hold while `policies.ownLimits` is on, which is its default. The meter is
    // the same one the walk reads, so a minute limit agrees with it.
    policies,
    ownLimits: options.policiesOwnLimits,
    meter,
    // The titles a pool is named with, read from the same directory the gate asks.
    ...(users === undefined ? {} : { titles: users }),
    onProblem: (message) => process.stderr.write(`${message}\n`),
  });
  base.resourceProviders = { ...base.resourceProviders, usage: usageScheme };
  // The usage commands, which answer what the scheme's reads answer, as values.
  base.methods = {
    ...base.methods,
    ...Object.fromEntries(Object.entries(usageMethods(usageScheme)).map(([name, method]) => [name, { by: 'ahpd', name, method }])),
    /*
     * The token commands over AHP, when there is a directory that keeps tokens.
     * A host with no users file has nobody to mint one for, so it serves none.
     */
    ...(users === undefined
      ? {}
      : Object.fromEntries(Object.entries(tokenMethods(users)).map(([name, method]) => [name, { by: 'ahpd', name, method }]))),
    // Who a connection is, beside the tokens and for the same reason: a host
    // with no users file has nobody to answer about.
    ...(users === undefined
      ? {}
      : Object.fromEntries(Object.entries(meMethods(users)).map(([name, method]) => [name, { by: 'ahpd', name, method }]))),
    /*
     * The update the desk asks for over AHP: the command's own steps, served by
     * this daemon so the restart is its own and waits for the answer to go.
     */
    'x-ahpd/update': { by: 'ahpd', name: 'x-ahpd/update', method: updateMethod(facts) },
    /*
     * The restart a client asks for over AHP: the command's own checks, served
     * by this daemon so the restart is its own and waits for the answer to go.
     */
    'x-ahpd/restart': { by: 'ahpd', name: 'x-ahpd/restart', method: restartMethod(facts) },
  };

  /*
   * What plugins asked to have said about this host.
   *
   * A plugin that made the daemon reachable somewhere - a tunnel, an
   * announcement on the network - has to be able to put that address where a
   * person looks for one, which is the block below and not the log: `ahpd
   * status` parses stdout and shows what it finds. Collected here rather than
   * written straight out, because the block is written once and in one order.
   *
   * `listening` is handled before the block is written, which is when a line
   * like that can exist at all: the port is bound by then and the tunnel that
   * forwards to it has been made.
   */
  const said: string[] = [];
  let announced = false;

  /*
   * The plugins, between the base and the host.
   *
   * `loadPlugins` is the only thing here that runs code the daemon did not
   * write, and it is handed the specs the flags and the file named. Every
   * problem is a line in the log so a skipped plugin is where a log reader
   * looks, and every one of them costs itself and nothing else: a plugin that
   * does not resolve, one that throws, one whose manifest is wrong, a duplicate
   * `provider`, which drops the agent that lost the id and keeps the sessions
   * recorded for it waiting for it, and an item of a plugin's that the plugin
   * itself dropped and said so. The one thing that is refused is a daemon with
   * no backend at all, which is answered just below. Each of them is announced
   * as well as stamped, which is how the person who ran `ahpd start` is told
   * what their daemon is missing before it says it started.
   */
  stamp('start: plugins');
  /*
   * The presets a configuration file still holds, read before any plugin loads:
   * a plugin registers an engine now, and an agent is a record.
   *
   * Only the plans are made here. They are written once the engines have loaded,
   * because an engine's schema is what says which of a record's fields are
   * secrets, and a plaintext key must not reach a record or a listing. The file
   * is only rewritten once every record and every vault write succeeded, so a
   * failure here leaves it as it was for the next start to try again.
   */
  const planned = planPresets({
    plugins: options.plugins,
    configFile: pluginFile,
    // The marker that says the presets were moved once belongs beside the
    // records, not beside a file a `--config-file` may have put anywhere.
    recordsDir: configDir(),
    log: stamp,
  });
  const holding: LoadOptions = {
    base,
    paths: options.paths,
    configDir: configDir(),
    hostId: hostId(),
    cwd: process.cwd(),
    log: stamp,
    say: (line) => {
      const one = line.trim();
      // After the block is out there is nowhere for it to go, and a line
      // written to stdout on its own would be a line `recordOf` reads as part
      // of the announcement it already parsed.
      if (one === '' || announced) return;
      said.push(one);
    },
    /*
     * An alert a plugin raises after its load answered changes its row, so a
     * client watching the plugins channel is sent the row again. The list the
     * channel reads is replaced first, because what it was handed is a copy
     * taken when the load answered.
     */
    alertsChanged: () => {
      alerts = pluginHoldings.alerts();
      void pluginLists.refresh();
    },
    /*
     * A view a plugin shows or clears after its load answered changes its row
     * for the same reason, and the row is read again from the set, so there is
     * nothing to replace here.
     */
    viewsChanged: () => {
      void pluginLists.refresh();
    },
  };
  /*
   * The set this daemon keeps for as long as it runs.
   *
   * A plugin enabled later joins the agent list and the vault the first load
   * used rather than a second set built beside it, which is why the set is made
   * here and handed to the load rather than made inside it.
   */
  const pluginHoldings = pluginSet(holding);
  /*
   * The routes the plugins registered, kept here because they change: a plugin
   * loaded later has a route, and both the listener below and the routes of its
   * own read this through a closure on each request.
   */
  let liveRoutes: Record<string, Route> = {};
  applyNow = async (reload?: string[]) => {
    const answer = await applyPlugins({
      set: pluginHoldings,
      configFile: pluginFile,
      noPlugins: options.noPlugins,
      host: () => host,
      log: stamp,
      records: () => recordAgents,
      ...(reload === undefined ? {} : { reload }),
    });
    const now = pluginHoldings.fold().options;
    // The channels read these through closures, so a load or unload reaches a
    // listing, the adapters and the routes without anything being rebuilt.
    loaded = answer.loaded;
    alerts = answer.alerts;
    adapters = withHostAdapters(now.adapters);
    pluginTypes = pluginTriggerTypes(now.pluginTriggers);
    // An engine a plugin brought or took away is what the stored records are read
    // against, so the list is replaced before they are opened again.
    engines = now.engines ?? {};
    liveRoutes = answer.routes;
    // A plugin loaded later acts on the host as its own client, as one loaded
    // at start does, and it can only be handed the host once the host exists.
    for (const one of now.pluginConnects ?? []) one.host = host;
    for (const line of answer.problems) stamp(line);
    await pluginLists.refresh();
    await adapterLists.refresh();
    await engineLists.refresh();
    await connectorLists.refresh();
    /*
     * The records again, against the engines this fold holds: one of an engine a
     * plugin just brought opens now, and one of an engine it took away is listed
     * `unavailable` and its sessions end.
     */
    await agentLists.openAll();
    if (answer.restart) markRestart();
    return answer;
  };
  const { options: folded, contributions, problems, loaded: didLoad, routes: registered, alerts: didAlert } = await loadPlugins(planned.plugins, { ...holding, set: pluginHoldings });
  // The channel built above starts answering manifests from here.
  loaded = didLoad;
  alerts = didAlert;
  liveRoutes = registered;
  // And the two channels start answering adapters, which is what a stored
  // connector is checked against when it opens below.
  adapters = withHostAdapters(folded.adapters);
  // And the engines a stored agent record is read against when it is opened below.
  engines = folded.engines ?? {};
  // The trigger types a save is now checked against: the host's own two are the
  // store's, and these are what the plugins brought.
  pluginTypes = pluginTriggerTypes(folded.pluginTriggers);
  for (const problem of problems) stamp(problem);

  /*
   * The ports a plugin may have replaced, taken from this fold before the
   * records open: a record's key is read from the vault the fold holds, and a
   * record's agent is folded in before the host is built.
   */
  if (folded.usage !== undefined) metered = folded.usage;
  if (folded.vault !== undefined) held = folded.vault;
  kept = folded.automations;
  /*
   * The presets written now that the engines and the vault are known.
   *
   * A record's secrets are moved to the vault the fold holds, under the record's
   * own name, before the record is stored: nothing here reads one, and no
   * listing serves one. The file is rewritten only after each record is.
   */
  await applyPresets({
    plan: planned,
    records: agentRecords,
    recordsDir: configDir(),
    engines,
    vault: held,
    log: stamp,
  });
  /*
   * A Claude record written before `models` held one shape is split into
   * `models` and `modelSources` before it is opened below. A record already in
   * the two-list shape is not written, so this is the once the shape changed.
   */
  await splitModels({ records: agentRecords, vault: held, log: stamp });
  /*
   * The stored records opened, and folded into the load, before the host is
   * built.
   *
   * The daemon bundles no agent, so a start whose agents are all records is an
   * ordinary start: what a client finds in the first turn is what the host was
   * built over, and a start with neither a plugin's agent nor a record's is
   * refused below rather than answered by a host that could serve nothing.
   *
   * A record whose id a plugin already serves is reported by the fold and left
   * out, the same line a fold made later gives.
   */
  const agentProblems = new Set(problems);
  /*
   * The handed record, opened once the engines are known. The variable is
   * taken out of this process's environment once read, so no program a session
   * starts inherits the record's keys from it.
   */
  try {
    const one = handedAgent(process.env[AGENT_RECORD_VARIABLE], engines);
    if (one !== undefined) handed = [one];
  }
  catch (error) {
    stamp(reason(error));
  }
  delete process.env[AGENT_RECORD_VARIABLE];
  let opened: Agent[] = [];
  try {
    opened = await agentLists.agents();
  }
  catch (error) {
    stamp(`The agent records could not be served: ${reason(error)}`);
  }
  const start = pluginHoldings.fold([...opened, ...handed]);
  for (const problem of start.problems) {
    if (agentProblems.has(problem)) continue;
    agentProblems.add(problem);
    stamp(problem);
  }
  const started = start.options;

  /*
   * A plugin that also set the reader, over the module the file named.
   *
   * The fold keeps the daemon's own and reports the plugin, but two readers of
   * one line is a configuration that says two things, so this one refuses the
   * start rather than running on the reader the operator did not write.
   */
  const clash = parserConflict(options.commandParser !== undefined, contributions);
  if (clash !== undefined) stop(clash);

  /*
   * The routes the plugins registered, served on this listener.
   *
   * Assembled here rather than at `daemonRequest`, which is the first thing
   * that asked for it, because two of its four answers are only known now: the
   * routes the fold holds, and the names the plugins just announced.
   *
   * The names a route answers to are the daemon's own first - the same
   * `apiOrigins` answers the API's `Host` check with, built whether `http` is
   * on or off, because a route is served on this listener and so is reached by
   * the names of this port rather than of a listener of the API's own. Then
   * whatever a plugin announced, which is how the host a tunnel handed out
   * becomes a name this answers to without anybody configuring it.
   *
   * A daemon with no plugin that registered a route mounts this anyway, so a
   * path under `/plugins/` is told there is nothing there rather than being
   * answered as a request this listener does not speak.
   */
  pluginRequests = pluginRoutes({
    // With a port of their own, the routes are not on this listener, and a
    // path under `/plugins/` here is told there is nothing there.
    routes: () => (routesPort === undefined ? liveRoutes : {}),
    authorities: () => [...apiOrigins(apiHost, options.resource, boundPort, options.origins).authorities, ...announcedNames(said)],
    onProblem: stamp,
    otherwise: below,
  });
  /*
   * The routes' own listener, for `routes.port`.
   *
   * It serves the plugins' routes and a 404 for everything else, so AHP, the
   * API and the proxy are never reached on it. Its names are the ones of its
   * own port. A name a plugin announced is left out, because what a tunnel
   * forwards to is the daemon's port.
   */
  let routesBoundPort = 0;
  const routesListener: ApiListener | undefined = routesPort === undefined
    ? undefined
    : await listenApi(pluginRoutes({
      routes: () => liveRoutes,
      authorities: () => apiOrigins(routesHost, options.resource, routesBoundPort, options.origins).authorities,
      onProblem: stamp,
      otherwise: (request) => Promise.resolve(json(404, { message: `No plugin route at ${new URL(request.url).pathname}` })),
    }), { port: routesPort, host: routesHost });
  routesBoundPort = routesListener?.port ?? 0;

  /*
   * A daemon with no backend, said in the words of the thing that fixes it.
   *
   * The daemon still starts - decision
   * `the-daemon-bundles-no-agent-and-starts-without-one` - because a client
   * installs and updates plugins over its own channel, and a daemon that
   * exited could not be fixed from one. The command carries `--config-file`
   * when this run was given one, so it names the plugin in the file this
   * daemon reads.
   */
  if (started.agents.length === 0) {
    const flag = options.configFile === undefined ? '' : ` --config-file ${options.configFile}`;
    /*
     * Plugins named and none of them a backend is, after an update, plugins
     * from the release before this one: the refusals above say which. Moving
     * them is the fix, and installing one the file already names is not.
     */
    if (planned.plugins.length > 0)
      stamp(`No backend is loaded, so no session can start until one is. The plugins in ${options.configFile ?? configPath()} loaded none; if they are from an older release, run ahpd plugin update all, or update them from a client.`);
    else
      stamp(`No backend is loaded, so no session can start until one is. Run ahpd plugin install @ahpd/agent-claude${flag} to install Claude Code and add it to "plugins" in ${options.configFile ?? configPath()}, or run npm i in ${configDir()} and add the package to "plugins" yourself.`);
  }

  /*
   * What the host knows about connectors: the listing a session's `connectors`
   * key is checked against at its start - the same refs an automation's save is
   * checked against, kept current by every read and by the channel's own puts
   * and removes - and the call an action tool makes, which does the live checks
   * in the channel.
   */
  const host = createHost({ ...started, connectors: { refs: () => connectorLists.refs(), run: connectorLists.run } });
  // The plugin channel's marks reach the host that now serves it.
  markRestart = () => { host.markRestartNeeded(); };
  valuesMoved = () => host.daemonValuesMoved();
  /*
   * The host the plugins were loaded for, handed over now that it exists.
   *
   * A plugin that acts on this host is a client of it, and its connection is
   * `Host.accept` over an in-memory pair - so what it needs is this object, and
   * nothing can give it earlier: every `apply` ran before `createHost` did.
   * Bound here rather than inside the host because the host does not know which
   * of its options came from plugins; a plugin that asked during `apply` was
   * already told to ask from `listening` or later.
   */
  for (const one of folded.pluginConnects ?? []) one.host = host;
  turning = () => host.turning();
  /*
   * A record's agent folded into the running host.
   *
   * The agents channel asks this with every record it has open, after a put or
   * a remove and at a start, and gets back the ids the host took. A record
   * whose id a plugin or the daemon already serves is reported and left out:
   * the record stays on disk and the channel lists it `invalid`.
   *
   * The whole options object goes to the host, not the agents alone - a fold is
   * one object, and `replace` refuses what moves a port or a scheme - so the
   * connectors port the host was built with is put back beside it.
   */
  const refoldAgents = async (records: Agent[]): Promise<ReadonlySet<string>> => {
    const agents = [...records, ...handed];
    const next = pluginHoldings.fold(agents);
    for (const line of next.problems) {
      // The same clash comes back on every fold, and is the log's once.
      if (agentProblems.has(line)) continue;
      agentProblems.add(line);
      stamp(line);
    }
    const now = next.options;
    adapters = withHostAdapters(now.adapters);
    pluginTypes = pluginTriggerTypes(now.pluginTriggers);
    engines = now.engines ?? {};
    const refused = host.replace({ ...now, connectors: { refs: () => connectorLists.refs(), run: connectorLists.run } });
    if (refused !== undefined) throw new Error(refused);
    recordAgents = agents;
    return new Set(next.records);
  };
  /*
   * Every stored agent of an engine a plugin registered, opened and folded into the
   * host before the listener answers: a session a client starts in the first
   * turn finds the agent in the root list already.
   */
  await agentLists.openAll();
  /*
   * Every stored connector of an adapter a plugin registered, opened before
   * the listener answers: a call that arrives in the first turn after the
   * socket is bound finds the connector that answers it already open. One of
   * an adapter nobody registered stays on disk, and is listed as `unavailable`.
   */
  await connectorLists.openAll();

  /*
   * The door, and which transport this host answers on.
   *
   * The deployment's own token is the host, and no other is. A person's token
   * names them at the door unless their record requires the issuer - decision
   * `a-persons-token-names-them-unless-the-issuer-is-required` - in which case
   * the socket is admitted and then answers `-32007` until the issuer's token
   * signs them in. With no directory there is nothing to ask, so nothing is
   * passed and the door refuses what it refuses.
   *
   * Over stdio there is no door to guard: the process that started this one
   * holds the only handle to the pipes, so the connection is this host itself
   * and the token and the directory are not consulted at all. That is the case
   * a container runs in, and the outer host's own grant is what decided whether
   * it may exist. `listen` is the only file that knows which runtime answered,
   * and the announcement says which one it found.
   */
  /*
   * What one connection is: a node's socket, or a client's.
   *
   * The door admits a socket on the join path only on a node's own token, so a
   * socket that arrives with a node's name is that node's - its control socket,
   * or the socket of one session - and is the registry's. Everything else is a
   * client of this host, whoever the door said it is.
   */
  const acceptConnection = (peer: Peer, principal?: Principal, root?: boolean, opened?: Opened): Connected | Raw => {
    const node = opened?.node;
    if (node === undefined || nodes === undefined) return host.accept(peer, principal, root);
    return nodes.accept(node, peer, opened?.url);
  };

  stamp('start: listen');
  const listener = options.stdio
    ? await overStdio(
      { tap },
      (peer, principal, root) => host.accept(peer, principal, root),
    )
    : await listen(
      {
        port: options.port,
        host: options.host,
        ...door,
        tap,
        // The plain requests beside the upgrade.
        ...plainRequests(daemonRequest),
      },
      acceptConnection,
    );
  // Where the API and the daemon actually are, now that both listeners are bound.
  apiBoundPort = apiListener?.port ?? listener.port;
  boundHost = listener.host;
  boundPort = listener.port;

  /*
   * The socket is open, and this is the first thing that could have wanted it.
   *
   * Raised before the announcement rather than after, because a plugin that
   * stands something up here - a tunnel forwarding to the bound port, a record
   * on the network - has a line to add to that announcement, and because a URL
   * printed before it works is a URL somebody pastes into a client that then
   * cannot reach it. A handler that is slow makes `ahpd start` slow, which is
   * the honest cost of the thing it is doing.
   *
   * Not raised over stdio: there is no address for anybody to reach, and the
   * process that started this one is already holding the only handle to it.
   */
  if (!options.stdio) {
    // Not said over stdio, where nothing is listening for anybody to reach.
    stamp('start: listening');
    await raise(
      folded.events,
      {
        type: 'listening',
        runtime: listener.runtime,
        host: listener.host,
        port: listener.port,
        guarded: listener.guarded,
      },
      stamp,
    );
  }

  stamp('start: checks');
  await startingChecks();

  /*
   * Where this host says what it is.
   *
   * A socket host says it on stdout, which is a log a person reads. A stdio host
   * says it on stderr, because its stdout is the wire: a reader there is parsing
   * frames, and a status line would be the one frame nothing sent.
   */
  /*
   * What this host says about itself, built first and written once.
   *
   * One write, so a reader of a log that several daemons write to takes a block
   * as one daemon's; and held in a variable, because a supervised daemon writes
   * its own record out of these lines rather than reading its own log back.
   */
  const say = options.stdio ? process.stderr : process.stdout;
  const announcement =
    `${options.stdio ? 'ahpd over stdio' : `ahpd on ws://${urlHost(listener.host)}:${listener.port}`} (${listener.runtime}), sessions in ${options.paths.join(', ')}\n`
    // Where the API is, when there is one: on this port, or on the one
    // `httpApi.port` bound. Its own line, and `http://` rather than `ws://`, so
    // `daemon.ts` keeps reading the origin off the line above.
    + (api === undefined ? '' : `http on http://${urlHost(apiHost)}:${apiListener?.port ?? listener.port}${API_PREFIX}\n`)
    // Where the routes are, when `routes.port` gave them a listener of their own.
    + (routesListener === undefined ? '' : `routes on http://${urlHost(routesHost)}:${routesListener.port}/plugins/\n`)
    // Its own line, in the same write as the origin, so `start` reading a log
    // other daemons also write to takes the announcement of the child it spawned.
    + `pid ${String(process.pid)}\n`
    // Its own line rather than the end of the one above, which `daemon.ts`
    // reads the session directories off with a regular expression.
    + `automations ${memory ? 'in memory, schedules do not fire' : `in ${automationsDir()}, schedules fire`}\n`
    // Its own line for the same reason: a client that only needs the names reads
    // one line, and `daemon.ts` keeps matching the two above unchanged.
    + `plugins ${loaded.length === 0 ? 'none' : loaded.map((one) => one.name).join(', ')}\n`
    // The folder this run serves because nothing names one. `daemon.ts`
    // records it, and the first `ahpd paths add` writes it beside the new folder.
    + (options.startFolder === undefined ? '' : `start folder ${options.startFolder}\n`)
    // Every configuration file read, in the order they were merged.
    + `config ${options.configFiles.length === 0 ? 'none' : options.configFiles.join(', ')}\n`
    // Where the secrets are, or that a plugin took the vault over. Its own
    // line, for the reason the two above are their own lines: where a value
    // lives is the first thing asked of a host nobody trusts yet.
    + `vault ${held === vault ? vaultPath() : 'from a plugin'}\n`
    // Where the secret came from, never the secret: stdout is a log, and a log
    // is the one place a credential should not end up.
    + `${from}\n`
    // What a client is told to sign in against, and which issuer it may use, so
    // an operator can see both without reading root state. Absent when there is
    // nobody to sign in.
    + (users === undefined
      ? ''
      : `sign-in ${advertisedResource()}${issuer === undefined ? '' : ` (issuer ${issuer.id})`}\n`)
    + (options.advancedTools ? 'advanced tools: offered to every session\n' : '')
    // What the session tools are offered to, and nothing where that is every
    // session: on with no provider list is the default, and a line saying so
    // is a line about nothing. Off beats a list, so it is said alone.
    + (options.sessionTools
      ? (options.sessionToolsProviders.length === 0 ? '' : `session tools: offered to ${options.sessionToolsProviders.join(', ')}\n`)
      : 'session tools: offered to no session\n')
    + (options.closedChats === 'hidden' ? '' : 'closed chats: their conversations are deleted\n')
    + (options.archiveDirtyWorktree === 'keep' ? '' : 'archived sessions: uncommitted changes are committed, then the tree is removed\n')
    + (options.wire === undefined ? '' : `wire to ${options.wire}\n`)
    // What this daemon started without, one line each, so whoever started it
    // reads it here rather than in the log they are not watching. The line
    // starts every one, because `daemon.ts` takes them off the announcement and
    // a problem may begin with any word at all. A problem that holds a newline
    // of its own - a thrown error whose message is two lines - is put on one,
    // because the line is what tells it apart.
    + problems.map((problem) => `skipped: ${oneLine(problem)}\n`).join('')
    // What a plugin asked to have said, in the order the plugins were loaded,
    // and last so the lines `daemon.ts` matches keep the places it expects.
    + said.map((line) => `${line}\n`).join('')
    + (checkingUpdates(options.updateCheck) ? updateLine(manifest()) ?? '' : '');
  announced = true;

  /*
   * The record of a daemon a service manager started.
   *
   * `ahpd start` writes the record of the child it spawned, because the parent
   * is the one that waits for the announcement. A unit or an agent spawns the
   * daemon itself and knows nothing of records, so a supervised daemon writes
   * its own, at the same moment and from the same lines.
   *
   * The record is one configuration directory's, so another daemon already
   * holding it is one this process cannot serve beside. A stamp and an exit is
   * what says so, rather than a thrown error: a process with listeners open is
   * not ended by one, and a daemon left holding the port with no record is the
   * failure a log read afterwards cannot see.
   */
  if (service !== undefined) {
    const other = claim(recordOf(announcement, process.pid, token, undefined, undefined, service, serviceName));
    if (other !== undefined) {
      stamp(`Another daemon is already running: ${other.url} (pid ${String(other.pid)}). Stop it with ahpd stop, then start this one again.`);
      process.exit(1);
    }
  }

  /*
   * Ask npm, later and in the background.
   *
   * The line above was read from the file as it was; this is what keeps that
   * file current for the next start. Nothing here is awaited, and the timer is
   * let go of so a daemon that is stopping does not wait six hours for it.
   */
  if (checkingUpdates(options.updateCheck)) {
    const ask = (): void => { void refreshUpdate({ name: manifest().name, registry: npmRegistry() }); };
    if (stale(readUpdate())) ask();
    setInterval(ask, MAX_AGE_MS).unref();
  }

  /*
   * Down in the order it went up.
   *
   * `stopping` before the socket closes, so a plugin that made a tunnel to the
   * bound port can take it down while there is still a port to name. Raised
   * whatever the signal was, and awaited like any other event - a handler that
   * hangs here is a daemon that will not stop, which is the same deliberate cost
   * awaiting has everywhere else.
   */
  /**
   * The pipe this daemon answers a stop and a restart on, once it has one.
   *
   * Declared here rather than beside the code that makes it, because the way
   * down closes it and the way down is built first: a stop that arrives between
   * the two takes it down with everything else.
   */
  let controlListener: ControlServer | undefined;
  const way = lifecycle({
    down: async () => {
      await raise(folded.events, { type: 'stopping' }, stamp);
      peopleLists?.close();
      // The hourly fetch of the provider lists stops with the daemon that reads them.
      catalogue.stop();
      /*
       * And every connection the plugins opened, after `stopping` and before
       * the listeners go.
       *
       * After, because a plugin that stands something down here may still have
       * a session to tell about it, and the connection is how it tells. Before,
       * because `host.close()` below is what the host's own work ends in: a
       * connection left open past it is one still watching a session nothing
       * will ever mention again.
       */
      // Every plugin the daemon holds now, not only the ones it started with:
      // a plugin loaded while it ran opened a connection too.
      for (const one of pluginHoldings.contributions()) one.connects.close();
      // The control before the listeners, so a stop that arrives as the daemon
      // goes down reaches no handler and is answered by the record alone.
      await controlListener?.close();
      // The API first, and awaited, so a request in flight is not left holding
      // a listener the daemon is no longer behind, and a successor does not
      // find its port still bound.
      await apiListener?.close();
      await routesListener?.close();
      await listener.close();
      // Then what the host runs: the clock, the sessions and their agents,
      // the terminals, and the stores, so a successor is their only writer.
      await host.close();
    },
    start: (line, token) => startDaemon(line, process.argv[1] as string, token, process.pid),
    stop: (successor) => {
      try { process.kill(successor.pid, 'SIGTERM'); }
      catch { /* it went already, which is a stop */ }
      forget([successor.pid]);
    },
    forget: () => { forget([process.pid]); },
    log: stamp,
    exit: (code) => process.exit(code),
    later: (step) => { setTimeout(step, 0); },
    /*
     * A daemon a service manager holds is restarted through it: the manager
     * starts the next daemon from the unit or the agent, and a successor this
     * process spawned would be in the same cgroup as this one, where the stop
     * job the restart begins with would end it too. A daemon started by a
     * terminal has no manager to ask.
     */
    ...(service === undefined ? {} : { hand: (): Promise<void> => realManager().restart(service, serviceName) }),
  });
  // From here a `shutdown` request runs the way down, as the control pipe does.
  wayDown = way.shutdown;
  process.on('SIGINT', way.shutdown);
  process.on('SIGTERM', way.shutdown);
  /*
   * A restart, served or signalled: the recorded line and its token read over
   * the configuration as it is now, before anything goes down; then, after the
   * answer has gone, the same steps as a shutdown, the successor started with
   * that line and token, and the exit. The token is the one the line reads
   * now, so a changed token is the one the successor's record carries.
   *
   * Before any of that, the host stops taking new turns: the way down awaits
   * the plugins' `stopping` handlers, which have no limit, and a turn begun
   * while one of those runs is a turn `host.close()` ends.
   *
   * The read also asks the successor's own binary whether it takes that line
   * at all, which is the one thing a daemon holding a line cannot answer for
   * itself: this process was started by the ahpd as it was then, and an
   * install since may have dropped a flag the line still names. Its token is
   * read first, so a line this daemon also cannot read is refused with this
   * daemon's words rather than with a child's.
   */
  restart = checkedRestart(
    async (line) => {
      /*
       * A supervised daemon was started with no line of its own: the line is
       * the unit's or the agent's, and the manager starts the next daemon with
       * it. There is nothing here to read, and nothing for a check to ask.
       *
       * `ahpd update` is the one caller that hands one anyway: it passes this
       * daemon's own words so the binary npm just installed is asked whether it
       * takes them, before the manager is asked to start it. Nothing is started
       * from that line - the manager starts the daemon - so only the check runs.
       */
      if (service !== undefined) {
        if (line === undefined) return undefined;
        await successorTakes(line);
        return undefined;
      }
      // An unsupervised record always has its line: `notRestartable` refused it
      // otherwise. Read as a guard, so a record that lost it is refused rather
      // than parsed as no options at all.
      if (line === undefined) throw new Error('The recorded line is missing; run ahpd stop and ahpd start.');
      const token = secret(await optionsOfLine(line)).token;
      await successorTakes(line);
      return token;
    },
    () => host.turning(),
    way,
    (why) => { host.refuseTurns(why); },
  );
  /*
   * `ahpd restart` at the terminal: a signal to the recorded process, which
   * answers it here. A daemon run in the foreground never listens for them.
   */
  if (detached) {
    const answer = (forced: boolean, piped: boolean) => (): void => {
      void answerRestartSignal(forced, {
        self: process.pid, recorded: running, turning: () => host.turning(), log: stamp, restart,
      }, piped);
    };
    const onRestart = answer(false, false);
    const onForced = answer(true, false);
    process.on(RESTART_SIGNAL, onRestart);
    process.on(FORCED_SIGNAL, onForced);
    /*
     * And on Windows, the same three handlers over the control pipe, because
     * the signals above cannot be sent there: `SIGTERM` is a hard kill, and the
     * other two do not exist. A request names the signal it stands for, so what
     * runs is what the signal would have run, and the log names the pipe.
     *
     * `process.on` stays on every platform. On Linux and macOS the terminal
     * still sends the signals, and the record holds no pipe there.
     */
    if (control !== undefined) {
      controlListener = controlServer(control, { SIGTERM: way.shutdown, SIGHUP: answer(false, true), SIGUSR2: answer(true, true) }, stamp);
    }
  }
  /*
   * The announcement last, once the pipe listens. `ahpd start` returns when it
   * reads this, and a stop may follow at once: on Windows the pipe is how that
   * stop arrives, so a pipe not yet listening is a stop nobody answers.
   */
  await controlListener?.listening;
  say.write(announcement);
}

/**
 * What a `shutdown` request does to this daemon: the way down once there is
 * one, and the signal it sent itself before that.
 *
 * `way` answers the way down the daemon has now, or nothing in the window
 * between the host being built with this and the lifecycle being made - the
 * socket is bound in that window, so a request can land in it. There is no way
 * down to run there, and the signal is kept for it rather than a request that
 * does nothing. Once the way is there, this runs the same steps `ahpd stop`
 * and the signals do, `stopping` first, so the stopping event, the plugin
 * connections, the listeners and `host.close()` all happen - which sending
 * `SIGTERM` to itself never did on Windows, where Node makes that a hard kill.
 */
export const daemonShutdown = (way: () => (() => void) | undefined): (() => void) => () => {
  const down = way();
  if (down === undefined) {
    process.kill(process.pid, 'SIGTERM');
    return;
  }
  down();
};

/**
 * The options a recorded line runs with, read over the configuration as it is
 * now: what a daemon started again with that line is told.
 *
 * `strict` refuses a flag this code does not know rather than keeping it as a
 * guess, and is what a check run asks for: the permissive read is the daemon
 * holding a line it did not write and has to answer for, while the question
 * "does this code take this line" is only answerable by the code itself - a
 * flag this ahpd has dropped is one a successor would die on.
 */
export async function optionsOfLine(argv: readonly string[], strict = false): Promise<Options> {
  const run = declareRun(createRegistry());
  const tokens = tokenize(optionTable(optionsOf(run), true), argv, { permissive: !strict });
  return namedOptionsFrom(await canonicalFromCli(run, { slots: {}, options: tokens.options }));
}

/**
 * The declaration of the foreground run.
 *
 * Hidden, because a person reaches it by typing nothing rather than a word:
 * `ahpd --port 9000` is this command, and `--help` is a question about the
 * program. It stays registered and matchable so the program is the one parser.
 */
export const declareRun = (registry: Registry<object>): Command => registry.action({
  id: 'daemon.run',
  summary: 'Run it here, in this terminal',
  description: 'One host, one working directory, one port. `ahpd` with no command is this.',
  hidden: true,
  surfaces: { cli: { pattern: ['run'] } },
  input: flagFields,
  run: async (context) => {
    const input = context.input as Readonly<Record<string, unknown>>;
    const configFile = context.optional<string>('configFile') ?? configPath();
    // Before anything else, because a first run is refused for having no
    // backend and this is the way in. The options are read after it, so a file
    // it wrote is the one this run starts from.
    const say = (line: string): void => { process.stderr.write(`${line}\n`); };
    await offerConfigure({ configFile, term: here, say });
    const options = await namedOptionsFrom(input);
    // After the options, which is what says whether this folder is served, and
    // before the host is built, so a folder answered for is one this run serves.
    await askToServe(options, configFile, here, say);
    await runForeground(options, input);
  },
});
