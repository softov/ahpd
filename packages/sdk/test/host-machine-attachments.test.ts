/*
 * A session in a machine is handed the files its messages name.
 *
 * A message's attachment is a file this host wrote under the session's own
 * folder and the message names it by path, so a session running in a machine
 * reads that path only once the machine holds a file there - decision
 * `a-session-in-a-machine-gets-each-attachment-copied-into-it`. The copy is the
 * plugin's to make, through the port below, and this file is about when the
 * host asks for it: after the file is written and before the action is applied,
 * for every session in a machine however that machine was made, and out again
 * when the session goes.
 *
 * The port records what it was asked, and reads the file at the moment it is
 * asked, which is what makes "after they are written" something a case can see
 * rather than something the order of two calls happens to look like.
 */

import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { createHost } from '../src/host.js';
import { fileSessions } from '../src/sessions.js';
import { echo } from '../../../examples/echo/agent.js';
import type { Agent, Start } from '../src/types/agent.js';
import type { Bag } from '../src/types/common.js';
import type { ComputerPort } from '../src/types/computers.js';
import type { Chosen, MessageAttachment, MessageFrom, Session } from '../src/types/session.js';
import type { Peer } from '../src/types/rpc.js';

/** A PNG's first bytes. Nothing here decodes it, so a header is a picture. */
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489', 'hex');

let made: string[] = [];
afterEach(() => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true });
  made = [];
});

const temp = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'ahpd-machine-attach-'));
  made.push(dir);
  return dir;
};

const settle = async (times = 20): Promise<void> => {
  for (let i = 0; i < times; i++) await new Promise((r) => { setTimeout(r, 0); });
};

const until = async (ready: () => boolean, tries = 400): Promise<void> => {
  for (let i = 0; i < tries && !ready(); i++) await settle(1);
};

/** The one a case waited for, which nothing hands back without one. */
const first = <T>(list: T[]): T => list[0] as T;

/** What one copy was asked, and what the file held when it was asked. */
interface Copy {
  id: string;
  paths: string[];
  /** Each path's bytes at that moment, and nothing where there was no file. */
  hex: (string | undefined)[];
}

/** What the port was asked, and how it answered. */
interface Asked {
  put: Copy[];
  taken: Copy[];
  /** Whether a copy fails, which a machine that is not running makes it. */
  fail?: boolean;
}

const asked = (): Asked => ({ put: [], taken: [] });

const hexOf = (path: string): string | undefined =>
  (existsSync(path) ? readFileSync(path).toString('hex') : undefined);

/**
 * A port whose machines are one id and whose copies are recorded.
 *
 * `how` and `create` are here because a port is one object: a session naming
 * `computer://box` never asks either, since the machine it names already
 * exists.
 */
const port = (said: Asked, order: string[] = []): ComputerPort => ({
  how: async () => undefined,
  putIn: async (id, paths) => {
    order.push('putIn');
    said.put.push({ id, paths: [...paths], hex: paths.map(hexOf) });
    if (said.fail === true) throw new Error('the machine is not running');
  },
  takeOut: async (id, paths) => {
    said.taken.push({ id, paths: [...paths], hex: paths.map(hexOf) });
  },
});

/** The echo backend, saying what each turn was handed. */
const scripted = (said: Bag[], order: string[], dir: string): Agent => {
  const base = echo({ path: dir, pace: 0 });
  return {
    ...base,
    create: (start: Start): Session => {
      const session = base.create(start);
      return {
        ...session,
        begin: (turnId: string, text: string, model?: Chosen, from?: MessageFrom, attachments?: MessageAttachment[]) => {
          order.push('begun');
          said.push({ turnId, text, ...(attachments === undefined ? {} : { attachments }) });
          session.begin(turnId, text, model, from, attachments);
        },
      };
    },
  };
};

const peer = (): Peer => ({ send: () => {}, notify: () => {}, request: async () => ({}), answered: () => {}, close: () => {} });

/**
 * A host with machines, one session and its chat watched.
 *
 * The store keeps files, which is what a session's attachments folder is: a
 * host that keeps none has no folder to write into and nothing to hand over.
 */
async function serving(computers: ComputerPort, order: string[] = [], dir = temp()) {
  const said: Bag[] = [];
  const lines: string[] = [];
  const host = createHost({
    path: dir,
    agents: [scripted(said, order, dir)],
    sessions: fileSessions({ dir }),
    computers,
    onEvent: (line) => { lines.push(line); },
  });
  const client = host.accept(peer());
  await client.handle({
    method: 'initialize',
    params: { clientId: 'window', protocolVersions: ['0.9.0'], initialSubscriptions: ['ahp-root://'] },
  });
  /** Open a session in a machine and answer the chat a client writes into. */
  const open = async (channel: string, computer = 'computer://box'): Promise<string> => {
    await client.handle({ method: 'createSession', params: { channel, provider: 'echo', config: { computer } } });
    const opened = await client.handle({ method: 'subscribe', params: { channel } }) as {
      snapshot: { state: { defaultChat: string } };
    };
    const chatUri = opened.snapshot.state.defaultChat;
    await client.handle({ method: 'subscribe', params: { channel: chatUri } });
    return chatUri;
  };
  const turn = (chatUri: string, action: Bag): Promise<unknown> =>
    client.handle({ method: 'dispatchAction', params: { channel: chatUri, clientSeq: 0, action } });
  return { host, client, dir, lines, said, open, turn };
}

