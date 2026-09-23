#!/usr/bin/env node
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { asSpec, automationsPath, configDir, configPath, daemonLog, isIdentifier, loadConfig, namedIssuer, personalUrl, sessionsPath, signInIdentifier } from './config.js';
import { MAX_AGE_MS, checkingUpdates, readUpdate, refreshUpdate, registry, stale, updateLine } from './update.js';
import { manifest, version } from './version.js';
import { running, start, statusLine, stop as stopDaemon } from './daemon.js';
import { pty } from './pty.js';
import { describePlugin, loadPlugins, pluginLine } from './plugins.js';
import { claude } from '@ahpd/agent-claude';
import type { HostOptions, PluginSpec, Tap } from '@ahpd/sdk';
import { AGENT_CLASH, createHost, fileResources, gitBranches, gitChanges, gitWorktrees, githubIssuer, githubPullRequests, hostTools, listen, fileSessions, fileUsers, memoryAutomations, memorySessions, oidcIssuer, scheduledAutomations, shellTerminals, signInRecord } from '@ahpd/sdk';

/**
 * The daemon.
 *
 * One host, one working directory, one port. A second directory is a second
 * daemon rather than a flag, because the working directory is what the
 * catalogue *is* - a host that served several would have to answer "which
 * sessions" before it could answer anything, and the protocol has no place to
 * ask.
 *
 * This is the one file that reads argv, the filesystem and stdout. Everything
 * under it is given what it needs - which is why `gitBranches` is constructed
 * here and passed in rather than reached for by the host: it spawns `git`, and
 * a host that went looking for a binary would be one that could not run
 * without it. `node:fs` is used here because all three supported runtimes
 * provide it; the builtins that remain below are the ones a protocol feature
 * genuinely is - a terminal is a subprocess and a resource is a file.
 */

interface Options {
  /** TCP port to bind. 0 lets the OS choose. */
  port: number;
  /** Address to bind. Loopback unless asked otherwise. */
  host: string;
  /**
   * The directories whose sessions this host serves.
   *
   * The first is where a session goes when the client names none, and is what
   * the host advertises as its default. A client may name any of the others
   * and nothing else.
   */
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
  /**
   * The identifier this host advertises for its own sign-in.
   *
   * RFC 9728 wants a resource identifier that uses the https scheme, and this
   * daemon derives one from the address it listens on when this names none.
   * A deployment behind a proxy names the public one here, so what a client is
   * told is where the host actually answers.
   */
  resource?: string;
  /**
   * An authorization server whose tokens this host also accepts.
   *
   * `github`, or an https OpenID Connect issuer. Absent, the host is its own
   * issuer and only secrets it minted are checked.
   */
  issuer?: string;
  /**
   * Where automations are kept, and whether a clock fires them.
   *
   * `file` is a store that survives a restart and runs a schedule; `memory`
   * is one that holds definitions for as long as the process does and fires
   * nothing. Both accept a schedule trigger - what says the difference to a
   * client is the `nextRunAt` the memory one does not report.
   */
  automations: 'file' | 'memory';
  /**
   * Where the flags and configuration this host adds on top of a backend go.
   *
   * `file` keeps them beside the configuration, so a restart still knows which
   * sessions were archived and which had been read. `memory` holds them for as
   * long as the process runs, which returns every archived session to the
   * catalogue on a restart - for every client at once, since these are shared.
   */
  sessions: 'file' | 'memory';
  /**
   * A file every frame is appended to, both directions, one JSON line each.
   *
   * What a client and this host actually said to each other, which neither
   * side's log can show: a log says what a program meant. Off unless asked,
   * because the file grows by every token of every reply.
   */
  wire?: string;
  /**
   * Plugins to load, in the order they apply.
   *
   * A package name, a path, or an object naming one with its options. Naming a
   * plugin runs its code in this process with this process's permissions, so
   * this list is the trust boundary the configuration file's ownership is
   * about.
   */
  plugins: PluginSpec[];
  /** Load none, whatever the configuration file names. */
  noPlugins: boolean;
  help: boolean;
  /** Say the version and stop. */
  version: boolean;
  /** Ask npm, in the background, whether a newer version exists. */
  updateCheck: boolean;
}

