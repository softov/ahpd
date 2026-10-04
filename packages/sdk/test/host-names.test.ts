import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  resetSdk, actions, claude, createHost, hello, machine, open,
  peer, sdk, serving, sessionQueries, settle, running,
} from './support/host.js';

vi.mock('@anthropic-ai/claude-agent-sdk', async () => (await import('./support/claude-sdk.js')).fake);

beforeEach(resetSdk);

/*
 * The other spelling of a chat URI.
 *
 * This host mints `ahp-chat:/<id>` because that is the form the specification
 * documents, and it says in as many words that the owning session is *not*
 * encoded in a chat URI. VS Code derives `ahp-chat://default/<base64url>` from
 * the session instead of reading `chats`, so against a conformant host it
 * subscribes to a channel that does not exist and draws the pane from that one.
 * Both are answered; only one is published.
 */
describe('a chat asked for by the name a client computed', () => {
  const derived = (session: string) =>
    `ahp-chat://default/${Buffer.from(session, 'utf8').toString('base64url')}`;

  it('answers about a live session\'s chat, under the name that was used', async () => {
    const { client, uri, chatUri } = await running();
    const alias = derived(uri);

    const own = await client.handle({ method: 'subscribe', params: { channel: chatUri } }) as {
      snapshot: { state: { turns: unknown[] } };
    };
    const same = await client.handle({ method: 'subscribe', params: { channel: alias } }) as {
      snapshot: { resource: string; state: { turns: unknown[] } };
    };
    // The same conversation...
    expect(same.snapshot.state.turns).toEqual(own.snapshot.state.turns);
    // ...answered about the URI the client asked about, because that is the
    // one its subscription is keyed by.
    expect(same.snapshot.resource).toBe(alias);
  });

  it('sends the conversation on under the name it was asked for', async () => {
    const { client, peer: p, uri, chatUri } = await running();
    const alias = derived(uri);
    await client.handle({ method: 'subscribe', params: { channel: alias } });

    client.handle({
      method: 'dispatchAction',
      params: { channel: alias, clientSeq: 4, action: { type: 'chat/turnStarted', turnId: 't1', message: { text: 'hi' } } },
    });
    await settle();

    // Driven through the alias, and heard back through it: a client watching
    // one name and told about another has been told nothing.
    expect(sdk.said).toEqual(['hi']);
    const said = actions(p, alias).find((e) => e.action.type === 'chat/turnStarted');
    expect(said?.origin).toEqual({ clientId: 'probe', clientSeq: 4 });
    // And the canonical channel is what this host publishes, so a client that
    // read `chats` is watching that one and is unaffected.
    expect(actions(p, chatUri).some((e) => e.action.type === 'chat/turnStarted')).toBe(true);
  });

  it('leaves a chat URI it did not mint alone', async () => {
    const { client } = await running();
    // Not base64, and not a chat id anybody can compute.
    await expect(client.handle({ method: 'subscribe', params: { channel: 'ahp-chat://peer/not-base64!' } }))
      .rejects.toMatchObject({ code: -32001 });
  });
});

/*
 * A session created by a client, and the name it goes on disk under.
 */
