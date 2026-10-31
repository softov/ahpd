import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Status } from '../src/sessions/catalog.js';
import { fileSessions, memorySessions } from '../src/sessions/sessions.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  resetSdk, actions, claude, createHost, echo, emit, hello, hostTools, machine, open, peer,
 sdk, serving, sessionQueries, settle, running,
} from './support/host.js';
import type { Agent, Listed, Start } from '../src/types/agent.js';
import type { HostTool } from '../src/types/host.js';
import type { Principal } from '../src/types/users.js';

vi.mock('@anthropic-ai/claude-agent-sdk', async () => (await import('./support/claude-sdk.js')).fake);

beforeEach(resetSdk);

/** The catalogue as one person reads it, which is the only filter it takes. */
const MINE = 'ahp-automations://?owner=me';

/** One person, with nothing to check against: a filter reads the id alone. */
const person = (id: string): Principal => ({ id, roles: [], can: () => true, memberships: [], teams: [] });

const AUTOMATION_DEFINITION = {
  title: 'Nightly',
  enabled: true,
  message: { text: 'review what changed today' },
  session: { provider: 'echo', workingDirectories: ['file:///tmp'] },
  triggers: [],
};

/**
 * A host whose catalogue has one automation each for ana and ben, with both
 * of them subscribed to the filtered catalogue.
 */
async function twoAutomationOwners() {
  const { memoryAutomations } = await import('../src/automations/automations.js');
  const store = memoryAutomations();
  store.create('ahp-automation:/ana-nightly', AUTOMATION_DEFINITION, 'user:ana');
  store.create('ahp-automation:/ben-nightly', AUTOMATION_DEFINITION, 'user:ben');
  const host = createHost({
    path: '/home/softov',
    agents: [claude({ paths: ['/home/softov'] })],
    automations: store,
  });
  const anaPeer = peer();
  const benPeer = peer();
  const ana = host.accept(anaPeer, person('ana'));
  const ben = host.accept(benPeer, person('ben'));
  await ana.handle(hello(['0.9.0'], { clientId: 'ana' }));
  await ben.handle(hello(['0.9.0'], { clientId: 'ben' }));
  await ana.handle({ method: 'subscribe', params: { channel: MINE } });
  await ben.handle({ method: 'subscribe', params: { channel: MINE } });
  return { store, ana, ben, anaPeer, benPeer };
}

/** The catalogue as a snapshot answers it. */
type Catalogue = { snapshot: { state: { entries: { resource: string }[] } } };