const USAGE = `ahpd - an Agent Host Protocol server, with a Claude backend

  ahpd [options]              run it here, in this terminal
  ahpd start [options]        run it in the background and let go of it
  ahpd stop                   stop the one running in the background
  ahpd status                 say whether one is, and where
  ahpd config                 say where the configuration is, and what it says
  ahpd plugin list            what the configuration names, and what a run
                              would load, without loading any of it
  ahpd user add <id>          add a person, with --role <name> once per role
  ahpd user token <id>        mint their credential, shown once. --url prints
                              the whole ws:// URL a client can be given
  ahpd user list              who is in the file
  ahpd user rm <id>           take a person out of it

  --port <n>                    Listen here. Default 9187; 0 picks a free one.
  --host <addr>                 Bind here. Default 127.0.0.1. Pass 0.0.0.0 to
                                accept from other machines, which needs a token.
  --path <dir>                  A directory this host serves. Repeatable; the
                                first is the default a client gets when it
                                names none, and the catalogue is the union of
                                all of them. Default: where the daemon started.
  --connection-token <secret>   Require this secret on every connection.
  --connection-token-file <p>   Require the secret in this file. A fresh one is
                                written if the file is not there.
  --without-connection-token    Accept any connection. Only when the port is
                                already reachable by nobody else.
  --config-file <p>             Read this instead of the file below.
  --users <file>                The people who may use this host. A person's
                                token is also a connection token, so a client
                                that can only carry a URL arrives as them.
  --resource <url>              The https identifier this host advertises for
                                its own sign-in. Default: derived from --host
                                and --port.
  --issuer <github|url>         An authorization server whose tokens are also
                                accepted: github, or an https OpenID Connect
                                issuer. Its identifier is advertised, so a
                                client can resolve a provider for it.
  --automations <where>         file, the default, keeps them beside the
                                configuration and fires their schedules;
                                memory keeps them until this process ends and
                                fires nothing.
  --sessions <where>            Where the read and archived bits and a
                                session's settings go. file, the default,
                                keeps them beside the configuration; memory
                                forgets them when this process ends.
  --wire <file>                 Append every frame, both directions, to this
                                file as JSON lines: { at, from, peer, frame }.
                                pnpm wire -- <file> checks it against the
                                protocol schema.
  --plugin <spec>               A package, a path, or a package installed in
                                the configuration directory, loaded at startup.
                                Repeatable, and applied in the order named.
                                Naming one runs its code in this process with
                                this process's permissions: installing a plugin
                                is the trust decision.
  --no-plugins                  Load none, whatever the configuration file says.
  --no-update-check             Never ask npm whether a newer version exists.
                                NO_UPDATE_NOTIFIER or CI in the environment,
                                or updateCheck: false in the file, say the same.
  --version, -v                 What version this is
  --help, -h                    This

Every option above can be a key in the configuration file instead, spelled the
way it is here without the dashes: port, host, paths, connectionToken,
connectionTokenFile, withoutConnectionToken, automations, sessions, wire,
updateCheck, plugins, users, resource, issuer. A flag beats the file, because a
flag is this run and a file is every run until somebody edits it. "plugins" is
a list of the same specs --plugin takes, and --no-plugins is the one flag with
no key: leaving plugins out is already the off.

Clients present the token as ?tkn=<secret> on the URL, or as an
Authorization: Bearer <secret> header.

Point a client at it:
  ahpc --host ws://127.0.0.1:9187
`;

