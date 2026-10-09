import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  resetSdk, actions, claude, createHost, echo, emit, hello, machine, open, peer, sdk, serving,
  sessionQueries, settle, running,
} from './support/host.js';
import { fileSessions } from '../src/sessions.js';
import { idOf } from '../src/catalog.js';
import { chatUriFor } from '../src/host/channels.js';
import { undeclaredIn } from './support/wire.js';
import type { Agent, HostOptions, Session, Start } from '@ahpd/sdk';

vi.mock('@anthropic-ai/claude-agent-sdk', async () => (await import('./support/claude-sdk.js')).fake);

beforeEach(resetSdk);

describe('two people on one chat', () => {
  it('shows each other what is being typed', async () => {
    const host = serving('/home/softov');
    const one = peer();
    const a = host.accept(one);
    const two = peer();
    const b = host.accept(two);
    for (const client of [a, b]) {
      await client.handle(hello(['0.9.0']));
    }
    await a.handle({ method: 'createSession', params: { channel: 'ahp-session:/live', provider: 'claude' } });
    for (const client of [a, b]) {
      await client.handle({ method: 'subscribe', params: { channel: 'ahp-chat:/live' } });
    }

    a.handle({
      method: 'dispatchAction',
      params: {
        channel: 'ahp-chat:/live',
        action: { type: 'chat/draftChanged', draft: { text: 'half a th', origin: { kind: 'user' } } },
      },
    });
    await settle();
    // The only reason a draft is on the wire at all: a client that kept its
    // own would need nothing from a host for it.
    const typed = actions(two, 'ahp-chat:/live')
      .find((e) => e.action.type === 'chat/draftChanged')?.action.draft as { text?: string } | undefined;
    expect(typed?.text).toBe('half a th');

    // And somebody arriving later gets it from the snapshot.
    const three = host.accept(peer());
    await three.handle(hello(['0.9.0']));
    const opened = await three.handle({ method: 'subscribe', params: { channel: 'ahp-chat:/live' } }) as {
      snapshot: { state: { draft?: { text?: string } } };
    };
    expect(opened.snapshot.state.draft?.text).toBe('half a th');
  });
});

