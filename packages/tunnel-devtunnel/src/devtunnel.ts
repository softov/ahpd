/**
 * Driving the `devtunnel` CLI.
 *
 * Not a dependency and not bundled: `devtunnel` is a separate .NET program
 * that only somebody using a tunnel needs, and it has to be installed and
 * logged in before any of this can run. So this file spawns it and decodes
 * what it prints, and the plugin costs a host that never turns it on nothing.
 *
 * Every decoder here takes the fields it needs and ignores the rest, so a CLI
 * that adds a field keeps working, and refuses a missing or wrong-typed one
 * rather than carrying on with a tunnel id that is `undefined`.
 *
 * The process boundary is `Runner` rather than `spawn` reached for directly,
 * so the arrangement above it can be tested without the CLI. It is never
 * waited for synchronously: one `devtunnel` call takes seconds against the
 * service, and a daemon whose event loop stood still that long lets every
 * timer that started before it expire, as cofold's catalogue fetch did.
 */

import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { IDENTITY_LABEL, LABELS, TUNNEL_PORT } from './discovery.js';

/** Anything this file could not get out of the CLI. */
export class TunnelError extends Error {}

/** What one finished `devtunnel` run left behind. */
export interface Result {
  status: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
}

/** How a `devtunnel` command is run. Replaced in tests. */
export type Runner = (args: readonly string[]) => Result | Promise<Result>;

/** How the long-running `devtunnel host` is started. Replaced in tests. */
export type Spawner = (args: readonly string[]) => ChildProcess;

/** One tunnel, as much of it as anything here reads. */
export interface Tunnel {
  tunnelId: string;
  labels: string[];
}

const install = [
  '`devtunnel` was not found on PATH.',
  '',
  'Install it from https://aka.ms/devtunnels/download, then log in:',
  '',
  '    devtunnel user login -g      with a GitHub account',
  '    devtunnel user login         with a Microsoft account',
].join('\n');

/** The default runner: the CLI, on this machine, without holding the event loop. */
export const run: Runner = (args) => new Promise<Result>((done, fail) => {
  const child = spawn('devtunnel', [...args], { stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8').on('data', (chunk: string) => { stdout += chunk; });
  child.stderr.setEncoding('utf8').on('data', (chunk: string) => { stderr += chunk; });
  child.on('error', (error: NodeJS.ErrnoException) => {
    fail(new TunnelError(error.code === 'ENOENT' ? install : `could not start devtunnel: ${error.message}`));
  });
  child.on('close', (status, signal) => { done({ status, signal, stdout, stderr }); });
});

/** The default spawner, for the one command that does not end. */
export const start: Spawner = (args) => spawn('devtunnel', [...args], { stdio: ['ignore', 'pipe', 'pipe'] });

const why = (done: Result): string => {
  const ended = done.signal !== null
    ? `signal ${done.signal}`
    : done.status === null ? 'no exit status' : `exit status ${done.status}`;
  return [ended, done.stderr.trim(), done.stdout.trim()].filter((one) => one !== '').join('\n');
};

/** Run one command and insist it worked. */
async function ok(runner: Runner, args: readonly string[]): Promise<Result> {
  const done = await runner(args);
  if (done.status !== 0) throw new TunnelError(`devtunnel ${args[0] ?? ''} failed:\n${why(done)}`);
  return done;
}

function parse(command: string, stdout: string): Record<string, unknown> {
  let value: unknown;
  try { value = JSON.parse(stdout); }
  catch { throw new TunnelError(`devtunnel ${command} did not print JSON:\n${stdout.trim() || '<nothing>'}`); }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TunnelError(`devtunnel ${command} printed ${Array.isArray(value) ? 'an array' : typeof value}, not an object`);
  }
  return value as Record<string, unknown>;
}

/**
 * One tunnel out of the CLI's JSON.
 *
 * `labels` is what the current CLI calls them and `tags` is what it called
 * them before, and both spellings are read because which one a person has
 * installed is not this plugin's to decide.
 */
function tunnelOf(value: unknown): Tunnel | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const held = value as Record<string, unknown>;
  const id = held.tunnelId;
  if (typeof id !== 'string' || id === '') return undefined;
  const labels = Array.isArray(held.labels) ? held.labels : Array.isArray(held.tags) ? held.tags : [];
  return { tunnelId: id, labels: labels.filter((one): one is string => typeof one === 'string') };
}

