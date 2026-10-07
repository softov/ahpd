/*
 * A message's attachments, as files this host wrote.
 *
 * A client pastes a picture and sends it with the message, and every backend
 * downstream would otherwise have to carry the bytes: the chat state holds
 * them, the transcript holds them, and a session reopened a week later reads
 * them back out of a file written for a message that has long finished. The
 * host writes them once, before the action is applied, and what travels from
 * there is a path - decision
 * `an-attachments-bytes-are-written-to-disk-and-the-message-names-the-file`.
 *
 * What is asserted is the message the backend was handed, because that is the
 * whole of what "applied" means here: the state a client reads is the
 * backend's own, built out of what `begin` was given. The scripted session
 * below is the stand-in for a real one and reports the attachments it was
 * handed alongside the turn, which is what a backend that keeps a chip in its
 * state does.
 */

import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { createHost } from '../src/host.js';
import { fileSessions, memorySessions } from '../src/sessions.js';
import { echo } from '../../../examples/echo/agent.js';
import type { Agent, Start } from '../src/types/agent.js';
import type { Bag } from '../src/types/common.js';
import type { Chosen, MessageAttachment, MessageFrom, Session } from '../src/types/session.js';
import type { Peer } from '../src/types/rpc.js';

/** The key the reference client looks for, and the shape it reads. */
const TAG = 'vscode.agentHost.snapshotAttachment';

/** A PNG's first bytes. Nothing here decodes it, so a header is a picture. */
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489', 'hex');

let made: string[] = [];
afterEach(() => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true });
  made = [];
});

const temp = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'ahpd-attach-'));
  made.push(dir);
  return dir;
};

/** A client that answers the one question the host asks it about a file. */
function peer(): Peer & { notes: Bag[]; asked: { method: string; params: Bag }[] } {
  const notes: Bag[] = [];
  const asked: { method: string; params: Bag }[] = [];
  return {
    notes,
    asked,
    send: () => {},
    notify: (method, params) => { notes.push({ method, params }); },
    request: async (method, params) => {
      asked.push({ method, params: params as Bag });
      return { data: PNG.toString('base64'), encoding: 'base64' };
    },
    answered: () => {},
    close: () => {},
  };
}

const settle = async (times = 8): Promise<void> => {
  for (let i = 0; i < times; i++) await new Promise((r) => { setTimeout(r, 0); });
};

const until = async (ready: () => boolean, tries = 200): Promise<void> => {
  for (let i = 0; i < tries && !ready(); i++) await settle(1);
};

/** What the scripted session was handed, kept so a case can read it. */
interface Said {
  begun: { turnId: string; text: string; attachments?: unknown[] }[];
  queued: { id: string; text: string; attachments?: unknown[] }[];
  steered: { id: string; text: string; attachments?: unknown[] }[];
  handed: Map<string, MessageAttachment[] | undefined>;
}

const saidNothing = (): Said => ({ begun: [], queued: [], steered: [], handed: new Map() });

/** The one a case waited for, which nothing hands back without one. */
const first = <T>(list: T[]): T => list[0] as T;

/**
 * The echo backend, saying what it was handed.
 *
 * Every method the host reaches a message by is recorded, and the attachments
 * are reported back in the chat state beside the turn they belong to. A
 * backend that dropped them would leave a client with the message and no
 * picture, which is the thing this is here to make impossible.
 */
