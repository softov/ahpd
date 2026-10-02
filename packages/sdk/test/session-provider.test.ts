import { expect, describe, it } from 'vitest';
import { createHost, ROOT } from '../src/host.js';
import { echo } from '../../../examples/echo/agent.js';
import { idOf } from '../src/catalog.js';
import { memorySessions } from '../src/sessions.js';
import type { Agent, Start } from '../src/types/agent.js';
import type { Peer } from '../src/types/rpc.js';
import type { SessionStore } from '../src/types/sessions.js';

/*
 * Which harness a session runs on.
 *
 * Two harnesses can read the same transcripts, so the id alone does not say
 * whose a row is or which endpoint resumes it. A transcript never says either
 * - the host picks the agent when a session is created, resumed or forked, and
 * that is the one moment it knows.
 *
 * The backend here names its own ids, which is the half a real harness gets
 * right and the example does not: the id the host chose and the id the
 * transcript is written under are one name for a created session and two for a
 * fork.
 */

const DIR = '/tmp/ahpd-provider';

const peer = (): Peer => ({
  send: () => {}, notify: () => {}, request: async () => ({}), answered: () => {}, close: () => {},
});

const settle = async (times = 40): Promise<void> => {
  for (let i = 0; i < times; i++) await new Promise((r) => { setTimeout(r, 0); });
};

/**
 * The example backend, under an id of its own choosing.
 *
 * A created session keeps the id the host gave it, because that is what a
 * Claude harness does with a UUID; a fork is written under a fresh transcript
 * id, which is the one no store would have a name for otherwise.
 */
function backend(provider = 'echo'): Agent {
  const base = echo({ path: DIR, pace: 0 });
  return {
    ...base,
    provider,
    chats: { ...base.chats, fork: true },
    create: (start: Start) => {
      const session = base.create(start);
      return {
        ...session,
        agentId: () => (start.forkAt !== undefined ? `forked-${idOf(start.chatUri)}` : `own-${idOf(start.uri)}`),
        forkPoint: () => 'the-prompt',
      };
    },
  };
}

/**
 * The example backend, under an id it names only once it has spoken.
 *
 * A real harness writes its transcript under an id it chooses while it streams
 * its first answer, not one it was handed, so a fork and a session the host
 * named itself have no id of their own until a turn has ended.
 */
function late(provider = 'echo'): Agent {
  const base = echo({ path: DIR, pace: 0 });
  return {
    ...base,
    provider,
    chats: { ...base.chats, fork: true },
    create: (start: Start) => {
      const session = base.create(start);
      const named = start.forkAt !== undefined ? `forked-${idOf(start.chatUri)}` : `own-${idOf(start.uri)}`;
      return {
        ...session,
        agentId: () => (session.allTurns().length === 0 ? undefined : named),
        forkPoint: () => 'the-prompt',
      };
    },
  };
}

const uri = 'ahp-session:/made';
const chatUri = 'ahp-chat:/made';

/** A host on one store, with the backend behind it. */
function serving(store: SessionStore, agents: Agent[]) {
  const host = createHost({ path: DIR, agents, sessions: store });
  const client = host.accept(peer());
  void (async () => {
    await client.handle({
      method: 'initialize',
      params: { clientId: 'probe', protocolVersions: ['0.9.0'], initialSubscriptions: [ROOT] },
    });
  })();
  return { host, client };
}

/** Say something to a chat, and wait for the turn to be over. */
async function talk(client: ReturnType<typeof serving>['client'], channel: string, turnId: string): Promise<void> {
  client.handle({
    method: 'dispatchAction',
    params: { channel, action: { type: 'chat/turnStarted', turnId, message: { text: 'hi' } } },
  });
  await settle();
}

/** The store, with a record of every provider row written to it. */
function counting(): SessionStore & { writes: string[] } {
  const store = memorySessions();
  const writes: string[] = [];
  return {
    ...store,
    writes,
    setProvider: (id, value) => {
      writes.push(id);
      store.setProvider(id, value);
    },
  };
}

it('records the harness a session was created on, under both ids it answers to', async () => {
  const store = memorySessions();
  const { client } = serving(store, [backend()]);
  await settle();
  await client.handle({ method: 'createSession', params: { channel: uri, provider: 'echo' } });

  expect(store.provider('made')).toBe('echo');
  // The transcript is written under the id the backend chose, and that is the
  // one a catalogue of files will list.
  expect(store.provider('own-made')).toBe('echo');
  expect(store.provider('never-started')).toBeUndefined();
});

it('records nothing for a session refused before it runs', async () => {
  const store = memorySessions();
  const { client } = serving(store, [backend()]);
  await settle();
  await expect(client.handle({ method: 'createSession', params: { channel: uri, provider: 'nothing' } }))
    .rejects.toMatchObject({ code: -32002 });
  expect(store.provider('made')).toBeUndefined();
});

