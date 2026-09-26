import { createHash } from 'node:crypto';
import { createServer } from 'node:net';
import type { AddressInfo } from 'node:net';
import { connect } from 'node:net';
import { EventEmitter } from 'node:events';
import type { ChildProcess } from 'node:child_process';
import { afterEach, expect, it } from 'vitest';
import { pluginHost, raise } from '../packages/sdk/src/plugins.js';
import type { PluginContext } from '../packages/sdk/src/types/plugin.js';
import {
  deriveConnectionToken, displayLabel, nameLabel, LAUNCHER_LABEL, PROTOCOL_LABEL, TUNNEL_PORT,
} from '../packages/tunnel-devtunnel/src/discovery.js';
import { create, find, prepare, TunnelError } from '../packages/tunnel-devtunnel/src/devtunnel.js';
import type { Result, Runner } from '../packages/tunnel-devtunnel/src/devtunnel.js';
import { forward } from '../packages/tunnel-devtunnel/src/forward.js';
import { apply } from '../packages/tunnel-devtunnel/src/plugin.js';

/*
 * The convention, the CLI and the plugin, without a `devtunnel` on the machine.
 *
 * The convention is the half that has to be right, so it is checked against
 * what it is a convention *for* rather than against itself: the token is
 * recomputed here from its definition, and the labels are read back through
 * the same rule VS Code's `TunnelTags` applies. The CLI half is driven through
 * a fake runner, which is what the `Runner` seam is for.
 */

const ok = (stdout: string): Result => ({ status: 0, signal: null, stdout, stderr: '' });
const no = (stderr: string, status = 1): Result => ({ status, signal: null, stdout: '', stderr });

/** A runner that answers each command by its first word, and records the calls. */
const runner = (answers: Record<string, Result | Result[]>): Runner & { calls: string[][] } => {
  const calls: string[][] = [];
  const left = new Map(Object.entries(answers).map(([at, value]) => [at, Array.isArray(value) ? [...value] : [value]]));
  const one = ((args: readonly string[]) => {
    calls.push([...args]);
    const queue = left.get(args[0] ?? '');
    return (queue !== undefined && queue.length > 1 ? queue.shift() : queue?.[0]) ?? ok('{}');
  }) as Runner & { calls: string[][] };
  one.calls = calls;
  return one;
};

const context = (over: Partial<PluginContext> = {}): PluginContext => ({
  path: '/work', paths: ['/work'], version: '0.6.3', log: () => {}, say: () => {}, ...over,
});

// The convention ----------------------------------------------------------

it('derives the token a client presents as unpadded base64url of the id hash', async () => {
  const id = 'sunny-otter-9k3';
  const expected = createHash('sha256').update(id).digest('base64url');
  expect(await deriveConnectionToken(id)).toBe(expected);
  // 32 bytes is 43 characters once the padding is gone, which is what the
  // client's own encoder produces and what the query parameter carries.
  expect(expected).toHaveLength(43);
});

it('never lets a derived token begin with a dash', async () => {
  // A token is a query parameter and one starting with a dash reads as a flag
  // to whatever handles it next, so the client prefixes it and so must this.
  const found = await Promise.all(
    Array.from({ length: 200 }, (_, at) => deriveConnectionToken(`id-${at}`)),
  );
  expect(found.some((token) => token.startsWith('a-'))).toBe(true);
  expect(found.every((token) => !token.startsWith('-'))).toBe(true);
});

it('reads the display name the way the client works it out', () => {
  // The first label that is not the launcher, not underscore-prefixed and not
  // a protocol tag. Order matters, and the two markers must not win it.
  expect(displayLabel([LAUNCHER_LABEL, PROTOCOL_LABEL, '_ahpd', 'dev82'])).toBe('dev82');
  expect(displayLabel([LAUNCHER_LABEL, PROTOCOL_LABEL, '_ahpd'])).toBeUndefined();
});

it('turns a machine name into something that can be a label', () => {
  expect(nameLabel('dev82.brbyte.com')).toBe('dev82brbytecom');
  expect(nameLabel('--dev')).toBe('dev');
  expect(nameLabel('x'.repeat(40))).toHaveLength(20);
  expect(nameLabel('!!!')).toBeUndefined();
});