const scripted = (dir: string, said: Said, pace = 0): Agent => {
  const base = echo({ path: dir, pace });
  return {
    ...base,
    create: (start: Start): Session => {
      const session = base.create(start);
      const kept = (one: Bag): Bag => {
        const mine = said.handed.get(String(one.id));
        if (mine === undefined) return one;
        return { ...one, message: { ...(one.message as Bag), attachments: mine } };
      };
      return {
        ...session,
        begin: (turnId: string, text: string, model?: Chosen, from?: MessageFrom, attachments?: MessageAttachment[]) => {
          said.begun.push({ turnId, text, ...(attachments === undefined ? {} : { attachments }) });
          said.handed.set(turnId, attachments);
          session.begin(turnId, text, model, from, attachments);
        },
        queue: (id: string, text: string, model?: Chosen, from?: MessageFrom, attachments?: MessageAttachment[]) => {
          said.queued.push({ id, text, ...(attachments === undefined ? {} : { attachments }) });
          said.handed.set(id, attachments);
          session.queue(id, text, model, from, attachments);
        },
        // The one backend method that is optional, and this is a session that
        // has it: a message mid-turn is the case task 02 is about. Answered
        // the way a real one does - a message with nothing running to take it
        // is not taken - which is also what makes the order two dispatches
        // were applied in something a case can see.
        steer: (id: string, text: string, attachments?: MessageAttachment[]) => {
          if ((session.chatState() as Bag).activeTurn === undefined) return false;
          said.steered.push({ id, text, ...(attachments === undefined ? {} : { attachments }) });
          return session.steer?.(id, text, attachments) ?? true;
        },
        chatState: () => {
          const state = session.chatState() as Bag;
          return {
            ...state,
            turns: (state.turns as Bag[]).map(kept),
            ...(state.activeTurn === undefined ? {} : { activeTurn: kept(state.activeTurn as Bag) }),
          };
        },
      };
    },
  };
};

/** One client, one session, watching both its channels. */
async function serving(said: Said, dir = temp(), store = true, pace = 0) {
  const sessions = store ? fileSessions({ dir }) : memorySessions();
  const host = createHost({ path: dir, agents: [scripted(dir, said, pace)], sessions });
  const p = peer();
  const client = host.accept(p);
  await client.handle({
    method: 'initialize',
    params: { clientId: 'window', protocolVersions: ['0.9.0'], initialSubscriptions: ['ahp-root://'] },
  });
  await client.handle({ method: 'createSession', params: { channel: 'ahp-session:/one', provider: 'echo' } });
  const opened = await client.handle({ method: 'subscribe', params: { channel: 'ahp-session:/one' } }) as {
    snapshot: { state: { defaultChat: string } };
  };
  const chatUri = opened.snapshot.state.defaultChat;
  await client.handle({ method: 'subscribe', params: { channel: chatUri } });
  const turn = (action: Bag, clientSeq = 0): Promise<unknown> =>
    client.handle({ method: 'dispatchAction', params: { channel: chatUri, clientSeq, action } });
  const state = async (): Promise<Bag> =>
    ((await client.handle({ method: 'subscribe', params: { channel: chatUri } })) as { snapshot: { state: Bag } }).snapshot.state;
  return { host, client, peer: p, chatUri, dir, turn, state };
}

/** Every file written under the one session's folder, by name. */
const written = (dir: string): { folder: string; names: string[] } => {
  const folder = join(dir, 'attachments');
  const session = first(readdirSync(folder));
  return { folder: join(folder, session), names: readdirSync(join(folder, session)) };
};

/** The attachments of what a case recorded, as the wire's own shape. */
const sent = (one: { attachments?: unknown[] }): Bag[] => (one.attachments ?? []) as Bag[];

const png = (label = 'pasted.png'): Bag => ({
  type: 'embeddedResource',
  label,
  contentType: 'image/png',
  data: PNG.toString('base64'),
});

it('writes an embedded image to a file the message names', async () => {
  const said = saidNothing();
  const { dir, turn, state } = await serving(said);
  await turn({ type: 'chat/turnStarted', turnId: 't1', message: { text: 'what is this', attachments: [png()] } });
  await until(() => said.begun.length > 0);

  const { folder, names } = written(dir);
  expect(names).toHaveLength(1);
  expect(first(names)).toMatch(/\.png$/);
  const file = join(folder, first(names));
  expect(readFileSync(file)).toEqual(PNG);
  // Read-only, because nobody edits what somebody pasted.
  expect(statSync(file).mode & 0o777).toBe(0o400);

  const attachment = first(sent(first(said.begun)));
  expect(attachment.type).toBe('resource');
  expect(attachment.uri).toBe(`file://${file}`);
  expect(attachment.label).toBe('pasted.png');
  expect(attachment.contentType).toBe('image/png');
  expect((attachment._meta as Bag)[TAG]).toEqual({ isSnapshot: true, contentType: 'image/png' });
  // The bytes are gone from the message: what travels is the path.
  expect('data' in attachment).toBe(false);

  // And the turn a client reads carries the same resource, which is the chip.
  const chat = await state();
  const turns = [...(chat.turns as Bag[]), ...(chat.activeTurn === undefined ? [] : [chat.activeTurn as Bag])];
  const turnWith = turns.find((one) => (one.message as Bag).attachments !== undefined) as Bag;
  const seen = first((turnWith.message as Bag).attachments as Bag[]);
  expect(seen.uri).toBe(`file://${file}`);
  expect((seen._meta as Bag)[TAG]).toEqual({ isSnapshot: true, contentType: 'image/png' });
});

