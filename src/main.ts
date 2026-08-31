#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { claude } from './agents/claude.js';
import { createHost } from './host.js';
import { gitBranches } from './git.js';
import { gitChanges } from './changes.js';
import { fileResources } from './resources.js';
import { shellTerminals } from './terminals.js';
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
  help: boolean;
}

const USAGE = `ahpd - an Agent Host Protocol host that runs Claude Code

  ahpd [options]

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
  --help, -h                    This

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
      case '--help': case '-h': options.help = true; break;
      default:
        if (argv[i]?.startsWith('-')) {
          process.stderr.write(`Unknown option ${argv[i]}. Try --help.\n`);
          process.exit(2);
        }
    }
  }
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

const options = parse(process.argv.slice(2));
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
  onEvent: (message) => process.stdout.write(`${message}\n`),
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