describe('dropping the turns after one', () => {
  /** Two finished turns, with the backend's own names for what they did. */
  async function twice() {
    const running_ = await running();
    const { client, chatUri } = running_;
    client.handle({
      method: 'dispatchAction',
      params: { channel: chatUri, action: { type: 'chat/turnStarted', turnId: 't1', message: { text: 'first' } } },
    });
    await settle();
    await emit({ type: 'user', session_id: 'sdk-1', uuid: 'prompt-1', message: { role: 'user', content: 'first' } });
    await emit({ type: 'assistant', uuid: 'reply-1', message: { id: 'm1', content: [{ type: 'text', text: 'one' }] } });
    await emit({ type: 'result', subtype: 'success', is_error: false, duration_ms: 1 });
    client.handle({
      method: 'dispatchAction',
      params: { channel: chatUri, action: { type: 'chat/turnStarted', turnId: 't2', message: { text: 'second' } } },
    });
    await settle();
    await emit({ type: 'user', session_id: 'sdk-1', uuid: 'prompt-2', message: { role: 'user', content: 'second' } });
    await emit({ type: 'assistant', uuid: 'reply-2', message: { id: 'm2', content: [{ type: 'text', text: 'two' }] } });
    await emit({ type: 'result', subtype: 'success', is_error: false, duration_ms: 1 });
    return running_;
  }

  it('rewinds the agent to the end of the turn it keeps, under the same id', async () => {
    const { client, chatUri } = await twice();
    const before = sessionQueries().length;

    client.handle({
      method: 'dispatchAction',
      params: { channel: chatUri, action: { type: 'chat/truncated', turnId: 't1' } },
    });
    await settle();

    // A CLI that still remembered the dropped turn would answer the edited
    // message with the one it replaced still in front of it.
    expect(sessionQueries().length).toBe(before + 1);
    const fresh = sessionQueries().at(-1);
    expect(fresh?.options.resume).toBe('sdk-1');
    // The kept turn's *last* entry, not the prompt it began with: cutting at
    // the prompt keeps the question and drops the answer to it.
    expect(fresh?.options.resumeSessionAt).toBe('reply-1');
    // And not a fork. A truncation carries on in the conversation it dropped
    // the turns from, so the id has to survive it - a new one would leave
    // every later resume reaching the transcript that still has them.
    expect(fresh?.options.forkSession).toBeUndefined();

    // The history through that turn is still here: a truncation that emptied
    // the chat is not what the action asks for.
    const state = (await client.handle({ method: 'subscribe', params: { channel: chatUri } }) as {
      snapshot: { state: { turns: { id: string }[] } };
    }).snapshot.state;
    expect(state.turns.map((one) => one.id)).toEqual(['t1']);
  });

  it('says so before it restarts, so nobody is shown what they asked to be rid of', async () => {
    const { client, peer: p, chatUri } = await twice();
    client.handle({
      method: 'dispatchAction',
      params: { channel: chatUri, clientSeq: 3, action: { type: 'chat/truncated', turnId: 't1' } },
    });
    await settle();
    const said = actions(p, chatUri).map((e) => e.action.type);
    expect(said).toContain('chat/truncated');
    // Carrying the origin of the client that asked, like every other action a
    // client dispatches: one applying it optimistically has to be able to
    // recognise its own.
    const truncated = actions(p, chatUri).find((e) => e.action.type === 'chat/truncated');
    expect(truncated?.origin).toEqual({ clientId: 'probe', clientSeq: 3 });
  });

  it('refuses a turn it has no rewind point for, rather than clearing the screen alone', async () => {
    const { client, peer: p, uri, chatUri } = await running();
    client.handle({
      method: 'dispatchAction',
      params: { channel: chatUri, action: { type: 'chat/turnStarted', turnId: 't1', message: { text: 'hi' } } },
    });
    await settle();
    // Finished without the CLI ever naming what it did - which is every turn
    // read back off a transcript rather than watched running.
    await emit({ type: 'result', session_id: 'sdk-1', subtype: 'success', is_error: false, duration_ms: 1 });

    client.handle({
      method: 'dispatchAction',
      params: { channel: chatUri, action: { type: 'chat/truncated', turnId: 't1' } },
    });
    await settle();
    const refused = actions(p).filter((e) => e.rejectionReason !== undefined).at(-1);
    expect(refused?.rejectionReason).toContain('not a turn this host can rewind to');
    // And nothing moved: the turn is still there and the CLI was not restarted.
    const state = (await client.handle({ method: 'subscribe', params: { channel: chatUri } }) as {
      snapshot: { state: { turns: { id: string }[] } };
    }).snapshot.state;
    expect(state.turns.map((one) => one.id)).toEqual(['t1']);
    expect(uri).toBeTruthy();
  });

  it('drops the turn that is running, and comes back idle', async () => {
    const { client, peer: p, chatUri } = await twice();
    client.handle({
      method: 'dispatchAction',
      params: { channel: chatUri, action: { type: 'chat/turnStarted', turnId: 't3', message: { text: 'third' } } },
    });
    await settle();
    const before = actions(p, chatUri).length;

    client.handle({
      method: 'dispatchAction',
      params: { channel: chatUri, action: { type: 'chat/truncated', turnId: 't1' } },
    });
    await settle();

    /*
     * Silently, which the action says in as many words.
     *
     * Nothing about the dropped turn is reported as an ending: `chat/truncated`
     * is said first and every client has already taken that turn off its
     * screen, so a completion or a cancellation behind it would be an ending
     * for something nobody is holding.
     */
    const after = actions(p, chatUri).slice(before).map((e) => e.action.type);
    expect(after).toContain('chat/truncated');
    expect(after).not.toContain('chat/error');
    expect(after).not.toContain('chat/turnComplete');

    const state = (await client.handle({ method: 'subscribe', params: { channel: chatUri } }) as {
      snapshot: { state: { turns: { id: string }[]; activeTurn?: unknown } };
    }).snapshot.state;
    expect(state.turns.map((one) => one.id)).toEqual(['t1']);
    expect(state.activeTurn).toBeUndefined();
  });

  it('will not empty a conversation entire, and says why', async () => {
    const { client, peer: p, chatUri } = await twice();
    client.handle({
      method: 'dispatchAction',
      params: { channel: chatUri, action: { type: 'chat/truncated' } },
    });
    await settle();
    /*
     * `turnId` is optional and its absence means "clear everything", which as
     * a rewind is a cut at a point before the first prompt - and there is no
     * such entry for the backend to be pointed at. Refused rather than served
     * as an emptied screen in front of an agent that remembers all of it.
     */
    const refused = actions(p).filter((e) => e.rejectionReason !== undefined).at(-1);
    expect(refused?.rejectionReason).toContain('not a conversation entire');
  });
});