describe('what it says it is doing', () => {
  it('names the tool, and stops naming it when the turn ends', async () => {
    const { client, peer: p, uri, chatUri } = await running();
    client.handle({
      method: 'dispatchAction',
      params: { channel: chatUri, action: { type: 'chat/turnStarted', turnId: 't1', message: { text: 'go' } } },
    });
    await settle();
    await emit({
      type: 'assistant',
      message: { id: 'm1', content: [{ type: 'tool_use', id: 'toolu_1', name: 'Bash', input: { command: 'ls -la' } }] },
    });

    // On the session channel, because that is where a catalogue row and a
    // detail pane read it - the protocol has a session mirror its chat's.
    const said = actions(p, uri)
      .filter((e) => e.action.type === 'session/activityChanged')
      .map((e) => e.action.activity);
    expect(said).toContain('Bash ls -la');

    const listed = await client.handle({ method: 'listSessions', params: { channel: 'ahp-root://' } }) as {
      items: { activity?: string }[];
    };
    expect(listed.items[0]?.activity).toBe('Bash ls -la');

    await emit({ type: 'result', subtype: 'success', duration_ms: 5 });
    // Cleared, not left saying the last thing it did.
    expect(actions(p, uri).filter((e) => e.action.type === 'session/activityChanged').at(-1)?.action.activity)
      .toBeUndefined();
    // And cleared on the catalogue row, which takes a `null` for it: a
    // partial is spread over the row the client holds, so a key left off is
    // a field that did not move, and the reference client's row went on
    // saying `Bash ls -la` until something else about the session changed.
    const moved = p.notes
      .filter((n) => n.method === 'root/sessionSummaryChanged')
      .map((n) => (n.params as { changes: Record<string, unknown> }).changes);
    expect(moved.some((one) => one.activity === 'Bash ls -la')).toBe(true);
    expect(moved.at(-1)).toHaveProperty('activity', null);
  });

  it('says the title once it has one', async () => {
    const { client, peer: p, uri, chatUri } = await running();
    client.handle({
      method: 'dispatchAction',
      params: { channel: chatUri, action: { type: 'chat/turnStarted', turnId: 't1', message: { text: 'a question about paging' } } },
    });
    await settle();
    // The catalogue learned it; a client with the session already open holds
    // whatever it was called when it opened it, which was "New session".
    const retitled = actions(p, uri).find((e) => e.action.type === 'session/titleChanged');
    expect(retitled?.action.title).toBe('a question about paging');
  });

  it('takes a title from a client, for the row or for one chat, and refuses a blank one', async () => {
    const { client, peer: p, uri, chatUri } = await running();
    await client.handle({ method: 'subscribe', params: { channel: 'ahp-root://' } });
    client.handle({ method: 'dispatchAction', params: { channel: uri, action: { type: 'session/titleChanged', title: 'Paging' } } });
    await settle();
    expect(actions(p, uri).find((e) => e.action.type === 'session/titleChanged')?.action.title).toBe('Paging');
    const row = p.notes.filter((n) => n.method === 'root/sessionSummaryChanged').at(-1);
    expect((row?.params as { changes: { title?: string } }).changes.title).toBe('Paging');
    // On a chat channel it names the chat; the default chat is the session,
    // so it is said as the session's.
    client.handle({ method: 'dispatchAction', params: { channel: chatUri, action: { type: 'session/titleChanged', title: 'Paging, again' } } });
    await settle();
    expect(actions(p, uri).filter((e) => e.action.type === 'session/titleChanged').at(-1)?.action.title).toBe('Paging, again');
    client.handle({ method: 'dispatchAction', params: { channel: uri, action: { type: 'session/titleChanged', title: '  ' } } });
    await settle();
    expect(actions(p, uri).find((e) => e.rejectionReason?.includes('blank'))).toBeDefined();
    const kept = actions(p, uri).filter((e) => e.action.type === 'session/titleChanged' && e.rejectionReason === undefined);
    expect(kept.at(-1)?.action.title).toBe('Paging, again');
  });

  it('brings a renamed peer chat back with its title after a restart on the same file', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ahpd-title-'));
    try {
      const dir = join(root, 'sessions');
      const uri = 'ahp-session:/titled';
      const peerChat = 'ahp-chat:/peer';
      const first = createHost({
        path: '/home/softov', agents: [claude({ paths: ['/home/softov'] })], ...machine(), sessions: fileSessions({ dir }),
      });
      const pa = peer();
      const a = first.accept(pa);
      await a.handle(hello(['0.9.0'], { initialSubscriptions: ['ahp-root://'] }));
      await a.handle({ method: 'createSession', params: { channel: uri, provider: 'claude' } });
      await a.handle({ method: 'createChat', params: { channel: uri, chat: peerChat } });
      await a.handle({ method: 'subscribe', params: { channel: uri } });
      await a.handle({ method: 'subscribe', params: { channel: peerChat } });
      a.handle({ method: 'dispatchAction', params: { channel: peerChat, action: { type: 'session/titleChanged', title: 'Tests' } } });
      await settle();
      // A peer chat's title is said as a chat, not as the session's.
      // The last update, after the rows the session sends once its
      // customizations arrive.
      expect(actions(pa, uri).filter((one) => one.action.type === 'session/chatUpdated').at(-1)?.action.changes).toEqual({ title: 'Tests' });
      // The write is coalesced onto the next tick.
      await new Promise((tick) => { setTimeout(tick, 5); });

      // A second host on the same file, which is what a restart is.
      const second = createHost({
        path: '/home/softov', agents: [claude({ paths: ['/home/softov'] })], ...machine(), sessions: fileSessions({ dir }),
      });
      const b = second.accept(peer());
      await b.handle(hello(['0.9.0'], { initialSubscriptions: ['ahp-root://'] }));
      await b.handle({ method: 'createSession', params: { channel: uri, provider: 'claude' } });
      // The same chat, created again, which is where the stored title is
      // applied before the chat is announced.
      await b.handle({ method: 'createChat', params: { channel: uri, chat: peerChat } });
      const state = (await b.handle({ method: 'subscribe', params: { channel: uri } }) as {
        snapshot: { state: { chats: { resource: string; title: string }[] } };
      }).snapshot.state;
      expect(state.chats.find((one) => one.resource === peerChat)?.title).toBe('Tests');
    }
    finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('keeps a title written under the session\'s old name once it is held under its provider\'s', async () => {
    const id = '5d0c9e1a-7b2f-4c3d-9e8f-1a2b3c4d5e6f';
    const chatOf = (session: string) => `ahp-chat://default/${Buffer.from(session, 'utf8').toString('base64url')}`;
    // What a store written before holds: the title under the chat of
    // `ahp-session:/<id>`, the name the session was held by then.
    const store = memorySessions();
    store.setChatTitle(id, chatOf(`ahp-session:/${id}`), 'Paging');
    sdk.sessions.push({ sessionId: id, summary: 'Derived', lastModified: 1, cwd: '/home/softov' });
    const host = createHost({ path: '/home/softov', agents: [claude({ paths: ['/home/softov'] })], ...machine(), sessions: store });
    const client = host.accept(peer());
    await client.handle(hello(['0.9.0']));
    await client.handle({ method: 'listSessions', params: { channel: 'ahp-root://' } });
    client.handle({
      method: 'dispatchAction',
      params: { channel: chatOf(`claude:/${id}`), action: { type: 'chat/turnStarted', turnId: 't1', message: { text: 'carry on' } } },
    });
    await settle(8);
    const opened = await client.handle({ method: 'subscribe', params: { channel: `claude:/${id}` } }) as {
      snapshot: { state: { title: string } };
    };
    expect(opened.snapshot.state.title).toBe('Paging');

    // Renamed again, it is kept once, under the name it is held by now.
    client.handle({
      method: 'dispatchAction',
      params: { channel: `claude:/${id}`, action: { type: 'session/titleChanged', title: 'Paging, again' } },
    });
    await settle();
    expect(store.chatTitlesOf(id)).toEqual({ [chatOf(`claude:/${id}`)]: 'Paging, again' });
  });

  it('takes a chat\'s title with the chat, rather than leaving it for the next one', async () => {
    const store = memorySessions();
    const host = createHost({ path: '/home/softov', agents: [claude({ paths: ['/home/softov'] })], ...machine(), sessions: store });
    const client = host.accept(peer());
    await client.handle(hello(['0.9.0']));
    const uri = 'ahp-session:/titled';
    await client.handle({ method: 'createSession', params: { channel: uri, provider: 'claude' } });
    const peerChat = 'ahp-chat:/peer';
    await client.handle({ method: 'createChat', params: { channel: uri, chat: peerChat } });
    await client.handle({ method: 'subscribe', params: { channel: uri } });
    await client.handle({
      method: 'dispatchAction',
      params: { channel: peerChat, action: { type: 'session/titleChanged', title: 'Tests' } },
    });
    await settle();
    const id = 'titled';
    expect(store.chatTitlesOf(id)).toEqual({ [peerChat]: 'Tests' });

    await client.handle({ method: 'disposeChat', params: { channel: peerChat } });
    await settle();
    // The session is still here; the chat and the name that was its own are not.
    expect(store.chatTitlesOf(id)).toBeUndefined();
  });

  it('reports what the turn cost, while there is still a turn to hang it on', async () => {
    const { client, peer: p, chatUri } = await running();
    client.handle({
      method: 'dispatchAction',
      params: { channel: chatUri, action: { type: 'chat/turnStarted', turnId: 't1', message: { text: 'go' } } },
    });
    await settle();
    await emit({
      type: 'result',
      subtype: 'success',
      duration_ms: 5,
      usage: { input_tokens: 120, output_tokens: 34, cache_read_input_tokens: 900 },
    });
    const said = actions(p, chatUri).map((e) => e.action.type);
    // Before the turn completes: the reducer hangs usage on `activeTurn`, and
    // completing is what moves that into `turns`.
    expect(said.indexOf('chat/usage')).toBeLessThan(said.indexOf('chat/turnComplete'));
    const usage = actions(p, chatUri).find((e) => e.action.type === 'chat/usage')?.action.usage;
    expect(usage).toEqual({ inputTokens: 120, outputTokens: 34, cacheReadTokens: 900 });
  });

  it('names the model the turn was answered on', async () => {
    const { client, peer: p, chatUri } = await running();
    client.handle({
      method: 'dispatchAction',
      params: { channel: chatUri, action: { type: 'chat/turnStarted', turnId: 't1', message: { text: 'go' } } },
    });
    await settle();
    await emit({
      type: 'assistant',
      message: { id: 'm1', model: 'claude-sonnet-4-5-20250929', content: [{ type: 'text', text: '2' }] },
    });
    await emit({ type: 'result', subtype: 'success', duration_ms: 5, usage: { input_tokens: 2 } });

    // The model that answered, not the one configured: a session set to
    // `sonnet` runs on whatever that resolved to, and a client names the model
    // on a historic turn - and sizes that turn's context window - from here.
    const usage = actions(p, chatUri).find((e) => e.action.type === 'chat/usage')?.action.usage;
    expect(usage).toEqual({ inputTokens: 2, model: 'claude-sonnet-4-5-20250929' });

    const opened = await client.handle({ method: 'subscribe', params: { channel: chatUri } }) as {
      snapshot: { state: { turns: { usage?: { model?: string } }[] } };
    };
    expect(opened.snapshot.state.turns[0]?.usage?.model).toBe('claude-sonnet-4-5-20250929');
  });
});

/*
 * What the wire actually says, as against what this host meant.
 *
 * Every case below is a *shape* a client reads by name, and every one of them
 * was wrong in a way nothing here could see: a notification never reaches a
 * reducer, so the conformance replay does not touch it, and the client this
 * repository ships ignores the three catalogue notifications altogether. Two
 * implementations agreeing is not the same as either being right.
 */
describe('the fields a client reads by name', () => {
  /** The protocol notifications on the root channel, in order. */
  const catalogue = (p: ReturnType<typeof peer>) => p.notes
    .filter((n) => n.method.startsWith('root/session'))
    .map((n) => ({ method: n.method, params: n.params as Record<string, unknown> }));

  it('names the session in root/sessionRemoved', async () => {
    const { client, peer: p, uri } = await running();
    await client.handle({ method: 'disposeSession', params: { channel: uri } });

    const gone = catalogue(p).find((n) => n.method === 'root/sessionRemoved');
    // `session`, which is the field the protocol declares. Under any other
    // name the client reads `undefined` and takes nothing out of its list.
    // The name it is held and listed by, which is its provider's.
    expect(gone?.params.session).toBe('ahp-session:/live');
  });

  it('sends root/sessionSummaryChanged as a partial, without the identity fields', async () => {
    const { client, peer: p, uri } = await running();
    client.handle({
      method: 'dispatchAction',
      params: { channel: uri, action: { type: 'chat/turnStarted', turnId: 't1', message: { text: 'hi' } } },
    });
    await settle();

    const moved = catalogue(p).filter((n) => n.method === 'root/sessionSummaryChanged').at(-1);
    expect(moved?.params.session).toBe('ahp-session:/live');
    const changes = moved?.params.changes as Record<string, unknown>;
    expect(changes).toBeDefined();
    // What moved is in there under its own name.
    expect(changes.status).toBe(Status.InProgress);
    expect(changes.title).toEqual(expect.any(String));
    // And the three the protocol says never change are left out, because a
    // *change* carrying them is a change claiming they did.
    expect(changes).not.toHaveProperty('resource');
    expect(changes).not.toHaveProperty('provider');
    expect(changes).not.toHaveProperty('createdAt');
  });

  it('still says what moved on a session no agent is running for', async () => {
    sdk.sessions.push({ sessionId: 'browsed', summary: 'Read me', lastModified: 1, cwd: '/home/softov' });
    const host = serving('/home/softov');
    const seen = peer();
    const watching = host.accept(seen);
    await watching.handle(hello(['0.9.0'], { initialSubscriptions: ['ahp-root://'] }));
    // Reading the catalogue is what teaches this host the row exists.
    await watching.handle({ method: 'listSessions', params: { channel: 'ahp-root://' } });

    watching.handle({
      method: 'dispatchAction',
      params: { channel: 'ahp-session:/browsed', action: { type: 'session/isReadChanged', isRead: true } },
    });
    await settle();

    const moved = catalogue(seen).filter((n) => n.method === 'root/sessionSummaryChanged').at(-1);
    // Named the way the catalogue named it, which is by its provider. The
    // client dispatched under the older spelling and is answered about the
    // session it meant.
    expect(moved?.params.session).toBe('ahp-session:/browsed');
    // A row nobody is running still has a status - `IsRead` is this host's bit
    // and belongs to the row, not to a process - so the notification carries
    // it rather than carrying nothing, which is what it used to do in exactly
    // the case that needed saying.
    expect((moved?.params.changes as Record<string, unknown>).status)
      .toBe(Status.Idle | Status.IsRead);
  });

  it('holds a draft typed into a session nothing is running for', async () => {
    sdk.sessions.push({ sessionId: 'typed', summary: 'Read me', lastModified: 1, cwd: '/home/softov' });
    const host = serving('/home/softov');
    const p = peer();
    const client = host.accept(p);
    await client.handle(hello(['0.9.0'], { initialSubscriptions: ['ahp-root://'] }));
    await client.handle({ method: 'listSessions', params: { channel: 'ahp-root://' } });
    const chat = 'ahp-chat://default/Y2xhdWRlOi90eXBlZA';
    await client.handle({ method: 'subscribe', params: { channel: chat } });

    const draft = { text: '/', origin: { kind: 'user' } };
    client.handle({ method: 'dispatchAction', params: { channel: chat, action: { type: 'chat/draftChanged', draft } } });
    await settle();

    /*
     * Taken, not refused, and no agent started for it.
     *
     * A client applies a draft before sending it, so a refusal is a composer
     * that empties itself as somebody types into it - which is what a slash
     * menu opening and closing again actually is. Starting a CLI instead
     * would be a session opened because a key was pressed.
     */
    const said = actions(p, chat).map((one) => one.action);
    expect(said.some((one) => one.type === 'chat/draftChanged' && one.draft === undefined)).toBe(false);
    expect(said.find((one) => one.type === 'chat/draftChanged')?.draft).toEqual(draft);
    expect(p.notes.map((one) => (one.params as { rejectionReason?: string }).rejectionReason)
      .filter((one) => typeof one === 'string')).toEqual([]);
    expect(sessionQueries()).toHaveLength(0);

    // And a client arriving afterwards is told, which is the whole reason a
    // draft is on the wire rather than kept in the composer that typed it.
    const state = (await client.handle({ method: 'subscribe', params: { channel: chat } }) as {
      snapshot: { state: { draft?: { text?: string } } };
    }).snapshot.state;
    expect(state.draft?.text).toBe('/');
  });

  it('answers a draft it already holds for a session nothing is running for to its sender alone', async () => {
    sdk.sessions.push({ sessionId: 'held', summary: 'Read me', lastModified: 1, cwd: '/home/softov' });
    const host = serving('/home/softov');
    const p = peer();
    const client = host.accept(p);
    await client.handle(hello(['0.9.0'], { clientId: 'one', initialSubscriptions: ['ahp-root://'] }));
    const other = peer();
    const watching = host.accept(other);
    await watching.handle(hello(['0.9.0'], { clientId: 'two', initialSubscriptions: ['ahp-root://'] }));
    await client.handle({ method: 'listSessions', params: { channel: 'ahp-root://' } });
    const chat = 'ahp-chat://default/Y2xhdWRlOi9oZWxk';
    await client.handle({ method: 'subscribe', params: { channel: chat } });
    await watching.handle({ method: 'subscribe', params: { channel: chat } });

    const draft = { text: '/', origin: { kind: 'user' } };
    const drafts = (q: ReturnType<typeof peer>) => actions(q, chat).filter((one) => one.action.type === 'chat/draftChanged');
    client.handle({ method: 'dispatchAction', params: { channel: chat, clientSeq: 1, action: { type: 'chat/draftChanged', draft } } });
    await settle();
    expect(drafts(other)).toHaveLength(1);

    client.handle({ method: 'dispatchAction', params: { channel: chat, clientSeq: 2, action: { type: 'chat/draftChanged', draft } } });
    await settle();
    const answer = drafts(p).find((one) => one.origin?.clientSeq === 2);
    expect(answer?.origin?.clientId).toBe('one');
    expect(answer?.rejectionReason).toBeUndefined();
    expect(drafts(other)).toHaveLength(1);
    expect(sessionQueries()).toHaveLength(0);
  });

  it('hands the draft to the session when one is finally started', async () => {
    sdk.sessions.push({ sessionId: 'carried', summary: 'Read me', lastModified: 1, cwd: '/home/softov' });
    sdk.transcript = [];
    const host = serving('/home/softov');
    const p = peer();
    const client = host.accept(p);
    await client.handle(hello(['0.9.0'], { initialSubscriptions: ['ahp-root://'] }));
    await client.handle({ method: 'listSessions', params: { channel: 'ahp-root://' } });
    const chat = 'ahp-chat://default/YWhwLXNlc3Npb246L2NhcnJpZWQ';
    await client.handle({ method: 'subscribe', params: { channel: chat } });
    client.handle({
      method: 'dispatchAction',
      params: { channel: chat, action: { type: 'chat/draftChanged', draft: { text: 'half a th', origin: { kind: 'user' } } } },
    });
    await settle();

    // The turn is what starts the agent, and the draft was typed into this
    // conversation before there was one. A session that lost it on the way to
    // starting would be one that ate what was in the composer.
    client.handle({
      method: 'dispatchAction',
      params: { channel: chat, action: { type: 'chat/turnStarted', turnId: 't1', message: { text: 'go on then' } } },
    });
    await settle();
    expect(sessionQueries().length).toBeGreaterThan(0);
    const state = (await client.handle({ method: 'subscribe', params: { channel: chat } }) as {
      snapshot: { state: { draft?: { text?: string } } };
    }).snapshot.state;
    expect(state.draft?.text).toBe('half a th');
  });

  it('will not hold a draft for a chat naming a session it has never heard of', async () => {
    const { client, peer: p } = await running();
    p.notes.length = 0;
    client.handle({
      method: 'dispatchAction',
      params: {
        channel: 'ahp-chat://default/Y2xhdWRlOi9ub2JvZHk',
        action: { type: 'chat/draftChanged', draft: { text: 'x', origin: { kind: 'user' } } },
      },
    });
    await settle();
    // A chat URI is a client's to spell, so a draft kept for every one that
    // arrived would be a map that only grows.
    const refused = p.notes
      .map((one) => (one.params as { rejectionReason?: string }).rejectionReason)
      .filter((one): one is string => typeof one === 'string');
    expect(refused.some((one) => one.includes('not a session this host knows'))).toBe(true);
  });

  it('advertises automations only where there are any', async () => {
    const { memoryAutomations } = await import('../src/automations/automations.js');
    const without = await open().handle(hello(['0.9.0'])) as Record<string, unknown>;
    // Absence is what tells a client the host has no catalogue and no
    // automation commands, and a correct one will not go looking.
    expect(without).not.toHaveProperty('automations');

    const host = createHost({
      path: '/home/softov',
      agents: [claude({ paths: ['/home/softov'] })],
      automations: memoryAutomations(),
    });
    const with_ = await host.accept(peer()).handle(hello(['0.9.0'])) as {
      automations?: { create?: unknown; schedules?: unknown; runCancellation?: unknown; runHistoryLimit?: unknown };
    };
    expect(with_.automations?.create).toEqual({});
    expect(with_.automations?.schedules).toEqual({});
    // Served, so a client offers Stop on a run that is `pending` or `running`:
    // the host cancels the turn in each of the run's sessions and keeps them.
    expect(with_.automations?.runCancellation).toEqual({});
    // The number is VS Code's, and the store keeps exactly it.
    expect(with_.automations?.runHistoryLimit).toBe(50);
  });

  it('answers the filtered automations catalogue with only the caller\'s own', async () => {
    const { ana, ben } = await twoAutomationOwners();
    const mine = await ana.handle({ method: 'subscribe', params: { channel: MINE } }) as Catalogue;
    expect(mine.snapshot.state.entries.map((one) => one.resource)).toEqual(['ahp-automation:/ana-nightly']);
    const theirs = await ben.handle({ method: 'subscribe', params: { channel: MINE } }) as Catalogue;
    expect(theirs.snapshot.state.entries.map((one) => one.resource)).toEqual(['ahp-automation:/ben-nightly']);
    // The plain catalogue is everybody's, as it was before there was a filter.
    const all = await ana.handle({ method: 'subscribe', params: { channel: 'ahp-automations://' } }) as Catalogue;
    expect(all.snapshot.state.entries.map((one) => one.resource).sort())
      .toEqual(['ahp-automation:/ana-nightly', 'ahp-automation:/ben-nightly']);
  });

  it('refuses an automations owner filter that is not me', async () => {
    const { ana } = await twoAutomationOwners();
    await expect(ana.handle({ method: 'subscribe', params: { channel: 'ahp-automations://?owner=team:x' } }))
      .rejects.toMatchObject({ code: -32602 });
  });

  it('sends a moved automation to the filtered subscription it belongs to, and to no other', async () => {
    const { store, anaPeer, benPeer } = await twoAutomationOwners();
    anaPeer.notes.length = 0;
    benPeer.notes.length = 0;
    store.update('ahp-automation:/ana-nightly', { title: 'Changed' });
    await settle();
    expect(actions(anaPeer, MINE).some((one) => one.action.type === 'automation/set')).toBe(true);
    expect(actions(benPeer, MINE).some((one) => one.action.type === 'automation/set')).toBe(false);
  });

  it('sends a removal to every filtered subscription, because an id alone is not the record', async () => {
    const { store, anaPeer, benPeer } = await twoAutomationOwners();
    anaPeer.notes.length = 0;
    benPeer.notes.length = 0;
    store.remove('ahp-automation:/ana-nightly');
    await settle();
    expect(actions(anaPeer, MINE).some((one) => one.action.type === 'automation/removed')).toBe(true);
    expect(actions(benPeer, MINE).some((one) => one.action.type === 'automation/removed')).toBe(true);
  });

  it('echoes the clientSeq the dispatch carried, and nothing on its own actions', async () => {
    const { client, peer: p, uri, chatUri } = await running();
    client.handle({
      method: 'dispatchAction',
      params: {
        channel: uri,
        clientSeq: 41,
        action: { type: 'chat/turnStarted', turnId: 't1', message: { text: 'hi' } },
      },
    });
    await settle();

    // The turn is said back, and the echo is what a client matches against the
    // dispatch it applied optimistically. This is emitted from inside the
    // session, several layers below the notification handler, which is the
    // case the scoped origin exists for.
    const started = actions(p, chatUri).find((e) => e.action.type === 'chat/turnStarted');
    expect(started?.origin).toEqual({ clientId: 'probe', clientSeq: 41 });

    await emit(
      { type: 'stream_event', event: { type: 'message_start', message: { id: 'm1' } } },
      { type: 'stream_event', event: { type: 'content_block_start', index: 0, content_block: { type: 'text' } } },
    );
    // And what the agent said is the host's own, so it carries no origin: a
    // client that saw one there would think it had written the agent's words.
    const part = actions(p, chatUri).find((e) => e.action.type === 'chat/responsePart');
    expect(part?.origin).toBeUndefined();
  });

  it('echoes the clientSeq of a turn that switched the model before it began', async () => {
    const { client, peer: p, uri, chatUri } = await running();
    client.handle({
      method: 'dispatchAction',
      params: {
        channel: uri,
        clientSeq: 42,
        action: { type: 'chat/turnStarted', turnId: 't1', message: { text: 'hi', model: { id: 'sonnet' } } },
      },
    });
    await settle();

    // The CLI is asked for the model first and the turn is said once it has
    // it, after the dispatch was applied: still this client's own turn.
    expect(sdk.modelsSet).toContain('sonnet');
    const started = actions(p, chatUri).find((e) => e.action.type === 'chat/turnStarted');
    expect(started?.origin).toEqual({ clientId: 'probe', clientSeq: 42 });
  });

  it('refuses a dispatch out loud, to the client that sent it and nobody else', async () => {
    const host = serving('/home/softov');
    const mine = peer();
    const theirs = peer();
    const client = host.accept(mine);
    const other = host.accept(theirs);
    await client.handle(hello(['0.9.0']));
    await other.handle(hello(['0.9.0']));
    const uri = 'ahp-session:/live';
    await client.handle({ method: 'createSession', params: { channel: uri, provider: 'claude' } });
    await client.handle({ method: 'subscribe', params: { channel: uri } });
    await other.handle({ method: 'subscribe', params: { channel: uri } });
    // Where the state stands before the refusal. A snapshot is taken *at* a
    // sequence number, so this is the one every later action must be above.
    const at = (await client.handle({ method: 'subscribe', params: { channel: uri } }) as {
      snapshot: { fromSeq: number };
    }).snapshot.fromSeq;

    client.handle({
      method: 'dispatchAction',
      params: { channel: uri, clientSeq: 7, action: { type: 'chat/truncated', turnId: 't1' } },
    });
    await settle();

    const refused = actions(mine, uri)
      .filter((e) => (e as { rejectionReason?: string }).rejectionReason !== undefined);
    expect(refused).toHaveLength(1);
    // Which dispatch it answers, so the client knows what to put back.
    expect(refused[0]?.origin).toEqual({ clientId: 'probe', clientSeq: 7 });
    expect(refused[0]?.action.type).toBe('chat/truncated');
    // The reason names what actually happened rather than the type again:
    // this chat has no turn by that name, so there is nothing to truncate to.
    expect((refused[0] as { rejectionReason?: string }).rejectionReason)
      .toContain('not a completed turn');
    // No state moved, so the sequence did not either: the refusal carries the
    // number this host is still at rather than claiming a place in the stream.
    expect(refused[0]?.serverSeq).toBe(at);
    // And the client watching alongside hears nothing: it never applied this,
    // so it has nothing to put back - and reducing a refused envelope would
    // apply the very change this host declined to make.
    expect(actions(theirs, uri)
      .filter((e) => (e as { rejectionReason?: string }).rejectionReason !== undefined)).toHaveLength(0);
  });

  it('leaves createdAt where it was while the session goes on', async () => {
    const { client, peer: p, uri } = await running();
    const added = catalogue(p).find((n) => n.method === 'root/sessionAdded');
    const born = (added?.params.summary as Record<string, unknown>).createdAt as string;
    expect(born).toEqual(expect.any(String));

    // Far enough for a fresh `new Date()` to differ.
    await new Promise((r) => { setTimeout(r, 5); });
    client.handle({
      method: 'dispatchAction',
      params: { channel: uri, action: { type: 'chat/turnStarted', turnId: 't1', message: { text: 'hi' } } },
    });
    await settle();

    const listed = await client.handle({ method: 'listSessions', params: { channel: 'ahp-root://' } }) as {
      items: { resource: string; createdAt: string; modifiedAt: string }[];
    };
    const row = listed.items.find((one) => one.resource === 'ahp-session:/live');
    // `createdAt` is identity and `modifiedAt` is not. Answering both with the
    // modification time gave every live row an age that moved every time
    // somebody said something to it.
    expect(row?.createdAt).toBe(born);
    expect(row?.modifiedAt).not.toBe(born);
  });

  /** A session's row as the root last said it, folded from either notification. */
  const rowOf = (p: ReturnType<typeof peer>, session: string): Record<string, unknown> | undefined => {
    let found: Record<string, unknown> | undefined;
    for (const note of p.notes) {
      const params = note.params as Record<string, unknown>;
      if (note.method === 'root/sessionAdded') {
        const summary = params.summary as Record<string, unknown> | undefined;
        if (summary?.resource === session) found = { ...(found ?? {}), ...summary };
      }
      if (note.method === 'root/sessionSummaryChanged' && params.session === session) {
        found = { ...(found ?? {}), ...(params.changes as Record<string, unknown>) };
      }
    }
    return found;
  };

  /** The chats the row lists, in the spelling the host holds them under. */
  const chatsOf = (p: ReturnType<typeof peer>, session: string) =>
    (rowOf(p, session)?.chats ?? []) as { resource: string; status?: number; interactivity?: string; title?: string }[];

  const statusOf = (p: ReturnType<typeof peer>, session: string, chat: string) =>
    chatsOf(p, session).find((one) => one.resource === chat)?.status;

  const sessionStatus = (p: ReturnType<typeof peer>, session: string) =>
    (catalogue(p).filter((n) => n.method === 'root/sessionSummaryChanged').at(-1)?.params.changes as
      { status?: number } | undefined)?.status;

  it("marks one chat read without moving its other chats", async () => {
    const { client, peer: p, uri } = await running();
    const second = 'ahp-chat:/second';
    await client.handle({ method: 'createChat', params: { channel: uri, chat: second } });
    // Subscribed, because a notification goes to the connections watching a
    // channel and to no others - a client opens the chat it is about to read.
    await client.handle({ method: 'subscribe', params: { channel: second } });
    // A new chat starts read, so it is marked unread first for the read to move.
    client.handle({
      method: 'dispatchAction',
      params: { channel: second, action: { type: 'chat/isReadChanged', isRead: false } },
    });
    await settle();
    p.notes.length = 0;

    client.handle({
      method: 'dispatchAction',
      params: { channel: second, action: { type: 'chat/isReadChanged', isRead: true } },
    });
    await settle();

    // On the chat's own channel, which is where the client watching that one
    // chat reduces it.
    expect(actions(p, second).some((e) => e.action.type === 'chat/isReadChanged')).toBe(true);
    // And on the session channel, which is where a client watching the session
    // reads what each of its chats is doing. `changes` carries the status the
    // protocol says to project, not a chat summary it has no field for.
    const updated = actions(p, uri).filter((e) => e.action.type === 'session/chatUpdated').at(-1);
    expect(updated?.action.chat).toBe(second);
    expect((updated?.action.changes as { status?: number } | undefined)?.status).toBe(Status.Idle | Status.IsRead);
    // The row a client lists says it too, and says it about that chat alone.
    expect(statusOf(p, 'ahp-session:/live', second)).toBe(Status.Idle | Status.IsRead);
    const others = chatsOf(p, 'ahp-session:/live').filter((one) => one.resource !== second);
    expect(others.map((one) => one.status)).toEqual(others.map(() => Status.Idle | Status.IsRead));
    // Every chat is read again, so the session is read with them.
    expect(sessionStatus(p, 'ahp-session:/live')).toBe(Status.Idle | Status.IsRead);
    // A client opening the chat afterwards gets the bit in its state, so a
    // restart of the client is not a chat that forgot it was read.
    const state = (await client.handle({ method: 'subscribe', params: { channel: second } }) as {
      snapshot: { state: { status: number } };
    }).snapshot.state;
    expect(state.status).toBe(Status.Idle | Status.IsRead);
  });

  it('only answers its sender the second time a chat is marked read', async () => {
    const { client, peer: p, uri } = await running();
    const second = 'ahp-chat:/second';
    await client.handle({ method: 'createChat', params: { channel: uri, chat: second } });
    const read = (clientSeq: number) => ({
      method: 'dispatchAction',
      params: { channel: second, clientSeq, action: { type: 'chat/isReadChanged', isRead: true } },
    });
    client.handle(read(1));
    await settle();
    const said = p.notes.length;
    client.handle(read(2));
    await settle();
    // One echo, with the sender's own `clientSeq`, so it can let go of what it
    // applied. Not the row: the catalogue did not move, and a state that did
    // not move is no reason to wake anybody.
    const after = p.notes.slice(said);
    expect(after.map((one) => one.method)).toEqual(['action']);
    expect((after[0]?.params as { origin?: { clientSeq?: number } }).origin?.clientSeq).toBe(2);
  });

  it('marks a worker chat read, which the row lists like any other', async () => {
    sdk.sessions.push({ sessionId: 'restored', summary: 'Read me', lastModified: 1, cwd: '/home/softov' });
    const host = serving('/home/softov', [], {
      agents: [{
        ...claude({ paths: ['/home/softov'] }),
        subagents: async () => [{ toolCallId: 'toolu_task', title: 'Explore', turns: [] }],
      }],
    } as never);
    const p = peer();
    const client = host.accept(p);
    await client.handle(hello(['0.9.0'], { initialSubscriptions: ['ahp-root://'] }));
    await client.handle({ method: 'subscribe', params: { channel: 'ahp-session:/restored' } });
    // A turn is what starts the session, and a session nothing is running for
    // lists no chats - so the worker's chat is only there once one is.
    client.handle({
      method: 'dispatchAction',
      params: { channel: 'ahp-chat:/restored', action: { type: 'chat/turnStarted', turnId: 't1', message: { text: 'go' } } },
    });
    await settle(8);
    await client.handle({ method: 'listSessions', params: { channel: 'ahp-root://' } });

    const worker = chatsOf(p, 'ahp-session:/restored').find((one) => one.interactivity === 'read-only');
    expect(worker?.resource).toContain('toolu_task');
    p.notes.length = 0;

    client.handle({
      method: 'dispatchAction',
      params: { channel: worker?.resource as string, action: { type: 'chat/isReadChanged', isRead: true } },
    });
    await settle();
    // Read is the client's own bit and outlives every reason the turns are
    // read-only: somebody who has read what a subagent did does not want it
    // back as unread when they open the session again.
    expect(statusOf(p, 'ahp-session:/restored', worker?.resource as string)).toBe(Status.Idle | Status.IsRead);
  });

  it('archives one chat, and restores it, without archiving the session', async () => {
    const { client, peer: p, uri } = await running();
    const second = 'ahp-chat:/second';
    await client.handle({ method: 'createChat', params: { channel: uri, chat: second } });
    p.notes.length = 0;
    const archive = (on: boolean) => client.handle({
      method: 'dispatchAction',
      params: { channel: second, action: { type: 'chat/isArchivedChanged', isArchived: on } },
    });

    archive(true);
    await settle();
    expect(statusOf(p, 'ahp-session:/live', second)).toBe(Status.Idle | Status.IsRead | Status.IsArchived);
    // The session is not archived with it. One chat put away is a chat, and a
    // session that went with it would take the other chats off the list too.
    expect(sessionStatus(p, 'ahp-session:/live')).toBe(Status.Idle | Status.IsRead);

    archive(false);
    await settle();
    expect(statusOf(p, 'ahp-session:/live', second)).toBe(Status.Idle | Status.IsRead);
  });

  it('takes archiving the default chat as archiving the session', async () => {
    const { host, client, peer: p, uri, chatUri } = await running();
    // A second client on the same chat, which archived nothing.
    const q = peer();
    const other = host.accept(q);
    await other.handle(hello(['0.9.0'], { clientId: 'other' }));
    await other.handle({ method: 'subscribe', params: { channel: chatUri } });
    p.notes.length = 0;

    client.handle({
      method: 'dispatchAction',
      params: { channel: chatUri, clientSeq: 4, action: { type: 'chat/isArchivedChanged', isArchived: true } },
    });
    await settle();

    // Said on the session channel, because the session is what moved, and with
    // the action the protocol declares for it.
    expect(actions(p, uri).some((e) => e.action.type === 'session/isArchivedChanged'
      && e.action.isArchived === true)).toBe(true);
    // The client that archived the chat is answered on the chat, once, with
    // its own action: it holds what it sent until that comes back.
    const answered = actions(p, chatUri).filter((e) => e.origin?.clientId === 'probe' && e.origin.clientSeq === 4);
    expect(answered.map((e) => [e.action.type, e.rejectionReason])).toEqual([['chat/isArchivedChanged', undefined]]);
    // And to it alone. The default chat *is* the session, so a chat action
    // said to everyone would be a chat a client hides while the session it
    // names says it is still there.
    expect(actions(q, chatUri).some((e) => e.action.type === 'chat/isArchivedChanged')).toBe(false);
    expect(sessionStatus(p, 'ahp-session:/live')).toBe(Status.Idle | Status.IsRead | Status.IsArchived);
    // The chat's own entry carries no archive bit: the session is what is
    // archived, and an entry repeating it says one thing twice.
    const chats = chatsOf(p, 'ahp-session:/live');
    expect(chats).toHaveLength(1);
    expect((chats[0]?.status ?? 0) & Status.IsArchived).toBe(0);

    // And back the other way, which is a session taken out of the archive.
    client.handle({
      method: 'dispatchAction',
      params: { channel: chatUri, action: { type: 'chat/isArchivedChanged', isArchived: false } },
    });
    await settle();
    expect(sessionStatus(p, 'ahp-session:/live')).toBe(Status.Idle | Status.IsRead);
  });

  it('marks a chat unread when a turn starts in it, and keeps it read when a client says so', async () => {
    const { client, peer: p, uri } = await running();
    const second = 'ahp-chat:/second';
    await client.handle({ method: 'createChat', params: { channel: uri, chat: second } });

    client.handle({
      method: 'dispatchAction',
      params: { channel: second, action: { type: 'chat/turnStarted', turnId: 't1', message: { text: 'go' } } },
    });
    await settle();
    // Unread, as the protocol's chat reducer makes it on a turn's start.
    expect(statusOf(p, 'ahp-session:/live', second)).toBe(Status.InProgress);

    client.handle({
      method: 'dispatchAction',
      params: { channel: second, action: { type: 'chat/isReadChanged', isRead: true } },
    });
    await settle();
    // Both bits, because they are different facts about one chat: work is
    // happening in it, and the person has read what it said so far.
    expect(statusOf(p, 'ahp-session:/live', second)).toBe(Status.InProgress | Status.IsRead);
  });
});

/*
 * The annotations channel: a client's marks, kept for the other clients.
 *
 * Nothing here produces one. What this host contributes is that a mark one
 * client made is a mark every other client in the session can see - so the
 * state is stored and echoed rather than computed, and it is reduced with the
 * package's own `annotationsReducer` so that host and clients cannot disagree.
 *
 * The channel is answered even while it is empty, because a client opens a
 * session by subscribing to three channels at once - the session, its chat,
 * and `<sessionUri>/annotations` - and treats the three as one hydration.
 * Refusing the third fails the open, and the failure is silent.
 */
describe('a session\'s annotations', () => {
  it('answers an empty channel for a live session', async () => {
    const { client, uri } = await running();

    const opened = await client.handle({ method: 'subscribe', params: { channel: `${uri}/annotations` } }) as {
      snapshot: { resource: string; state: { annotations: unknown[] } };
    };
    expect(opened.snapshot.resource).toBe(`${uri}/annotations`);
    expect(opened.snapshot.state.annotations).toEqual([]);
  });

  it('reads the transcript once, however many channels ask for it at once', async () => {
    sdk.sessions.push({ sessionId: 'old', summary: 'Older', lastModified: 1, cwd: '/home/softov' });
    sdk.transcript.push({ type: 'user', uuid: 'u1', message: { role: 'user', content: 'earlier' } });
    const client = open();
    await client.handle(hello(['0.9.0']));
    sdk.reads = 0;

    /*
     * The three a client sends in one breath to open a session.
     *
     * Not awaited in turn: they arrive together, and before this each of them
     * missed the cache none of the others had finished filling - so a 35MB
     * transcript was read three times *concurrently*, which is where the
     * memory goes rather than where the turns do.
     */
    await Promise.all([
      client.handle({ method: 'subscribe', params: { channel: 'ahp-session:/old' } }),
      client.handle({ method: 'subscribe', params: { channel: 'ahp-session:/old/annotations' } }),
      client.handle({ method: 'fetchTurns', params: { channel: 'ahp-session:/old' } }).catch(() => undefined),
    ]);
    expect(sdk.reads).toBe(1);
  });

  it('answers one for a session read from its transcript, before it has been listed', async () => {
    sdk.sessions.push({ sessionId: 'old', summary: 'Older', lastModified: 1, cwd: '/home/softov' });
    sdk.transcript.push({ type: 'user', uuid: 'u1', message: { role: 'user', content: 'earlier' } });
    const client = open();
    await client.handle(hello(['0.9.0']));

    // Deliberately without listing first. A client sends the three
    // subscriptions that open a session in one breath, and its `listSessions`
    // is still in flight when they arrive.
    const opened = await client.handle({
      method: 'subscribe',
      params: { channel: 'ahp-session:/old/annotations' },
    }) as { snapshot: { state: { annotations: unknown[] } } };
    expect(opened.snapshot.state.annotations).toEqual([]);
  });

  it('refuses one for a session that is not here', async () => {
    const { client } = await running();
    await expect(client.handle({ method: 'subscribe', params: { channel: 'ahp-session:/nobody/annotations' } }))
      .rejects.toMatchObject({ code: -32001 });
  });

  it('keeps a mark one client made, and shows it to the next', async () => {
    const { host, client, uri } = await running();
    const marks = `${uri}/annotations`;
    await client.handle({ method: 'subscribe', params: { channel: marks } });
    client.handle({
      method: 'dispatchAction',
      params: {
        channel: marks,
        action: {
          type: 'annotations/set',
          annotation: {
            id: 'a1',
            origin: { session: uri },
            resource: 'file:///home/softov/x.ts',
            resolved: false,
            entries: [{ id: 'e1', text: 'this is the bit' }],
          },
        },
      },
    });
    // A second client, arriving after. The whole point of the channel is that
    // the mark is the session's rather than the marker's.
    const other = host.accept(peer());
    await other.handle(hello(['0.9.0']));
    const seen = await other.handle({ method: 'subscribe', params: { channel: marks } }) as {
      snapshot: { state: { annotations: { id: string; entries: { text: string }[] }[] } };
    };
    expect(seen.snapshot.state.annotations).toHaveLength(1);
    expect(seen.snapshot.state.annotations[0]?.entries[0]?.text).toBe('this is the bit');
  });

  it('echoes each of the five to everyone watching, carrying the origin', async () => {
    const { client, peer: p, uri } = await running();
    const marks = `${uri}/annotations`;
    await client.handle({ method: 'subscribe', params: { channel: marks } });
    const send = (action: Record<string, unknown>) => client.handle({
      method: 'dispatchAction',
      params: { channel: marks, clientSeq: 4, action },
    });
    send({
      type: 'annotations/set',
      annotation: {
        id: 'a1', origin: { session: uri }, resource: 'file:///x', resolved: false,
        entries: [{ id: 'e1', text: 'one' }],
      },
    });
    send({ type: 'annotations/entrySet', annotationId: 'a1', entry: { id: 'e2', text: 'two' } });
    send({ type: 'annotations/updated', annotationId: 'a1', resolved: true });
    send({ type: 'annotations/entryRemoved', annotationId: 'a1', entryId: 'e1' });

    const echoed = p.notes.filter((note) => note.method === 'action'
      && (note.params as { channel: string }).channel === marks);
    expect(echoed).toHaveLength(4);
    // The echo is what a client reconciles its optimistic apply against.
    expect(echoed[0]?.params).toMatchObject({ origin: { clientSeq: 4 } });

    const state = (await client.handle({ method: 'subscribe', params: { channel: marks } }) as {
      snapshot: { state: { annotations: { resolved: boolean; entries: { id: string }[] }[] } };
    }).snapshot.state;
    expect(state.annotations[0]?.resolved).toBe(true);
    expect(state.annotations[0]?.entries.map((e) => e.id)).toEqual(['e2']);

    send({ type: 'annotations/removed', annotationId: 'a1' });
    const gone = (await client.handle({ method: 'subscribe', params: { channel: marks } }) as {
      snapshot: { state: { annotations: unknown[] } };
    }).snapshot.state;
    expect(gone.annotations).toEqual([]);
  });

  it('refuses one that names a mark the session does not have', async () => {
    const { client, peer: p, uri } = await running();
    const marks = `${uri}/annotations`;
    await client.handle({ method: 'subscribe', params: { channel: marks } });
    // The reducer answers an unknown id by handing back the state it was
    // given. Echoing that as though it applied leaves the client holding an
    // optimistic mark this host never kept.
    client.handle({
      method: 'dispatchAction',
      params: { channel: marks, action: { type: 'annotations/updated', annotationId: 'nope', resolved: true } },
    });
    const refused = p.notes.filter((note) => note.method === 'action').at(-1);
    expect(refused?.params).toMatchObject({
      rejectionReason: expect.stringContaining('does not have'),
    });
  });
});

/*
 * A chat that another backend serves.
 *
 * AHP's own `createChat` names no backend: only a plugin names one, through the
 * `ToolCall` its tool is handed. That is the seam these cases open a chat
 * through, because it is the only way one comes to be on a backend the session
 * does not run on.
 */
describe('a chat another backend serves', () => {
  /**
   * A second backend, and a tool that opens a chat on the backend it names.
   *
   * Echo rather than the fake Claude: what is under test is which backend the
   * chat went to, and a backend that records its own start says that without a
   * turn having to run.
   */
  async function chatsOnAnother() {
    type Answer = { content: { text: string }[]; isError?: boolean };
    type Tool = { name: string; handler: (input: unknown) => Promise<Answer> };
    const other: Agent = { ...echo({ path: '/home/softov', pace: 0 }), provider: 'other' };
    const maker: HostTool = {
      definition: {
        name: 'make_chat',
        title: 'Make Chat',
        description: 'Open a chat in this session, on the backend it names.',
        inputSchema: {
          type: 'object',
          properties: {
            provider: { type: 'string', description: 'The backend that serves the chat.' },
            prompt: { type: 'string', description: 'What to say in it first.' },
          },
          required: ['prompt'],
        },
      },
      run: async (input, at) => {
        const made = await at.createChat(at.session, {
          prompt: String(input.prompt),
          from: { origin: { kind: 'agent' } },
          ...(typeof input.provider === 'string' ? { provider: input.provider } : {}),
        });
        return made.chat;
      },
    };
    const host = createHost({
      path: '/home/softov',
      agents: [claude({ paths: ['/home/softov'] }), other],
      ...machine(),
      tools: [...hostTools(), maker],
      sleepAfterMinutes: 0,
    });
    const client = host.accept(peer());
    await client.handle(hello(['0.9.0']));
    const session = 'ahp-session:/mine';
    await client.handle({ method: 'createSession', params: { channel: session, provider: 'claude' } });
    await settle(8);
    const servers = sessionQueries().at(-1)?.options.mcpServers as Record<string, { tools: Tool[] }> | undefined;
    const tool = servers?.ahp?.tools.find((one) => one.name === 'make_chat');
    if (tool === undefined) throw new Error('no make_chat');
    const made = await tool.handler({ provider: 'other', prompt: 'say hi' });
    if (made.isError === true) throw new Error(made.content[0]?.text ?? 'make_chat failed');
    return { client, session, chatUri: made.content[0]?.text ?? '' };
  }

  type Client = ReturnType<ReturnType<typeof createHost>['accept']>;

  /** One channel's state, as a subscribing client reads it. */
  const stateOf = async (client: Client, channel: string): Promise<Record<string, unknown>> => {
    const answer = await client.handle({ method: 'subscribe', params: { channel } }) as {
      snapshot: { state: Record<string, unknown> };
    };
    return answer.snapshot.state;
  };

  it("says the chat's backend, and leaves the session on its own", async () => {
    const { client, session, chatUri } = await chatsOnAnother();
    expect(chatUri).toMatch(/^ahp-chat:\/[0-9a-f-]+$/);

    // The chat says which backend serves it, in `_meta` because `ChatState`
    // declares no provider.
    const chat = await stateOf(client,chatUri);
    expect((chat._meta as Record<string, unknown> | undefined)?.['ahpd.provider']).toBe('other');

    // And the session keeps its own: a chat on another harness does not
    // rename the session it is a chat of.
    const one = await stateOf(client,session);
    expect(one.provider).toBe('claude');
  });

  it("leaves a chat of the session's own backend without the key", async () => {
    const { client, session } = await chatsOnAnother();
    const chatUri = (await stateOf(client,session)).defaultChat as string;
    const chat = await stateOf(client,chatUri);
    // The session already says `claude`; a key repeating it on every chat would
    // be two answers to one question, and could disagree with the session.
    expect(Object.prototype.hasOwnProperty.call((chat._meta as object | undefined) ?? {}, 'ahpd.provider'))
      .toBe(false);
  });
});

describe("a browsed session's _meta", () => {
  /*
   * What a client draws a session it has not started from.
   *
   * The state of a session nothing runs is composed by `describes`, which asks
   * the backend's running agent for `_meta` while there is one. A browsed row
   * has no agent, so its keys are the ones the backend put on the row it
   * listed - and the running agent's replace them once the session starts.
   */
  const PATH = '/home/softov';
  const STAMP = '2026-10-25T00:00:00.000Z';
  const chatOf = (session: string) => `ahp-chat://default/${Buffer.from(session, 'utf8').toString('base64url')}`;
  const row = (id: string, meta?: Record<string, unknown>): Listed => ({
    id,
    title: id,
    createdAt: STAMP,
    modifiedAt: STAMP,
    workingDirectories: [`file://${PATH}`],
    ...(meta === undefined ? {} : { _meta: meta }),
  });
  /**
   * A backend over one listed row, whose sessions report `_meta` as a running
   * one does: the model it is on, beside what the listing said.
   */
  const backend = (listed: Listed[]): Agent => {
    const base = echo({ path: PATH, pace: 0 });
    return {
      ...base,
      provider: 'slow',
      displayName: 'Slow',
      directories: () => [PATH],
      list: async () => [...listed],
      create: (start: Start) => {
        const session = base.create(start);
        return {
          ...session,
          sessionState: () => ({ ...session.sessionState(), _meta: { 'ahpd.model': 'opus' } }),
        };
      },
      transcript: async () => [],
    };
  };
  type State = { _meta?: Record<string, unknown> };

  it("answers a session nothing runs with the _meta its backend listed", async () => {
    const host = createHost({
      path: PATH,
      agents: [backend([row('one', { bot: 'motion', color: 'red' })])],
      ...machine(),
    });
    const client = host.accept(peer());
    await client.handle(hello(['0.9.0']));
    await client.handle({ method: 'listSessions', params: { channel: 'ahp-root://' } });

    const opened = await client.handle({ method: 'subscribe', params: { channel: 'ahp-session:/one' } }) as {
      snapshot: { state: State };
    };
    expect(opened.snapshot.state._meta).toEqual({ bot: 'motion', color: 'red' });
  });

  it("replaces a listed row's _meta with the running agent's own", async () => {
    const host = createHost({
      path: PATH,
      agents: [backend([row('one', { bot: 'motion', color: 'red' })])],
      ...machine(),
    });
    const client = host.accept(peer());
    await client.handle(hello(['0.9.0']));
    await client.handle({ method: 'listSessions', params: { channel: 'ahp-root://' } });

    // The first turn resumes the session, as a person opening a chat and
    // typing into it does. The row is not created again: its id is held.
    client.handle({
      method: 'dispatchAction',
      params: { channel: chatOf('ahp-session:/one'), action: { type: 'chat/turnStarted', turnId: 't1', message: { text: 'carry on' } } },
    });
    await settle(8);

    const opened = await client.handle({ method: 'subscribe', params: { channel: 'ahp-session:/one' } }) as {
      snapshot: { state: State };
    };
    // The running agent knows the session as it is now, and the listed keys are
    // dropped rather than merged: `_meta` is replaced whole.
    expect(opened.snapshot.state._meta).toEqual({ 'ahpd.model': 'opus' });
  });
});

describe('what a backend offers, asked again', () => {
  it('probes again when the backend says its answer changed, and stops asking when the host closes', async () => {
    let changed: (() => void) | undefined;
    let stopped = 0;
    let seeds = [{ id: 'skill:review', type: 'skill', name: 'review' }];
    const host = createHost({
      path: '/home/softov',
      agents: [{
        ...echo({ path: '/home/softov', pace: 0 }),
        provider: 'probed',
        probe: async () => ({ models: [], commands: [], customizations: [...seeds] }),
        probeChanged: (onChange) => {
          changed = onChange;
          return () => { stopped += 1; };
        },
      }],
      ...machine(),
    });
    const p = peer();
    const client = host.accept(p);
    await client.handle(hello(['0.9.0'], { initialSubscriptions: ['ahp-root://'] }));
    await settle();
    type Offering = { provider: string; customizations?: { id: string }[] }[];
    const idsIn = (agents: Offering): unknown[] =>
      (agents.find((one) => one.provider === 'probed')?.customizations ?? []).map((one) => one.id);
    // The first answer came before the client did, so it is in the snapshot.
    const root = (await client.handle({ method: 'subscribe', params: { channel: 'ahp-root://' } }) as {
      snapshot: { state: { agents: Offering } };
    }).snapshot.state;
    expect(idsIn(root.agents)).toEqual(['skill:review']);
    /** The ids the root was last told this backend offers. */
    const offered = (): unknown[] => idsIn(
      (actions(p, 'ahp-root://').filter((one) => one.action.type === 'root/agentsChanged').at(-1)?.action.agents ?? []) as Offering,
    );
    // Asked after the first answer, and once.
    expect(changed).toBeDefined();

    seeds = [...seeds, { id: 'agent:scout', type: 'agent', name: 'scout' }];
    changed?.();
    await settle();
    expect(offered()).toEqual(['skill:review', 'agent:scout']);

    await host.close();
    expect(stopped).toBe(1);
  });

  it('stops asking a backend a fold removed', async () => {
    let stopped = 0;
    const probed: Agent = {
      ...echo({ path: '/home/softov', pace: 0 }),
      provider: 'probed',
      probe: async () => ({ models: [], commands: [], customizations: [] }),
      probeChanged: () => () => { stopped += 1; },
    };
    const options = { path: '/home/softov', agents: [probed, echo({ path: '/home/softov', pace: 0 })], ...machine() };
    const host = createHost(options);
    await settle();
    expect(host.replace({ ...options, agents: [echo({ path: '/home/softov', pace: 0 })] })).toBeUndefined();
    expect(stopped).toBe(1);
    await host.close();
    expect(stopped).toBe(1);
  });

  it('probes one at a time, and once more for every change while one runs', async () => {
    let changed: (() => void) | undefined;
    let running = 0;
    let most = 0;
    let probes = 0;
    const answers: (() => void)[] = [];
    const host = createHost({
      path: '/home/softov',
      agents: [{
        ...echo({ path: '/home/softov', pace: 0 }),
        provider: 'probed',
        probe: async () => {
          probes += 1;
          running += 1;
          most = Math.max(most, running);
          await new Promise<void>((done) => answers.push(done));
          running -= 1;
          return { models: [], commands: [], customizations: [] };
        },
        probeChanged: (onChange) => {
          changed = onChange;
          return () => undefined;
        },
      }],
      ...machine(),
    });
    await settle();
    answers.shift()?.();
    await settle();
    expect(changed).toBeDefined();

    changed?.();
    await settle();
    expect(probes).toBe(2);
    // Three changes while the second probe runs are one probe after it.
    changed?.();
    changed?.();
    changed?.();
    await settle();
    expect(probes).toBe(2);
    answers.shift()?.();
    await settle();
    expect(probes).toBe(3);
    answers.shift()?.();
    await settle();
    expect(probes).toBe(3);
    expect(most).toBe(1);
    await host.close();
  });
});