it('records the harness a session is resumed on after a restart', async () => {
  const store = memorySessions();
  const agent = backend();
  // A host that ran the session to the end and stopped, which is what leaves
  // a row in the backend's catalogue and nothing in the store.
  const first = serving(store, [agent]);
  await settle();
  await first.client.handle({ method: 'createSession', params: { channel: uri, provider: 'echo' } });
  first.client.handle({
    method: 'dispatchAction',
    params: { channel: chatUri, action: { type: 'chat/turnStarted', turnId: 't1', message: { text: 'hi' } } },
  });
  await settle();
  await first.client.handle({ method: 'disposeSession', params: { channel: uri } });
  await settle();
  expect(store.provider('made')).toBeUndefined();

  // A daemon that came back, asked to say the first thing about a row it has
  // never listed: the catalogue is what teaches it whose the row is, and the
  // turn is what starts it.
  const second = serving(store, [agent]);
  await settle();
  await second.client.handle({ method: 'listSessions', params: { channel: ROOT } });
  second.client.handle({
    method: 'dispatchAction',
    params: { channel: 'ahp-chat:/made', action: { type: 'chat/turnStarted', turnId: 't2', message: { text: 'again' } } },
  });
  await settle();
  expect(store.provider('made')).toBe('echo');
  // The id the transcript is written under is the one the turn resumed from.
  expect(store.provider('own-made')).toBe('echo');
});

it('records the harness a fork was cut on, under the id the new transcript is written under', async () => {
  const store = memorySessions();
  const { client } = serving(store, [backend()]);
  await settle();
  await client.handle({ method: 'createSession', params: { channel: uri, provider: 'echo' } });
  client.handle({
    method: 'dispatchAction',
    params: { channel: chatUri, action: { type: 'chat/turnStarted', turnId: 't1', message: { text: 'hi' } } },
  });
  await settle();
  await client.handle({
    method: 'createChat',
    params: { channel: uri, chat: 'ahp-chat:/copy', source: { kind: 'fork', chat: chatUri, turnId: 't1' } },
  });
  await settle();
  await talk(client, 'ahp-chat:/copy', 't2');

  // A fork is a second transcript under an id nobody chose, and the harness it
  // was cut on is the only thing that says where opening it resumes.
  expect(store.provider('forked-copy')).toBe('echo');
});

it('records a fork under its own id once the first turn that names it ends', async () => {
  const store = memorySessions();
  const { client } = serving(store, [late()]);
  await settle();
  await client.handle({ method: 'createSession', params: { channel: uri, provider: 'echo' } });
  await talk(client, chatUri, 't1');
  await client.handle({
    method: 'createChat',
    params: { channel: uri, chat: 'ahp-chat:/copy', source: { kind: 'fork', chat: chatUri, turnId: 't1' } },
  });
  await settle();

  // Nothing has been said on the fork yet, so the backend has not said what its
  // transcript is called either - and an id guessed now would be a guess.
  expect(store.provider('forked-copy')).toBeUndefined();

  await talk(client, 'ahp-chat:/copy', 't2');
  expect(store.provider('forked-copy')).toBe('echo');
});

it('records a session the host named itself under the id its backend picks', async () => {
  const store = memorySessions();
  const { client } = serving(store, [late()]);
  await settle();
  await client.handle({ method: 'createSession', params: { channel: 'ahp-session:/plain', provider: 'echo' } });
  await settle();

  // The session is on the harness from the moment it starts; the transcript it
  // writes is not under an id anybody chose yet.
  expect(store.provider('plain')).toBe('echo');
  expect(store.provider('own-plain')).toBeUndefined();

  await talk(client, 'ahp-chat:/plain', 't1');
  expect(store.provider('own-plain')).toBe('echo');
});

it('records the transcript id once, and writes nothing on the turns after', async () => {
  const store = counting();
  const { client } = serving(store, [late()]);
  await settle();
  await client.handle({ method: 'createSession', params: { channel: 'ahp-session:/plain', provider: 'echo' } });
  await settle();
  await talk(client, 'ahp-chat:/plain', 't1');
  expect(store.writes).toEqual(['plain', 'own-plain']);

  // Every turn ends the same way, and the answer does not change: a store
  // rewritten per turn is a store being written to for nothing.
  await talk(client, 'ahp-chat:/plain', 't2');
  expect(store.writes).toEqual(['plain', 'own-plain']);
});

it('keeps the harness a session runs on through a change of directory', async () => {
  const store = memorySessions();
  const { client } = serving(store, [backend()]);
  await settle();
  await client.handle({ method: 'createSession', params: { channel: uri, provider: 'echo' } });
  await client.handle({
    method: 'dispatchAction',
    params: { channel: chatUri, action: { type: 'chat/turnStarted', turnId: 't1', message: { text: 'hi' } } },
  });
  await settle();
  await client.handle({ method: 'createChat', params: { channel: uri, chat: 'ahp-chat:/second' } });
  await settle();

  // An ordinary second chat is not a fork and records nothing of its own: it
  // is a chat in a session that already says which harness it runs on.
  expect(store.provider('own-second')).toBeUndefined();
  expect(store.provider('made')).toBe('echo');
});

