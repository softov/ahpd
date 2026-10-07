import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  resetSdk, actions, emit, hello, open, peer, sdk, serving,
  sessionQueries, settle, running,
} from './support/host.js';
import { undeclaredIn } from './support/wire.js';

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
     * are allowed different things. This used to be `host.ts` knowing the name
     * `permissionMode`; it is now the backend's schema saying so.
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
});
