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
import { chatUriFor, subagentChatUri } from '../src/host/channels.js';
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
  const THIRD = 'ahp-chat:/third';
  const LIVE = 'ahp-session:/live';
  const TWO = 'ahp-session:/two';
  const TAIL = 'ahp-chat:/tail';
  const OTHERS = 'ahp-session:/others';
  const ONBOX = 'ahp-session:/onbox';
  const EXTRA = `${DIR}/extra`;
  const MORE = `${DIR}/more`;

  const backend = (starts: Start[], pace = 0): Agent => {
    const base = echo({ path: DIR, pace });
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

  /**
   * A session with two chats, watched on both channels.
   *
   * The subscription is what puts a channel's actions on the wire, so a case
   * that reads them has to have asked for them first - the snapshot a
   * subscribe answers with says what the state *is*, and the actions after it
   * are what moved.
   */
  const chatty = async (dir: string, agent: Agent) => {
    const { client, p } = await hostAt(dir, agent);
    await client.handle({ method: 'createSession', params: { channel: LIVE, provider: 'echo' } });
    await client.handle({ method: 'createChat', params: { channel: LIVE, chat: PEER } });
    await settle();
    await opened(client, LIVE);
    await opened(client, PEER);
    return { client, p };
  };

  /**
   * A session with three chats: the one it hands out, and two peers.
   *
   * Three, because a reorder is only a reorder where there is a chat between
   * the one that moved and where it went, and two of them make every position
   * reachable.
   */
  const three = async (dir: string, agent: Agent) => {
    const { client, p } = await hostAt(dir, agent);
    await client.handle({ method: 'createSession', params: { channel: LIVE, provider: 'echo' } });
    await client.handle({ method: 'createChat', params: { channel: LIVE, chat: PEER } });
    await client.handle({ method: 'createChat', params: { channel: LIVE, chat: THIRD } });
    await settle();
    await opened(client, LIVE);
    await opened(client, PEER);
    await opened(client, THIRD);
    return { client, p };
  };

  /**
   * Two sessions, each with a chat of its own, watched on every channel.
   *
   * `LIVE` is the session a move leaves and `TWO` the one it lands in, because
   * a move between sessions changes two catalogues at once - and a client that
   * hears only one of them is holding a chat in two places or in none.
   */
  const apart = async (dir: string, agent: Agent) => {
    const { client, p } = await hostAt(dir, agent);
    /*
     * Both sessions work in `DIR`, which is what a chat's own folder set is
     * read against: a chat is its session's primary directory plus what it has
     * narrowed itself to, so a session with no directory has no folders for a
     * move to carry.
     */
    await client.handle({
      method: 'createSession',
      params: { channel: LIVE, provider: 'echo', workingDirectories: [`file://${DIR}`] },
    });
    await client.handle({ method: 'createChat', params: { channel: LIVE, chat: PEER } });
    await client.handle({
      method: 'createSession',
      params: { channel: TWO, provider: 'echo', workingDirectories: [`file://${DIR}`] },
    });
    await client.handle({ method: 'createChat', params: { channel: TWO, chat: TAIL } });
    await settle();
    for (const channel of [LIVE, PEER, TWO, TAIL]) await opened(client, channel);
    return { client, p };
  };

  /** The same backend, answering that it cannot take a conversation back. */
  const unresumable = (starts: Start[]): Agent => {
    const base = backend(starts);
    return { ...base, create: (start: Start): Session => ({ ...base.create(start), resumable: () => false }) };
  };

  /** Every `movable` a chat's own channel said, in the order it said them. */
  const moves = (p: ReturnType<typeof peer>, channel: string) => actions(p, channel)
    .filter((e) => e.action.type === 'chat/movableChanged')
    .map((e) => e.action.movable);

  /** Every order a session's channel was told, as the list each one named. */
  const reorders = (p: ReturnType<typeof peer>, channel: string) => actions(p, channel)
    .filter((e) => e.action.type === 'session/chatsReordered')
    .map((e) => e.action.chats as string[]);

  /** The chats a session lists, in the order it lists them. */
  const listed = (read: Read): (string | undefined)[] => (read.state.chats ?? []).map((one) => one.resource);

  /** What a snapshot says, which is all these cases read. */
  interface Read {
    state: {
      resource: string;
      defaultChat?: string;
      chats?: { resource: string; movable?: boolean }[];
      turns: { message?: { text?: string } }[];
      movable?: boolean;
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

  /*
   * Whether a chat may be moved, which is what a client draws a control from.
   *
   * The host is authoritative and the protocol reads a missing key as `false`,
   * so a chat that cannot move carries no `movable` at all rather than the
   * longer way of saying the same thing.
   */
  it('offers a move for a peer chat, and not for the one the session hands out', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ahpd-chats-'));
    try {
      const { client } = await chatty(join(root, 'sessions'), backend([]));
      const session = await opened(client, LIVE);
      const rows = session.state.chats ?? [];
      expect(rows.map((one) => one.resource)).toEqual([session.state.defaultChat, PEER]);
      /*
       * The chat a client gets when it names none MUST NOT move: a session
       * whose default left would have to answer a client naming no chat with a
       * question.
       */
      expect(rows[0]).not.toHaveProperty('movable');
      expect(rows[1]).toMatchObject({ resource: PEER, movable: true });

      // And the chat's own state, which is the other half of one answer: a
      // client drawing a row and a client holding the chat agree.
      expect((await opened(client, PEER)).state.movable).toBe(true);
      expect((await opened(client, session.state.defaultChat as string)).state.movable).toBeUndefined();
    }
    finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('takes the move away for the length of a turn, and gives it back after', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ahpd-chats-'));
    try {
      const { client, p } = await chatty(join(root, 'sessions'), backend([]));
      await send(client, PEER, 't1', 'over here');

      // A move closes the backend and starts it again, and a turn is the one
      // thing that must not be cut in half - so the chat says so at both ends.
      expect(moves(p, PEER)).toEqual([false, true]);

      // And the row says it too, because a client watching the list is not
      // looking at the chat. `false` has to be carried rather than left out: a
      // partial is spread over the row, and a key that is not there leaves the
      // client holding the `true` it was handed.
      const told = actions(p, LIVE)
        .filter((e) => e.action.type === 'session/chatUpdated' && e.action.chat === PEER)
        .map((e) => (e.action.changes as { movable?: boolean }).movable);
      expect(told).toContain(false);
      expect(told.at(-1)).toBe(true);
    }
    finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('holds a chat where it is while a worker of it runs', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ahpd-chats-'));
    try {
      const starts: Start[] = [];
      const { client, p } = await chatty(join(root, 'sessions'), backend(starts));
      expect((await opened(client, PEER)).state.movable).toBe(true);

      // A worker, opened by the backend on the start the host handed it. A move
      // takes a chat's workers with it, so one running a turn is the chat's own
      // delay.
      const worker = starts.at(-1)?.subagent?.('toolu_task', { title: 'Explore', prompt: 'list the files' });
      await settle();
      expect((await opened(client, PEER)).state.movable).toBeUndefined();
      /*
       * And a worker is not a move of its own. It is a chat of the session and
       * the catalogue names it, but nothing holds it as a chat a client opened,
       * so there is nothing to move rather than a move that is refused.
       */
      expect(worker).toBeDefined();
      await expect(client.handle({
        method: 'moveChat',
        params: { channel: worker?.uri, destination: { kind: 'session', session: LIVE } },
      })).rejects.toThrow(/No chat at/);

      worker?.end('complete');
      await settle();
      expect((await opened(client, PEER)).state.movable).toBe(true);
      expect(moves(p, PEER)).toEqual([false, true]);
    }
    finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('takes the move away from a chat that becomes the default', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ahpd-chats-'));
    try {
      const { client, p } = await chatty(join(root, 'sessions'), backend([]));
      const first = (await opened(client, LIVE)).state.defaultChat as string;
      expect((await opened(client, PEER)).state.movable).toBe(true);

      await client.handle({ method: 'disposeChat', params: { channel: first } });
      await settle();

      // `default` is a role and not a chat, so the chat that took it over is
      // now the one the session hands out - and it stops being movable without
      // anybody having to speak to it again.
      expect((await opened(client, LIVE)).state.defaultChat).toBe(PEER);
      expect((await opened(client, PEER)).state.movable).toBeUndefined();
      expect(moves(p, PEER)).toEqual([false]);
    }
    finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('offers no move for a chat its backend cannot take back', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ahpd-chats-'));
    try {
      const { client, p } = await chatty(join(root, 'sessions'), unresumable([]));

      // A move starts the backend again with the id it kept the conversation
      // under, and this one has said it cannot be asked for one. So the chat is
      // never offered - and nothing is said about it either, because nothing
      // about it has moved.
      expect((await opened(client, PEER)).state.movable).toBeUndefined();
      await send(client, PEER, 't1', 'over here');
      expect((await opened(client, PEER)).state.movable).toBeUndefined();
      expect(moves(p, PEER)).toEqual([]);
    }
    finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  /*
   * Where a chat sits in its session, which is the whole of a move that stays
   * inside one.
   *
   * The chat keeps its process, its turns and its folders, so nothing is
   * started and nothing is read back: the list a client draws is the only thing
   * that changes, and `session/chatsReordered` is what says so.
   */
  it('says the whole new order when a chat is put behind another', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ahpd-chats-'));
    try {
      const starts: Start[] = [];
      const { client, p } = await three(join(root, 'sessions'), backend(starts));
      const first = (await opened(client, LIVE)).state.defaultChat as string;
      /*
       * A worker on the peer chat, which is a chat of the session without being
       * one a client opened.
       *
       * Every chat has to be named in the order, worker included, and a worker
       * sits after every peer - so a host that named only the chats it holds
       * would send a list the reducer takes for a list of the wrong length and
       * drops. The chat that moves is the third, because a chat carrying a
       * running worker is one that cannot move.
       */
      const worker = starts.find((one) => one.chatId === UUID)
        ?.subagent?.('toolu_task', { title: 'Explore', prompt: 'list the files' });
      await settle();
      expect(worker).toBeDefined();

      const answer = await client.handle({
        method: 'moveChat',
        params: { channel: THIRD, destination: { kind: 'session', session: LIVE, after: first } },
      }) as { session: string };
      await settle();

      /*
       * One action, naming every chat once, in the new order.
       *
       * The reducer takes a list that is any other length or names anything it
       * does not hold as a no-op, so a host that sent only the movement would
       * be changing nothing at all - and it has to be one action for the same
       * reason: a client that drew the list between two of them would show an
       * order this host never said.
       */
      const order = listed(await opened(client, LIVE));
      expect(order.slice(0, 3)).toEqual([first, THIRD, PEER]);
      // The worker last, which is where a worker sits: after every chat the
      // session holds, because the host holds it rather than a `Session`.
      expect(order[3]).toMatch(/^ahp-chat:\/\/subagent\//);
      expect(order[3]).toContain('toolu_task');
      expect(reorders(p, LIVE)).toEqual([order]);

      /*
       * And the answer names the session the chat is in, under the name this
       * host publishes it as rather than the alias this client asked with.
       *
       * That is where a client that asked for a move between sessions reads the
       * one it landed in, so it has to be a name the host answers about - the
       * same one a catalogue row offers.
       */
      expect(answer.session).toBe('echo:/live');
      const published = listed(await opened(client, answer.session));
      expect(published).toHaveLength(4);
      expect(published.indexOf(THIRD)).toBeLessThan(published.indexOf(PEER));

      worker?.end('complete');
    }
    finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('puts a chat first when it was given nothing to sit behind', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ahpd-chats-'));
    try {
      const { client, p } = await three(join(root, 'sessions'), backend([]));
      const first = (await opened(client, LIVE)).state.defaultChat as string;

      // `after` is optional and its absence is not "leave it where it is": it
      // is the beginning of the catalogue, which is the one place no anchor
      // can name.
      await client.handle({
        method: 'moveChat',
        params: { channel: PEER, destination: { kind: 'session', session: LIVE } },
      });
      await settle();
      expect(reorders(p, LIVE)).toEqual([[PEER, first, THIRD]]);
      expect(listed(await opened(client, LIVE))).toEqual([PEER, first, THIRD]);
    }
    finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('refuses a move it cannot make, and leaves the order alone', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ahpd-chats-'));
    try {
      const { client, p } = await three(join(root, 'sessions'), backend([]));
      const first = (await opened(client, LIVE)).state.defaultChat as string;
      const before = listed(await opened(client, LIVE));
      const ask = (channel: string, destination: unknown) =>
        client.handle({ method: 'moveChat', params: { channel, destination } });

      // The chat the session hands out, which the protocol says MUST NOT move.
      await expect(ask(first, { kind: 'session', session: LIVE }))
        .rejects.toThrow(/cannot be moved/);
      /*
       * A chat this host is not running, which is not a chat at all here.
       *
       * Read the way every other method reads a chat: one under a session this
       * host does not know resolves to the first chat that session would have,
       * which is nothing this host is holding either - so the sentence names
       * that resolution rather than the URI the client wrote.
       */
      await expect(ask('ahp-chat:/nowhere', { kind: 'session', session: LIVE }))
        .rejects.toThrow(/No chat at/);
      // A destination this host does not know, and none at all.
      await expect(ask(PEER, { kind: 'somewhere' }))
        .rejects.toThrow(/is not one this host serves yet/);
      await expect(ask(PEER, {}))
        .rejects.toThrow(/needs a destination/);
      // A session it is not in, which is a move between sessions - and this
      // host is not running that session, so there is nowhere to put it.
      await expect(ask(PEER, { kind: 'session', session: 'ahp-session:/elsewhere' }))
        .rejects.toThrow(/is not a session this host is running/);
      // Itself as its own anchor, and an anchor this session does not hold.
      await expect(ask(PEER, { kind: 'session', session: LIVE, after: PEER }))
        .rejects.toThrow(/cannot be placed after itself/);
      await expect(ask(PEER, { kind: 'session', session: LIVE, after: 'ahp-chat:/nowhere' }))
        .rejects.toThrow(/is not a chat in/);

      // A rejection is a rejection: no action and no reordering, so a client
      // that was told no holds the list it already had.
      await settle();
      expect(reorders(p, LIVE)).toEqual([]);
      expect(listed(await opened(client, LIVE))).toEqual(before);
    }
    finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('holds a chat where it is while a turn of it is running', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ahpd-chats-'));
    try {
      // One word at a time, so the turn is still in flight when the move is
      // asked for: a move closes a process and starts another, and there is no
      // half of a turn to do that in.
      const { client, p } = await three(join(root, 'sessions'), backend([], 50));
      void client.handle({
        method: 'dispatchAction',
        params: { channel: THIRD, action: { type: 'chat/turnStarted', turnId: 't1', message: { text: 'hold on now' } } },
      });
      await settle();

      await expect(client.handle({
        method: 'moveChat',
        params: { channel: THIRD, destination: { kind: 'session', session: LIVE } },
      })).rejects.toThrow(/cannot be moved/);
      expect(reorders(p, LIVE)).toEqual([]);

      // And it is the turn rather than the chat: once the words are out, the
      // same move goes through.
      const until = Date.now() + 10_000;
      while ((await opened(client, THIRD)).state.movable !== true && Date.now() < until)
        await new Promise((r) => { setTimeout(r, 10); });
      expect((await opened(client, THIRD)).state.movable).toBe(true);
      await client.handle({
        method: 'moveChat',
        params: { channel: THIRD, destination: { kind: 'session', session: LIVE } },
      });
      await settle();
      expect(reorders(p, LIVE)).toHaveLength(1);
    }
    finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('keeps the order it was given over a restart', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ahpd-chats-'));
    try {
      const dir = join(root, 'sessions');
      const agent = backend([]);
      const first = await three(dir, agent);
      await send(first.client, LIVE, 't1', 'first');
      await send(first.client, PEER, 't2', 'second');
      await send(first.client, THIRD, 't3', 'third');
      const lead = (await opened(first.client, LIVE)).state.defaultChat as string;
      await first.client.handle({
        method: 'moveChat',
        params: { channel: THIRD, destination: { kind: 'session', session: LIVE, after: lead } },
      });
      await settle();
      // The store writes on the tick after the change, so the second host
      // starts on a folder that has all of it rather than on a race.
      await new Promise((tick) => { setTimeout(tick, 5); });

      /*
       * A second host over the same folder.
       *
       * A reorder nobody wrote down is a reorder that lasts until the daemon
       * is restarted, which a person finds out about days later - so the order
       * a restart rebuilds the chats in is the one the move asked for, and not
       * the one they were opened in.
       */
      const second = await hostAt(dir, agent);
      const session = await opened(second.client, 'echo:/live');
      expect(listed(session)).toEqual([session.state.defaultChat, THIRD, PEER]);
    }
    finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  /*
   * A chat moved into another session, which is the other half of what a move
   * is.
   *
   * The two sessions are two processes and two conversations, so the chat
   * cannot be carried across in memory: it is closed here and started there,
   * on the name its backend keeps it under and on the turns it had, in the
   * folders it was working in. Everything a client holds is what the actions
   * say, and the store is what a restart reads.
   */
  it('moves a chat into another session, with its turns and its own folders', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ahpd-chats-'));
    try {
      const starts: Start[] = [];
      const { client, p } = await apart(join(root, 'sessions'), backend(starts));
      /*
       * Folders for the chat to keep, narrower than its session's.
       *
       * A chat works in a subset of its session's folders, so what travels is
       * the chat's own set: one moved beside a session working somewhere else
       * goes on where it was, and one narrowed to a folder of its own arrives
       * narrowed rather than with everything its old session had.
       */
      for (const directory of [EXTRA, MORE]) {
        void client.handle({
          method: 'dispatchAction',
          params: { channel: LIVE, action: { type: 'session/workingDirectorySet', directory: `file://${directory}` } },
        });
        await settle(20);
      }
      void client.handle({
        method: 'dispatchAction',
        params: { channel: PEER, action: { type: 'chat/workingDirectoryRemoved', directory: `file://${MORE}` } },
      });
      await settle(20);
      await send(client, PEER, 't1', 'over here');
      const before = starts.length;
      const lead = (await opened(client, TWO)).state.defaultChat as string;

      const answer = await client.handle({
        method: 'moveChat',
        params: { channel: PEER, destination: { kind: 'session', session: TWO, after: TAIL } },
      }) as { session: string };
      await settle(20);

      /*
       * One start, and it is the chat: the destination resumes the
       * conversation the backend kept under the chat's own name, seeded with
       * the turns it had, in the folders it was working in.
       */
      expect(resuming(starts.slice(before))).toEqual([{ chatId: UUID, resume: UUID, first: 'over here' }]);
      const mine = starts.at(-1) as Start;
      expect(mine.uri).toBe('echo:/two');
      expect(mine.workingDirectory).toBe(DIR);
      expect(mine.additional).toEqual([EXTRA]);
      // The session it landed in, published under a name a client can ask about.
      expect(answer.session).toBe('echo:/two');

      // Out of the source's list, and into the destination's after the anchor.
      const from = await opened(client, LIVE);
      expect(listed(from)).toEqual([from.state.defaultChat]);
      const there = await opened(client, TWO);
      expect(listed(there)).toEqual([lead, TAIL, PEER]);
      expect(reorders(p, TWO).at(-1)).toEqual([lead, TAIL, PEER]);

      /*
       * And the actions a client that was watching both channels holds: the
       * chat leaves one session before it arrives at the other, because a
       * client told the other way round holds it twice.
       */
      const left = actions(p, LIVE).map((e) => e.action);
      expect(left.some((one) => one.type === 'session/chatRemoved' && one.chat === PEER)).toBe(true);
      expect(actions(p, TWO).some((one) => one.action.type === 'session/chatAdded'
        && (one.action.summary as { resource?: string }).resource === PEER)).toBe(true);
      /*
       * And the root rows, which is the catalogue both sessions are drawn from.
       *
       * A row carries the time of its newest chat, so the chat arriving moves
       * the destination's row forward and the chat leaving moves the source's
       * row back to the newest of what it still holds. A row that kept the
       * moved chat's time is a row a client draws in the wrong place.
       */
      const rows = p.notes
        .filter((n) => n.method === 'root/sessionSummaryChanged')
        .map((n) => n.params as { session: string; changes: { modifiedAt?: string } });
      const cameTo = rows.filter((one) => one.session === 'echo:/two');
      const wentFrom = rows.filter((one) => one.session === 'echo:/live');
      expect(cameTo.at(-1)?.changes.modifiedAt).toBeDefined();
      expect(wentFrom.at(-1)?.changes.modifiedAt).toBeDefined();
      expect((wentFrom.at(-1) as { changes: { modifiedAt: string } }).changes.modifiedAt
        < (wentFrom.at(-2) as { changes: { modifiedAt: string } }).changes.modifiedAt).toBe(true);

      // Its turns came with it, and it goes on from there.
      expect(said(await opened(client, PEER))).toEqual(['over here']);
      await send(client, PEER, 't2', 'and again');
      expect(said(await opened(client, PEER))).toEqual(['over here', 'and again']);
    }
    finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('takes the workers of a moved chat with it, and answers for them where they are', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ahpd-chats-'));
    try {
      const starts: Start[] = [];
      const { client, p } = await apart(join(root, 'sessions'), backend(starts));
      // A worker on the chat that is about to move, which is a chat of the
      // session that is not one a client opened.
      const worker = starts.find((one) => one.chatId === UUID)
        ?.subagent?.('toolu_task', { title: 'Explore', prompt: 'list the files' });
      await settle();
      expect(worker).toBeDefined();
      /*
       * Two spellings of one name. The host mints it from the session it holds,
       * and a client is answered in the session it knows: this one opened `LIVE`
       * as `ahp-session:/live`, so a worker announced on that channel is named
       * with that inside it. The name is the same chat either way, and which
       * one a client holds is which one it was handed.
       */
      const called = subagentChatUri('echo:/live', 'toolu_task');
      const asSaid = subagentChatUri(LIVE, 'toolu_task');
      /*
       * Ended before the move, because a worker mid-turn is the chat's own
       * delay: the move closes the process the worker runs in, and nothing may
       * be running when it does.
       */
      worker?.end('complete');
      await settle();

      await client.handle({
        method: 'moveChat',
        params: { channel: PEER, destination: { kind: 'session', session: TWO, after: TAIL } },
      });
      await settle(20);

      /*
       * A worker is a conversation inside a call of a chat, so it goes where
       * the call goes - and its name does not change: it names the session the
       * worker was opened in, and a client holding that name must not be handed
       * a second one.
       */
      const from = await opened(client, LIVE);
      expect(listed(from)).toEqual([from.state.defaultChat]);
      const there = await opened(client, TWO);
      expect(listed(there)).toEqual([there.state.defaultChat, TAIL, PEER, called]);
      expect(actions(p, LIVE).some((e) => e.action.type === 'session/chatRemoved' && e.action.chat === asSaid)).toBe(true);
      /*
       * And it still answers for itself. The session inside its name is the one
       * it was opened in rather than the one holding it now, so a host that
       * read the session out of the name would answer a client about a chat of
       * the session it left.
       */
      const openedWorker = await opened(client, called);
      expect(openedWorker.state.resource).toBe(called);
      expect(openedWorker.state.turns.length).toBeGreaterThan(0);
    }
    finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('refuses a move to another provider, another computer, or a session it is not running', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ahpd-chats-'));
    try {
      const starts: Start[] = [];
      /*
       * Three sessions: the chat's own, one of another backend, and one in a
       * machine. A session of another backend keeps its conversations in
       * another format on another disk, and a chat's folders are paths on the
       * machine it ran on - so neither move is one this host can make, and both
       * are refused with the difference named.
       */
      const host = createHost({
        path: DIR,
        agents: [backend(starts), claude({ paths: [DIR] })],
        ...machine(),
        sessions: fileSessions({ dir: join(root, 'sessions') }),
      });
      const p = peer();
      p.request = async () => ({ trusted: true });
      const client = host.accept(p);
      await client.handle(hello(['0.9.0'], { initialSubscriptions: ['ahp-root://'] }));
      await client.handle({ method: 'createSession', params: { channel: LIVE, provider: 'echo' } });
      await client.handle({ method: 'createChat', params: { channel: LIVE, chat: PEER } });
      await client.handle({ method: 'createSession', params: { channel: OTHERS, provider: 'claude' } });
      await client.handle({
        method: 'createSession',
        params: { channel: ONBOX, provider: 'echo', config: { computer: 'computer://box' } },
      });
      await settle(20);
      await opened(client, LIVE);
      const before = starts.length;

      await expect(client.handle({
        method: 'moveChat',
        params: { channel: PEER, destination: { kind: 'session', session: OTHERS } },
      })).rejects.toThrow(/between providers is not supported yet/);
      await expect(client.handle({
        method: 'moveChat',
        params: { channel: PEER, destination: { kind: 'session', session: ONBOX } },
      })).rejects.toThrow(/between computers is not supported yet/);
      await expect(client.handle({
        method: 'moveChat',
        params: { channel: PEER, destination: { kind: 'session', session: 'ahp-session:/nowhere' } },
      })).rejects.toThrow(/is not a session this host is running/);

      /*
       * Nothing was started and nothing moved: a refusal that closed the chat
       * and left its record in the destination would be a conversation nobody
       * can open, and one the client was told had not moved.
       */
      await settle(20);
      expect(starts.length).toBe(before);
      const from = await opened(client, LIVE);
      expect(listed(from)).toEqual([from.state.defaultChat, PEER]);
      expect(reorders(p, LIVE)).toEqual([]);
    }
    finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('leaves a chat in its session when the destination will not start it', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ahpd-chats-'));
    try {
      const starts: Start[] = [];
      const base = backend(starts);
      // A destination that will not take the conversation: the host asks it to
      // start the chat, and it says no.
      const refusing: Agent = {
        ...base,
        create: (start: Start): Session => {
          if (start.chatUri === PEER && start.uri === 'echo:/two')
            throw new Error('this backend will not work there');
          return base.create(start);
        },
      };
      const { client, p } = await apart(join(root, 'sessions'), refusing);
      await send(client, PEER, 't1', 'over here');

      await expect(client.handle({
        method: 'moveChat',
        params: { channel: PEER, destination: { kind: 'session', session: TWO } },
      })).rejects.toThrow(/will not work there/);
      await settle(20);

      /*
       * The chat is where it was, with a process behind it again and its turns
       * read back - and the client was told nothing had moved, so the two have
       * to agree.
       */
      const from = await opened(client, LIVE);
      expect(listed(from)).toEqual([from.state.defaultChat, PEER]);
      expect(reorders(p, LIVE)).toEqual([]);
      expect(reorders(p, TWO)).toEqual([]);
      await send(client, PEER, 't2', 'and again');
      expect(said(await opened(client, PEER))).toEqual(['over here', 'and again']);

      // And nowhere has it arrived: the destination holds its own chat only.
      const there = await opened(client, TWO);
      expect(listed(there)).toEqual([there.state.defaultChat, TAIL]);
    }
    finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('makes a session for a moved chat, and it lists once after a restart', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ahpd-chats-'));
    try {
      const dir = join(root, 'sessions');
      const starts: Start[] = [];
      // One backend behind both hosts, which is what a daemon restarting is: the
      // process that holds the conversations is the same one, and the listing
      // it answers from is the same listing.
      const agent = backend(starts);
      const first = await chatty(dir, agent);
      await send(first.client, PEER, 't1', 'over here');
      /*
       * And one turn in the session the chat leaves, because a backend holds a
       * conversation from the turn it ends: a session nothing was ever said to
       * is a session no listing has a row for, and this one is read back from
       * one.
       */
      const outgoing = (await opened(first.client, LIVE)).state.defaultChat as string;
      await send(first.client, outgoing, 't0', 'the one it leaves');
      const before = starts.length;

      const answer = await first.client.handle({
        method: 'moveChat',
        params: { channel: PEER, destination: { kind: 'newSession' } },
      }) as { session: string };
      await settle(20);

      /*
       * The session is named after the chat's own conversation, which is the
       * name a restart resumes it by. A session named anything else would hold
       * that conversation as a second session beside it, and a listing would
       * offer the same transcript twice.
       */
      expect(answer.session).toBe(`echo:/${UUID}`);
      expect(resuming(starts.slice(before))).toEqual([{ chatId: UUID, resume: UUID, first: 'over here' }]);
      expect(starts.at(-1)?.uri).toBe(`echo:/${UUID}`);

      const there = await opened(first.client, answer.session);
      expect(there.state.defaultChat).toBe(PEER);
      expect(listed(there)).toEqual([PEER]);
      /*
       * The one chat a session has is the one a client gets when it names none,
       * and the protocol says that chat MUST NOT move. So the chat that could
       * be moved a moment ago cannot be now, and the client is told.
       */
      expect(moves(first.p, PEER).at(-1)).toBe(false);
      expect((await opened(first.client, PEER)).state.movable).toBeUndefined();
      // The session it left has its own chat and no other.
      const from = await opened(first.client, LIVE);
      expect(listed(from)).toEqual([from.state.defaultChat]);

      // The store writes on the tick after the change, so the second host
      // starts on a folder that has all of it rather than on a race.
      await new Promise((tick) => { setTimeout(tick, 5); });

      /*
       * A second host over the same folder.
       *
       * The chat is a chat of the session it was given, so it comes back as
       * that session's chat and not as a session of its own - and the turns it
       * had come back with it.
       */
      const second = await hostAt(dir, agent);
      const rows = await second.client.handle({ method: 'listSessions', params: { channel: 'ahp-root://' } }) as {
        items: { resource: string }[];
      };
      expect(rows.items.map((one) => one.resource).sort()).toEqual([`echo:/${UUID}`, 'echo:/live']);
      const after = await opened(second.client, `echo:/${UUID}`);
      expect(after.state.defaultChat).toBe(PEER);
      expect(listed(after)).toEqual([PEER]);
      expect(said(await opened(second.client, PEER))).toEqual(['over here']);
      // And the session it came back with is itself, not a chat of another one.
      const backAgain = await opened(second.client, 'echo:/live');
      expect(listed(backAgain)).toEqual([backAgain.state.defaultChat]);

      const was = starts.length;
      await send(second.client, PEER, 't2', 'and again');
      expect(resuming(starts.slice(was))).toEqual([{ chatId: UUID, resume: UUID, first: 'over here' }]);
      expect(said(await opened(second.client, PEER))).toEqual(['over here', 'and again']);
    }
    finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