// The CLI -----------------------------------------------------------------

it('finds a tunnel this plugin made before, by its own label', () => {
  const run = runner({ list: ok(JSON.stringify({ tunnels: [{ tunnelId: 'older', labels: [] }, { tunnelId: 'newest', labels: ['_ahpd'] }] })) });
  expect(find(run)?.tunnelId).toBe('newest');
  expect(run.calls[0]).toEqual(['list', '--labels', '_ahpd', '--json']);
});

it('reads the older tags spelling as well as labels', () => {
  const run = runner({ list: ok(JSON.stringify({ tunnels: [{ tunnelId: 'one', tags: [LAUNCHER_LABEL, 'dev82'] }] })) });
  expect(find(run)?.labels).toEqual([LAUNCHER_LABEL, 'dev82']);
});

it('has no tunnel when the account has none', () => {
  expect(find(runner({ list: ok(JSON.stringify({ tunnels: [] })) }))).toBeUndefined();
});

it('creates one carrying every label the convention needs', () => {
  const run = runner({ create: ok(JSON.stringify({ tunnel: { tunnelId: 'made', labels: [] } })) });
  expect(create('dev82', run).tunnelId).toBe('made');
  const args = run.calls[0] as string[];
  expect(args.slice(0, 2)).toEqual(['create', '--json']);
  expect(args.filter((one, at) => args[at - 1] === '--labels'))
    .toEqual([LAUNCHER_LABEL, PROTOCOL_LABEL, '_ahpd', 'dev82']);
});

it('refuses output that names no tunnel rather than carrying on without one', () => {
  expect(() => create(undefined, runner({ create: ok('{"tunnel":{}}') }))).toThrow(TunnelError);
  expect(() => create(undefined, runner({ create: ok('not json') }))).toThrow(/did not print JSON/);
});

it('says the command failed, with what it printed', () => {
  expect(() => find(runner({ list: no('not logged in') }))).toThrow(/not logged in/);
});

it('puts the well-known port on the tunnel and leaves access alone by default', () => {
  const run = runner({ port: ok(''), access: ok('') });
  prepare({ tunnelId: 'made', labels: [] }, false, run);
  expect(run.calls).toEqual([['port', 'create', 'made', '-p', String(TUNNEL_PORT), '--protocol', 'http']]);
});

it('opens it to the signed-out only when asked', () => {
  const run = runner({ port: ok(''), access: ok('') });
  prepare({ tunnelId: 'made', labels: [] }, true, run);
  expect(run.calls[1]).toEqual(['access', 'create', 'made', '--anonymous', '--port', String(TUNNEL_PORT)]);
});

it('treats a port that is already there as prepared, which is what reuse means', () => {
  const run = runner({ port: no('Port already exists on tunnel') });
  expect(() => prepare({ tunnelId: 'made', labels: [] }, false, run)).not.toThrow();
});

it('treats the service\'s conflict on an existing port as prepared too', () => {
  const run = runner({
    port: no('Tunnel service error: Conflict with existing entity. Tunnel port number conflicts with an existing port in the tunnel.'),
  });
  expect(() => prepare({ tunnelId: 'made', labels: [] }, false, run)).not.toThrow();
});

it('still fails on a port error that is not a conflict', () => {
  const run = runner({ port: no('Tunnel service error: Unauthorized.') });
  expect(() => prepare({ tunnelId: 'made', labels: [] }, false, run)).toThrow(/Unauthorized/);
});

// The hop -----------------------------------------------------------------

const closing: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const close of closing.splice(0)) await close();
});

it('carries a connection from the well-known port to the one the daemon bound', async () => {
  const daemon = createServer((socket) => { socket.on('data', (chunk) => socket.write(`seen ${chunk}`)); });
  await new Promise<void>((done) => { daemon.listen(0, '127.0.0.1', done); });
  closing.push(() => new Promise<void>((done) => { daemon.close(() => done()); }));
  const bound = (daemon.address() as AddressInfo).port;

  // Not the well-known port: the whole point is that the two are different.
  const hop = await forward(0, bound, () => {});
  closing.push(() => hop.close());

  const answer = await new Promise<string>((done, fail) => {
    const client = connect({ host: '127.0.0.1', port: hop.port }, () => { client.write('frame'); });
    client.on('data', (chunk) => { done(String(chunk)); client.destroy(); });
    client.on('error', fail);
  });
  expect(answer).toBe('seen frame');
});

