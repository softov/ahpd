import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  resetSdk, actions, claude, createHost, hello, machine, open,
  peer, sdk, serving, sessionQueries, settle, running, wrote, firstMessage,
} from './support/host.js';
import { memorySessions } from '../src/sessions/sessions.js';

vi.mock('@anthropic-ai/claude-agent-sdk', async () => (await import('./support/claude-sdk.js')).fake);

beforeEach(resetSdk);

/*
 * A session's default chat, by the one URI it has.
 *
 * `ahp-chat://default/<base64url(session)>`, the shape the reference host
 * builds and an older VS Code window computes from the session. It is the only
 * name the chat answers to: `ahp-chat:/<id>` is a chat of its own URI, never
 * the default chat of session `<id>`, as the reference host keys a chat by the
 * URI a client sends.
 * https://github.com/microsoft/vscode/blob/58a595f76bdc150460d7e0d279d26cc6fc577b0a/src/vs/platform/agentHost/node/agentService.ts#L11472-L11490
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
      params: { channel: alias, clientSeq: 4, action: { type: 'chat/turnStarted', turnId: 't1', startedAt: new Date().toISOString(), message: { origin: { kind: 'user' }, text: 'hi' } } },
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

  it('answers ahp-chat:/<id> as no chat of session <id>', async () => {
    const { client, uri, chatUri } = await running();
    // `ahp-session:/live`, whose default chat is the derived one alone.
    expect(uri).toBe('ahp-session:/live');
    expect(chatUri).toBe(derived(uri));
    await expect(client.handle({ method: 'subscribe', params: { channel: 'ahp-chat:/live' } }))
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

  it('holds a session created on the protocol\'s URI under that URI, and answers its creator in its own', async () => {
    const id = '39c2a6f0-8c1e-4d7a-9b6e-2f1d3c4b5a69';
    const p = peer();
    const client = serving('/home/softov').accept(p);
    await client.handle(hello(['0.9.0'], { initialSubscriptions: ['ahp-root://'] }));
    await client.handle({ method: 'createSession', params: { channel: `ahp-session:/${id}`, provider: 'claude' } });
    await firstMessage(client, `ahp-chat://default/${Buffer.from(`ahp-session:/${id}`, 'utf8').toString('base64url')}`);

    // Listed and announced under the name it was made with.
    const listed = await client.handle({ method: 'listSessions', params: { channel: 'ahp-root://' } }) as {
      items: { resource: string }[];
    };
    expect(listed.items.map((one) => one.resource)).toEqual([`ahp-session:/${id}`]);
    const added = p.notes.filter((n) => n.method === 'root/sessionAdded')
      .map((n) => (n.params as { summary: { resource: string } }).summary.resource);
    expect(added).toEqual([`ahp-session:/${id}`]);

    // The creator's own name is the session, in its own spelling.
    const opened = await client.handle({ method: 'subscribe', params: { channel: `ahp-session:/${id}` } }) as {
      snapshot: { resource: string; state: { defaultChat: string } };
    };
    expect(opened.snapshot.resource).toBe(`ahp-session:/${id}`);
    expect(opened.snapshot.state.defaultChat)
      .toBe(`ahp-chat://default/${Buffer.from(`ahp-session:/${id}`, 'utf8').toString('base64url')}`);
    // And the backend is handed the id, never the scheme.
    expect(sessionQueries()[0]?.options.sessionId).toBe(id);
  });

  it('holds a session created on its provider\'s scheme under that scheme', async () => {
    const id = '2c5b9d1e-7f4a-4c8b-9e3d-6a0f1b2c3d4e';
    const client = serving('/home/softov').accept(peer());
    await client.handle(hello(['0.9.0']));
    await client.handle({ method: 'createSession', params: { channel: `claude:/${id}`, provider: 'claude' } });
    await firstMessage(client, `ahp-chat://default/${Buffer.from(`claude:/${id}`, 'utf8').toString('base64url')}`);

    const listed = await client.handle({ method: 'listSessions', params: { channel: 'ahp-root://' } }) as {
      items: { resource: string }[];
    };
    expect(listed.items.map((one) => one.resource)).toEqual([`claude:/${id}`]);
  });

  /*
   * Whatever scheme the client named, the session's row carries that URI, as
   * the reference host holds a client's session under the channel it named,
   * and every spelling of the id names the same session, as that host answers
   * a session under each identity it has: the client is answered under the
   * name it used, and the state is the session's own.
   * https://github.com/microsoft/vscode/blob/58a595f76bdc150460d7e0d279d26cc6fc577b0a/src/vs/platform/agentHost/node/protocolServerHandler.ts#L2213-L2221
   * https://github.com/microsoft/vscode/blob/58a595f76bdc150460d7e0d279d26cc6fc577b0a/src/vs/platform/agentHost/node/agentHostChatOwnershipService.ts#L264-L287
   */
  it('holds a session created on another provider\'s scheme under that URI, and answers every spelling of its id', async () => {
    const id = '4e8d2f6a-1b3c-4d5e-8f7a-9b0c1d2e3f4a';
    const client = serving('/home/softov').accept(peer());
    await client.handle(hello(['0.9.0']));
    await client.handle({ method: 'createSession', params: { channel: `pi:/${id}`, provider: 'claude' } });
    await firstMessage(client, `ahp-chat://default/${Buffer.from(`pi:/${id}`, 'utf8').toString('base64url')}`);

    const listed = await client.handle({ method: 'listSessions', params: { channel: 'ahp-root://' } }) as {
      items: { resource: string }[];
    };
    expect(listed.items.map((one) => one.resource)).toEqual([`pi:/${id}`]);
    const opened = await client.handle({ method: 'subscribe', params: { channel: `pi:/${id}` } }) as {
      snapshot: { resource: string; state: { defaultChat: string } };
    };
    expect(opened.snapshot.resource).toBe(`pi:/${id}`);
    expect(opened.snapshot.state.defaultChat).toBe(`ahp-chat://default/${Buffer.from(`pi:/${id}`, 'utf8').toString('base64url')}`);

    // Another spelling of the same id is the same session, answered under the
    // spelling the client used, with the session's own state.
    const other = await client.handle({ method: 'subscribe', params: { channel: `ahp-session:/${id}` } }) as {
      snapshot: { resource: string; state: { defaultChat: string } };
    };
    expect(other.snapshot.resource).toBe(`ahp-session:/${id}`);
    expect(other.snapshot.state.defaultChat).toBe(opened.snapshot.state.defaultChat);
    // And so is the chat derived from it.
    const chat = await client.handle({
      method: 'subscribe',
      params: { channel: `ahp-chat://default/${Buffer.from(`ahp-session:/${id}`, 'utf8').toString('base64url')}` },
    }) as { snapshot: { resource: string; state: { turns: unknown[] } } };
    expect(chat.snapshot.resource).toBe(`ahp-chat://default/${Buffer.from(`ahp-session:/${id}`, 'utf8').toString('base64url')}`);
    expect(chat.snapshot.state.turns).toEqual([]);
  });

  it('keeps the name each new session is held under in its row', async () => {
    const store = memorySessions();
    const host = createHost({
      path: '/home/softov',
      agents: [claude({ paths: ['/home/softov'] })],
      ...machine(),
      sessions: store,
    });
    const client = host.accept(peer());
    await client.handle(hello(['0.9.0']));
    const ids = ['one', 'two', 'three'];
    await client.handle({ method: 'createSession', params: { channel: `ahp-session:/${ids[0]}`, provider: 'claude' } });
    await client.handle({ method: 'createSession', params: { channel: `claude:/${ids[1]}`, provider: 'claude' } });
    await client.handle({ method: 'createSession', params: { channel: `pi:/${ids[2]}`, provider: 'claude' } });

    expect(ids.map((id) => store.uri?.(id))).toEqual([
      `ahp-session:/${ids[0]}`,
      `claude:/${ids[1]}`,
      `pi:/${ids[2]}`,
    ]);
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
    await firstMessage(client, `ahp-chat://default/${Buffer.from(`claude:/${id}`, 'utf8').toString('base64url')}`);
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

  it('keeps a session a backend keeps on disk when it is made again under its name, and refuses its id under another', async () => {
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
      .resolves.toBeNull();
    await expect(client.handle({ method: 'createSession', params: { channel: 'echo:/kept', provider: 'echo' } }))
      .rejects.toMatchObject({ code: -32003 });
    const listed = await client.handle({ method: 'listSessions', params: { channel: 'ahp-root://' } }) as {
      items: { resource: string; title: string }[];
    };
    expect(listed.items.map((one) => [one.resource, one.title])).toEqual([['ahp-session:/kept', 'Kept']]);
  });

  /*
   * A window whose subscription a reconnect reported missing creates the
   * session again before it subscribes, and VS Code's host runs that creation
   * over the session it holds.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentService.ts#L6323-L6328
   */
  it('answers a session made again for the agent it is held under, and keeps it, as VS Code\'s host', async () => {
    const { client, peer: p, uri, chatUri } = await running();
    client.handle({
      method: 'dispatchAction',
      params: { channel: chatUri, clientSeq: 1, action: { type: 'chat/turnStarted', turnId: 't1', startedAt: new Date().toISOString(), message: { origin: { kind: 'user' }, text: 'hi' } } },
    });
    await settle();
    const added = () => p.notes.filter((one) => one.method === 'root/sessionAdded').length;
    const before = added();

    await expect(client.handle({ method: 'createSession', params: { channel: uri, provider: 'claude' } })).resolves.toBeNull();
    await settle();

    const read = await client.handle({ method: 'subscribe', params: { channel: chatUri } }) as {
      snapshot: { state: { turns: { id: string }[]; activeTurn?: { id: string } } };
    };
    const { state } = read.snapshot;
    expect([...state.turns.map((turn) => turn.id), state.activeTurn?.id]).toContain('t1');
    expect(added()).toBe(before);
  });
});