describe('a chat made out of another', () => {
  it('forks at the turn it was told to, and brings the history through it', async () => {
    const { client, uri, chatUri } = await running();
    client.handle({
      method: 'dispatchAction',
      params: { channel: chatUri, action: { type: 'chat/turnStarted', turnId: 't1', message: { text: 'hi' } } },
    });
    await settle();
    // The CLI echoes the prompt back under an id of its own and then answers,
    // and the answer's id is the one a fork cuts at.
    await emit({ type: 'user', session_id: 'sdk-1', uuid: 'sdk-prompt-1', message: { role: 'user', content: 'hi' } });
    await emit({ type: 'assistant', uuid: 'sdk-reply-1', message: { id: 'm1', content: [{ type: 'text', text: 'hello' }] } });
    await emit({ type: 'result', subtype: 'success', is_error: false, duration_ms: 1 });

    await client.handle({
      method: 'createChat',
      params: {
        channel: uri, chat: 'ahp-chat:/forked',
        source: { kind: 'fork', chat: chatUri, turnId: 't1' },
      },
    });
    const fresh = sessionQueries().at(-1);
    expect(fresh?.options.forkSession).toBe(true);
    // The turn's *last* entry, not the prompt it began with: a fork copies the
    // conversation through the chosen turn, answer included, so cutting at the
    // prompt would leave the new chat showing an answer its agent never gave.
    expect(fresh?.options.resumeSessionAt).toBe('sdk-reply-1');

    // And the conversation through that turn is visible in the new chat: a
    // fork that starts empty is a new chat, not a fork.
    const state = (await client.handle({ method: 'subscribe', params: { channel: 'ahp-chat:/forked' } }) as {
      snapshot: { state: { turns: { id: string }[] } };
    }).snapshot.state;
    expect(state.turns.map((one) => one.id)).toEqual(['t1']);
  });

  it('tells a side chat what the turn said, and keeps it out of the history', async () => {
    const { client, uri, chatUri } = await running();
    client.handle({
      method: 'dispatchAction',
      params: { channel: chatUri, action: { type: 'chat/turnStarted', turnId: 't1', message: { text: 'the weather' } } },
    });
    await settle();
    await emit({ type: 'result', session_id: 'sdk-1', subtype: 'success', is_error: false, duration_ms: 1 });

    await client.handle({
      method: 'createChat',
      params: {
        channel: uri, chat: 'ahp-chat:/side',
        source: { kind: 'sideChat', chat: chatUri, turnId: 't1' },
        initialMessage: { text: 'and tomorrow?' },
      },
    });
    await settle();
    /*
     * The model is told both; the conversation shows one.
     *
     * The protocol is explicit that a side chat does not copy the source
     * transcript into its visible history - so the context rides on the first
     * prompt and nowhere else.
     */
    expect(sdk.said.at(-1)).toContain('the weather');
    expect(sdk.said.at(-1)).toContain('and tomorrow?');
    const state = (await client.handle({ method: 'subscribe', params: { channel: 'ahp-chat:/side' } }) as {
      snapshot: { state: { turns: unknown[]; activeTurn?: { message: { text: string } } } };
    }).snapshot.state;
    expect(state.turns).toEqual([]);
    expect(state.activeTurn?.message.text).toBe('and tomorrow?');
  });

  /**
   * A chat's first turn, finished, with the prompt id the CLI echoed for it.
   *
   * What a fork resumes at, so a chat made out of this one has a turn to name.
   */
  const oneTurn = async (client: ReturnType<ReturnType<typeof serving>['accept']>, chatUri: string, turnId = 't1'): Promise<void> => {
    client.handle({
      method: 'dispatchAction',
      params: { channel: chatUri, action: { type: 'chat/turnStarted', turnId, message: { text: 'hi' } } },
    });
    await settle();
    await emit({ type: 'user', session_id: 'sdk-1', uuid: `sdk-prompt-${turnId}`, message: { role: 'user', content: 'hi' } });
    await emit({ type: 'result', subtype: 'success', is_error: false, duration_ms: 1 });
  };

  /** Every frame a peer was sent, with the subscribe answers given, against the protocol schema. */
  const defectsOf = (p: ReturnType<typeof peer>, answers: unknown[]): string[] =>
    undeclaredIn([...p.notes, ...answers.map((result) => ({ result }))]);

  it('says a fork came from that chat at that turn, wherever the chat is described', async () => {
    const { client, peer: p, uri, chatUri } = await running();
    await oneTurn(client, chatUri);
    await client.handle({
      method: 'createChat',
      params: { channel: uri, chat: 'ahp-chat:/forked', source: { kind: 'fork', chat: chatUri, turnId: 't1' } },
    });
    const origin = { kind: 'fork', chat: chatUri, turnId: 't1' };

    const added = actions(p, uri).find((e) => e.action.type === 'session/chatAdded');
    expect((added?.action.summary as { origin?: unknown }).origin).toEqual(origin);

    // A full summary is re-sent when the chat moves, and it must not say
    // `user` over what the chat was made from.
    client.handle({
      method: 'dispatchAction',
      params: { channel: 'ahp-chat:/forked', action: { type: 'session/titleChanged', title: 'Forked' } },
    });
    client.handle({
      method: 'dispatchAction',
      params: { channel: 'ahp-chat:/forked', action: { type: 'chat/turnStarted', turnId: 't2', message: { text: 'again' } } },
    });
    await settle();
    const updated = actions(p, uri)
      .filter((e) => e.action.type === 'session/chatUpdated' && e.action.chat === 'ahp-chat:/forked')
      .map((e) => e.action.changes as { origin?: unknown; resource?: unknown });
    expect(updated.some((one) => one.resource !== undefined)).toBe(true);
    for (const one of updated) if (one.origin !== undefined) expect(one.origin).toEqual(origin);

    const session = await client.handle({ method: 'subscribe', params: { channel: uri } }) as {
      snapshot: { state: { chats: { resource: string; origin?: unknown }[] } };
    };
    expect(session.snapshot.state.chats.find((c) => c.resource === 'ahp-chat:/forked')?.origin).toEqual(origin);
    // The chat it came from is still one somebody opened.
    expect(session.snapshot.state.chats.find((c) => c.resource === chatUri)?.origin).toEqual({ kind: 'user' });

    const own = await client.handle({ method: 'subscribe', params: { channel: 'ahp-chat:/forked' } }) as {
      snapshot: { state: { origin?: unknown } };
    };
    expect(own.snapshot.state.origin).toEqual(origin);

    expect(defectsOf(p, [session, own])).toEqual([]);
  });

  it('says a side chat came from that chat at that turn, with the selection it was given', async () => {
    const { client, peer: p, uri, chatUri } = await running();
    await oneTurn(client, chatUri);
    const selection = { text: 'the weather' };
    await client.handle({
      method: 'createChat',
      params: { channel: uri, chat: 'ahp-chat:/side', source: { kind: 'sideChat', chat: chatUri, turnId: 't1', selection } },
    });
    const origin = { kind: 'sideChat', chat: chatUri, turnId: 't1', selection };

    const added = actions(p, uri).find((e) => e.action.type === 'session/chatAdded');
    expect((added?.action.summary as { origin?: unknown }).origin).toEqual(origin);
    const session = await client.handle({ method: 'subscribe', params: { channel: uri } }) as {
      snapshot: { state: { chats: { resource: string; origin?: unknown }[] } };
    };
    expect(session.snapshot.state.chats.find((c) => c.resource === 'ahp-chat:/side')?.origin).toEqual(origin);
    const own = await client.handle({ method: 'subscribe', params: { channel: 'ahp-chat:/side' } }) as {
      snapshot: { state: { origin?: unknown } };
    };
    expect(own.snapshot.state.origin).toEqual(origin);

    expect(defectsOf(p, [session, own])).toEqual([]);
  });

  it('names a secondary chat it was forked from as that chat, under any spelling of the session', async () => {
    const { client, peer: p, uri, chatUri } = await running();
    await oneTurn(client, chatUri);
    await client.handle({ method: 'createChat', params: { channel: uri, chat: 'ahp-chat:/other' } });
    await oneTurn(client, 'ahp-chat:/other');
    await client.handle({
      method: 'createChat',
      params: { channel: uri, chat: 'ahp-chat:/forked', source: { kind: 'fork', chat: 'ahp-chat:/other', turnId: 't1' } },
    });
    await client.handle({
      method: 'createChat',
      params: { channel: uri, chat: 'ahp-chat:/lead-fork', source: { kind: 'fork', chat: chatUri, turnId: 't1' } },
    });

    const alias = `claude:/${uri.slice(uri.indexOf(':/') + 2)}`;
    const aliased = await client.handle({ method: 'subscribe', params: { channel: alias } }) as {
      snapshot: { state: { defaultChat: string; chats: { resource: string; origin?: unknown }[] } };
    };
    const rows = aliased.snapshot.state.chats;
    // Not the default chat: the chat it was made from is a peer of it.
    expect(rows.find((c) => c.resource === 'ahp-chat:/forked')?.origin)
      .toEqual({ kind: 'fork', chat: 'ahp-chat:/other', turnId: 't1' });
    // The default chat, in the spelling this client gave the session.
    expect(rows.find((c) => c.resource === 'ahp-chat:/lead-fork')?.origin)
      .toEqual({ kind: 'fork', chat: aliased.snapshot.state.defaultChat, turnId: 't1' });
    expect(aliased.snapshot.state.defaultChat).not.toBe(chatUri);
    expect(defectsOf(p, [aliased])).toEqual([]);
  });

  it('refuses a source it does not know, and one from another session', async () => {
    const { client, uri, chatUri } = await running();
    await expect(client.handle({
      method: 'createChat',
      params: { channel: uri, chat: 'ahp-chat:/bad', source: { kind: 'graft', chat: chatUri, turnId: 't1' } },
    })).rejects.toThrow(/not a chat source/);
    await expect(client.handle({
      method: 'createChat',
      params: { channel: uri, chat: 'ahp-chat:/bad', source: { kind: 'fork', chat: 'ahp-chat:/elsewhere', turnId: 't1' } },
    })).rejects.toThrow(/is not a chat in/);
  });
});