it('names the harness each of two backends a session runs on', async () => {
  const store = memorySessions();
  const { client } = serving(store, [backend('one'), backend('two')]);
  await settle();
  await client.handle({ method: 'createSession', params: { channel: uri, provider: 'two' } });
  expect(store.provider('made')).toBe('two');
});

/*
 * One catalogue, two harnesses reading it.
 *
 * Two Claude harnesses read the same transcripts, so every session is one row
 * per harness. Which of them owns a row is not in the transcript: the host
 * recorded it when the session ran, and the row is given to that harness when
 * it is loaded.
 */

const STAMP = new Date(0).toISOString();

/** A backend over a fixed catalogue, with a record of what it was asked to start. */
function harness(provider: string, ids: string[], started: string[]): Agent {
  const base = echo({ path: DIR, pace: 0 });
  return {
    ...base,
    provider,
    list: async () => ids.map((id) => ({
      id,
      title: `${id} as ${provider}`,
      createdAt: STAMP,
      modifiedAt: STAMP,
      workingDirectories: [`file://${DIR}`],
    })),
    // A past session's turns, so a row this host has not run is openable.
    transcript: async () => [],
    create: (start: Start) => {
      started.push(start.resume ?? idOf(start.uri));
      return base.create(start);
    },
  };
}

/** The catalogue a client was handed, as the resources it names them by. */
async function catalogue(client: ReturnType<typeof serving>['client']): Promise<string[]> {
  const listed = await client.handle({ method: 'listSessions', params: { channel: ROOT } }) as {
    items: { resource: string }[];
  };
  return listed.items.map((one) => one.resource);
}

describe('a row two harnesses both list', () => {
  it('is listed once', async () => {
    const one: string[] = [];
    const two: string[] = [];
    const store = memorySessions();
    const { client } = serving(store, [
      harness('one', ['shared', 'mine'], one),
      harness('two', ['shared', 'mine'], two),
    ]);
    await settle();
    expect(await catalogue(client)).toEqual(['one:/shared', 'one:/mine']);
  });

  it('goes to the harness the host recorded, whichever one loaded first', async () => {
    for (const order of [['one', 'two'], ['two', 'one']]) {
      const store = memorySessions();
      store.setProvider('shared', 'two');
      const one: string[] = [];
      const two: string[] = [];
      const { client } = serving(store, [
        harness('one', ['shared'], one),
        harness('two', ['shared'], two),
      ]);
      await settle();
      // The row is one conversation, and it is `two`'s because that is where
      // it ran - not because that is where the answer came from first.
      expect(await catalogue(client)).toEqual(['two:/shared']);
    }
  });

  it('goes to the first harness that lists it when nothing was recorded', async () => {
    const one: string[] = [];
    const two: string[] = [];
    const store = memorySessions();
    const { client } = serving(store, [
      harness('one', ['unrecorded'], one),
      harness('two', ['unrecorded'], two),
    ]);
    await settle();
    // A session from before this was recorded, and one whose harness is gone,
    // both open somewhere rather than nowhere.
    expect(await catalogue(client)).toEqual(['one:/unrecorded']);
  });

  it('goes to the first harness that lists it when the recorded one is not loaded', async () => {
    const one: string[] = [];
    const two: string[] = [];
    const store = memorySessions();
    store.setProvider('shared', 'gone');
    const { client } = serving(store, [
      harness('one', ['shared'], one),
      harness('two', ['shared'], two),
    ]);
    await settle();
    expect(await catalogue(client)).toEqual(['one:/shared']);
  });

  it('leaves a row only one harness lists alone', async () => {
    const one: string[] = [];
    const two: string[] = [];
    const store = memorySessions();
    const { client } = serving(store, [
      harness('one', ['only-mine'], one),
      harness('two', ['only-theirs'], two),
    ]);
    await settle();
    expect(await catalogue(client)).toEqual(['one:/only-mine', 'two:/only-theirs']);
  });

  it('resumes on the harness the row was kept for', async () => {
    const one: string[] = [];
    const two: string[] = [];
    const store = memorySessions();
    store.setProvider('shared', 'two');
    const { client } = serving(store, [
      harness('one', ['shared'], one),
      harness('two', ['shared'], two),
    ]);
    await settle();
    await catalogue(client);

    client.handle({
      method: 'dispatchAction',
      params: { channel: 'ahp-chat:/shared', action: { type: 'chat/turnStarted', turnId: 't1', message: { text: 'go' } } },
    });
    await settle();

    // Opening a row asks the backend it was kept for, which is the whole
    // point of keeping it: the other harness would resume it on another
    // endpoint, and under another key.
    expect(two).toEqual(['shared']);
    expect(one).toEqual([]);
  });
});
