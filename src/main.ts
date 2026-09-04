#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { configPath, loadConfig } from './config.js';
import { running, start, stop as stopDaemon } from './daemon.js';
import { claude } from './agents/claude.js';
import { createHost } from './host.js';
import { gitBranches } from './git.js';
import { gitChanges } from './changes.js';
import { scheduledAutomations } from './scheduled.js';
import { fileResources } from './resources.js';
import { shellTerminals } from './terminals.js';
import { gitWorktrees } from './worktrees.js';
import { listen } from './listen.js';

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
  help: boolean;
}

const USAGE = `ahpd - an Agent Host Protocol host that runs Claude Code

  ahpd [options]              run it here, in this terminal
  ahpd start [options]        run it in the background and let go of it
  ahpd stop                   stop the one running in the background
  ahpd status                 say whether one is, and where
  ahpd config                 say where the configuration is, and what it says

  --port <n>                    Listen here. Default 9187; 0 picks a free one.
  --host <addr>                 Bind here. Default 127.0.0.1. Pass 0.0.0.0 to
                                accept from other machines, which needs a token.
  --path <dir>                  A directory this host serves. Repeatable; the
                                first is the default a client gets when it
                                names none, and a directory not named here is
                                refused. Default: where the daemon started.
  --connection-token <secret>   Require this secret on every connection.
  --connection-token-file <p>   Require the secret in this file. A fresh one is
                                written if the file is not there.
  --without-connection-token    Accept any connection. Only when the port is
                                already reachable by nobody else.
  --config-file <p>             Read this instead of the file below.
  --help, -h                    This

Every option above can be a key in the configuration file instead, spelled the
way it is here without the dashes: port, host, paths, connectionToken,
connectionTokenFile, withoutConnectionToken. A flag beats the file, because a
flag is this run and a file is every run until somebody edits it.

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
    open: false,
    help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    switch (argv[i]) {
      case '--port': options.port = Number(argv[++i]); break;
      case '--host': options.host = String(argv[++i]); break;
      // Repeatable. One host over two projects is one catalogue and one
      // process, which is the case a second `--path` is for; a directory this
      // host was not told about is refused rather than served, because a host
      // that ran the agent wherever it was told is one anybody who can reach
      // the port can point at any directory on the machine.
      case '--path': options.paths.push(String(argv[++i])); break;
      case '--connection-token': options.token = String(argv[++i]); break;
      case '--connection-token-file': options.tokenFile = String(argv[++i]); break;
      case '--without-connection-token': options.open = true; break;
      case '--config-file': options.configFile = String(argv[++i]); break;
      case '--help': case '-h': options.help = true; break;
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

  if (options.paths.length === 0) options.paths.push(process.cwd());
  return options;
}

const stop = (message: string): never => {
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
    parse(rest);
    try {
      const begun = await start(rest, process.argv[1] as string);
      process.stdout.write(`ahpd on ${begun.url} (pid ${String(begun.pid)}), sessions in ${begun.paths.join(', ') || process.cwd()}\n`);
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
    process.stdout.write(`ahpd on ${found.url} (pid ${String(found.pid)}), started ${found.startedAt}\n`);
    if (found.paths.length > 0) process.stdout.write(`sessions in ${found.paths.join(', ')}\n`);
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
  process.stderr.write(`No command called ${verb}. Try --help.\n`);
  process.exit(2);
}

const options = parse(argv);
if (options.help) {
  process.stdout.write(USAGE);
  process.exit(0);
}

const { token, from } = secret(options);

const host = createHost({
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
  terminals: shellTerminals(),
  directories: gitBranches(),
  changes: gitChanges(),
  worktrees: gitWorktrees(),
  /*
   * Automations, with a clock.
   *
   * A daemon is the case the port was written for: it is already running at
   * nine in the morning, which is the only way an automation fires with
   * nobody connected. Definitions live in a file beside the configuration and
   * come back on a restart; the runs do not, because they name sessions that
   * went when the process did.
   *
   * A host embedded in something that already schedules passes its own store
   * instead, and one that should fire nothing passes `memoryAutomations()`.
   */
  automations: scheduledAutomations({
    onProblem: (message) => process.stdout.write(`${message}\n`),
  }),
  /*
   * When, as well as what.
   *
   * The daemon's own lines had no times on them, so a log read after
   * something went wrong said what happened in order and nothing about how
   * far apart - which is most of what is worth knowing when a process died
   * a minute after starting. It is also what makes this log line up against
   * a client's, since the two are separate programs and the only thing they
   * share is a clock.
   *
   * The timestamp is added here rather than in `createHost`, because a host
   * embedded in something else has its own log with its own format and
   * `onEvent` hands it the message to do that with.
   */
  onEvent: (message) => process.stdout.write(`${new Date().toISOString()} ${message}\n`),
});

// Whichever runtime this is. `listen` is the only file that knows, and it
// says which one it found - a daemon that silently ran somewhere unexpected
// would be a daemon nobody could tell apart from the one they meant to start.
const listener = await listen(
  { port: options.port, host: options.host, ...(token !== undefined ? { token } : {}) },
  (peer) => host.accept(peer),
);

process.stdout.write(
  `ahpd on ws://${listener.host}:${listener.port} (${listener.runtime}), sessions in ${options.paths.join(', ')}\n`
  // Where the secret came from, never the secret: stdout is a log, and a log
  // is the one place a credential should not end up.
  + `${from}\n`,
);

const shutdown = (): void => {
  void Promise.resolve(listener.close()).finally(() => process.exit(0));
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
