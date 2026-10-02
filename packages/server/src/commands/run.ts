/**
 * The foreground daemon, and the one command every flag is declared on.
 *
 * `ahpd [options]` means "run it here, in this terminal", and a program has no
 * word for that. The declaration below is that command, and `main.ts` gives it
 * its word when a line has no command in it. The body is the whole daemon: the
 * announcement, the update check, the record a detached daemon writes about
 * itself, and the shutdown both signals reach.
 */

import { appendFileSync, writeFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { join } from 'node:path';
import { canonicalFromCli, createRegistry, optionTable, optionsOf, tokenize } from '@cofold/commands';
import type { Command, Registry } from '@cofold/commands';
import type { HostOptions, Tap, Usage } from '@ahpd/sdk';
import {
  AGENT_CLASH,
  createHost,
  fileResources,
  fileSessions,
  fileUsage,
  fileUsers,
  gitBranches,
  gitChanges,
  gitWorktrees,
  githubPullRequests,
  hostTools,
  issuerFrom,
  listen,
  memoryAutomations,
  memorySessions,
  overStdio,
  peopleProviders,
  raise,
  scheduledAutomations,
  shellTerminals,
  signInRecord,
  usageProvider,
} from '@ahpd/sdk';
import { DETACHED_ENV, forget, running, start as startDaemon } from '../daemon.js';
import { automationsPath, configDir, configPath, daemonLog, isIdentifier, namedIssuer, sessionsPath, signInIdentifier, urlHost } from '../config.js';
import { API_PREFIX, apiHandler, listenApi, plainRequests, withoutApi, type ApiListener, type ApiOrigins } from '../http.js';
import { servedRegistry, type ServedFacts } from './served.js';
import { loadPlugins } from '../plugins.js';
import { pty } from '../pty.js';
import { MAX_AGE_MS, checkingUpdates, readUpdate, refreshUpdate, registry as npmRegistry, stale, updateLine } from '../update.js';
import { manifest, version } from '../version.js';
import { conflict, optionsFrom, secret, flagFields, stop } from './options.js';
import { FORCED_SIGNAL, RESTART_SIGNAL, answerRestartSignal, checkedRestart, lifecycle } from './restart.js';
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
 * the port the resource names when it names one - decision
 * `the-http-api-checks-origin-and-host-and-takes-only-json`.
 */
export function apiOrigins(host: string, resource: string | undefined, port: number): ApiOrigins {
  const names = ['127.0.0.1', 'localhost', '[::1]'];
  if (host !== '0.0.0.0' && host !== '::') names.push(urlHost(host));
  const authorities = names.map((one) => `${one}:${port}`);
  const origins = names.map((one) => `http://${one}:${port}`);
  if (resource !== undefined) {
    const at = new URL(resource);
    authorities.push(at.hostname, `${at.hostname}:${port}`, ...(at.port === '' ? [] : [at.host]));
    origins.push(at.origin);
  }
  return { authorities, origins };
}

/**
 * One host, one working directory, one port.
 *
 * A second directory is a second daemon rather than a flag, because the working
 * directory is what the catalogue *is* - a host that served several would have
 * to answer "which sessions" before it could answer anything, and the protocol
 * has no place to ask.
 */
export async function runForeground(options: Options): Promise<void> {
  const { token, from } = secret(options);
  /*
   * Whether `ahpd start` spawned this process, and so will record it. Taken out
   * of the environment at once, so a shell a session runs does not inherit it.
   */
  const detached = process.env[DETACHED_ENV] === '1';
  delete process.env[DETACHED_ENV];

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
      ...(options.issuer === undefined ? {} : { issuer: options.issuer }),
      trustToken: options.trustToken,
      onProblem: (line) => process.stderr.write(`${line}\n`),
    });

  /*
   * The HTTP API, when the configuration asked for one.
   *
   * The same registry the terminal renders, under `/api`: `http: true` puts it
   * on this listener beside the WebSocket, and `http.port` puts it on one of
   * its own. Off, the daemon still answers plain requests so `/api` is a 404
   * rather than the 426 this listener gives everything else - decision
   * `the-http-api-is-on-the-daemon-port-under-api`.
   *
   * Built before the socket is opened, because a shared port is handed to
   * `listen` as its request handler and a port of its own has to be bound
   * before the announcement names it.
   */
  if (options.http !== undefined && options.stdio) {
    stop('http needs a listening port, and --stdio serves one connection on this process\'s own pipes.');
  }
  /*
   * A host with no gate is not one the API may be served from.
   *
   * With neither a deployment token nor a directory there is nothing to hold a
   * request against, so `http` here would be an administration surface anybody
   * who reaches the port may drive - decision
   * `an-unconfigured-daemon-does-not-serve-the-http-api`.
   */
  if (options.http !== undefined && token === undefined && users === undefined) {
    stop('http needs a credential: pass --connection-token, --connection-token-file or --users.');
  }
  const ownPort = options.http?.port;
  // The API's own listener binds where `http.host` says, and on the daemon's
  // address otherwise.
  const apiHost = options.http?.host ?? options.host;
  /*
   * What this host's work cost: a folder of monthly JSONL files beside the
   * sessions and the automations.
   *
   * Built here rather than in the `HostOptions` literal below, because three
   * things ask for it: the host, the `usage:` scheme it serves, and the
   * `ahpd usage` this daemon serves. One store, or the command and the scheme
   * answer from two.
   */
  const store = fileUsage({
    folder: join(configDir(), 'usage'),
    onProblem: (message) => process.stdout.write(`${message}\n`),
  });
  // This daemon's own once a plugin has folded in a store of its own; before
  // the host is built, a request finds the daemon's.
  let metered: Usage = store;

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
    running: () => ({
      pid: process.pid,
      url: `ws://${urlHost(boundHost)}:${boundPort}`,
      host: boundHost,
      port: boundPort,
      paths: options.paths,
      startedAt,
      automations: memory ? 'in memory, schedules do not fire' : `in ${automationsPath()}, schedules fire`,
    }),
    turning: () => turning(),
    usage: () => metered,
    restart: (argv, force) => restart(argv, force),
  };
  /*
   * The port the API answers on: its own when `http.port` gave it one, and the
   * daemon's otherwise. Read per request, because both listeners are bound
   * after the handler is built.
   */
  let apiBoundPort = 0;
  const api = options.http === undefined ? undefined : apiHandler({
    registry: servedRegistry(facts),
    ...(token === undefined ? {} : { token }),
    ...(users === undefined ? {} : { users }),
    program: { name: 'ahpd', version: version(), description: 'An Agent Host Protocol server, with a Claude backend' },
    origins: () => apiOrigins(apiHost, options.resource, apiBoundPort),
  });
  // On the daemon's own port: the API where it is, and the 404 that says it is
  // not where `http.port` moved it.
  const daemonRequest = ownPort === undefined ? (api ?? withoutApi()) : withoutApi();
  const apiListener: ApiListener | undefined = api === undefined || ownPort === undefined
    ? undefined
    : await listenApi(api, { port: ownPort, host: apiHost });
  apiBoundPort = apiListener?.port ?? 0;

  /*
   * The host the plugins are folded into.
   *
   * It is the literal this daemon is built from, named so a plugin's
   * contributions can be folded into it rather than built beside it. It keeps
   * every field, so a daemon with no plugins gets the same host either way, and
   * it is a value the fold never mutates.
   */
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
     * included - decision `the-daemon-bundles-no-agent`. A configuration that
     * names none is refused below rather than built into a host that could not
     * answer a turn.
     */
    agents: [],
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
    terminals: shellTerminals(await pty()),
    directories: gitBranches(),
    changes: gitChanges(),
    worktrees: gitWorktrees(),
    github: githubPullRequests(),
    /*
     * The directory built above, handed to the host as its `users` port.
     *
     * Absent stays absent, which is the install that never configured people.
     */
    ...(users === undefined ? {} : { users }),
    /*
     * People, teams, projects and roles, as four resource schemes.
     *
     * The same directory the gate above asks, served the way `computer:` is: a
     * client lists `team://` and writes `team://backend`, and the host answers
     * `team:read` and `team:write` for it as it does for any other scheme -
     * decision `people-are-resource-schemes-with-a-grant-each`. Absent with no
     * directory, so an install that never configured people advertises no
     * screen over an empty root.
     */
    ...(users === undefined ? {} : { resourceProviders: peopleProviders(users) }),
    /*
     * The host's own tools, offered to every session's model.
     *
     * What a session cannot see from inside itself: the sessions running beside
     * it and the terminals the person has open. Both read-only, and both facts
     * only the host has.
     */
    tools: hostTools(),
    /*
     * Whether a tool that declares it needs advanced permission is offered.
     *
     * The host's own answer, and false unless the operator says otherwise, so a
     * plugin cannot decide for the operator that a model may start containers
     * here.
     */
    advancedTools: options.advancedTools,
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
      : fileSessions({
        file: sessionsPath(),
        onProblem: (message) => process.stdout.write(`${message}\n`),
      }),
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
    automations: memory
      ? memoryAutomations()
      : scheduledAutomations({
        // Beside the configuration, which is this daemon's decision to make and
        // not the store's - see `ScheduledOptions.file`.
        file: automationsPath(),
        onProblem: (message) => process.stdout.write(`${message}\n`),
      }),
    // What this host's work cost, built above so the scheme and the command
    // read the same records this host charges to.
    usage: store,
    // Whether that is one record per turn or one per report, which `usage.per`
    // in the configuration file chose.
    usagePer: options.usagePer,
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
     * the wire capture when there is one, and a shutdown that is the same
     * signal handler `ahpd stop` reaches through `SIGTERM`.
     */
    diagnostics: {
      version: version(),
      logs: () => [daemonLog(), ...(options.wire === undefined ? [] : [options.wire])],
      shutdown: () => { process.kill(process.pid, 'SIGTERM'); },
    },
  };

  /*
   * Usage, as a resource scheme.
   *
   * The store is the one the literal above hands the host, so the two are
   * registered here rather than in the literal - and only where there is a
   * store: a host with no `usage` port serves no `usage:` scheme and leaves the
   * key out of the advertisement rather than answering one that is not there.
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
  base.resourceProviders = {
    ...base.resourceProviders,
    usage: usageProvider({
      usage: store,
      ...(options.usageTimezone === undefined ? {} : { timezone: options.usageTimezone }),
      onProblem: (message) => process.stdout.write(`${message}\n`),
    }),
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
   * looks; the one problem that is not skipped is a duplicate `provider`, which
   * is refused because a host built over it would answer a turn with the wrong
   * backend. Everything else - a plugin that does not resolve, one that throws,
   * one whose manifest is wrong - costs itself and nothing else.
   */
  const { options: folded, problems, loaded } = await loadPlugins(options.plugins, {
    base,
    paths: options.paths,
    configDir: configDir(),
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
  });
  for (const problem of problems) stamp(problem);
  if (problems.some((problem) => problem.startsWith(AGENT_CLASH))) process.exit(1);

  /*
   * A daemon with no backend, said in the words of the thing that fixes it.
   *
   * `createHost` refuses this too, but its sentence is written for an embedder
   * holding a `HostOptions`, and the person reading this log wrote a
   * configuration file instead. The command carries `--config-file` when this
   * run was given one, so it names the plugin in the file this daemon reads.
   */
  if (folded.agents.length === 0) {
    const install = `ahpd plugin install @ahpd/agent-claude${options.configFile === undefined ? '' : ` --config-file ${options.configFile}`}`;
    stamp(`No backend is loaded, so this host could serve nothing. Run ${install} to install Claude Code and add it to "plugins" in ${options.configFile ?? configPath()}, or run npm i in ${configDir()} and add the package to "plugins" yourself.`);
    process.exit(1);
  }

  const host = createHost(folded);
  turning = () => host.turning();
  // What the host was finally built over, which is what a served `ahpd usage`
  // reads: a plugin that registered a store of its own is the one the records
  // were written to, and a command answering from the daemon's folder beside it
  // would report a total nothing was charged to.
  if (folded.usage !== undefined) metered = folded.usage;

  /*
   * The wire, written down as it happens.
   *
   * One line per frame, appended synchronously so the file is whole at the
   * moment anything else is read: a capture that lags the crash it is meant to
   * explain is no capture. `frame` is the message parsed, so `jq` reads the
   * file; a frame that is not JSON is kept as the string it was, because a
   * client that sent one is exactly what a capture is for.
   */
  const tap = options.wire === undefined ? undefined : ((): Tap => {
    const at = options.wire as string;
    writeFileSync(at, '');
    return (from, text, peer) => {
      let frame: unknown = text;
      try { frame = JSON.parse(text); } catch { /* kept as text */ }
      appendFileSync(at, `${JSON.stringify({ at: new Date().toISOString(), from, peer, frame })}\n`);
    };
  })();

  /*
   * The door, and which transport this host answers on.
   *
   * The deployment's own token is the host, and no other is. A person's token
   * opens the socket and says nobody unless their record trusts it - decision
   * `the-door-is-a-door` - so a client that presents only a connection token is
   * admitted and then answers `-32007` until it authenticates. With no directory
   * there is nothing to ask, so nothing is passed and the door refuses what it
   * refuses.
   *
   * Over stdio there is no door to guard: the process that started this one
   * holds the only handle to the pipes, so the connection is this host itself
   * and the token and the directory are not consulted at all. That is the case
   * a container runs in, and the outer host's own grant is what decided whether
   * it may exist. `listen` is the only file that knows which runtime answered,
   * and the announcement says which one it found.
   */
  const listener = options.stdio
    ? await overStdio(
      { ...(tap ? { tap } : {}) },
      (peer, principal, root) => host.accept(peer, principal, root),
    )
    : await listen(
      {
        port: options.port,
        host: options.host,
        ...(token !== undefined ? { token } : {}),
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
        ...(tap ? { tap } : {}),
        // The plain requests beside the upgrade.
        ...plainRequests(daemonRequest),
      },
      (peer, principal, root) => host.accept(peer, principal, root),
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

  /*
   * Where this host says what it is.
   *
   * A socket host says it on stdout, which is a log a person reads. A stdio host
   * says it on stderr, because its stdout is the wire: a reader there is parsing
   * frames, and a status line would be the one frame nothing sent.
   */
  const say = options.stdio ? process.stderr : process.stdout;
  say.write(
    `${options.stdio ? 'ahpd over stdio' : `ahpd on ws://${urlHost(listener.host)}:${listener.port}`} (${listener.runtime}), sessions in ${options.paths.join(', ')}\n`
    // Where the API is, when there is one: on this port, or on the one
    // `http.port` bound. Its own line, and `http://` rather than `ws://`, so
    // `daemon.ts` keeps reading the origin off the line above.
    + (api === undefined ? '' : `http on http://${urlHost(apiHost)}:${apiListener?.port ?? listener.port}${API_PREFIX}\n`)
    // Its own line, in the same write as the origin, so `start` reading a log
    // other daemons also write to takes the announcement of the child it spawned.
    + `pid ${String(process.pid)}\n`
    // Its own line rather than the end of the one above, which `daemon.ts`
    // reads the session directories off with a regular expression.
    + `automations ${memory ? 'in memory, schedules do not fire' : `in ${automationsPath()}, schedules fire`}\n`
    // Its own line for the same reason: a client that only needs the names reads
    // one line, and `daemon.ts` keeps matching the two above unchanged.
    + `plugins ${loaded.length === 0 ? 'none' : loaded.map((one) => one.name).join(', ')}\n`
    // Every configuration file read, in the order they were merged.
    + `config ${options.configFiles.length === 0 ? 'none' : options.configFiles.join(', ')}\n`
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
    + (options.wire === undefined ? '' : `wire to ${options.wire}\n`)
    // What a plugin asked to have said, in the order the plugins were loaded,
    // and last so the lines `daemon.ts` matches keep the places it expects.
    + said.map((line) => `${line}\n`).join('')
    + (checkingUpdates(options.updateCheck) ? updateLine(manifest()) ?? '' : ''),
  );
  announced = true;

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
  const way = lifecycle({
    down: async () => {
      await raise(folded.events, { type: 'stopping' }, stamp);
      // The API first, and awaited, so a request in flight is not left holding
      // a listener the daemon is no longer behind, and a successor does not
      // find its port still bound.
      await apiListener?.close();
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
  });
  process.on('SIGINT', way.shutdown);
  process.on('SIGTERM', way.shutdown);
  /*
   * A restart, served or signalled: the recorded line and its token read over
   * the configuration as it is now, before anything goes down; then, after the
   * answer has gone, the same steps as a shutdown, the successor started with
   * that line and token, and the exit. The token is the one the line reads
   * now, so a changed token is the one the successor's record carries.
   */
  restart = checkedRestart(async (line) => secret(await optionsOfLine(line)).token, () => host.turning(), way);
  /*
   * `ahpd restart` at the terminal: a signal to the recorded process, which
   * answers it here. A daemon run in the foreground never listens for them.
   */
  if (detached) {
    const answer = (forced: boolean) => (): void => {
      void answerRestartSignal(forced, {
        self: process.pid, recorded: running, turning: () => host.turning(), log: stamp, restart,
      });
    };
    process.on(RESTART_SIGNAL, answer(false));
    process.on(FORCED_SIGNAL, answer(true));
  }
}

/**
 * The options a recorded line runs with, read over the configuration as it is
 * now: what a daemon started again with that line is told.
 */
export async function optionsOfLine(argv: readonly string[]): Promise<Options> {
  const run = declareRun(createRegistry());
  const tokens = tokenize(optionTable(optionsOf(run), true), argv, { permissive: true });
  return optionsFrom(await canonicalFromCli(run, { slots: {}, options: tokens.options }));
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
    await runForeground(optionsFrom(context.input as Readonly<Record<string, unknown>>));
  },
});