function parse(argv: string[]): Options {
  const options: Options = {
    port: 9187,
    host: '127.0.0.1',
    paths: [],
    automations: 'file',
    sessions: 'file',
    open: false,
    plugins: [],
    noPlugins: false,
    help: false,
    version: false,
    updateCheck: true,
  };
  for (let i = 0; i < argv.length; i++) {
    switch (argv[i]) {
      case '--port': options.port = Number(argv[++i]); break;
      case '--host': options.host = String(argv[++i]); break;
      // Repeatable. One host over two projects is one catalogue and one
      // process, which is the case a second `--path` is for.
      case '--path': options.paths.push(String(argv[++i])); break;
      case '--connection-token': options.token = String(argv[++i]); break;
      case '--connection-token-file': options.tokenFile = String(argv[++i]); break;
      case '--without-connection-token': options.open = true; break;
      case '--config-file': options.configFile = String(argv[++i]); break;
      case '--users': options.users = String(argv[++i]); break;
      case '--resource': options.resource = String(argv[++i]); break;
      case '--issuer': options.issuer = String(argv[++i]); break;
      case '--automations': {
        const said = String(argv[++i]);
        if (said === 'file' || said === 'memory') options.automations = said;
        else stop(`--automations takes file or memory, not ${said}.`);
        break;
      }
      case '--sessions': {
        const said = String(argv[++i]);
        if (said === 'file' || said === 'memory') options.sessions = said;
        else stop(`--sessions takes file or memory, not ${said}.`);
        break;
      }
      case '--wire': options.wire = String(argv[++i]); break;
      // Repeatable, and a list rather than a switch: plugins apply in the
      // order they are named, and one that another depends on has to run first.
      case '--plugin': {
        const said = String(argv[++i]);
        const spec = asSpec(said);
        if (spec !== undefined) options.plugins.push(spec);
        else stop(`--plugin takes a name or a path, not ${said}.`);
        break;
      }
      case '--no-plugins': options.noPlugins = true; break;
      case '--no-update-check': options.updateCheck = false; break;
      case '--help': case '-h': options.help = true; break;
      case '--version': case '-v': options.version = true; break;
      default:
        if (argv[i]?.startsWith('-')) {
          process.stderr.write(`Unknown option ${argv[i]}. Try --help.\n`);
          process.exit(2);
        }
    }
  }
  /*
   * The file, under the flags.
   *
   * Each source is narrower than the one below it: a flag is this run and a
   * file is every run until somebody edits it, so the flag wins. `paths` is
   * replaced rather than merged - a file that named two directories and a
   * `--path` that named a third would otherwise serve three, which is not
   * what either of them said.
   */
  const file = loadConfig(options.configFile);
  if (!argv.includes('--port') && typeof file.port === 'number') options.port = file.port;
  if (!argv.includes('--host') && typeof file.host === 'string') options.host = file.host;
  if (options.paths.length === 0 && Array.isArray(file.paths)) options.paths.push(...file.paths);
  if (options.token === undefined && typeof file.connectionToken === 'string') options.token = file.connectionToken;
  if (options.tokenFile === undefined && typeof file.connectionTokenFile === 'string') options.tokenFile = file.connectionTokenFile;
  if (!options.open && file.withoutConnectionToken === true) options.open = true;
  if (!argv.includes('--automations') && (file.automations === 'file' || file.automations === 'memory')) {
    options.automations = file.automations;
  }
  if (!argv.includes('--sessions') && (file.sessions === 'file' || file.sessions === 'memory')) {
    options.sessions = file.sessions;
  }
  if (!argv.includes('--wire') && typeof file.wire === 'string') options.wire = file.wire;
  if (options.users === undefined && typeof file.users === 'string') options.users = file.users;
  if (options.resource === undefined && typeof file.resource === 'string') options.resource = file.resource;
  if (options.issuer === undefined && typeof file.issuer === 'string') options.issuer = file.issuer;
  if (!argv.includes('--no-update-check') && file.updateCheck === false) options.updateCheck = false;

  /*
   * The plugins, under the flags.
   *
   * A command line `--plugin` replaces the file's list rather than adding to
   * it, the way `--path` does: a flag is this run and the file is every run,
   * and a person who names one plugin meant that one. `--no-plugins` is the
   * explicit off, and passing it beside a `--plugin` is refused rather than
   * resolved, because nobody means both.
   */
  if (options.noPlugins && options.plugins.length > 0) {
    stop('--no-plugins contradicts the --plugin you also passed.');
  }
  if (options.plugins.length === 0 && !options.noPlugins && Array.isArray(file.plugins)) {
    file.plugins.forEach((entry: unknown, index: number) => {
      const spec = asSpec(entry);
      if (spec !== undefined) {
        options.plugins.push(spec);
        return;
      }
      stop(`${options.configFile ?? configPath()} has plugins[${String(index)}] = ${JSON.stringify(entry)}, which is not a plugin spec.`);
    });
  }

  if (options.paths.length === 0) options.paths.push(process.cwd());
  return options;
}