// The plugin --------------------------------------------------------------

/** A `devtunnel host` that does not exist, so nothing is spawned in a test. */
const spawner = () => {
  const child = new EventEmitter() as ChildProcess & { killed: boolean };
  child.killed = false;
  child.kill = () => { child.killed = true; return true; };
  return child;
};

const listening = { type: 'listening', runtime: 'node', host: '127.0.0.1', port: TUNNEL_PORT, guarded: false } as const;

it('announces the tunnel it stood up, so ahpd status carries the address', async () => {
  const said: string[] = [];
  const run = runner({
    list: ok(JSON.stringify({ tunnels: [{ tunnelId: 'kept-one', labels: [LAUNCHER_LABEL, PROTOCOL_LABEL, '_ahpd', 'dev82'] }] })),
    port: ok(''),
  });
  const { host, contribution } = pluginHost('tunnel', context({ say: (line) => { said.push(line); } }));
  await apply(host, { runner: run, spawner });

  await raise(contribution.events, listening);
  expect(said).toEqual([`tunnel kept-one (dev82), port ${TUNNEL_PORT}`]);
});

it('says which token a client will present when the daemon wants one of its own', async () => {
  const said: string[] = [];
  const run = runner({
    list: ok(JSON.stringify({ tunnels: [{ tunnelId: 'kept-one', labels: ['_ahpd'] }] })),
    port: ok(''),
  });
  const { host, contribution } = pluginHost('tunnel', context({ say: (line) => { said.push(line); } }));
  await apply(host, { runner: run, spawner });

  await raise(contribution.events, { ...listening, guarded: true });
  expect(said[1]).toContain(await deriveConnectionToken('kept-one'));
  expect(said[1]).toContain('this daemon requires its own');
});

it('costs the tunnel and not the daemon when the CLI is missing', async () => {
  const logged: string[] = [];
  const said: string[] = [];
  const run: Runner = () => { throw new TunnelError('`devtunnel` was not found on PATH.'); };
  const { host, contribution } = pluginHost('tunnel', context({
    log: (line) => { logged.push(line); },
    say: (line) => { said.push(line); },
  }));
  await apply(host, { runner: run, spawner });

  await expect(raise(contribution.events, listening)).resolves.toBeUndefined();
  expect(said).toEqual([]);
  expect(logged.some((line) => line.includes('not found on PATH'))).toBe(true);
});

it('keeps the tunnel across a stop, because the id is what the token comes from', async () => {
  const run = runner({
    list: ok(JSON.stringify({ tunnels: [{ tunnelId: 'kept-one', labels: ['_ahpd'] }] })),
    port: ok(''),
  });
  const { host, contribution } = pluginHost('tunnel', context());
  await apply(host, { runner: run, spawner });

  await raise(contribution.events, listening);
  await raise(contribution.events, { type: 'stopping' });
  expect(run.calls.some((args) => args[0] === 'delete')).toBe(false);
});

it('deletes it on the way down when the run asked not to keep it', async () => {
  const run = runner({
    list: ok(JSON.stringify({ tunnels: [{ tunnelId: 'kept-one', labels: ['_ahpd'] }] })),
    port: ok(''),
  });
  const { host, contribution } = pluginHost('tunnel', context());
  await apply(host, { runner: run, spawner, keep: false });

  await raise(contribution.events, listening);
  await raise(contribution.events, { type: 'stopping' });
  expect(run.calls.at(-1)).toEqual(['delete', 'kept-one', '--force']);
});

it('has nothing to take down when it never stood anything up', async () => {
  const run: Runner = () => { throw new TunnelError('no CLI'); };
  const { host, contribution } = pluginHost('tunnel', context());
  await apply(host, { runner: run, spawner, keep: false });

  await raise(contribution.events, listening);
  await expect(raise(contribution.events, { type: 'stopping' })).resolves.toBeUndefined();
});
