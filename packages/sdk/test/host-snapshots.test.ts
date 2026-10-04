import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Status } from '../src/catalog.js';
import { fileSessions, memorySessions } from '../src/sessions.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  resetSdk, actions, claude, createHost, emit, hello, machine, open, peer,
 sdk, serving, sessionQueries, settle, running,
} from './support/host.js';

vi.mock('@anthropic-ai/claude-agent-sdk', async () => (await import('./support/claude-sdk.js')).fake);

beforeEach(resetSdk);

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
      expect(actions(pa, uri).find((one) => one.action.type === 'session/chatUpdated')?.action.changes).toEqual({ title: 'Tests' });
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
    expect(gone?.params.session).toBe('claude:/live');
  });

  it('sends root/sessionSummaryChanged as a partial, without the identity fields', async () => {
    const { client, peer: p, uri } = await running();
    client.handle({
      method: 'dispatchAction',
      params: { channel: uri, action: { type: 'chat/turnStarted', turnId: 't1', message: { text: 'hi' } } },
    });
    await settle();

    const moved = catalogue(p).filter((n) => n.method === 'root/sessionSummaryChanged').at(-1);
    expect(moved?.params.session).toBe('claude:/live');
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
    expect(moved?.params.session).toBe('claude:/browsed');
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

  it('hands the draft to the session when one is finally started', async () => {
    sdk.sessions.push({ sessionId: 'carried', summary: 'Read me', lastModified: 1, cwd: '/home/softov' });
    sdk.transcript = [];
    const host = serving('/home/softov');
    const p = peer();
    const client = host.accept(p);
    await client.handle(hello(['0.9.0'], { initialSubscriptions: ['ahp-root://'] }));
    await client.handle({ method: 'listSessions', params: { channel: 'ahp-root://' } });
    const chat = 'ahp-chat://default/Y2xhdWRlOi9jYXJyaWVk';
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
    const { memoryAutomations } = await import('../src/automations.js');
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
      automations?: { create?: unknown; schedules?: unknown; runCancellation?: unknown };
    };
    expect(with_.automations?.create).toEqual({});
    expect(with_.automations?.schedules).toEqual({});
    // Not advertised, because it is not served: a run here is a session, and
    // disposing it is how it stops.
    expect(with_.automations).not.toHaveProperty('runCancellation');
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
    const row = listed.items.find((one) => one.resource === 'claude:/live');
    // `createdAt` is identity and `modifiedAt` is not. Answering both with the
    // modification time gave every live row an age that moved every time
    // somebody said something to it.
    expect(row?.createdAt).toBe(born);
    expect(row?.modifiedAt).not.toBe(born);
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