describe('a session a client names', () => {
  it('is stored under the id the client chose, so it survives a restart', async () => {
    const client = open();
    await client.handle(hello(['0.9.0']));
    const uri = 'claude:/d65884b6-d15e-4bec-b4b8-ae44d17765dd';
    await client.handle({ method: 'createSession', params: { channel: uri, provider: 'claude' } });

    /*
     * The backend invents an id of its own unless it is given one, and writes
     * the transcript under that. A session created here then lived on disk
     * under a name its client had never heard of: while this daemon ran it
     * answered to both, and the moment it restarted the client's own URI was
     * dead - `No agent for session`, for ever, about a session that was there.
     */
    expect(sessionQueries()[0]?.options.sessionId).toBe('d65884b6-d15e-4bec-b4b8-ae44d17765dd');
  });

  it('leaves a name the backend would not take alone', async () => {
    const { client } = await running();
    // `ahp-session:/live` - a name, and not a UUID. Asking the backend to use
    // it would be refused, so the backend names this one and nothing is lost
    // that was not already lost.
    expect(sessionQueries()[0]?.options.sessionId).toBeUndefined();
  });

  it('holds a session created under another scheme as its provider\'s, and answers its creator in its own', async () => {
    const id = '39c2a6f0-8c1e-4d7a-9b6e-2f1d3c4b5a69';
    const p = peer();
    const client = serving('/home/softov').accept(p);
    await client.handle(hello(['0.9.0'], { initialSubscriptions: ['ahp-root://'] }));
    await client.handle({ method: 'createSession', params: { channel: `ahp-session:/${id}`, provider: 'claude' } });

    // Listed and announced the way it is after a restart, which is the name
    // VS Code routes on.
    const listed = await client.handle({ method: 'listSessions', params: { channel: 'ahp-root://' } }) as {
      items: { resource: string }[];
    };
    expect(listed.items.map((one) => one.resource)).toEqual([`claude:/${id}`]);
    const added = p.notes.filter((n) => n.method === 'root/sessionAdded')
      .map((n) => (n.params as { summary: { resource: string } }).summary.resource);
    expect(added).toEqual([`claude:/${id}`]);

    // The creator's own name is still the session, in its own spelling.
    const opened = await client.handle({ method: 'subscribe', params: { channel: `ahp-session:/${id}` } }) as {
      snapshot: { resource: string; state: { defaultChat: string } };
    };
    expect(opened.snapshot.resource).toBe(`ahp-session:/${id}`);
    expect(opened.snapshot.state.defaultChat)
      .toBe(`ahp-chat://default/${Buffer.from(`ahp-session:/${id}`, 'utf8').toString('base64url')}`);
    // And the backend is handed the id, never the scheme.
    expect(sessionQueries()[0]?.options.sessionId).toBe(id);
  });

  it('refuses a session whose id another provider already holds', async () => {
    const { echo } = await import('../../../examples/echo/agent.js');
    const id = '5d0c9e8b-7a6f-4e3d-8c2b-1a0f9e8d7c6b';
    const host = createHost({
      path: '/home/softov',
      agents: [claude({ paths: ['/home/softov'] }), { ...echo({ path: '/home/softov', pace: 0 }), provider: 'codex', displayName: 'Codex' }],
      ...machine(),
    });
    const client = host.accept(peer());
    await client.handle(hello(['0.9.0']));
    await client.handle({ method: 'createSession', params: { channel: `claude:/${id}`, provider: 'claude' } });
    // The id is what everything kept about a session is stored by, so a
    // second one under it would share the first one's flags, config and marks.
    await expect(client.handle({ method: 'createSession', params: { channel: `ahp-session:/${id}`, provider: 'codex' } }))
      .rejects.toMatchObject({ code: -32003 });
    const listed = await client.handle({ method: 'listSessions', params: { channel: 'ahp-root://' } }) as {
      items: { resource: string }[];
    };
    expect(listed.items.map((one) => one.resource)).toEqual([`claude:/${id}`]);
  });

  it('refuses a held id before it makes anything for the new session', async () => {
    const { echo } = await import('../../../examples/echo/agent.js');
    const asked: string[] = [];
    const host = createHost({
      path: '/tmp',
      agents: [echo({ path: '/tmp', pace: 0 })],
      ...machine(),
      worktrees: {
        repository: async (dir) => { asked.push(dir); return dir; },
        branches: async () => [],
        create: async () => {},
        dirty: async () => false,
        remove: async () => {},
      },
    });
    const client = host.accept(peer());
    await client.handle(hello(['0.9.0']));
    await client.handle({ method: 'createSession', params: { channel: 'ahp-session:/dup', provider: 'echo' } });
    await expect(client.handle({
      method: 'createSession',
      params: { channel: 'elsewhere:/dup', provider: 'echo', workingDirectories: ['file:///tmp'], config: { isolation: 'worktree' } },
    })).rejects.toMatchObject({ code: -32003 });
    // No worktree was asked for on the refused one's behalf.
    expect(asked).toEqual([]);
  });

  it('refuses the id of a session a backend keeps on disk', async () => {
    const { echo } = await import('../../../examples/echo/agent.js');
    const stamp = new Date(0).toISOString();
    const host = createHost({
      path: '/tmp',
      agents: [{ ...echo({ path: '/tmp', pace: 0 }), list: async () => [{ id: 'kept', title: 'Kept', createdAt: stamp, modifiedAt: stamp, workingDirectories: ['file:///tmp'] }] }],
      ...machine(),
    });
    const client = host.accept(peer());
    await client.handle(hello(['0.9.0']));
    await client.handle({ method: 'listSessions', params: { channel: 'ahp-root://' } });
    await expect(client.handle({ method: 'createSession', params: { channel: 'ahp-session:/kept', provider: 'echo' } }))
      .rejects.toMatchObject({ code: -32003 });
  });
});