/*
 * A listed session, by the one URI it is listed under.
 *
 * A row this host never made is listed as `ahp-session:/<id>`, and that URI is
 * the only one it answers to: the same id in a provider's scheme is no session
 * here, as the reference host finds no session under a URI it was not created
 * with. Everything about the row - its chat, its flags, its marks, its resume -
 * goes by that URI.
 * https://github.com/microsoft/vscode/blob/58a595f76bdc150460d7e0d279d26cc6fc577b0a/src/vs/platform/agentHost/node/agentService.ts#L14083
 */
describe('a session asked for by the name a client computed', () => {
  const listed = { sessionId: 'row', summary: 'A real title', lastModified: 1_700_000_000_000, cwd: '/home/softov' };
  const ROW = 'ahp-session:/row';
  const derived = (session: string) =>
    `ahp-chat://default/${Buffer.from(session, 'utf8').toString('base64url')}`;

  const browsing = async (p = peer()) => {
    sdk.sessions.push(listed);
    sdk.transcript.push({ type: 'user', uuid: 'u1', message: { role: 'user', content: 'earlier' } });
    wrote(listed.sessionId, listed.cwd);
    const client = serving('/home/softov').accept(p);
    await client.handle(hello(['0.9.0']));
    // Listed first: that is when this host learns whose the row is, and it is
    // what a client does before it opens one.
    await client.handle({ method: 'listSessions', params: { channel: 'ahp-root://' } });
    return client;
  };

  it('names its chat after the URI it is listed under', async () => {
    const client = await browsing();
    const opened = await client.handle({ method: 'subscribe', params: { channel: ROW } }) as {
      snapshot: { resource: string; state: { defaultChat: string; chats: { resource: string }[] } };
    };
    expect(opened.snapshot.resource).toBe(ROW);
    expect(opened.snapshot.state.defaultChat).toBe(derived(ROW));
    expect(opened.snapshot.state.chats[0]?.resource).toBe(derived(ROW));
  });

  it('names a listed session nobody here made as the protocol\'s URI', async () => {
    const client = await browsing();
    const listed = await client.handle({ method: 'listSessions', params: { channel: 'ahp-root://' } }) as {
      items: { resource: string }[];
    };
    /*
     * A row this host has no record of is a transcript it never ran, so it is
     * named `ahp-session:/<id>` and nothing is written for it - the protocol's
     * spelling, which is what VS Code publishes for a session it finds with no
     * registration of its own.
     */
    expect(listed.items[0]?.resource).toBe('ahp-session:/row');
  });

  /*
   * Every spelling of the id names the row: the reference host answers a
   * session under each identity it has and derives that session's chat from
   * each of them, a chat's owner coming from the records that hold it.
   * https://github.com/microsoft/vscode/blob/58a595f76bdc150460d7e0d279d26cc6fc577b0a/src/vs/platform/agentHost/node/agentHostChatOwnershipService.ts#L264-L287
   * https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/common/state/sessionState.ts#L894-L898
   */
  it('answers the provider\'s scheme of its id as the row, with its chat and its marks', async () => {
    const client = await browsing();
    await client.handle({ method: 'listSessions', params: { channel: 'ahp-root://' } });
    const other = 'claude:/row';
    const opened = await client.handle({ method: 'subscribe', params: { channel: other } }) as {
      snapshot: { resource: string; state: { title: string; defaultChat: string } };
    };
    // Answered under the spelling the client used, with the row's own state.
    expect(opened.snapshot.resource).toBe(other);
    expect(opened.snapshot.state.title).toBe('A real title');
    expect(opened.snapshot.state.defaultChat).toBe(derived(ROW));
    const chat = await client.handle({ method: 'subscribe', params: { channel: derived(other) } }) as {
      snapshot: { resource: string; state: { turns: { message?: { text?: string } }[] } };
    };
    expect(chat.snapshot.resource).toBe(derived(other));
    expect(chat.snapshot.state.turns[0]?.message?.text).toBe('earlier');
    const marks = await client.handle({ method: 'subscribe', params: { channel: `${other}/annotations` } }) as {
      snapshot: { resource: string; state: { annotations: unknown[] } };
    };
    expect(marks.snapshot.resource).toBe(`${other}/annotations`);
    expect(marks.snapshot.state.annotations).toEqual([]);
  });

  it('applies what is sent under the provider\'s scheme of its id to the session', async () => {
    const p = peer();
    const client = await browsing(p);
    const other = 'claude:/row';
    // Watched under the spelling the client used, which is where its echoes go.
    for (const channel of [other, `${other}/annotations`, derived(other)]) {
      await client.handle({ method: 'subscribe', params: { channel } });
    }
    for (const [channel, action] of [
      [other, { type: 'session/isReadChanged', isRead: true }],
      [`${other}/annotations`, {
        type: 'annotations/set',
        annotation: { id: 'a1', origin: { session: other }, resource: 'file:///x', resolved: false, entries: [{ id: 'e1', text: 'mark' }] },
      }],
      [derived(other), { type: 'chat/draftChanged', draft: { text: 'typed' } }],
    ] as [string, Record<string, unknown>][]) {
      client.handle({ method: 'dispatchAction', params: { channel, action } });
      await settle(6);
    }

    // Each is applied to the session, and said on the channel the client named.
    expect(actions(p).filter((e) => e.rejectionReason !== undefined)).toEqual([]);
    const said = actions(p).filter((e) => e.channel !== 'ahp-root://').map((e) => [e.channel, e.action.type]);
    expect(said).toEqual([
      [other, 'session/isReadChanged'],
      // The session's sole counted chat follows its read bit, and its row with it.
      [derived(other), 'chat/isReadChanged'],
      [other, 'session/chatUpdated'],
      [`${other}/annotations`, 'annotations/set'],
      [derived(other), 'chat/draftChanged'],
    ]);
    // Nothing is woken for a flag, a mark or a draft.
    expect(sessionQueries()).toHaveLength(0);
    // The session's own name holds them: the read bit on its row, the mark on
    // its marks, the draft on its chat.
    const rows = await client.handle({ method: 'listSessions', params: { channel: 'ahp-root://' } }) as {
      items: { resource: string; status: number }[];
    };
    expect(rows.items.find((one) => one.resource === ROW)?.status).toBe(1 | 32);
    const marks = await client.handle({ method: 'subscribe', params: { channel: `${ROW}/annotations` } }) as {
      snapshot: { state: { annotations: { id: string }[] } };
    };
    expect(marks.snapshot.state.annotations.map((one) => one.id)).toEqual(['a1']);
    const chat = await client.handle({ method: 'subscribe', params: { channel: derived(ROW) } }) as {
      snapshot: { state: { draft?: { text?: string } } };
    };
    expect(chat.snapshot.state.draft?.text).toBe('typed');
  });

  it('says a person started the chat', async () => {
    const client = await browsing();
    const opened = await client.handle({ method: 'subscribe', params: { channel: derived(ROW) } }) as {
      snapshot: { state: { origin?: { kind: string } } };
    };
    // `ChatOrigin`'s four kinds are `user`, `fork`, `sideChat` and `tool`.
    // A transcript is a conversation somebody typed, so it is the first.
    expect(opened.snapshot.state.origin).toEqual({ kind: 'user' });

    const session = await client.handle({ method: 'subscribe', params: { channel: ROW } }) as {
      snapshot: { state: { chats: { origin?: { kind: string } }[] } };
    };
    // And the row in the session's catalogue says the same, because a client
    // reads a chat's origin off whichever of the two it has.
    expect(session.snapshot.state.chats[0]?.origin).toEqual({ kind: 'user' });
  });

  it('serves that chat the transcript', async () => {
    const client = await browsing();
    const chat = await client.handle({ method: 'subscribe', params: { channel: derived(ROW) } }) as {
      snapshot: { state: { turns: unknown[] } };
    };
    expect(chat.snapshot.state.turns.length).toBeGreaterThan(0);
  });

  it('records a flag against the row the catalogue lists', async () => {
    const client = await browsing();
    client.handle({
      method: 'dispatchAction',
      params: { channel: ROW, action: { type: 'session/isReadChanged', isRead: true } },
    });
    await settle();

    // Idle, and read: kept by the row's id, which is what a listing reads.
    const rows = await client.handle({ method: 'listSessions', params: { channel: 'ahp-root://' } }) as {
      items: { status: number }[];
    };
    expect(rows.items[0]?.status).toBe(33);
  });

  it('resumes the session that URI belongs to', async () => {
    const client = await browsing();
    client.handle({
      method: 'dispatchAction',
      params: {
        channel: derived(ROW),
        action: { type: 'chat/turnStarted', turnId: 't1', startedAt: new Date().toISOString(), message: { origin: { kind: 'user' }, text: 'and now?' } },
      },
    });
    await settle(6);

    // Resumed, rather than refused for want of a backend owning a name this
    // host never stored.
    expect(sessionQueries()).toHaveLength(1);
    expect(sessionQueries()[0]?.options.resume).toBe('row');
    expect(sdk.said).toEqual(['and now?']);
  });

  it('sends the chat it resumes on to the client that watched it asleep', async () => {
    const p = peer();
    const client = await browsing(p);
    const chat = derived(ROW);
    await client.handle({ method: 'subscribe', params: { channel: ROW } });
    await client.handle({ method: 'subscribe', params: { channel: chat } });
    client.handle({
      method: 'dispatchAction',
      params: { channel: chat, clientSeq: 1, action: { type: 'chat/turnStarted', turnId: 't1', startedAt: new Date().toISOString(), message: { origin: { kind: 'user' }, text: 'and now?' } } },
    });
    await settle(6);

    // Watched while it slept: the session wakes under the URI it is listed by,
    // and its chat is the one the client watched.
    expect(sdk.said).toEqual(['and now?']);
    expect(actions(p, chat).map((e) => e.action.type)).toContain('chat/turnStarted');
  });

  it('serves its annotations under that URI', async () => {
    const client = await browsing();
    const opened = await client.handle({
      method: 'subscribe',
      params: { channel: `${ROW}/annotations` },
    }) as { snapshot: { state: { annotations: unknown[] } } };
    expect(opened.snapshot.state.annotations).toEqual([]);
  });
});