it('writes each attachment of a message to its own file', async () => {
  const said = saidNothing();
  const { dir, turn } = await serving(said);
  await turn({
    type: 'chat/turnStarted',
    turnId: 't1',
    message: {
      text: 'look',
      attachments: [
        png(),
        { type: 'embeddedResource', label: 'notes.txt', contentType: 'text/plain', data: Buffer.from('hello\n').toString('base64') },
      ],
    },
  });
  await until(() => said.begun.length > 0);

  const { folder, names } = written(dir);
  expect(names).toHaveLength(2);
  expect(names.some((one) => one.endsWith('.png'))).toBe(true);
  const text = names.find((one) => one.endsWith('.txt')) as string;
  expect(readFileSync(join(folder, text), 'utf8')).toBe('hello\n');
  const handed = sent(first(said.begun));
  const image = handed.find((one) => String(one.uri).endsWith('.png')) as Bag;
  const note = handed.find((one) => String(one.uri).endsWith('.txt')) as Bag;
  expect(image.uri).toBe(`file://${join(folder, names.find((one) => one.endsWith('.png')) as string)}`);
  expect(note.uri).toBe(`file://${join(folder, text)}`);
});

it('names the file inside the folder whatever the label says', async () => {
  const said = saidNothing();
  const { dir, turn } = await serving(said);
  await turn({
    type: 'chat/turnStarted',
    turnId: 't1',
    message: { text: 'here', attachments: [png('../../outside.png')] },
  });
  await until(() => said.begun.length > 0);

  const { names } = written(dir);
  expect(names).toHaveLength(1);
  // The label's basename, inside the folder: no path from the client is one.
  expect(first(names)).toMatch(/-outside\.png$/);
  expect(readdirSync(join(dir, 'attachments'))).toHaveLength(1);
});

it('reads a file only the client has, and leaves one this host has as it came', async () => {
  const said = saidNothing();
  const { dir, turn, peer: p } = await serving(said);
  const here = join(dir, 'mine.png');
  writeFileSync(here, PNG);
  await turn({
    type: 'chat/turnStarted',
    turnId: 't1',
    message: {
      text: 'these',
      attachments: [
        { type: 'resource', label: 'elsewhere.png', uri: 'file:///nowhere/elsewhere.png', contentType: 'image/png' },
        { type: 'resource', label: 'mine.png', uri: `file://${here}`, contentType: 'image/png' },
      ],
    },
  });
  await until(() => said.begun.length > 0);

  // The client was asked for the one it alone has, and only that one.
  expect(p.asked).toEqual([
    { method: 'resourceRead', params: { channel: 'ahp-root://', uri: 'file:///nowhere/elsewhere.png' } },
  ]);
  const { folder, names } = written(dir);
  expect(names).toHaveLength(1);
  expect(readFileSync(join(folder, first(names)))).toEqual(PNG);
  const handed = sent(first(said.begun));
  const elsewhere = handed.find((one) => one.label === 'elsewhere.png') as Bag;
  const mine = handed.find((one) => one.label === 'mine.png') as Bag;
  expect(elsewhere.uri).toBe(`file://${join(folder, first(names))}`);
  expect((elsewhere._meta as Bag)[TAG]).toEqual({ isSnapshot: true, contentType: 'image/png' });
  // A file this host already holds is the user's own and is left where it is.
  expect(mine).toEqual({ type: 'resource', label: 'mine.png', uri: `file://${here}`, contentType: 'image/png' });
});

it('asks no client for a file above the size it will fetch', async () => {
  const said = saidNothing();
  const { turn, peer: p } = await serving(said);
  const huge = {
    type: 'resource', label: 'huge.bin', uri: 'file:///nowhere/huge.bin',
    contentType: 'application/octet-stream', sizeHint: 33 * 1024 * 1024,
  };
  await turn({ type: 'chat/turnStarted', turnId: 't1', message: { text: 'huge', attachments: [huge] } });
  await until(() => said.begun.length > 0);
  expect(p.asked).toEqual([]);
  // Nothing was written, so nothing about it changed.
  expect(sent(first(said.begun))).toEqual([huge]);
});