/*
 * A session asked for by the name its client computed.
 *
 * A session URI is the client's to name, and VS Code names one after the
 * session's *provider* - `claude:/<uuid>` - for a row this host listed as
 * `ahp-session:/<uuid>`. The id is the same and only the id is read, so both
 * arrive at the same session; what differed was everything this host then said
 * back, because a chat URI is built from a session URI and every key here is a
 * session URI.
 */
describe('a session asked for by the name a client computed', () => {
  const listed = { sessionId: 'row', summary: 'A real title', lastModified: 1_700_000_000_000, cwd: '/home/softov' };
  const derived = (session: string) =>
    `ahp-chat://default/${Buffer.from(session, 'utf8').toString('base64url')}`;

  const browsing = async () => {
    sdk.sessions.push(listed);
    sdk.transcript.push({ type: 'user', uuid: 'u1', message: { role: 'user', content: 'earlier' } });
    const client = open();
    await client.handle(hello(['0.9.0']));
    // Listed first: that is when this host learns whose the row is, and it is
    // what a client does before it opens one.
    await client.handle({ method: 'listSessions', params: { channel: 'ahp-root://' } });
    return client;
  };

  it('names its chat after the name it was asked under', async () => {
    const client = await browsing();
    const opened = await client.handle({ method: 'subscribe', params: { channel: 'claude:/row' } }) as {
      snapshot: { resource: string; state: { resource: string; defaultChat: string; chats: { resource: string }[] } };
    };

    // Everything that names this session, spelled the one way the client can
    // pair up: the chat it computes from `claude:/row` is the chat the session
    // says it has. Told otherwise, it subscribes to one string, is handed
    // another, and renders nothing at all.
    expect(opened.snapshot.resource).toBe('claude:/row');
    expect(opened.snapshot.state.resource).toBe('claude:/row');
    expect(opened.snapshot.state.defaultChat).toBe(derived('claude:/row'));
    expect(opened.snapshot.state.chats[0]?.resource).toBe(derived('claude:/row'));
  });

  it('names a listed session after its provider', async () => {
    const client = await browsing();
    const listed = await client.handle({ method: 'listSessions', params: { channel: 'ahp-root://' } }) as {
      items: { resource: string }[];
    };
    /*
     * One name, and the one the only other implementation computes. It builds
     * a session URI as `<provider>:/<id>` both when it creates a session and
     * when it reopens one it listed; publishing `ahp-session:/<id>` gave it
     * two strings for the same session and it picked between them out of its
     * own stored state - the same conversation, the same bytes behind it,
     * drawing or not depending on which it happened to reach for.
     */
    expect(listed.items[0]?.resource).toBe('claude:/row');
  });

  it('still answers to the name it used to publish', async () => {
    const client = await browsing();
    await client.handle({ method: 'listSessions', params: { channel: 'ahp-root://' } });
    // Only the id inside a session URI is ever read, so the older spelling is
    // still the same session - and anything holding one is not broken by this.
    const opened = await client.handle({ method: 'subscribe', params: { channel: 'ahp-session:/row' } }) as {
      snapshot: { resource: string; state: { title: string } };
    };
    expect(opened.snapshot.resource).toBe('ahp-session:/row');
    expect(opened.snapshot.state.title).toBe('A real title');
  });

  it('says a person started the chat', async () => {
    const client = await browsing();
    const opened = await client.handle({ method: 'subscribe', params: { channel: derived('claude:/row') } }) as {
      snapshot: { state: { origin?: { kind: string } } };
    };
    // `ChatOrigin`'s four kinds are `user`, `fork`, `sideChat` and `tool`.
    // A transcript is a conversation somebody typed, so it is the first.
    expect(opened.snapshot.state.origin).toEqual({ kind: 'user' });

    const session = await client.handle({ method: 'subscribe', params: { channel: 'claude:/row' } }) as {
      snapshot: { state: { chats: { origin?: { kind: string } }[] } };
    };
    // And the row in the session's catalogue says the same, because a client
    // reads a chat's origin off whichever of the two it has.
    expect(session.snapshot.state.chats[0]?.origin).toEqual({ kind: 'user' });
  });

  it('serves that chat the transcript', async () => {
    const client = await browsing();
    const chat = await client.handle({ method: 'subscribe', params: { channel: derived('claude:/row') } }) as {
      snapshot: { state: { turns: unknown[] } };
    };
    expect(chat.snapshot.state.turns.length).toBeGreaterThan(0);
  });

  it('records a flag against the row the catalogue lists', async () => {
    const client = await browsing();
    client.handle({
      method: 'dispatchAction',
      params: { channel: 'claude:/row', action: { type: 'session/isReadChanged', isRead: true } },
    });
    await settle();

    // Idle, and read. Kept under the client's spelling it would have been
    // written to a key nothing ever reads, and the row would come back unread.
    const rows = await client.handle({ method: 'listSessions', params: { channel: 'ahp-root://' } }) as {
      items: { status: number }[];
    };
    expect(rows.items[0]?.status).toBe(33);
  });

  it('resumes the session that name belongs to', async () => {
    const client = await browsing();
    client.handle({
      method: 'dispatchAction',
      params: {
        channel: derived('claude:/row'),
        action: { type: 'chat/turnStarted', turnId: 't1', message: { text: 'and now?' } },
      },
    });
    await settle(6);

    // Resumed, rather than refused for want of a backend owning a name this
    // host never stored.
    expect(sessionQueries()).toHaveLength(1);
    expect(sessionQueries()[0]?.options.resume).toBe('row');
    expect(sdk.said).toEqual(['and now?']);
  });

  it('serves its annotations under that name too', async () => {
    const client = await browsing();
    const opened = await client.handle({
      method: 'subscribe',
      params: { channel: 'claude:/row/annotations' },
    }) as { snapshot: { state: { annotations: unknown[] } } };
    expect(opened.snapshot.state.annotations).toEqual([]);
  });
});