/*
 * The return type is on the variable rather than the arrow, which is what tells
 * TypeScript a call to this never comes back: with it, a check like
 * `if (path === undefined) stop(...)` narrows `path` for every line after.
 */
const stop: (message: string) => never = (message) => {
  process.stderr.write(`${message}\n`);
  process.exit(2);
};

/**
 * The secret this host will require, and where it came from.
 *
 * A token file that is not there is written rather than refused: the flag is
 * how a supervisor points several processes at one secret, and requiring the
 * person to invent one first makes the convenient spelling the unusable one.
 */
function secret(options: Options): { token?: string; from: string } {
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

const argv = process.argv.slice(2);

/*
 * The subcommands, which are about a daemon rather than being one.
 *
 * Answered before anything is built: `stop` and `status` need no host, and
 * `start` is this same program run again with the rest of the line. Keeping
 * them here means there is one place that knows how to read these options,
 * and `start` cannot drift from what it starts.
 */
const verb = argv[0] !== undefined && !argv[0].startsWith('-') ? argv[0] : undefined;
if (verb !== undefined) {
  const rest = argv.slice(1);
  if (verb === 'start') {
    // Parsed here as well as by the child, so a bad option is refused now
    // rather than by something that has already been let go of.
    const parsed = parse(rest);
    // Derived here too, so the record the parent writes carries the ready URL
    // and the child is told nothing it did not already know.
    const { token } = secret(parsed);
    try {
      const begun = await start(rest, process.argv[1] as string, token);
      process.stdout.write(`ahpd on ${begun.url} (pid ${String(begun.pid)}), sessions in ${begun.paths.join(', ') || process.cwd()}\n`);
      if (begun.automations !== undefined) process.stdout.write(`automations ${begun.automations}\n`);
      if (checkingUpdates(parsed.updateCheck)) process.stdout.write(updateLine(manifest()) ?? '');
      process.exit(0);
    }
    catch (error) {
      process.stderr.write(`Could not start it: ${error instanceof Error ? error.message : String(error)}\n`);
      process.exit(1);
    }
  }
  if (verb === 'stop') {
    const stopped = stopDaemon();
    process.stdout.write(stopped ? `Stopped ${stopped.url} (pid ${String(stopped.pid)}).\n` : 'None running.\n');
    process.exit(stopped ? 0 : 1);
  }
  if (verb === 'status') {
    const found = running();
    if (!found) { process.stdout.write('None running.\n'); process.exit(1); }
    process.stdout.write(`${statusLine(found)}\n`);
    if (found.paths.length > 0) process.stdout.write(`sessions in ${found.paths.join(', ')}\n`);
    // Absent from a record written by an older daemon, which is the one case
    // where saying nothing is better than guessing which store it was given.
    if (found.automations !== undefined) process.stdout.write(`automations ${found.automations}\n`);
    if (checkingUpdates(parse(rest).updateCheck)) process.stdout.write(updateLine(manifest()) ?? '');
    process.exit(0);
  }
  if (verb === 'config') {
    const at = argv.includes('--config-file') ? argv[argv.indexOf('--config-file') + 1] as string : configPath();
    process.stdout.write(`${at}\n`);
    const found = loadConfig(argv.includes('--config-file') ? at : undefined);
    const rows = Object.entries(found);
    process.stdout.write(rows.length === 0
      ? '  (nothing set)\n'
      : `${rows.map(([key, value]) => `  ${key}: ${JSON.stringify(value)}`).join('\n')}\n`);
    process.exit(0);
  }
  if (verb === 'user') {
    /*
     * The people who may use this host, managed without one running.
     *
     * The path comes from `--users` or the configuration key and from nowhere
     * else: a verb that invented a file because neither was set would write a
     * directory nobody asked for, and the next daemon to start would not be the
     * one that reads it.
     */
    const named = rest.includes('--users') ? rest[rest.indexOf('--users') + 1] : undefined;
    const from = loadConfig(argv.includes('--config-file') ? argv[argv.indexOf('--config-file') + 1] : undefined);
    const path = named ?? from.users;
    if (path === undefined) stop('No user file. Pass --users <file> or set "users" in the configuration.');
    // Where the daemon answers, for the URL form: the configuration's address
    // or the same defaults the daemon itself uses. `--host` and `--port` here
    // are for the daemon that was started with those flags rather than with a
    // configuration file, so the URL names where it actually is.
    const where = {
      host: typeof from.host === 'string' ? from.host : '127.0.0.1',
      port: typeof from.port === 'number' ? from.port : 9187,
    };
    const directory = fileUsers({ path, onProblem: (line) => process.stderr.write(`${line}\n`) });

    // Flags are read out of the whole line and the positionals are what is
    // left, because `list` takes none and `add` takes one: assuming two would
    // read the path as an unknown option.
    const [sub, ...more] = rest;
    const positionals: string[] = [];
    const roles: string[] = [];
    let asUrl = false;
    for (let i = 0; i < more.length; i++) {
      const one = more[i];
      if (one === '--users') { i++; continue; }
      if (one === '--url') { asUrl = true; continue; }
      if (one === '--host') {
        const said = more[++i];
        if (said === undefined) stop('--host needs an address.');
        where.host = said;
        continue;
      }
      if (one === '--port') {
        const said = Number(more[++i]);
        if (!Number.isInteger(said)) stop('--port needs a number.');
        where.port = said;
        continue;
      }
      if (one === '--role') {
        const held = more[++i];
        if (held === undefined) stop('--role needs a name.');
        roles.push(held);
        continue;
      }
      if (one !== undefined && one.startsWith('-')) stop(`Unknown option ${one}.`);
      if (one !== undefined) positionals.push(one);
    }
    const id = positionals[0];

    if (sub === 'list') {
      const rows = await directory.list();
      process.stdout.write(rows.length === 0
        ? `no users in ${path}\n`
        : `${rows.map((one) => `${one.id}${one.roles.length > 0 ? ` (${one.roles.join(', ')})` : ''}`).join('\n')}\n`);
      process.exit(0);
    }
    if (sub === 'add') {
      if (id === undefined || id.startsWith('-')) stop('user add takes an id: ahpd user add <id> [--role <name>]');
      const held = roles.length > 0 ? roles : ['member'];
      await directory.add(id, held);
      process.stdout.write(`Added ${id} (${held.join(', ')}). Give them a credential: ahpd user token ${id}\n`);
      process.exit(0);
    }
    if (sub === 'rm') {
      if (id === undefined || id.startsWith('-')) stop('user rm takes an id: ahpd user rm <id>');
      const gone = await directory.remove(id);
      process.stdout.write(gone
        ? `Removed ${id}. Their socket stays open; their next connection is refused.\n`
        : `No user called ${id}.\n`);
      process.exit(gone ? 0 : 1);
    }
    if (sub === 'token') {
      if (id === undefined || id.startsWith('-')) stop('user token takes an id: ahpd user token <id>');
      const secret = await directory.mint(id);
      /*
       * The bare secret by default, so it can be piped, and the whole URL when
       * asked for: a client that can only carry a connection token is given
       * one thing to paste rather than two to assemble. The warning goes to
       * stderr either way, so stdout stays the credential alone.
       */
      const shown = asUrl ? personalUrl(secret, where.host, where.port, hostname()) : secret;
      process.stderr.write(asUrl
        ? 'Shown once. Only its hash is stored, and minting again replaces it. Paste the URL where a client asks for a host.\n'
        : 'Shown once. Only its hash is stored, and minting again replaces it.\n');
      process.stdout.write(`${shown}\n`);
      process.exit(0);
    }
    stop('user takes add, rm, list or token.');
  }
  if (verb === 'plugin') {
    /*
     * A listing, and the reason the `ahpd` key exists: what a run would load,
     * what cannot be found, what needs configuring and what is switched off,
     * on one screen and before anything runs. The specs come from the same
     * `parse` the run uses, so `--plugin` and `--no-plugins` mean here what
     * they mean there, and nothing below imports a plugin or builds a host.
     */
    if (rest[0] !== 'list') {
      process.stderr.write('plugin takes list, and nothing else.\n');
      process.exit(2);
    }
    const parsed = parse(rest.slice(1));
    if (parsed.noPlugins) process.stdout.write('plugins: --no-plugins, so nothing is listed\n');
    else if (parsed.plugins.length === 0) process.stdout.write('plugins: none named\n');
    else {
      for (const spec of parsed.plugins) {
        process.stdout.write(`${pluginLine(await describePlugin(spec, { configDir: configDir(), cwd: process.cwd() }))}\n`);
      }
    }
    process.exit(0);
  }
  process.stderr.write(`No command called ${verb}. Try --help.\n`);
  process.exit(2);
}

const options = parse(argv);
if (options.version) {
  process.stdout.write(`${version()}\n`);
  process.exit(0);
}
if (options.help) {
  process.stdout.write(USAGE);
  process.exit(0);
}

const { token, from } = secret(options);

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
const stamp = (line: string): void => { process.stdout.write(`${new Date().toISOString()} ${line}\n`); };

/*
 * What this host calls its own sign-in resource.
 *
 * The operator's identifier when they named one, and otherwise one derived
 * from where this daemon listens. `signInIdentifier` does the deriving, so
 * what a client will be told is testable without binding a port, and this
 * only refuses an identifier the format would not accept.
 */
const advertisedResource = (): string => {
  const said = options.resource;
  if (said !== undefined && !isIdentifier(said)) {
    stop('--resource must be an https URL with no fragment, for example https://ahpd.example.com/');
  }
  return signInIdentifier({ ...(said === undefined ? {} : { resource: said }), host: options.host, port: options.port }, hostname());
};

/*
 * The authorization server this host accepts tokens from, when one is named.
 *
 * `github` is the preset a stock client can resolve with no client work, and an
 * https URL is an OpenID Connect issuer whose metadata is discovered. Absent,
 * the host is its own issuer and only secrets it minted are checked -
 * decision `the-issuer-option-takes-a-url-or-github`.
 */
const named = options.issuer === undefined ? undefined : namedIssuer(options.issuer);
if (options.issuer !== undefined && named === undefined) {
  stop('--issuer takes github or an https issuer URL.');
}
const issuer = named === undefined
  ? undefined
  : named.kind === 'github' ? githubIssuer() : oidcIssuer({ issuer: named.issuer });

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
    resource: signInRecord(advertisedResource(), issuer),
    ...(issuer === undefined ? {} : { issuer }),
    onProblem: (line) => process.stderr.write(`${line}\n`),
  });