describe('a session that runs no chat', () => {
  it('reports the customizations of its stored provider, whatever its URI names', async () => {
    const { echo } = await import('../../../examples/echo/agent.js');
    const seed = { id: 'seed-one', type: 'plugin', name: 'A seeded plugin' };
    const stamp = new Date(0).toISOString();
    const kept = memorySessions();
    kept.setProvider('one', 'slow');
    kept.setUri?.('one', 'ahp-session:/one');
    const host = createHost({
      path: '/home/softov',
      agents: [{
        ...echo({ path: '/home/softov', pace: 0 }),
        provider: 'slow',
        displayName: 'Slow',
        list: async () => [{ id: 'one', title: 'One', createdAt: stamp, modifiedAt: stamp, workingDirectories: ['file:///home/softov'] }],
        transcript: async () => [],
        probe: async () => ({ models: [], commands: [], customizations: [seed] }),
      }],
      ...machine(),
      sessions: kept,
    });
    const p = peer();
    const client = host.accept(p);
    await client.handle(hello(['0.9.0'], { initialSubscriptions: ['ahp-root://'] }));
    await client.handle({ method: 'listSessions', params: { channel: 'ahp-root://' } });
    await client.handle({ method: 'subscribe', params: { channel: 'ahp-session:/one' } });

    // A client plugin makes the host say the session's customizations again,
    // with no chat of the session running to ask.
    client.handle({
      method: 'dispatchAction',
      params: {
        channel: 'ahp-session:/one',
        action: {
          type: 'session/activeClientSet',
          activeClient: { clientId: 'probe', tools: [], customizations: [{ type: 'plugin', uri: 'file:///plugin', nonce: 'n' }] },
        },
      },
    });
    await settle();

    const changed = p.notes
      .filter((n) => n.method === 'action')
      .map((n) => (n.params as { action: { type: string; customizations?: unknown[] } }).action)
      .filter((action) => action.type === 'session/customizationsChanged')
      .at(-1);
    // The scheme `ahp-session` names no provider: the row's provider does,
    // and that is what the session reports.
    expect(changed?.customizations).toContainEqual(seed);
  });
});