/*
 * A session asked for by the name its creator used.
 *
 * A session created as `ahp-session:/<uuid>` is held as `claude:/<uuid>`, and
 * the creator keeps talking to it under its own name: every request that names
 * the session resolves that name, and every snapshot answered on it is in that
 * spelling.
 */
describe('a session asked for by the name its creator used', () => {
  const id = '6b1f0e8a-3c2d-4e5f-8a9b-0c1d2e3f4a5b';
  const given = `ahp-session:/${id}`;
  const held = `claude:/${id}`;
  const chatOfSession = (session: string) =>
    `ahp-chat://default/${Buffer.from(session, 'utf8').toString('base64url')}`;

  const created = async () => {
    const host = serving('/home/softov');
    const p = peer();
    const client = host.accept(p);
    await client.handle(hello(['0.9.0'], { initialSubscriptions: ['ahp-root://'] }));
    await client.handle({ method: 'createSession', params: { channel: given, provider: 'claude' } });
    return { host, client, peer: p };
  };

  it('forks a chat in it', async () => {
    const { client } = await created();
    await client.handle({ method: 'createChat', params: { channel: given, chat: 'ahp-chat:/second' } });
    const opened = await client.handle({ method: 'subscribe', params: { channel: given } }) as {
      snapshot: { resource: string; state: { chats: { resource: string }[] } };
    };
    expect(opened.snapshot.resource).toBe(given);
    expect(opened.snapshot.state.chats.map((one) => one.resource)).toEqual([chatOfSession(given), 'ahp-chat:/second']);
  });

  it('disposes it, and says so under the name it is held by', async () => {
    const { client, peer: p } = await created();
    await client.handle({ method: 'disposeSession', params: { channel: given } });
    const removed = p.notes.filter((n) => n.method === 'root/sessionRemoved')
      .map((n) => (n.params as { session: string }).session);
    expect(removed).toEqual([held]);
  });

  it('answers it in the handshake\'s first subscriptions, in the creator\'s spelling', async () => {
    const { host } = await created();
    const again = host.accept(peer());
    const result = await again.handle(hello(['0.9.0'], { clientId: 'again', initialSubscriptions: [given] })) as {
      snapshots: { resource: string; state: { defaultChat: string } }[];
    };
    expect(result.snapshots.map((one) => one.resource)).toEqual([given]);
    expect(result.snapshots[0]?.state.defaultChat).toBe(chatOfSession(given));
  });

  it('answers it on a reconnect, in the creator\'s spelling', async () => {
    const { host } = await created();
    const again = host.accept(peer());
    // Ahead of anything this host issued, so it is answered with state
    // rather than a replay.
    const result = await again.handle({
      method: 'reconnect',
      params: { channel: 'ahp-root://', clientId: 'probe', lastSeenServerSeq: 1_000_000, subscriptions: [given] },
    }) as { type: string; snapshots: { resource: string; state: { defaultChat: string } }[] };
    expect(result.type).toBe('snapshot');
    expect(result.snapshots.map((one) => one.resource)).toEqual([given]);
    expect(result.snapshots[0]?.state.defaultChat).toBe(chatOfSession(given));
  });

  it('opens for a second client the way VS Code opens it, with its turn and its pending approval', async () => {
    const { host, client: creator, peer: made } = await created();
    await creator.handle({ method: 'subscribe', params: { channel: given } });
    await creator.handle({ method: 'subscribe', params: { channel: chatOfSession(given) } });
    creator.handle({
      method: 'dispatchAction',
      params: { channel: chatOfSession(given), action: { type: 'chat/turnStarted', turnId: 't1', message: { text: 'clean the build' } } },
    });
    await settle();
    const decision = sdk.canUseTool?.('Bash', { command: 'rm -rf build' }, { toolUseID: 'c1' });
    await settle();

    // The window lists, takes the row's resource as the session, reads the
    // provider off its scheme and builds the chat from it.
    const window = peer();
    const vscode = host.accept(window);
    await vscode.handle(hello(['0.9.0'], { clientId: 'vscode' }));
    const rows = await vscode.handle({ method: 'listSessions', params: { channel: 'ahp-root://' } }) as {
      items: { resource: string; provider: string }[];
    };
    expect(rows.items.map((one) => one.resource)).toEqual([held]);
    const session = await vscode.handle({ method: 'subscribe', params: { channel: held } }) as {
      snapshot: { state: { defaultChat: string; inputNeeded?: { chat: string; toolCall: { toolCallId: string } }[] } };
    };
    expect(session.snapshot.state.defaultChat).toBe(chatOfSession(held));
    expect(session.snapshot.state.inputNeeded?.map((one) => one.chat)).toEqual([chatOfSession(held)]);
    const chat = await vscode.handle({ method: 'subscribe', params: { channel: chatOfSession(held) } }) as {
      snapshot: { state: { activeTurn?: { message: { text: string } } } };
    };
    expect(chat.snapshot.state.activeTurn?.message.text).toBe('clean the build');

    // Approved from the window, it reaches the agent, and the creator sees
    // it resolved under its own name.
    vscode.handle({
      method: 'dispatchAction',
      params: { channel: chatOfSession(held), action: { type: 'chat/toolCallConfirmed', toolCallId: 'c1', approved: true, confirmed: 'user-action' } },
    });
    expect(await decision).toMatchObject({ behavior: 'allow' });
    await settle();
    expect(actions(made, given).map((one) => one.action.type)).toContain('session/inputNeededRemoved');
    expect(actions(made, chatOfSession(given)).map((one) => one.action.type)).toContain('chat/toolCallConfirmed');
  });

  it('replays what it missed on a reconnect in the creator\'s spelling', async () => {
    const { host, client } = await created();
    await client.handle({ method: 'subscribe', params: { channel: given } });
    await client.handle({ method: 'createChat', params: { channel: given, chat: 'ahp-chat:/second' } });
    const again = host.accept(peer());
    const result = await again.handle({
      method: 'reconnect',
      params: { channel: 'ahp-root://', clientId: 'probe', lastSeenServerSeq: 0, subscriptions: [given] },
    }) as { type: string; actions: { channel: string }[] };
    expect(result.type).toBe('replay');
    expect(result.actions.length).toBeGreaterThan(0);
    expect(result.actions.every((one) => one.channel === given)).toBe(true);
    expect(JSON.stringify(result.actions)).not.toContain(held);
  });

  it('replays a chat and a pending approval on a reconnect in the creator\'s spelling, and leaves text alone', async () => {
    const { host, client } = await created();
    await client.handle({ method: 'subscribe', params: { channel: given } });
    await client.handle({ method: 'subscribe', params: { channel: chatOfSession(given) } });
    // Text that names the session is somebody's words, not a URI to respell.
    const text = `${held}/changeset/session is what changed`;
    client.handle({
      method: 'dispatchAction',
      params: { channel: chatOfSession(given), action: { type: 'chat/turnStarted', turnId: 't1', message: { text } } },
    });
    await settle();
    void sdk.canUseTool?.('Bash', { command: 'rm -rf build' }, { toolUseID: 'c1' });
    await settle();

    const again = host.accept(peer());
    const result = await again.handle({
      method: 'reconnect',
      params: { channel: 'ahp-root://', clientId: 'probe', lastSeenServerSeq: 0, subscriptions: [given, chatOfSession(given)] },
    }) as { type: string; actions: { channel: string; action: Record<string, any> }[] };
    expect(result.type).toBe('replay');
    // The chat's actions under the creator's name for the chat.
    const started = result.actions.find((one) => one.action.type === 'chat/turnStarted');
    expect(started?.channel).toBe(chatOfSession(given));
    expect(started?.action.message.text).toBe(text);
    // And the chat a pending approval is answered on, inside the payload.
    const asked = result.actions.find((one) => one.action.type === 'session/inputNeededSet');
    expect(asked?.channel).toBe(given);
    expect(asked?.action.request.chat).toBe(chatOfSession(given));
    expect(result.actions.every((one) => one.channel === given || one.channel === chatOfSession(given))).toBe(true);
  });

  it('lets its creator go when it unsubscribes under its own name', async () => {
    const { host } = await created();
    const watcher = peer();
    const other = host.accept(watcher);
    await other.handle(hello(['0.9.0'], { clientId: 'watcher' }));
    await other.handle({ method: 'subscribe', params: { channel: held } });
    const creator = host.accept(peer());
    await creator.handle(hello(['0.9.0'], { clientId: 'creator' }));
    await creator.handle({ method: 'subscribe', params: { channel: given } });
    creator.handle({
      method: 'dispatchAction',
      params: { channel: given, action: { type: 'session/activeClientSet', activeClient: { clientId: 'creator', tools: [] } } },
    });
    await settle();
    await creator.handle({ method: 'unsubscribe', params: { channel: given } });
    await settle();
    // Told under the held name, which is where everybody else is watching.
    const gone = actions(watcher, held).filter((one) => one.action.type === 'session/activeClientRemoved');
    expect(gone.map((one) => one.action.clientId)).toEqual(['creator']);
  });
});