/*
 * What the daemon contributes before any plugin does.
 *
 * This is the literal it has always been, named so a plugin's contributions
 * can be folded into it rather than built beside it. It keeps every port, so a
 * daemon with no plugins is exactly the daemon it was, and it is a value the
 * fold never mutates.
 */
const base: HostOptions = {
  path: options.paths[0] as string,
  // The daemon serves Claude Code. The host serves whatever it is given -
  // see `examples/` for what a second one looks like.
  agents: [claude({ paths: options.paths })],
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
   * The host's own tools, offered to every session's model.
   *
   * What a session cannot see from inside itself: the sessions running beside
   * it and the terminals the person has open. Both read-only, and both facts
   * only the host has.
   */
  tools: hostTools(),
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
  automations: memory
    ? memoryAutomations()
    : scheduledAutomations({
      // Beside the configuration, which is this daemon's decision to make and
      // not the store's - see `ScheduledOptions.file`.
      file: automationsPath(),
      onProblem: (message) => process.stdout.write(`${message}\n`),
    }),
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
  configDir: configDir(),
  cwd: process.cwd(),
  log: stamp,
});
for (const problem of problems) stamp(problem);
if (problems.some((problem) => problem.startsWith(AGENT_CLASH))) process.exit(1);

const host = createHost(folded);