it('leaves every attachment as it was sent when the store keeps no files', async () => {
  const said = saidNothing();
  const { dir, turn } = await serving(said, temp(), false);
  await turn({ type: 'chat/turnStarted', turnId: 't1', message: { text: 'hi', attachments: [png()] } });
  await until(() => said.begun.length > 0);
  expect(sent(first(said.begun))).toEqual([png()]);
  expect(() => readdirSync(join(dir, 'attachments'))).toThrow();
});

it('removes the folder with its session', async () => {
  const said = saidNothing();
  const { dir, turn, client } = await serving(said);
  await turn({ type: 'chat/turnStarted', turnId: 't1', message: { text: 'hi', attachments: [png()] } });
  await until(() => said.begun.length > 0);
  const session = first(readdirSync(join(dir, 'attachments')));
  expect(readdirSync(join(dir, 'attachments', session))).toHaveLength(1);

  await client.handle({ method: 'disposeSession', params: { channel: 'ahp-session:/one' } });
  await settle();
  // The session's own folder goes; the one its sessions share stays.
  expect(readdirSync(join(dir, 'attachments'))).toEqual([]);
});

it('hands a queued and a steering message their attachments', async () => {
  const said = saidNothing();
  // A turn over more than one tick, because a message mid-turn needs one
  // running to be taken and a queued one needs one to queue behind.
  const { dir, turn } = await serving(said, temp(), true, 60);
  await turn({ type: 'chat/turnStarted', turnId: 't0', message: { text: 'go' } });
  await until(() => said.begun.length > 0);
  // One queued and one steering, each with a picture of its own.
  await turn({
    type: 'chat/pendingMessageSet',
    id: 'q1',
    kind: 'queued',
    message: { text: 'later', attachments: [png('later.png')] },
  });
  await turn({
    type: 'chat/pendingMessageSet',
    id: 's1',
    kind: 'steering',
    message: { text: 'stop', attachments: [png('now.png')] },
  });
  await until(() => said.queued.length > 0 && said.steered.length > 0);

  const { folder, names } = written(dir);
  expect(names).toHaveLength(2);
  const queued = first(sent(first(said.queued)));
  const steered = first(sent(first(said.steered)));
  // Both are files inside the session's own folder, which is the whole of it.
  expect(names.map((one) => `file://${join(folder, one)}`).sort())
    .toEqual([String(queued.uri), String(steered.uri)].sort());
  expect((queued._meta as Bag)[TAG]).toEqual({ isSnapshot: true, contentType: 'image/png' });
  expect((steered._meta as Bag)[TAG]).toEqual({ isSnapshot: true, contentType: 'image/png' });
});

it('applies a message with attachments before what the client sent behind it', async () => {
  const said = saidNothing();
  const { turn, peer: p } = await serving(said, temp(), true, 60);
  // Sent without waiting in between, which is how a composer sends a message
  // and how a client corrects one - and neither is awaited, because the wait
  // is the thing being asked about.
  void turn({ type: 'chat/turnStarted', turnId: 't1', message: { text: 'look', attachments: [png()] } }, 7);
  void turn({
    type: 'chat/pendingMessageSet',
    id: 's1',
    kind: 'steering',
    message: { text: 'stop', attachments: [png('now.png')] },
  });
  await until(() => said.steered.length > 0);

  // Taken, which it could not be if the steering had been applied while the
  // turn ahead of it was still waiting on a file to be written.
  expect(said.begun).toHaveLength(1);
  expect(said.steered).toHaveLength(1);
  // And the turn is this client's own dispatch, carrying the number it sent,
  // so a client can tell its own write from somebody else's - the settled
  // action is applied as the dispatch it came in as, not beside it.
  const echoed = p.notes
    .map((note) => note.params as Bag)
    .filter((one) => (one.action as Bag | undefined)?.type === 'chat/turnStarted');
  expect((first(echoed).origin as Bag).clientSeq).toBe(7);
});