/*
 * A session asked for by the name its creator used.
 *
 * A session created as `ahp-session:/<uuid>` is held under that same URI, and
 * the creator keeps talking to it under its own name: every request that names
 * the session resolves that name, and every snapshot answered on it is in that
 * spelling.
 */
describe('a session asked for by the name its creator used', () => {
  const id = '6b1f0e8a-3c2d-4e5f-8a9b-0c1d2e3f4a5b';
  const given = `ahp-session:/${id}`;
  const held = given;
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
    await firstMessage(client, chatOfSession(given));
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
    const { host, client } = await created();
    await client.handle({ method: 'dispatchAction', params: { channel: given, action: { type: 'session/isReadChanged', isRead: true } } });
    await settle();
    const again = host.accept(peer());
    // Behind the oldest action this host holds, so it is answered with state
    // rather than a replay.
    const result = await again.handle({
      method: 'reconnect',
      params: { channel: 'ahp-root://', clientId: 'probe', lastSeenServerSeq: 0, subscriptions: [given] },
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
      params: { channel: chatOfSession(given), action: { type: 'chat/turnStarted', turnId: 't1', startedAt: new Date().toISOString(), message: { origin: { kind: 'user' }, text: 'clean the build' } } },
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
    const read = await client.handle({ method: 'subscribe', params: { channel: given } }) as { snapshot: { fromSeq: number } };
    await client.handle({ method: 'createChat', params: { channel: given, chat: 'ahp-chat:/second' } });
    const again = host.accept(peer());
    const result = await again.handle({
      method: 'reconnect',
      params: { channel: 'ahp-root://', clientId: 'probe', lastSeenServerSeq: read.snapshot.fromSeq, subscriptions: [given] },
    }) as { type: string; actions: { channel: string }[] };
    expect(result.type).toBe('replay');
    expect(result.actions.length).toBeGreaterThan(0);
    expect(result.actions.every((one) => one.channel === given)).toBe(true);
  });

  it('replays a chat and a pending approval on a reconnect in the creator\'s spelling, and leaves text alone', async () => {
    const { host, client } = await created();
    await client.handle({ method: 'subscribe', params: { channel: given } });
    const read = await client.handle({ method: 'subscribe', params: { channel: chatOfSession(given) } }) as { snapshot: { fromSeq: number } };
    // Text that names the session is somebody's words, not a URI to respell.
    const text = `${held}/changeset/session is what changed`;
    client.handle({
      method: 'dispatchAction',
      params: { channel: chatOfSession(given), action: { type: 'chat/turnStarted', turnId: 't1', startedAt: new Date().toISOString(), message: { text, origin: { kind: 'user' } } } },
    });
    await settle();
    void sdk.canUseTool?.('Bash', { command: 'rm -rf build' }, { toolUseID: 'c1' });
    await settle();

    const again = host.accept(peer());
    const result = await again.handle({
      method: 'reconnect',
      params: { channel: 'ahp-root://', clientId: 'probe', lastSeenServerSeq: read.snapshot.fromSeq, subscriptions: [given, chatOfSession(given)] },
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

/*
 * An older VS Code window, told as the reference host tells one: a client that
 * names itself `vscode-editor-window` or `vscode-agents-window` and does not
 * declare `vscode.ahpSessionUris` cannot address an `ahp-session:` session, and
 * one that does not declare `vscode.ahpChatUris` cannot address an opaque chat.
 * Such a window is shown neither, anywhere a session or a chat goes out.
 * https://github.com/microsoft/vscode/blob/58a595f76bdc150460d7e0d279d26cc6fc577b0a/src/vs/platform/agentHost/node/protocolServerHandler.ts#L1054-L1055
 * https://github.com/microsoft/vscode/blob/58a595f76bdc150460d7e0d279d26cc6fc577b0a/src/vs/platform/agentHost/node/protocolServerHandler.ts#L4326-L4355
 */
describe('an older VS Code window', () => {
  const older = { clientInfo: { name: 'vscode-editor-window', title: 'VS Code' } };
  const current = { ...older, _meta: { 'vscode.ahpSessionUris': true, 'vscode.ahpChatUris': true } };
  const AHP = 'ahp-session:/7a1d2c3b-4e5f-4a6b-8c7d-9e0f1a2b3c4d';
  const NAMED = 'claude:/8b2e3d4c-5f6a-4b7c-9d8e-0f1a2b3c4d5e';
  const derived = (session: string) => `ahp-chat://default/${Buffer.from(session, 'utf8').toString('base64url')}`;
  const shaped = (session: string, id: string) => `ahp-chat://${id}/${Buffer.from(session, 'utf8').toString('base64url')}`;

  /** A host with a session in each scheme, made by a client that can address both. */
  const both = async () => {
    const host = serving('/home/softov');
    const maker = host.accept(peer());
    await maker.handle(hello(['1.0.0'], { clientId: 'maker', initialSubscriptions: ['ahp-root://'] }));
    await maker.handle({ method: 'createSession', params: { channel: AHP, provider: 'claude' } });
    await maker.handle({ method: 'createSession', params: { channel: NAMED, provider: 'claude' } });
    await firstMessage(maker, derived(AHP));
    await firstMessage(maker, derived(NAMED));
    return { host, maker };
  };
  const listed = async (client: { handle(r: { method: string; params: Record<string, unknown> }): Promise<unknown> }) =>
    ((await client.handle({ method: 'listSessions', params: { channel: 'ahp-root://' } })) as { items: { resource: string }[] })
      .items.map((one) => one.resource).sort();

  it('lists no ahp-session: session to it, and refuses one as a subscription', async () => {
    const { host } = await both();
    const window = host.accept(peer());
    await window.handle(hello(['1.0.0'], { clientId: 'window', ...older }));
    expect(await listed(window)).toEqual([NAMED]);
    await expect(window.handle({ method: 'subscribe', params: { channel: AHP } })).rejects.toMatchObject({
      code: -32001, message: `Resource not available to this client: ${AHP}`,
    });
    await expect(window.handle({ method: 'subscribe', params: { channel: derived(AHP) } })).rejects.toMatchObject({ code: -32001 });
    const opened = await window.handle({ method: 'subscribe', params: { channel: NAMED } }) as { snapshot: { resource: string } };
    expect(opened.snapshot.resource).toBe(NAMED);
  });

  it('shows a window that declares it can address them every session', async () => {
    const { host } = await both();
    const window = host.accept(peer());
    await window.handle(hello(['1.0.0'], { clientId: 'window', ...current }));
    expect(await listed(window)).toEqual([AHP, NAMED].sort());
    // And any other client, which is no VS Code window at all.
    const other = host.accept(peer());
    await other.handle(hello(['1.0.0'], { clientId: 'other' }));
    expect(await listed(other)).toEqual([AHP, NAMED].sort());
  });

  it('leaves an ahp-session: session out of its first subscriptions, and reports it missing at reconnect', async () => {
    const { host } = await both();
    const window = host.accept(peer());
    const result = await window.handle(hello(['1.0.0'], { clientId: 'window', ...older, initialSubscriptions: ['ahp-root://', AHP, NAMED] })) as {
      serverSeq: number;
      snapshots: { resource: string }[];
    };
    expect(result.snapshots.map((one) => one.resource)).toEqual(['ahp-root://', NAMED]);
    // The name it gave at `initialize` is read again, with no `clientInfo` here.
    const again = host.accept(peer());
    const back = await again.handle({
      method: 'reconnect',
      params: { channel: 'ahp-root://', clientId: 'window', lastSeenServerSeq: result.serverSeq, subscriptions: [AHP, NAMED] },
    }) as { type: string; missing: string[] };
    expect(back.type).toBe('replay');
    expect(back.missing).toEqual([AHP]);
    // A reconnect that declares it can address them is shown every session.
    const declared = host.accept(peer());
    const whole = await declared.handle({
      method: 'reconnect',
      params: { channel: 'ahp-root://', clientId: 'window', lastSeenServerSeq: result.serverSeq, subscriptions: [AHP, NAMED], _meta: current._meta },
    }) as { missing: string[] };
    expect(whole.missing).toEqual([]);
  });

  it('tells it nothing about an ahp-session: session in the root, and all of one in a provider\'s scheme', async () => {
    const { host, maker } = await both();
    const p = peer();
    const window = host.accept(p);
    await window.handle(hello(['1.0.0'], { clientId: 'window', ...older, initialSubscriptions: ['ahp-root://'] }));
    await maker.handle({ method: 'createSession', params: { channel: 'ahp-session:/later', provider: 'claude' } });
    await maker.handle({ method: 'createSession', params: { channel: 'claude:/latest', provider: 'claude' } });
    await firstMessage(maker, derived('ahp-session:/later'));
    await firstMessage(maker, derived('claude:/latest'));
    await maker.handle({ method: 'disposeSession', params: { channel: AHP } });
    await settle();
    const said = (method: string) => p.notes.filter((n) => n.method === method).map((n) => {
      const params = n.params as { session?: string; summary?: { resource: string } };
      return params.summary?.resource ?? params.session;
    });
    expect(said('root/sessionAdded')).toEqual(['claude:/latest']);
    expect(said('root/sessionRemoved')).toEqual([]);
    expect(said('root/sessionSummaryChanged').every((one) => one?.startsWith('claude:') === true)).toBe(true);
  });

  it('shows a window that cannot address opaque chats only the shaped chats that name their session', async () => {
    const { host, maker } = await both();
    const OPAQUE = 'ahp-chat:/3c4d5e6f-7a8b-4c9d-8e0f-1a2b3c4d5e6f';
    const SHAPED = shaped(NAMED, '4d5e6f7a-8b9c-4d0e-9f1a-2b3c4d5e6f7a');
    await maker.handle({ method: 'createChat', params: { channel: NAMED, chat: OPAQUE } });
    const p = peer();
    const window = host.accept(p);
    await window.handle(hello(['1.0.0'], { clientId: 'window', ...older }));
    const opened = await window.handle({ method: 'subscribe', params: { channel: NAMED } }) as {
      snapshot: { state: { chats: { resource: string }[] } };
    };
    expect(opened.snapshot.state.chats.map((one) => one.resource)).toEqual([derived(NAMED)]);
    await expect(window.handle({ method: 'subscribe', params: { channel: OPAQUE } })).rejects.toMatchObject({ code: -32001 });
    // A chat made while it watches is said to it only when it can address it.
    await maker.handle({ method: 'createChat', params: { channel: NAMED, chat: 'ahp-chat:/5e6f7a8b-9c0d-4e1f-8a2b-3c4d5e6f7a8b' } });
    await maker.handle({ method: 'createChat', params: { channel: NAMED, chat: SHAPED } });
    await settle();
    const added = actions(p, NAMED).filter((one) => one.action.type === 'session/chatAdded')
      .map((one) => (one.action.summary as { resource: string }).resource);
    expect(added).toEqual([SHAPED]);
    const rows = ((await window.handle({ method: 'listSessions', params: { channel: 'ahp-root://' } })) as {
      items: { resource: string; chats?: { resource: string }[] }[];
    }).items;
    expect(rows.find((one) => one.resource === NAMED)?.chats?.map((one) => one.resource)).toEqual([derived(NAMED), SHAPED]);
  });

  it('holds a session it creates under the URI it named, for every client', async () => {
    const host = serving('/home/softov');
    const window = host.accept(peer());
    await window.handle(hello(['1.0.0'], { clientId: 'window', ...older }));
    const made = 'claude:/9c0d1e2f-3a4b-4c5d-8e6f-7a8b9c0d1e2f';
    await window.handle({ method: 'createSession', params: { channel: made, provider: 'claude' } });
    await firstMessage(window, derived(made));
    const other = host.accept(peer());
    await other.handle(hello(['1.0.0'], { clientId: 'other' }));
    expect(await listed(window)).toEqual([made]);
    expect(await listed(other)).toEqual([made]);
    // A newer client may also name the session's id in the protocol's scheme,
    // and is answered under that name with the session's own state.
    const standard = `ahp-session:/${made.slice('claude:/'.length)}`;
    const opened = await other.handle({ method: 'subscribe', params: { channel: standard } }) as {
      snapshot: { resource: string; state: { defaultChat: string } };
    };
    expect(opened.snapshot.resource).toBe(standard);
    expect(opened.snapshot.state.defaultChat).toBe(derived(made));
  });
});