describe('more than one chat in a session', () => {
  const second = 'ahp-chat:/other';

  it('advertises that it can, so a client knows it may ask', async () => {
    const client = open();
    const result = await client.handle(hello(['0.9.0'], { initialSubscriptions: ['ahp-root://'] })) as {
      snapshots: { state: { agents: { capabilities?: { multipleChats?: unknown } }[] } }[];
    };
    /*
     * Without this a client MUST NOT call `createChat` at all, and without the
     * two flags in it a client MUST NOT ask for a chat made out of another.
     * The backend declares those, because they are its: a fork continues one
     * of its conversations from a turn and a side chat starts one that knows
     * what a turn elsewhere said.
     */
    expect(result.snapshots[0]?.state.agents[0]?.capabilities?.multipleChats)
      .toEqual({ fork: true, sideChat: true });
  });

  it('spreads a session-scoped key across every chat, and keeps a chat-scoped one where it was', async () => {
    const { client, uri } = await running();
    await client.handle({ method: 'createChat', params: { channel: uri, chat: second } });
    const before = sdk.modesSet.length;
    await client.handle({
      method: 'dispatchAction',
      params: { channel: uri, action: { type: 'session/configChanged', config: { permissionMode: 'plan' } } },
    });
    await settle();
    /*
     * Both chats, because the schema says `scope: 'session'`.
     *
     * The chats of one session are peers on one config: a permission mode set
     * on one of them and not the other is a session where two conversations
     * are allowed different things. Which keys are a session's is the backend's
     * schema's answer rather than this host's.
     */
    expect(sdk.modesSet.length - before).toBe(2);

    const efforts = sdk.effortsSet.length;
    await client.handle({
      method: 'dispatchAction',
      params: { channel: uri, action: { type: 'session/configChanged', config: { effortLevel: 'low' } } },
    });
    await settle();
    // One, because that one says `scope: 'chat'`. How hard a conversation
    // thinks is that conversation's.
    expect(sdk.effortsSet.length - efforts).toBe(1);
  });

  it('opens one, and lists both on the session', async () => {
    const { client, peer: p, uri, chatUri } = await running();
    await client.handle({ method: 'createChat', params: { channel: uri, chat: second } });

    // `summary`, which is what the reducer reads: a chat announced under any
    // other name arrives as a TypeError inside it.
    expect(actions(p, uri).find((e) => e.action.type === 'session/chatAdded')?.action.summary)
      .toMatchObject({ resource: second, status: 1 });

    const opened = await client.handle({ method: 'subscribe', params: { channel: uri } }) as {
      snapshot: { state: { chats: { resource: string }[]; defaultChat: string } };
    };
    expect(opened.snapshot.state.chats.map((c) => c.resource)).toEqual([chatUri, second]);
    // The first stays the one a client gets when it names none.
    expect(opened.snapshot.state.defaultChat).toBe(chatUri);
  });

  it('runs them on their own agents, so a turn in one is not a turn in the other', async () => {
    const { client, uri, chatUri } = await running();
    await client.handle({ method: 'createChat', params: { channel: uri, chat: second } });
    client.handle({
      method: 'dispatchAction',
      params: { channel: second, action: { type: 'chat/turnStarted', turnId: 't1', message: { text: 'over here' } } },
    });
    await settle();
    // Two CLIs, one directory, one config - which is what makes them peers.
    expect(sessionQueries()).toHaveLength(2);
    expect(sdk.said).toEqual(['over here']);

    const first_ = await client.handle({ method: 'subscribe', params: { channel: chatUri } }) as {
      snapshot: { state: { turns: unknown[]; activeTurn?: unknown } };
    };
    expect(first_.snapshot.state.turns).toEqual([]);
    expect(first_.snapshot.state.activeTurn).toBeUndefined();
  });

  it('names each chat\'s own conversation to the backend, and none for the first', async () => {
    /*
     * `Start.chatId` is the name a backend keeps a chat's conversation under,
     * and the id in the chat's URI is that name. A session's first chat is the
     * session, so it is told none and the backend names it from the session
     * URI.
     */
    const starts: { chatId?: string }[] = [];
    const base = claude({ paths: ['/home/softov'] });
    const host = createHost({
      path: '/home/softov',
      agents: [{ ...base, create: (start) => { starts.push(start); return base.create(start); } }],
      ...machine(),
    });
    const client = host.accept(peer());
    await client.handle(hello(['0.9.0']));
    await client.handle({ method: 'createSession', params: { channel: 'ahp-session:/named', provider: 'claude' } });
    await settle();
    expect(starts.at(-1)?.chatId).toBeUndefined();

    const chat = 'ahp-chat:/0f8fad5b-d9cb-469f-a165-70867728950e';
    await client.handle({ method: 'createChat', params: { channel: 'ahp-session:/named', chat } });
    await settle();
    expect(starts.at(-1)?.chatId).toBe('0f8fad5b-d9cb-469f-a165-70867728950e');
  });

  it('carries the session\'s config into a chat opened later', async () => {
    const { client, uri } = await running();
    client.handle({
      method: 'dispatchAction',
      params: { channel: uri, action: { type: 'session/configChanged', config: { permissionMode: 'plan' } } },
    });
    await settle();
    await client.handle({ method: 'createChat', params: { channel: uri, chat: second } });
    await settle();
    // Config belongs to the session, not to whichever chat happened to be
    // open when it was answered.
    expect(sessionQueries().at(-1)?.options.permissionMode).toBe('plan');
  });

  it('says a session is waiting when any of its chats is', async () => {
    const { client, uri } = await running();
    await client.handle({ method: 'createChat', params: { channel: uri, chat: second } });
    client.handle({
      method: 'dispatchAction',
      params: { channel: second, action: { type: 'chat/turnStarted', turnId: 't1', message: { text: 'go' } } },
    });
    await settle();
    void sdk.canUseTool?.('Bash', { command: 'ls' }, { toolUseID: 'toolu_1' });
    await settle();

    const listed = await client.handle({ method: 'listSessions', params: { channel: 'ahp-root://' } }) as {
      items: { status: number }[];
    };
    // A catalogue that only looked at the default chat would show this idle
    // while another chat in it is blocked on a person.
    expect(listed.items[0]?.status).toBe(24);
  });

  it('will not dispose the only one, and says what to do instead', async () => {
    const { client, chatUri } = await running();
    await expect(client.handle({ method: 'disposeChat', params: { channel: chatUri } }))
      .rejects.toMatchObject({ code: -32602, message: expect.stringContaining('dispose the session') });
  });

  it('closes one, and moves the default when it was the default', async () => {
    const { client, peer: p, uri, chatUri } = await running();
    await client.handle({ method: 'createChat', params: { channel: uri, chat: second } });
    await client.handle({ method: 'disposeChat', params: { channel: chatUri } });

    expect(actions(p, uri).find((e) => e.action.type === 'session/defaultChatChanged')?.action.defaultChat)
      .toBe(second);
    expect(actions(p, uri).find((e) => e.action.type === 'session/chatRemoved')?.action.chat).toBe(chatUri);
    /*
     * And the name follows the role rather than the chat.
     *
     * `default` is which chat a client gets when it names none, not an identity
     * - so once the default has moved, the URI that means "this session's
     * default" resolves to the one that is now default. A client holding it
     * lands on the conversation the session would hand it anyway, which is
     * what it asked for.
     */
    const after = await client.handle({ method: 'subscribe', params: { channel: chatUri } }) as {
      snapshot: { state: { resource: string } };
    };
    expect(after.snapshot.state.resource).toBe(second);
  });

  it('refuses to fork one from a turn, which it cannot do', async () => {
    const { client, uri } = await running();
    // Forking needs a backend that resumes at a *turn*; this one resumes
    // whole sessions, and the capability it advertises says neither mode.
    await expect(client.handle({
      method: 'createChat',
      params: { channel: uri, chat: second, source: { kind: 'fork', chat: 'ahp-chat:/live', turnId: 't1' } },
    })).rejects.toMatchObject({ code: -32602 });
  });

  /*
   * A chat of a session is a conversation of its own that outlives the
   * process, and what makes it one is the store and the backend's transcripts
   * rather than anything this host holds in memory.
   *
   * The backend here is the example, with one change: it names a conversation
   * by the id it was handed, which is what a backend that keeps several does.
   * The store is a folder, because what a restart leaves behind is exactly
   * what was written down.
   */
  const DIR = '/home/softov';
  const UUID = '0f8fad5b-d9cb-469f-a165-70867728950e';
  const PEER = `ahp-chat:/${UUID}`;
  const LIVE = 'ahp-session:/live';

  const backend = (starts: Start[]): Agent => {
    const base = echo({ path: DIR, pace: 0 });
    return {
      ...base,
      // A session the host may add a folder to, which is one of the ways a
      // running session comes back with its chats.
      multipleDirectories: true,
      create: (start: Start): Session => {
        starts.push(start);
        return base.create(start.chatId === undefined ? start : { ...start, resume: start.chatId });
      },
    };
  };

  /**
   * A backend that answers with a name of its own for a chat.
   *
   * Claude's fork does exactly this: the host asks for a copy under a name it
   * chose, and the conversation the backend makes runs under one it minted. The
   * name it answers with is the only one a restart can resume by, so the record
   * has to be that one rather than the name that was asked for.
   */
  const renaming = (starts: Start[]): Agent => {
    // The example, so the transcript is kept under the id `create` is handed -
    // which is what makes the minted name the one a restart has to resume by.
    const base = echo({ path: DIR, pace: 0 });
    return {
      ...base,
      create: (start: Start): Session => {
        const mine = start.chatId === undefined || start.chatId === idOf(start.uri)
          ? idOf(start.uri)
          : `${start.chatId}-minted`;
        starts.push(start);
        const session = base.create({ ...start, resume: mine });
        return { ...session, agentId: () => mine };
      },
    };
  };

  /** A host over one store folder, and a client whose window trusts. */
  const hostAt = async (dir: string, agent: Agent, over: Partial<HostOptions> = {}) => {
    const host = createHost({ path: DIR, agents: [agent], ...machine(), sessions: fileSessions({ dir }), ...over });
    const p = peer();
    // A folder is untrusted until the window it is in says otherwise, and the
    // window here is the client. Nothing else in these cases asks it anything.
    p.request = async () => ({ trusted: true });
    const client = host.accept(p);
    await client.handle(hello(['0.9.0'], { initialSubscriptions: ['ahp-root://'] }));
    return { host, client, p };
  };

  /** What a snapshot says, which is all these cases read. */
  interface Read {
    state: {
      resource: string;
      defaultChat?: string;
      chats?: { resource: string }[];
      turns: { message?: { text?: string } }[];
    };
  }

  const opened = async (client: { handle(request: unknown): Promise<unknown> }, channel: string) =>
    (await client.handle({ method: 'subscribe', params: { channel } }) as { snapshot: Read }).snapshot;

  /** What a chat said, as the text each of its turns opened with. */
  const said = (read: Read): (string | undefined)[] => read.state.turns.map((one) => one.message?.text);

  const send = async (
    client: { handle(request: unknown): Promise<unknown> },
    channel: string,
    turnId: string,
    text: string,
  ): Promise<void> => {
    void client.handle({
      method: 'dispatchAction',
      params: { channel, action: { type: 'chat/turnStarted', turnId, message: { text } } },
    });
    await settle(8);
  };

  /** What each start was told it was resuming, and what it was seeded with. */
  const resuming = (starts: Start[]) => starts.map((one) => ({
    chatId: one.chatId,
    resume: one.resume,
    first: (one.seed?.[0] as unknown as { message?: { text?: string } } | undefined)?.message?.text,
  }));

  it('starts every chat of a session again when the session is restarted', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ahpd-chats-'));
    try {
      const starts: Start[] = [];
      const { client } = await hostAt(join(root, 'sessions'), backend(starts));
      await client.handle({ method: 'createSession', params: { channel: LIVE, provider: 'echo' } });
      await client.handle({ method: 'createChat', params: { channel: LIVE, chat: PEER } });
      await settle();
      await send(client, LIVE, 't1', 'first');
      await send(client, PEER, 't2', 'second');
      const before = starts.length;

      // The window adds a folder, which a backend that takes its folders at
      // startup can only answer by starting again: the in-process restart.
      void client.handle({
        method: 'dispatchAction',
        params: { channel: LIVE, action: { type: 'session/workingDirectorySet', directory: `file://${DIR}/extra` } },
      });
      await settle(20);

      /*
       * The chat that is the session, and then the peer chat resumed as the
       * conversation of its own that it is.
       *
       * Each under the name it was opened with, and each seeded with its own
       * turns: a chat started on another chat's history would answer as
       * somebody else, which is the whole of what a restart must not do.
       */
      expect(resuming(starts.slice(before))).toEqual([
        { chatId: undefined, resume: 'live', first: 'first' },
        { chatId: UUID, resume: UUID, first: 'second' },
      ]);
      const session = await opened(client, LIVE);
      expect(session.state.chats?.map((one) => one.resource)).toEqual([session.state.defaultChat, PEER]);
    }
    finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('serves each chat of a session from its own conversation after a restart', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ahpd-chats-'));
    try {
      const dir = join(root, 'sessions');
      const starts: Start[] = [];
      // One backend for both hosts, because what a restart leaves behind is
      // the store and the transcripts rather than the process that wrote them.
      const agent = backend(starts);
      const first = await hostAt(dir, agent);
      await first.client.handle({ method: 'createSession', params: { channel: LIVE, provider: 'echo' } });
      await first.client.handle({ method: 'createChat', params: { channel: LIVE, chat: PEER } });
      await settle();
      await send(first.client, LIVE, 't1', 'first');
      await send(first.client, PEER, 't2', 'second');
      // The store writes on the tick after the change, so the second host
      // starts on a folder that has all of it rather than on a race.
      await new Promise((tick) => { setTimeout(tick, 5); });

      const second = await hostAt(dir, agent);
      const listed = await second.client.handle({ method: 'listSessions', params: { channel: 'ahp-root://' } }) as {
        items: { resource: string }[];
      };
      /*
       * One row, and it is the session's own.
       *
       * The peer chat's conversation is what its backend keeps its turns
       * under, so a listing of that backend offers it - and a row for it would
       * be a session of its own, opening onto a chat nobody started.
       */
      expect(listed.items.map((one) => one.resource)).toEqual(['echo:/live']);

      // The session lists both chats, and opening the peer one answers its own
      // turns rather than the session's. Read only: nothing is started here.
      const session = await opened(second.client, 'echo:/live');
      expect(session.state.chats?.map((one) => one.resource)).toEqual([session.state.defaultChat, PEER]);
      expect(said(await opened(second.client, PEER))).toEqual(['second']);

      const before = starts.length;
      await send(second.client, PEER, 't3', 'third');
      /*
       * The session comes back with every chat it had, and the turn is
       * answered on the chat it was sent to rather than on the first one -
       * which is what a chat being its own conversation means.
       */
      expect(resuming(starts.slice(before))).toEqual([
        { chatId: undefined, resume: 'live', first: 'first' },
        { chatId: UUID, resume: UUID, first: 'second' },
      ]);
      expect(said(await opened(second.client, PEER))).toEqual(['second', 'third']);
      expect(said(await opened(second.client, session.state.defaultChat as string))).toEqual(['first']);
    }
    finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('finds a chat of a session it has never listed', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ahpd-chats-'));
    try {
      const dir = join(root, 'sessions');
      const starts: Start[] = [];
      const agent = backend(starts);
      const first = await hostAt(dir, agent);
      await first.client.handle({ method: 'createSession', params: { channel: LIVE, provider: 'echo' } });
      await first.client.handle({ method: 'createChat', params: { channel: LIVE, chat: PEER } });
      await settle();
      await send(first.client, LIVE, 't1', 'first');
      await send(first.client, PEER, 't2', 'second');
      await new Promise((tick) => { setTimeout(tick, 5); });

      /*
       * A second host over the same folder, which lists nothing at all.
       *
       * A peer chat's URI carries no session, so which session owns one is
       * read from what the store recorded - and a host that only learned it
       * from a listing would read the uuid as a session id here and answer
       * with a chat of a session nobody has.
       */
      const second = await hostAt(dir, agent);
      const before = starts.length;
      expect(said(await opened(second.client, PEER))).toEqual(['second']);
      // Read only: opening it starts no agent.
      expect(starts.length).toBe(before);

      await send(second.client, PEER, 't3', 'third');
      // The session comes back with every chat it had, and the turn is
      // answered on the chat it was sent to.
      expect(resuming(starts.slice(before))).toEqual([
        { chatId: undefined, resume: 'live', first: 'first' },
        { chatId: UUID, resume: UUID, first: 'second' },
      ]);
      expect(said(await opened(second.client, PEER))).toEqual(['second', 'third']);
    }
    finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('does not start a chat that was disposed', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ahpd-chats-'));
    try {
      const dir = join(root, 'sessions');
      const starts: Start[] = [];
      // One backend, so the transcript the second host resumes is the one the
      // first wrote - which is what a restart meets either way.
      const agent = backend(starts);
      const first = await hostAt(dir, agent);
      await first.client.handle({ method: 'createSession', params: { channel: LIVE, provider: 'echo' } });
      await first.client.handle({ method: 'createChat', params: { channel: LIVE, chat: PEER } });
      await settle();
      await send(first.client, LIVE, 't1', 'first');
      await first.client.handle({ method: 'disposeChat', params: { channel: PEER } });
      await settle();
      await new Promise((tick) => { setTimeout(tick, 5); });
      const before = starts.length;

      const second = await hostAt(dir, agent);
      await send(second.client, 'echo:/live', 't1', 'again');
      // One start, and it is the chat that is the session: a chat somebody
      // closed is not one the session comes back with.
      expect(resuming(starts.slice(before))).toEqual([{ chatId: undefined, resume: 'live', first: 'first' }]);
    }
    finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('starts again as the chat that took over when the first one was closed', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ahpd-chats-'));
    try {
      const dir = join(root, 'sessions');
      const starts: Start[] = [];
      const agent = backend(starts);
      const first = await hostAt(dir, agent);
      await first.client.handle({ method: 'createSession', params: { channel: LIVE, provider: 'echo' } });
      await first.client.handle({ method: 'createChat', params: { channel: LIVE, chat: PEER } });
      await settle();
      await send(first.client, LIVE, 't1', 'first');
      await send(first.client, PEER, 't2', 'second');
      const chatUri = (await opened(first.client, LIVE)).state.defaultChat as string;
      await first.client.handle({ method: 'disposeChat', params: { channel: chatUri } });
      await settle();
      await new Promise((tick) => { setTimeout(tick, 5); });

      const second = await hostAt(dir, agent);
      /*
       * The chat that took over, and not the one that was closed.
       *
       * Closing the session's first chat moves the default to the chat that is
       * left, and the store is what says so. A resume that started the closed
       * conversation instead would read turns nobody is looking at and leave
       * the chat the turn is sent to with no process behind it.
       */
      const before = starts.length;
      await send(second.client, PEER, 't3', 'third');
      expect(resuming(starts.slice(before))).toEqual([{ chatId: UUID, resume: UUID, first: 'second' }]);
      expect(said(await opened(second.client, PEER))).toEqual(['second', 'third']);

      // And the session lists that chat alone: a closed one is not one it has.
      const session = await opened(second.client, 'echo:/live');
      expect(session.state.defaultChat).toBe(PEER);
      expect(session.state.chats?.map((one) => one.resource)).toEqual([PEER]);
    }
    finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('resumes a chat under the name its backend answered with, not the one it asked for', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ahpd-chats-'));
    try {
      const dir = join(root, 'sessions');
      const starts: Start[] = [];
      const agent = renaming(starts);
      const first = await hostAt(dir, agent);
      await first.client.handle({ method: 'createSession', params: { channel: LIVE, provider: 'echo' } });
      await first.client.handle({ method: 'createChat', params: { channel: LIVE, chat: PEER } });
      await settle();
      await send(first.client, LIVE, 't0', 'first');
      await send(first.client, PEER, 't1', 'made here');
      await new Promise((tick) => { setTimeout(tick, 5); });

      const second = await hostAt(dir, agent);
      /*
       * The name the backend answered with is the conversation there is.
       *
       * A fork is the road that makes this real: the host asks for a copy under
       * the chat's own id and the backend makes one under an id it minted, so a
       * record holding the name that was asked for is a restart that reads a
       * conversation nobody wrote.
       */
      expect(said(await opened(second.client, PEER))).toEqual(['made here']);
      const before = starts.length;
      await send(second.client, PEER, 't2', 'said again');
      expect(resuming(starts.slice(before)).at(-1))
        .toEqual({ chatId: `${UUID}-minted`, resume: `${UUID}-minted`, first: 'made here' });
      expect(said(await opened(second.client, PEER))).toEqual(['made here', 'said again']);
    }
    finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('deletes a closed chat\'s conversation only when the daemon is told to', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ahpd-chats-'));
    try {
      const close = async (dir: string, over: Partial<HostOptions>): Promise<string[]> => {
        const gone: string[] = [];
        const agent: Agent = {
          ...backend([]),
          delete: async (id: string) => { gone.push(id); },
        };
        const { client } = await hostAt(dir, agent, over);
        await client.handle({ method: 'createSession', params: { channel: LIVE, provider: 'echo' } });
        await client.handle({ method: 'createChat', params: { channel: LIVE, chat: PEER } });
        await settle();
        await send(client, PEER, 't1', 'over here');
        await client.handle({ method: 'disposeChat', params: { channel: PEER } });
        await settle();
        return gone;
      };
      /*
       * The chat's own conversation, and never the session's: the session is
       * still there, and its conversation is not one a closed chat takes with
       * it. Which of the two answers this is comes from the daemon key, and the
       * default is the one that keeps the conversation.
       */
      expect(await close(join(root, 'default'), {})).toEqual([]);
      expect(await close(join(root, 'deleting'), { closedChats: 'delete' })).toEqual([UUID]);
    }
    finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('does not rebuild the chats of a session inside a machine', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ahpd-chats-'));
    try {
      const dir = join(root, 'sessions');
      const at = '2026-10-09T00:00:00.000Z';
      /*
       * A session this host ran in a machine, as it recorded it.
       *
       * Its conversation is the inner host's, in there, and the record beside
       * it is what this host has. Reading its list as chats of its own would
       * offer a row that opens onto nothing.
       */
      const seeding = fileSessions({ dir });
      seeding.setNested?.('inner', {
        provider: 'echo',
        machine: 'box',
        inner: 'inner',
        title: 'In a machine',
        createdAt: at,
        modifiedAt: at,
        workingDirectories: [`file://${DIR}`],
      });
      seeding.setChats('inner', [
        { uri: chatUriFor('echo:/inner'), backendId: 'inner', default: true },
        { uri: PEER, backendId: UUID },
      ]);
      seeding.close?.();

      const { client } = await hostAt(dir, backend([]));
      const listed = await client.handle({ method: 'listSessions', params: { channel: 'ahp-root://' } }) as {
        items: { resource: string }[];
      };
      expect(listed.items.map((one) => one.resource)).toEqual(['echo:/inner']);

      // Only the chat that is the session: a second one here is a conversation
      // in a machine, which this host does not serve.
      const session = await opened(client, 'echo:/inner');
      expect(session.state.chats?.map((one) => one.resource)).toEqual([session.state.defaultChat]);
      // And the peer's URI is refused: nothing outside the machine holds a chat
      // that is inside it.
      await expect(client.handle({ method: 'subscribe', params: { channel: PEER } }))
        .rejects.toMatchObject({ code: -32001 });
    }
    finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