/**
 * The tunnel this plugin made before, if it still exists.
 *
 * Found by its own label rather than by a name a person may have changed, and
 * the newest is taken when there is more than one: an account that accumulated
 * two of these should not stop working while somebody tidies up.
 */
export async function find(runner: Runner = run): Promise<Tunnel | undefined> {
  const done = await ok(runner, ['list', '--labels', IDENTITY_LABEL, '--json']);
  const listed = parse('list', done.stdout).tunnels;
  if (!Array.isArray(listed)) return undefined;
  const mine = listed.map(tunnelOf).filter((one): one is Tunnel => one !== undefined);
  return mine[mine.length - 1];
}

/** Make one, labelled so the convention's clients will look at it. */
export async function create(name: string | undefined, runner: Runner = run): Promise<Tunnel> {
  const labels = [...LABELS, ...(name === undefined ? [] : [name])];
  const args = ['create', '--json', ...labels.flatMap((label) => ['--labels', label])];
  const made = tunnelOf(parse('create', (await ok(runner, args)).stdout).tunnel);
  if (made === undefined) throw new TunnelError('devtunnel create did not say which tunnel it made');
  return made;
}

/**
 * Put the well-known port on it, and let it be reached without signing in.
 *
 * Both are safe to repeat: a port or an access entry that is already there is
 * not an error worth stopping for, which is what makes reusing a tunnel from a
 * previous run the same code path as making a new one.
 *
 * `anonymous` is what makes a tunnel reachable by somebody who is not signed
 * in to the same Dev Tunnels account. It is off unless it is asked for,
 * because the alternative is a URL that anyone who has it can open, and the
 * only thing between them and the daemon is the derived connection token,
 * which is computed from the tunnel id rather than kept secret.
 */
export async function prepare(tunnel: Tunnel, anonymous: boolean, runner: Runner = run): Promise<void> {
  // The service has said this more than one way: older CLIs print "already
  // exists", current ones "Conflict with existing entity ... conflicts with an
  // existing port in the tunnel".
  const already = (done: Result): boolean =>
    /already exists|already has|conflicts? with (an )?existing/i.test(`${done.stdout}${done.stderr}`);
  const port = await runner(['port', 'create', tunnel.tunnelId, '-p', String(TUNNEL_PORT), '--protocol', 'http']);
  if (port.status !== 0 && !already(port)) {
    throw new TunnelError(`devtunnel port create failed:\n${why(port)}`);
  }
  if (!anonymous) return;
  const access = await runner(['access', 'create', tunnel.tunnelId, '--anonymous', '--port', String(TUNNEL_PORT)]);
  if (access.status !== 0 && !already(access)) {
    throw new TunnelError(`devtunnel access create failed:\n${why(access)}`);
  }
}

/** Take it down, for a run that did not ask to keep it. */
export async function remove(tunnel: Tunnel, runner: Runner = run): Promise<void> {
  await runner(['delete', tunnel.tunnelId, '--force']);
}

/**
 * Forward the well-known port, for as long as the daemon runs.
 *
 * The one command here that does not end: it holds the connection to the Dev
 * Tunnels relay and serves `127.0.0.1:31546` through it. Its output goes to
 * `log` rather than to the daemon's stdout, which is an announcement a client
 * parses and not a place for another program's chatter.
 */
export function host(tunnel: Tunnel, log: (line: string) => void, spawner: Spawner = start): ChildProcess {
  const child = spawner(['host', tunnel.tunnelId]);
  const lines = (from: 'out' | 'err') => (chunk: Buffer | string) => {
    for (const line of String(chunk).split('\n')) {
      const one = line.trim();
      if (one !== '') log(`devtunnel ${from}: ${one}`);
    }
  };
  child.stdout?.on('data', lines('out'));
  child.stderr?.on('data', lines('err'));
  child.on('error', (error) => { log(`devtunnel host failed: ${error.message}`); });
  return child;
}