/** A pasted picture, as a client sends it. */
const png = (label = 'pasted.png'): Bag => ({
  type: 'embeddedResource',
  label,
  contentType: 'image/png',
  data: PNG.toString('base64'),
});

const attached = (one: Bag): Bag[] => (one.attachments ?? []) as Bag[];

it('puts the file into the machine after it is written and before the turn', async () => {
  const said = asked();
  const order: string[] = [];
  const { dir, lines, said: turns, open, turn } = await serving(port(said, order), order);
  const chat = await open('echo:/one');
  await turn(chat, { type: 'chat/turnStarted', turnId: 't1', message: { text: 'look', attachments: [png()] } });
  await until(() => said.put.length > 0);

  const copy = first(said.put);
  expect(copy.id).toBe('box');
  expect(copy.paths).toHaveLength(1);
  // The path the message names, which is the one the host wrote the bytes to.
  expect(first(copy.paths)).toMatch(new RegExp(`^${join(dir, 'attachments', 'one')}/.*\\.png$`));
  expect(first(copy.hex)).toBe(PNG.toString('hex'));

  // Written first, then handed over, and only then the turn: a copy asked for
  // before the file was there would hand a machine nothing.
  expect(order).toEqual(['putIn', 'begun']);
  // And nothing was said about it: this host says a line only for a copy it
  // could not make.
  expect(lines.some((one) => one.includes('computers:'))).toBe(false);
  const handed = first(attached(first(turns)));
  expect(handed.uri).toBe(`file://${first(copy.paths)}`);
});

it('puts each session\'s own file into the machine the two share', async () => {
  const said = asked();
  const { dir, said: turns, open, turn } = await serving(port(said));
  const one = await open('echo:/one');
  const two = await open('echo:/two');
  await turn(one, { type: 'chat/turnStarted', turnId: 't1', message: { text: 'mine', attachments: [png('one.png')] } });
  await turn(two, { type: 'chat/turnStarted', turnId: 't2', message: { text: 'yours', attachments: [png('two.png')] } });
  await until(() => said.put.length === 2);

  // Both into the one machine, each at a path under its own session's folder:
  // a machine belongs to no session, so what it is handed is per message.
  expect(said.put.map((one) => one.id)).toEqual(['box', 'box']);
  expect(first(said.put).paths).toContainEqual(expect.stringContaining(join('attachments', 'one')));
  expect(said.put[1]?.paths).toContainEqual(expect.stringContaining(join('attachments', 'two')));
  expect(first(said.put).paths).not.toEqual(said.put[1]?.paths);
  for (const copy of said.put) expect(first(copy.hex)).toBe(PNG.toString('hex'));
  // And each session's turn names the file that is in its own folder.
  expect(String(first(attached(turns[0] as Bag)).uri)).toContain(join('attachments', 'one'));
  expect(String(first(attached(turns[1] as Bag)).uri)).toContain(join('attachments', 'two'));
});

it('says so in a line when a copy fails, and runs the turn anyway', async () => {
  const said = { ...asked(), fail: true };
  const { lines, said: turns, open, turn } = await serving(port(said));
  const chat = await open('echo:/one');
  await turn(chat, { type: 'chat/turnStarted', turnId: 't1', message: { text: 'look', attachments: [png()] } });
  await until(() => said.put.length > 0 && turns.length > 0);

  expect(lines.some((one) => one.includes("computers: putting a message's attachments into box for echo:/one failed: the machine is not running"))).toBe(true);
  // The message is worth sending either way: the file is on this host, and the
  // turn the model runs is the one that was asked for.
  expect(turns).toHaveLength(1);
  expect(String(first(attached(first(turns))).uri)).toMatch(/^file:\/\/.*\.png$/);
});

it('takes a gone session\'s folder back out of its machine', async () => {
  const said = asked();
  const { dir, client, open, turn } = await serving(port(said));
  const chat = await open('echo:/one');
  await turn(chat, { type: 'chat/turnStarted', turnId: 't1', message: { text: 'look', attachments: [png()] } });
  await until(() => said.put.length > 0);

  await client.handle({ method: 'disposeSession', params: { channel: 'echo:/one' } });
  await settle();
  /*
   * The folder the host keeps for that one session, named as the store names
   * it. Only the path crosses: the machine holds its own copy of every file
   * under it, so the host's own folder having gone by the time the port is
   * asked is not a thing the machine notices.
   */
  expect(said.taken.map((one) => ({ id: one.id, paths: one.paths }))).toEqual([
    { id: 'box', paths: [join(dir, 'attachments', 'one')] },
  ]);
  // And the host's own copy goes with the session, as it did before this.
  expect(existsSync(join(dir, 'attachments', 'one'))).toBe(false);
});

it('hands nothing over for a session in no machine', async () => {
  const said = asked();
  const { open, turn, said: turns } = await serving(port(said));
  const chat = await open('echo:/one', '');
  await turn(chat, { type: 'chat/turnStarted', turnId: 't1', message: { text: 'look', attachments: [png()] } });
  await until(() => turns.length > 0);

  // Nothing entered, so nothing is copied anywhere - and the file is written
  // all the same, because that part is the store's and not a machine's.
  expect(said.put).toEqual([]);
  expect(String(first(attached(first(turns))).uri)).toMatch(/^file:\/\/.*\.png$/);
});
