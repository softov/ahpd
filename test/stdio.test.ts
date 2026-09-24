import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { createHost, ROOT } from '../packages/sdk/src/host.js';
import { echo } from '../examples/echo/agent.js';
import { overStdio } from '../packages/sdk/src/listen.js';
import { fileResources } from '../packages/sdk/src/resources.js';
import type { Grant, Users } from '../packages/sdk/src/types/users.js';

/*
 * The second transport: one line of JSON per frame, over a pipe.
 *
 * It exists so a container can run a host for another host to carry, and what
 * is asserted here is that it is the same host: the same handshake, the same
 * gate, the same tap, and the framing rule that a frame is one line and a line
 * is one frame however the pipe chooses to split it.
 *
 * The streams are the test's own, which is why `overStdio` takes them: a test
 * that commandeered the runner's stdin would be testing the runner.
 */

let root: string;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'ahpd-stdio-')); });
afterEach(() => { rmSync(root, { recursive: true, force: true }); });

type Bag = Record<string, any>;

/** A directory whose one token is decided by hand, so a role is one array. */
const directory = (tokens: Record<string, Grant[]>): Users => ({
  resource: { resource: 'ahpd://users', resource_name: 'ahpd users', required: false },
  verify: async (token) => {
    const held = tokens[token];
    return held === undefined ? undefined : { id: token, roles: ['r'], can: (one: Grant) => held.includes(one) };
  },
  list: async () => [],
  add: async () => {},
  remove: async () => false,
  mint: async () => '',
});

/** A host answering over a pipe, and the two ends the test holds. */
async function piped(options: { root?: boolean; users?: Users; tap?: (from: string, text: string, peer: number) => void } = {}) {
  const input = new PassThrough();
  const output = new PassThrough();
  const host = createHost({
    path: root,
    agents: [{ ...echo({ path: root, pace: 0 }), provider: 'base', displayName: 'Base' }],
    resources: fileResources(),
    ...(options.users === undefined ? {} : { users: options.users }),
  });
  const listener = await overStdio(
    {
      input,
      output,
      ...(options.root === undefined ? {} : { root: options.root }),
      ...(options.tap === undefined ? {} : { tap: options.tap }),
    },
    (peer, principal, isRoot) => host.accept(peer, principal, isRoot),
  );

  const frames: Bag[] = [];
  let pending = '';
  output.setEncoding('utf8');
  output.on('data', (chunk: string) => {
    pending += chunk;
    let at = pending.indexOf('\n');
    while (at !== -1) {
      const line = pending.slice(0, at);
      pending = pending.slice(at + 1);
      if (line !== '') frames.push(JSON.parse(line) as Bag);
      at = pending.indexOf('\n');
    }
  });

  const send = (frame: unknown): void => { input.write(`${JSON.stringify(frame)}\n`); };
  const wait = async (count: number): Promise<void> => {
    const deadline = Date.now() + 3000;
    while (frames.length < count && Date.now() < deadline) await new Promise((r) => { setTimeout(r, 2); });
  };
  return { listener, frames, send, wait, input, output };
}

const hello = { jsonrpc: '2.0', id: 1, method: 'initialize', params: { clientId: 'probe', protocolVersions: ['0.9.0'], initialSubscriptions: [ROOT] } };
const ping = (id: number) => ({ jsonrpc: '2.0', id, method: 'ping', params: {} });

it('answers a handshake over a pipe', async () => {
  const pipe = await piped();
  pipe.send(hello);
  await pipe.wait(1);
  expect(pipe.frames).toHaveLength(1);
  expect(pipe.frames[0]?.id).toBe(1);
  expect(pipe.frames[0]?.result).toMatchObject({ protocolVersion: expect.any(String) });
  await pipe.listener.close();
});

it('holds a frame that the pipe split, and answers it once', async () => {
  const pipe = await piped();
  const text = JSON.stringify(ping(7));
  const half = Math.floor(text.length / 2);
  pipe.input.write(text.slice(0, half));
  // Long enough that a reader without a buffer would have answered, or thrown.
  await new Promise((r) => { setTimeout(r, 20); });
  expect(pipe.frames).toEqual([]);
  pipe.input.write(`${text.slice(half)}\n`);
  await pipe.wait(1);
  expect(pipe.frames).toHaveLength(1);
  expect(pipe.frames[0]?.id).toBe(7);
  await pipe.listener.close();
});

it('answers every frame when two arrive in one write', async () => {
  const pipe = await piped();
  pipe.input.write(`${JSON.stringify(hello)}\n${JSON.stringify(ping(2))}\n`);
  await pipe.wait(2);
  // Both, and no third. The answers are correlated by id and not by order,
  // which is JSON-RPC's own rule: `initialize` does work a `ping` does not, so
  // two frames read in one line loop can answer in either order.
  expect(pipe.frames.map((one) => one.id).sort()).toEqual([1, 2]);
  await pipe.listener.close();
});

it('keeps an escaped newline inside one frame', async () => {
  const pipe = await piped();
  // A raw newline in a JSON string is written as two characters, so the frame
  // is still one line. This is the rule the framing rests on.
  pipe.send({ jsonrpc: '2.0', id: 3, method: 'ping', params: { said: 'one\ntwo' } });
  await pipe.wait(1);
  expect(pipe.frames).toHaveLength(1);
  expect(pipe.frames[0]?.id).toBe(3);
  await pipe.listener.close();
});

it('draws the parse error for a line that is not JSON, and keeps going', async () => {
  const pipe = await piped();
  pipe.input.write('this is not a frame\n');
  await pipe.wait(1);
  expect(pipe.frames[0]?.error).toMatchObject({ code: -32700 });
  pipe.send(ping(4));
  await pipe.wait(2);
  expect(pipe.frames[1]?.id).toBe(4);
  await pipe.listener.close();
});

it('is the host itself by default, and nobody when the caller says so', async () => {
  const users = directory({ someone: ['file:read'] });
  const opened = await piped({ users });
  opened.send(hello);
  await opened.wait(1);
  // Admitted as the host: the same call a person without the grant is refused
  // for is answered on a pipe, which is what a nested host needs.
  opened.send({ jsonrpc: '2.0', id: 5, method: 'resourceList', params: { channel: ROOT, uri: `file://${root}` } });
  await opened.wait(2);
  expect(opened.frames[1]?.result).toBeDefined();
  await opened.listener.close();

  const nobody = await piped({ users, root: false });
  nobody.send(hello);
  await nobody.wait(1);
  nobody.send({ jsonrpc: '2.0', id: 6, method: 'resourceList', params: { channel: ROOT, uri: `file://${root}` } });
  await nobody.wait(2);
  expect(nobody.frames[1]?.error).toMatchObject({ code: -32007 });
  await nobody.listener.close();
});

it('taps both directions on a pipe', async () => {
  const seen: string[] = [];
  const pipe = await piped({ tap: (from, text) => { seen.push(`${from}:${JSON.parse(text).id ?? JSON.parse(text).method}`); } });
  pipe.send(ping(8));
  await pipe.wait(1);
  expect(seen).toEqual(['client:8', 'host:8']);
  await pipe.listener.close();
});

it('says nothing more once it is closed', async () => {
  const pipe = await piped();
  await pipe.listener.close();
  expect(pipe.listener.host).toBe('stdio');
  expect(pipe.listener.port).toBe(0);
  expect(pipe.listener.guarded).toBe(false);
  pipe.send(ping(9));
  await new Promise((r) => { setTimeout(r, 30); });
  expect(pipe.frames).toEqual([]);
});