// Whichever runtime this is. `listen` is the only file that knows, and it
// says which one it found - a daemon that silently ran somewhere unexpected
// would be a daemon nobody could tell apart from the one they meant to start.
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
 * The door, and the directory behind it.
 *
 * `identify` is what makes a person's own connection token theirs: the
 * deployment's token still admits and names nobody, and anything else is put
 * to the directory, so a client that can only carry a URL arrives as somebody
 * without an `authenticate` - decision
 * `a-connection-token-may-carry-a-person`. With no directory there is nothing
 * to ask, so nothing is passed and the door refuses exactly what it refused.
 */
const listener = await listen(
  {
    port: options.port,
    host: options.host,
    ...(token !== undefined ? { token } : {}),
    ...(users === undefined ? {} : { identify: (presented: string) => users.verify(presented), root: true }),
    ...(tap ? { tap } : {}),
  },
  (peer, principal, root) => host.accept(peer, principal, root),
);

process.stdout.write(
  `ahpd on ws://${listener.host}:${listener.port} (${listener.runtime}), sessions in ${options.paths.join(', ')}\n`
  // Its own line rather than the end of the one above, which `daemon.ts`
  // reads the session directories off with a regular expression.
  + `automations ${memory ? 'in memory, schedules do not fire' : `in ${automationsPath()}, schedules fire`}\n`
  // Its own line for the same reason: a client that only needs the names reads
  // one line, and `daemon.ts` keeps matching the two above unchanged.
  + `plugins ${loaded.length === 0 ? 'none' : loaded.map((one) => one.name).join(', ')}\n`
  // Where the secret came from, never the secret: stdout is a log, and a log
  // is the one place a credential should not end up.
  + `${from}\n`
  // What a client is told to sign in against, and which issuer it may use, so
  // an operator can see both without reading root state. Absent when there is
  // nobody to sign in.
  + (users === undefined
    ? ''
    : `sign-in ${advertisedResource()}${issuer === undefined ? '' : ` (issuer ${issuer.id})`}\n`)
  + (options.wire === undefined ? '' : `wire to ${options.wire}\n`)
  + (checkingUpdates(options.updateCheck) ? updateLine(manifest()) ?? '' : ''),
);

/*
 * Ask npm, later and in the background.
 *
 * The line above was read from the file as it was; this is what keeps that
 * file current for the next start. Nothing here is awaited, and the timer is
 * let go of so a daemon that is stopping does not wait six hours for it.
 */
if (checkingUpdates(options.updateCheck)) {
  const ask = (): void => { void refreshUpdate({ name: manifest().name, registry: registry() }); };
  if (stale(readUpdate())) ask();
  setInterval(ask, MAX_AGE_MS).unref();
}

const shutdown = (): void => {
  void Promise.resolve(listener.close()).finally(() => process.exit(0));
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
