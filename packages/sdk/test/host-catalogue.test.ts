import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Request } from '../src/types/rpc.js';
import {
  claude, createHost, machine, resetSdk, actions, emit, hello, open, peer,
  sdk, serving, sessionQueries, settle, running,
} from './support/host.js';

vi.mock('@anthropic-ai/claude-agent-sdk', async () => (await import('./support/claude-sdk.js')).fake);

beforeEach(resetSdk);

describe('the catalogue', () => {
  it('orders it most-recently-modified first, as the protocol asks', async () => {
    sdk.sessions.push(
      { sessionId: 'old', summary: 'Older', lastModified: 1_700_000_000_000, cwd: '/home/softov' },
      { sessionId: 'new', summary: 'Newer', lastModified: 1_800_000_000_000, cwd: '/home/softov' },
    );
    const client = open();
    await client.handle(hello(['0.9.0']));
    const listed = await client.handle({ method: 'listSessions', params: { channel: 'ahp-root://' } }) as {
      items: { title: string; status: number; resource: string }[];
    };
    expect(listed.items.map((s) => s.title)).toEqual(['Newer', 'Older']);
    // Idle, because nothing this host started is running. A status assigned
    // rather than derived is a session that claims to be busy with nothing in it.
    expect(listed.items[0]?.status).toBe(1);
    /*
     * The provider as the scheme, which is how the only other implementation
     * names a session both when it creates one and when it reopens one it
     * listed. Publishing another spelling gave that client two strings for one
     * session, and the one it reached for came out of its own stored state -
     * so the same conversation drew or did not depending on which it picked.
     */
    expect(listed.items[0]?.resource).toBe('claude:/new');
  });

  it('counts the sessions it is running, not the transcripts beside them', async () => {
    // The protocol asks for the active, non-disposed sessions *on the server*.
    // A transcript on disk is a row somebody can open, not a session this host
    // is holding - counting those meant a host running nothing claimed two.
    sdk.sessions.push({ sessionId: 'a', lastModified: 1, cwd: '/home/softov' });
    sdk.sessions.push({ sessionId: 'b', lastModified: 2, cwd: '/home/softov' });
    const client = open();
    const first = await client.handle(hello(['0.9.0'], { initialSubscriptions: ['ahp-root://'] })) as {
      snapshots: { state: { activeSessions: number } }[];
    };
    expect(first.snapshots[0]?.state.activeSessions).toBe(0);

    await client.handle({ method: 'createSession', params: { channel: 'ahp-session:/live', provider: 'claude' } });
    const again = await client.handle({ method: 'subscribe', params: { channel: 'ahp-root://' } }) as {
      snapshot: { state: { activeSessions: number } };
    };
    expect(again.snapshot.state.activeSessions).toBe(1);

    await client.handle({ method: 'disposeSession', params: { channel: 'ahp-session:/live' } });
    const after = await client.handle({ method: 'subscribe', params: { channel: 'ahp-root://' } }) as {
      snapshot: { state: { activeSessions: number } };
    };
    expect(after.snapshot.state.activeSessions).toBe(0);
  });

  it('refuses a session channel it has no agent for', async () => {
    const client = open();
    await client.handle(hello(['0.9.0']));
    await expect(client.handle({ method: 'subscribe', params: { channel: 'ahp-session:/nope' } }))
      .rejects.toMatchObject({ code: -32001 });
  });

  it('hands over the whole catalogue to a client that asked for no page size', async () => {
    for (let i = 0; i < 120; i++)
      sdk.sessions.push({ sessionId: `s${i}`, lastModified: i, cwd: '/home/softov' });
    const client = open();
    await client.handle(hello(['0.9.0']));
    // `limit` omitted is the protocol's "let the server choose", and neither
    // client that connects to this host reads `nextCursor` - so a default
    // page would be a catalogue silently cut down to it.
    const listed = await client.handle({ method: 'listSessions', params: { channel: 'ahp-root://' } }) as {
      items: unknown[]; nextCursor?: string;
    };
    expect(listed.items).toHaveLength(120);
    expect(listed.nextCursor).toBeUndefined();
  });

  it('stops at a bound no real catalogue reaches, and offers the rest', async () => {
    for (let i = 0; i < 1_002; i++)
      sdk.sessions.push({ sessionId: `s${i}`, lastModified: i, cwd: '/home/softov' });
    const client = open();
    await client.handle(hello(['0.9.0']));
    const listed = await client.handle({ method: 'listSessions', params: { channel: 'ahp-root://' } }) as {
      items: unknown[]; nextCursor?: string;
    };
    // Not a page size - the point past which one frame stops being servable.
    // A client that pages gets the rest; one that does not has been told,
    // which is more than a frame that never arrives would tell it.
    expect(listed.items).toHaveLength(1_000);
    expect(listed.nextCursor).toBeTruthy();
    const rest = await client.handle({
      method: 'listSessions',
      params: { channel: 'ahp-root://', cursor: listed.nextCursor },
    }) as { items: unknown[]; nextCursor?: string };
    expect(rest.items).toHaveLength(2);
    expect(rest.nextCursor).toBeUndefined();
  });

  it('walks it in pages when one is asked for, with no gaps and no repeats', async () => {
    for (let i = 0; i < 120; i++)
      sdk.sessions.push({ sessionId: `s${i}`, lastModified: i, cwd: '/home/softov' });
    const client = open();
    await client.handle(hello(['0.9.0']));
    const seen: string[] = [];
    let cursor: string | undefined;
    let pages = 0;
    do {
      const page = await client.handle({
        method: 'listSessions',
        params: { channel: 'ahp-root://', limit: 50, ...(cursor ? { cursor } : {}) },
      }) as { items: { resource: string }[]; nextCursor?: string };
      seen.push(...page.items.map((row) => row.resource));
      cursor = page.nextCursor;
      pages++;
    } while (cursor !== undefined && pages < 10);
    expect(pages).toBe(3);
    expect(seen).toHaveLength(120);
    expect(new Set(seen).size).toBe(120);
    // Most-recently-modified first, across the pages and not only inside one.
    expect(seen[0]).toBe('claude:/s119');
    expect(seen.at(-1)).toBe('claude:/s0');
  });

  it('refuses a cursor it did not issue rather than starting over', async () => {
    sdk.sessions.push({ sessionId: 'a', lastModified: 1, cwd: '/home/softov' });
    const client = open();
    await client.handle(hello(['0.9.0']));
    // Resuming from the top would answer a question about the rest of the
    // catalogue with the beginning of it, and the client would page for ever.
    await expect(client.handle({
      method: 'listSessions',
      params: { channel: 'ahp-root://', cursor: 'bm90LWEtY3Vyc29y' },
    })).rejects.toMatchObject({ code: -32602 });
  });
});

describe('a session that already happened', () => {
  const older = { sessionId: 'older', summary: 'A real title', lastModified: 1_700_000_000_000, cwd: '/home/softov' };

  it('opens from its transcript without spawning anything', async () => {
    sdk.sessions.push(older);
    sdk.transcript.push(
      { type: 'user', uuid: 'u1', message: { role: 'user', content: 'what changed?' } },
      { type: 'assistant', uuid: 'a1', message: { content: [{ type: 'text', text: 'Two files.' }] } },
    );
    const client = open();
    await client.handle(hello(['0.9.0']));

    const state = (await client.handle({ method: 'subscribe', params: { channel: 'ahp-session:/older' } }) as {
      snapshot: { state: { lifecycle: string; defaultChat: string } };
    }).snapshot.state;
    expect(state.lifecycle).toBe('ready');

    const chat = (await client.handle({ method: 'subscribe', params: { channel: state.defaultChat } }) as {
      snapshot: { state: { turns: { message: { text: string }; responseParts: { kind: string }[] }[] } };
    }).snapshot.state;
    // The agent's reply belongs to the turn it answered, not to one of its
    // own - otherwise the history reads as a monologue with the questions
    // taken out.
    expect(chat.turns).toHaveLength(1);
    expect(chat.turns[0]?.message.text).toBe('what changed?');
    expect(chat.turns[0]?.responseParts[0]?.kind).toBe('markdown');

    // Browsing ninety-eight rows must not cost ninety-eight subprocesses.
    expect(sessionQueries()).toHaveLength(0);
  });

  it('draws the shell commands in its transcript as shell commands', async () => {
    sdk.sessions.push(older);
    sdk.transcript.push(
      { type: 'user', uuid: 'u1', message: { role: 'user', content: 'list it' } },
      { type: 'assistant', uuid: 'a1', message: { content: [{ type: 'tool_use', id: 'tc1', name: 'Bash', input: { command: 'ls' } }] } },
      { type: 'user', uuid: 'u2', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tc1', content: 'a b' }] } },
    );
    const client = open();
    await client.handle(hello(['0.9.0']));
    const state = (await client.handle({ method: 'subscribe', params: { channel: 'ahp-session:/older' } }) as {
      snapshot: { state: { defaultChat: string } };
    }).snapshot.state;
    const chat = (await client.handle({ method: 'subscribe', params: { channel: state.defaultChat } }) as {
      snapshot: { state: { turns: { responseParts: { toolCall?: { _meta?: { toolKind?: string } } }[] }[] } };
    }).snapshot.state;
    // The same hint a live call carries. A transcript read back off disk is
    // the same conversation, and its rows should draw the same way.
    expect(chat.turns[0]?.responseParts[0]?.toolCall?._meta?.toolKind).toBe('terminal');
  });

  it('agrees with the catalogue about what the conversation is called', async () => {
    sdk.sessions.push(older);
    sdk.transcript.push({
      type: 'user',
      uuid: 'u1',
      // A first message routinely opens with editor context the person never
      // typed. Deriving a title from it titles every row `<ide_opened_file>…`.
      message: { role: 'user', content: '<ide_opened_file>/some/path</ide_opened_file> fix the parser' },
    });
    const client = open();
    await client.handle(hello(['0.9.0']));
    const listed = await client.handle({ method: 'listSessions', params: {} }) as { items: { title: string }[] };
    const opened = (await client.handle({ method: 'subscribe', params: { channel: 'ahp-session:/older' } }) as {
      snapshot: { state: { title: string } };
    }).snapshot.state;
    expect(opened.title).toBe('A real title');
    expect(opened.title).toBe(listed.items[0]?.title);
  });

  it('names the folder its catalogue row listed, not the host\'s', async () => {
    sdk.sessions.push({ ...older, cwd: '/github/s2cmd' });
    const client = open();
    await client.handle(hello(['0.9.0']));
    const listed = await client.handle({ method: 'listSessions', params: {} }) as {
      items: { resource: string; workingDirectories: string[] }[];
    };
    expect(listed.items[0]?.workingDirectories).toEqual(['file:///github/s2cmd']);
    const opened = (await client.handle({ method: 'subscribe', params: { channel: listed.items[0]?.resource } }) as {
      snapshot: { state: { workingDirectories: string[] } };
    }).snapshot.state;
    expect(opened.workingDirectories).toEqual(['file:///github/s2cmd']);
  });

  it('resumes rather than replays when somebody says something', async () => {
    sdk.sessions.push(older);
    sdk.transcript.push({ type: 'user', uuid: 'u1', message: { role: 'user', content: 'earlier' } });
    const client = open();
    await client.handle(hello(['0.9.0']));
    await client.handle({ method: 'subscribe', params: { channel: 'ahp-session:/older' } });

    client.handle({
      method: 'dispatchAction',
      params: {
        channel: 'ahp-chat:/older',
        action: { type: 'chat/turnStarted', turnId: 't1', message: { text: 'and now?' } },
      },
    });
    await settle(6);

    // Resumed: the agent gets the context it built before, not a transcript
    // it has merely been shown.
    expect(sessionQueries()).toHaveLength(1);
    expect(sessionQueries()[0]?.options.resume).toBe('older');
    expect(sdk.said).toEqual(['and now?']);

    // And the channel does not open empty while it resumes.
    const chat = (await client.handle({ method: 'subscribe', params: { channel: 'ahp-chat:/older' } }) as {
      snapshot: { state: { turns: unknown[]; activeTurn?: unknown } };
    }).snapshot.state;
    expect(chat.turns.length).toBeGreaterThan(0);
    expect(chat.activeTurn).toBeDefined();
  });

  it('refuses a session that is neither running nor in the catalogue', async () => {
    const client = open();
    await client.handle(hello(['0.9.0']));
    await expect(client.handle({ method: 'subscribe', params: { channel: 'ahp-session:/ghost' } }))
      .rejects.toMatchObject({ code: -32001 });
  });
});

describe('paging a long history', () => {
  /** More turns than a snapshot carries, so the tail is genuinely a tail. */
  const many = (n: number) => {
    const out: Record<string, unknown>[] = [];
    for (let i = 0; i < n; i++) {
      out.push({ type: 'user', uuid: `u${i}`, message: { role: 'user', content: `said ${i}` } });
      out.push({ type: 'assistant', uuid: `a${i}`, message: { content: [{ type: 'text', text: `replied ${i}` }] } });
    }
    return out;
  };

  interface Loaded { turns: { message: { text: string } }[]; turnsNextCursor?: string }

  const opened = async (count = 120) => {
    sdk.sessions.push({ sessionId: 'long', summary: 'A long one', lastModified: 1, cwd: '/home/softov' });
    sdk.transcript.push(...many(count));
    const host = serving('/home/softov');
    const p = peer();
    const client = host.accept(p);
    await client.handle(hello(['0.9.0']));
    const chat = (await client.handle({ method: 'subscribe', params: { channel: 'ahp-chat:/long' } }) as {
      snapshot: { state: { turns: { message: { text: string } }[]; turnsNextCursor?: string } };
    }).snapshot.state;
    const pages = () => actions(p, 'ahp-chat:/long')
      .filter((e) => e.action.type === 'chat/turnsLoaded')
      .map((e) => e.action as unknown as Loaded);
    return { client, chat, pages };
  };

  it('carries the newest page and says where the rest begins', async () => {
    const { chat } = await opened();
    // The snapshot is what a client waits on before it can draw anything, and
    // the oldest turns are the ones nobody is looking at.
    expect(chat.turns).toHaveLength(50);
    expect(chat.turns[49]?.message.text).toBe('said 119');
    expect(chat.turnsNextCursor).toBe('70');
  });

  it('sends the page to everyone watching, not to the one who asked', async () => {
    const { client, pages } = await opened();
    const result = await client.handle({
      method: 'fetchTurns',
      params: { channel: 'ahp-chat:/long', cursor: '70' },
    });
    // Empty on purpose: the turns arrive as an action on the channel, so
    // every client watching the chat gets them - not only the one that asked.
    expect(result).toEqual({});

    const [page] = pages();
    expect(page?.turns).toHaveLength(50);
    expect(page?.turns[0]?.message.text).toBe('said 20');
    expect(page?.turns[49]?.message.text).toBe('said 69');
    expect(page?.turnsNextCursor).toBe('20');
  });

  it('walks back to the beginning and then stops offering a cursor', async () => {
    const { client, chat, pages } = await opened();
    let cursor = chat.turnsNextCursor;
    for (let i = 0; i < 6 && cursor !== undefined; i++) {
      await client.handle({ method: 'fetchTurns', params: { channel: 'ahp-chat:/long', cursor } });
      cursor = pages().at(-1)?.turnsNextCursor;
    }

    const loaded = pages();
    expect(loaded).toHaveLength(2);
    // Nothing older left, so no cursor - absence is how a client knows to
    // stop asking rather than paging the same page for ever.
    expect(loaded.at(-1)?.turnsNextCursor).toBeUndefined();
    expect(loaded.at(-1)?.turns[0]?.message.text).toBe('said 0');
    // Every turn, once, across the snapshot and the pages.
    const all = [...loaded.flatMap((l) => l.turns), ...chat.turns].map((t) => t.message.text);
    expect(new Set(all).size).toBe(120);
  });

  it('loads the next page when no cursor is given', async () => {
    const { client, pages } = await opened();
    // "Load whatever is next" - the page before the one the snapshot carried.
    await client.handle({ method: 'fetchTurns', params: { channel: 'ahp-chat:/long' } });
    expect(pages()[0]?.turns[49]?.message.text).toBe('said 69');
  });

  it('answers nothing older, without refusing, when the history fits', async () => {
    const { chat, client, pages } = await opened(10);
    expect(chat.turns).toHaveLength(10);
    expect(chat.turnsNextCursor).toBeUndefined();
    // "Load the next older page, if any": there is none, so nothing is sent
    // and nothing is refused. Refusing here is what reached a reader as
    // `RPC error -32602: Unrecognised cursor undefined` at the top of a
    // transcript that was already whole.
    await expect(client.handle({ method: 'fetchTurns', params: { channel: 'ahp-chat:/long' } }))
      .resolves.toEqual({});
    expect(pages()).toHaveLength(0);
  });

  it('refuses a cursor it did not issue', async () => {
    const { client } = await opened();
    // Guessing would answer a question about old turns with new ones, and the
    // client would page for ever without noticing.
    await expect(client.handle({ method: 'fetchTurns', params: { channel: 'ahp-chat:/long', cursor: 'banana' } }))
      .rejects.toMatchObject({ code: -32602 });
    await expect(client.handle({ method: 'fetchTurns', params: { channel: 'ahp-chat:/long', cursor: '9999' } }))
      .rejects.toMatchObject({ code: -32602 });
  });
});

describe('the flags a client sets', () => {
  it('keeps read and archived, and tells everyone watching', async () => {
    sdk.sessions.push({ sessionId: 'old', summary: 'Older', lastModified: 1, cwd: '/home/softov' });
    const host = serving('/home/softov');
    const p = peer();
    const client = host.accept(p);
    await client.handle(hello(['0.9.0'], { initialSubscriptions: ['ahp-root://'] }));
    const uri = 'ahp-session:/old';
    await client.handle({ method: 'subscribe', params: { channel: uri } });

    client.handle({ method: 'dispatchAction', params: { channel: uri, action: { type: 'session/isReadChanged', isRead: true } } });
    await settle();
    expect(actions(p, uri).some((e) => e.action.type === 'session/isReadChanged')).toBe(true);

    // The catalogue carries it too: activity in the low bits, the client's own
    // flags above. 1 | 32.
    const listed = await client.handle({ method: 'listSessions', params: { channel: 'ahp-root://' } }) as {
      items: { status: number }[];
    };
    expect(listed.items[0]?.status).toBe(33);
  });

  it('needs no agent to record one', async () => {
    sdk.sessions.push({ sessionId: 'old', summary: 'Older', lastModified: 1, cwd: '/home/softov' });
    const client = open();
    await client.handle(hello(['0.9.0']));
    // Marking a row read is what somebody does from a catalogue. Starting an
    // agent to record a bit would start one per row scrolled past.
    client.handle({
      method: 'dispatchAction',
      params: { channel: 'ahp-session:/old', action: { type: 'session/isArchivedChanged', isArchived: true } },
    });
    await settle();
    expect(sessionQueries()).toHaveLength(0);
    const listed = await client.handle({ method: 'listSessions', params: { channel: 'ahp-root://' } }) as {
      items: { status: number }[];
    };
    expect(listed.items[0]?.status).toBe(1 | 64);
  });
});

describe('a session read from its transcript', () => {
  it('rebuilds a tool call in a shape a client can draw', async () => {
    sdk.sessions.push({ sessionId: 'old', summary: 'Older', lastModified: 1, cwd: '/home/softov' });
    sdk.transcript.push(
      { type: 'user', uuid: 'u1', message: { role: 'user', content: 'list them' } },
      {
        type: 'assistant',
        uuid: 'a1',
        message: {
          role: 'assistant',
          model: 'claude-opus-5',
          usage: { input_tokens: 12, output_tokens: 3, cache_read_input_tokens: 900 },
          content: [{ type: 'tool_use', id: 'toolu_1', name: 'Bash', input: { command: 'ls' } }],
        },
      },
      {
        type: 'user',
        uuid: 'u2',
        message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_1', is_error: true, content: 'boom' }] },
      },
    );
    const client = open();
    await client.handle(hello(['0.9.0']));
    const opened = await client.handle({ method: 'subscribe', params: { channel: 'ahp-chat:/old' } }) as {
      snapshot: { state: { turns: { usage?: Record<string, unknown>; responseParts: { toolCall?: Record<string, unknown> }[] }[] } };
    };
    const turn = opened.snapshot.state.turns[0];
    const call = turn?.responseParts.find((part) => part.toolCall)?.toolCall;

    /*
     * `ToolCallStatus` has no `failed` - the seven are `streaming`,
     * `pending-confirmation`, `running`, `auth-required`,
     * `pending-result-confirmation`, `completed` and `cancelled`. A tool that
     * ran and went wrong ran; what went wrong is `success` and `error`.
     */
    expect(call?.status).toBe('completed');
    expect(call?.success).toBe(false);
    expect(call?.error).toMatchObject({ message: 'boom' });
    // The sentence the row draws, and the answer to whether anybody is being
    // asked. Both required, and a transcript full of calls without them is a
    // transcript of rows with nothing on them.
    expect(call?.invocationMessage).toEqual({ markdown: 'Running `ls`' });
    expect(call?.confirmed).toBe('not-needed');
    // MCP's content blocks, which carry a `type`.
    expect(call?.content).toEqual([{ type: 'text', text: 'boom' }]);
    // And what it cost, off the transcript rather than left out.
    expect(turn?.usage).toEqual({ inputTokens: 12, outputTokens: 3, cacheReadTokens: 900, model: 'claude-opus-5' });
  });

  it('is configurable before it is resumed', async () => {
    sdk.sessions.push({ sessionId: 'old', summary: 'Older', lastModified: 1, cwd: '/home/softov' });
    const client = open();
    await client.handle(hello(['0.9.0']));
    const opened = await client.handle({ method: 'subscribe', params: { channel: 'ahp-session:/old' } }) as {
      snapshot: { state: { config: { schema: { properties: Record<string, unknown> } }; values?: unknown } };
    };
    // Without the schema a client draws no controls at all - no permission
    // mode, no effort - on exactly the sessions somebody is deciding whether
    // to continue.
    expect(Object.keys(opened.snapshot.state.config.schema.properties)).toContain('permissionMode');
  });

  it('lists its chat the way a live session does', async () => {
    sdk.sessions.push({ sessionId: 'old', summary: 'Older', lastModified: 1000, cwd: '/home/softov' });
    const client = open();
    await client.handle(hello(['0.9.0']));
    await client.handle({ method: 'listSessions', params: { channel: 'ahp-root://' } });
    const opened = await client.handle({ method: 'subscribe', params: { channel: 'ahp-session:/old' } }) as {
      snapshot: { state: { chats: { resource: string; status: number; modifiedAt: string }[] } };
    };

    // A whole `ChatSummary`, because a client reads these fields by name off a
    // chat row and gets `undefined` from a row that carries only a URI.
    const chat = opened.snapshot.state.chats[0];
    expect(chat?.status).toBe(1);
    // The catalogue's time, not the moment somebody opened the row: a cold
    // session answering `now` looks edited every time it is read.
    expect(chat?.modifiedAt).toBe(new Date(1000).toISOString());
  });

  it('starts on what was chosen for it while it was only a row', async () => {
    sdk.sessions.push({ sessionId: 'old', summary: 'Older', lastModified: 1, cwd: '/home/softov' });
    const client = open();
    await client.handle(hello(['0.9.0']));
    client.handle({
      method: 'dispatchAction',
      params: { channel: 'ahp-session:/old', action: { type: 'session/configChanged', config: { permissionMode: 'plan' } } },
    });
    await settle();
    // Nothing was started to record it.
    expect(sessionQueries()).toHaveLength(0);

    client.handle({
      method: 'dispatchAction',
      params: { channel: 'ahp-chat:/old', action: { type: 'chat/turnStarted', turnId: 't1', message: { text: 'carry on' } } },
    });
    await settle(8);
    // Most of what the schema offers is fixed when the query is built, so a
    // session resumed without it is one that can never be given it.
    expect(sessionQueries().at(-1)?.options.permissionMode).toBe('plan');
  });

  it('reads a session again when the first read answered nothing', async () => {
    sdk.sessions.push({ sessionId: 'late', summary: 'Late', lastModified: 1, cwd: '/home/softov' });
    const client = open();
    await client.handle(hello(['0.9.0']));

    // Nothing in the transcript yet, which is the answer a read that failed
    // and a session nobody has written both give.
    const first = await client.handle({ method: 'subscribe', params: { channel: 'ahp-chat:/late' } }) as {
      snapshot: { state: { turns: unknown[] } };
    };
    expect(first.snapshot.state.turns).toEqual([]);
    expect(sdk.reads).toBe(1);

    // The turns are there now. The next open reads again rather than serving
    // the empty answer it kept, which is what made one bad read permanent for
    // the life of the process.
    sdk.transcript.push({ type: 'user', uuid: 'u1', message: { role: 'user', content: 'now' } });
    const second = await client.handle({ method: 'subscribe', params: { channel: 'ahp-chat:/late' } }) as {
      snapshot: { state: { turns: { message: { text: string } }[] } };
    };
    expect(sdk.reads).toBe(2);
    expect(second.snapshot.state.turns[0]?.message.text).toBe('now');

    // And a read that has turns is still kept, which is the large transcript
    // this cache was added for: a third open does not read at all.
    await client.handle({ method: 'subscribe', params: { channel: 'ahp-chat:/late' } });
    expect(sdk.reads).toBe(2);
  });

  it('tries a transcript that failed once more before calling it empty', async () => {
    sdk.sessions.push({ sessionId: 'flaky', summary: 'Flaky', lastModified: 1, cwd: '/home/softov' });
    sdk.transcript.push({ type: 'user', uuid: 'u1', message: { role: 'user', content: 'there' } });
    sdk.throwOnce = 1;

    const client = open();
    await client.handle(hello(['0.9.0']));
    const opened = await client.handle({ method: 'subscribe', params: { channel: 'ahp-chat:/flaky' } }) as {
      snapshot: { state: { turns: { message: { text: string } }[] } };
    };
    // The first read threw and the second answered, so the client is drawn a
    // turn rather than an empty session it would have to reopen to fix.
    expect(opened.snapshot.state.turns[0]?.message.text).toBe('there');
    expect(sdk.reads).toBe(2);
  });
});

describe('one conversation, one row', () => {
  it('hides the transcript a running session is writing', async () => {
    const { client } = await running();
    client.handle({
      method: 'dispatchAction',
      params: { channel: 'ahp-session:/live', action: { type: 'chat/turnStarted', turnId: 't1', message: { text: 'hi' } } },
    });
    await settle();
    // The client named the channel `live`; the agent names its own transcript
    // and writes under that. Both are this conversation.
    sdk.sessions.push({ sessionId: 'agent-chosen', summary: 'Hi', lastModified: 2, cwd: '/home/softov' });
    await emit({ type: 'system', subtype: 'init', session_id: 'agent-chosen' });

    const listed = await client.handle({ method: 'listSessions', params: { channel: 'ahp-root://' } }) as {
      items: { resource: string }[];
    };
    // One row, under the provider's name the session is held by.
    expect(listed.items.map((i) => i.resource)).toEqual(['claude:/live']);
  });
});

it('takes a client into a session it is serving from a transcript', async () => {
  sdk.sessions.push({ sessionId: 'older', summary: 'A real title', lastModified: 1, cwd: '/home/softov' });
  sdk.transcript.push({ type: 'user', uuid: 'u1', message: { role: 'user', content: 'hi' } });
  const host = serving('/home/softov');
  const p = peer();
  const client = host.accept(p);
  await client.handle(hello(['0.9.0']));
  const uri = 'ahp-session:/older';
  // Opening the row is what teaches this host the session exists.
  await client.handle({ method: 'subscribe', params: { channel: uri } });

  client.handle({
    method: 'dispatchAction',
    params: { channel: uri, clientSeq: 3, action: { type: 'session/activeClientSet', activeClient: {} } },
  });
  await settle();

  const said = actions(p, uri).filter((e) => e.action.type === 'session/activeClientSet');
  // `titles` is keyed by the bare id, and this asked it for the whole URI - so
  // every client announcing itself in a browsed session was turned away from a
  // session that was right there.
  expect(said.filter((e) => e.rejectionReason === undefined)).toHaveLength(1);
  expect(said.some((e) => e.rejectionReason !== undefined)).toBe(false);
});

it('takes a client into a session the catalogue has listed, before anybody reads it', async () => {
  sdk.sessions.push({ sessionId: 'listed', summary: 'A real title', lastModified: 1, cwd: '/home/softov' });
  const host = serving('/home/softov');
  const p = peer();
  const client = host.accept(p);
  await client.handle(hello(['0.9.0']));
  // Listing is what a client does before it opens a row, and announcing itself
  // is what it does *as* it opens one - before anything has read the transcript.
  await client.handle({ method: 'listSessions', params: { channel: 'ahp-root://' } });

  const uri = 'ahp-session:/listed';
  client.handle({
    method: 'dispatchAction',
    params: { channel: uri, clientSeq: 5, action: { type: 'session/activeClientSet', activeClient: {} } },
  });
  await settle();

  // Nothing refused it...
  expect(actions(p).some((e) => e.rejectionReason !== undefined)).toBe(false);
  // ...and the host kept it, which is the half a second client reads. The echo
  // itself goes to whoever is watching the session, which this client is not
  // yet - announcing yourself is what you do on the way in.
  const state = (await client.handle({ method: 'subscribe', params: { channel: uri } }) as {
    snapshot: { state: { activeClients: { clientId: string }[] } };
  }).snapshot.state;
  expect(state.activeClients.map((one) => one.clientId)).toEqual(['probe']);
});

/*
 * A build session sends a summary many times a second, and for most of those
 * times the row is byte for byte the row a client is already holding. Sending
 * it anyway is a flood of about 1.1 KB per second per client for nothing, and
 * it is the whole reason a host with two builds on it could not answer a
 * `listSessions` at all.
 */
describe('a summary that did not change', () => {
  /** The `changes` a session has been sent, in order. */
  const rowsMoved = (p: ReturnType<typeof peer>, session: string): Record<string, unknown>[] => p.notes
    .filter((n) => n.method === 'root/sessionSummaryChanged')
    .map((n) => n.params as { session: string; changes: Record<string, unknown> })
    .filter((n) => n.session === session)
    .map((n) => n.changes);

  /** The same title again, which is a move of nothing. */
  const retitle = async (client: { handle(request: Request): Promise<unknown> }, channel: string, title: string) => {
    await client.handle({ method: 'dispatchAction', params: { channel, action: { type: 'session/titleChanged', title } } });
    await settle();
  };

  it('sends one summary for however many calls moved nothing', async () => {
    const { client, peer: p } = await running();
    await retitle(client, 'claude:/live', 'Paging');
    expect(rowsMoved(p, 'claude:/live')).toHaveLength(1);

    // The same title again, and again: a rename a client makes twice, a
    // `rename_chat` the agent calls after its own, and the diff stat a
    // directory reports the same count for - all of it one row, unchanged.
    await retitle(client, 'claude:/live', 'Paging');
    await retitle(client, 'claude:/live', 'Paging');
    expect(rowsMoved(p, 'claude:/live')).toHaveLength(1);
  });

  it('sends again for a title that moved, and for an activity that moved', async () => {
    const { client, peer: p, chatUri } = await running();
    await retitle(client, 'claude:/live', 'Paging');
    expect(rowsMoved(p, 'claude:/live')).toHaveLength(1);

    await retitle(client, 'claude:/live', 'Paging, again');
    expect(rowsMoved(p, 'claude:/live')).toHaveLength(2);
    expect(rowsMoved(p, 'claude:/live').at(-1)?.title).toBe('Paging, again');

    // Which was the field that moved last in the measurements: a turn
    // starting and ending. Both have to get through, or the row a client
    // draws goes stale on exactly the session it is watching.
    const said = rowsMoved(p, 'claude:/live').length;
    client.handle({
      method: 'dispatchAction',
      params: { channel: chatUri, action: { type: 'chat/turnStarted', turnId: 't1', message: { text: 'read it' } } },
    });
    await settle();
    const busy = rowsMoved(p, 'claude:/live');
    expect(busy.length).toBeGreaterThan(said);
    expect(busy.at(-1)?.activity).toEqual(expect.any(String));
  });

  /**
   * A host whose directories say one file, and remember how to say it again.
   *
   * A row nobody is running takes its `changes` from the directory it is in,
   * and the directory is read at boot and again for every watcher a client
   * opened on it - so the same `{ status, changes }` comes back more than once
   * for a row that did not move. Which is the case this is here for.
   */
  const counted = () => {
    const watching: (() => void)[] = [];
    return {
      watching,
      source: {
        scopes: () => [{ id: 'uncommitted', label: 'Uncommitted', changeKind: 'uncommitted' }],
        state: async () => ({ status: 'ready' as const, files: [] }),
        summary: () => ({ files: 4 }),
        refresh: async () => true,
        watch: (_dir: string, onChange: () => void) => { watching.push(onChange); return () => {}; },
      },
    };
  };

  it('sends a listed row once, and not again for the same read of it', async () => {
    // The host's own path, and every directory its backend claims, is browsed
    // before the stored rows are read - so the row has to live somewhere else
    // for there to be a second read of it to be suppressed.
    sdk.sessions.push({ sessionId: 'old', summary: 'Older', lastModified: 1, cwd: '/github/elsewhere' });
    const counted_ = counted();
    const host = createHost({
      path: '/home/softov', agents: [claude({ paths: ['/home/softov'] })], ...machine(), changes: counted_.source,
    });
    const p = peer();
    const client = host.accept(p);
    await client.handle(hello(['0.9.0'], { initialSubscriptions: ['ahp-root://'] }));
    await client.handle({ method: 'listSessions', params: { channel: 'ahp-root://' } });
    // Reading the directory at boot is one read of it, and the summary that
    // comes out is the row's `status` and its counts and nothing else.
    await settle(12);
    expect(rowsMoved(p, 'claude:/old')).toHaveLength(1);
    expect(rowsMoved(p, 'claude:/old')[0]).toMatchObject({ status: 1, changes: { files: 4 } });

    // A client showing the row's diff re-reads the directory on every change
    // the source reports, which is the same answer for a working tree nobody
    // touched.
    await client.handle({ method: 'subscribe', params: { channel: 'claude:/old/changeset/uncommitted' } });
    await settle(12);
    const read = rowsMoved(p, 'claude:/old').length;
    expect(counted_.watching).toHaveLength(1);
    counted_.watching[0]?.();
    await settle(12);
    expect(rowsMoved(p, 'claude:/old')).toHaveLength(read);

    // And a flag is a change, so it goes out - once, and not twice.
    client.handle({
      method: 'dispatchAction',
      params: { channel: 'ahp-session:/old', action: { type: 'session/isReadChanged', isRead: true } },
    });
    await settle();
    expect(rowsMoved(p, 'claude:/old')).toHaveLength(read + 1);
    expect(rowsMoved(p, 'claude:/old').at(-1)?.status).toBe(33);
    counted_.watching[0]?.();
    await settle(12);
    expect(rowsMoved(p, 'claude:/old')).toHaveLength(read + 1);
  });

  it('sends the first move of a session re-created under the same URI', async () => {
    /*
     * The clock held still, because what this is about is a row that comes
     * back exactly as it was: the last summary sent for the URI was recorded
     * against the session that was disposed, and a client has nothing of the
     * new one to start from.
     */
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-01-01T12:00:00.000Z'));
    try {
      const { client, peer: p, uri } = await running();
      await retitle(client, uri, 'Paging');
      expect(rowsMoved(p, 'claude:/live')).toHaveLength(1);
      await retitle(client, uri, 'Paging');
      expect(rowsMoved(p, 'claude:/live')).toHaveLength(1);

      await client.handle({ method: 'disposeSession', params: { channel: uri } });
      await settle();
      await client.handle({ method: 'createSession', params: { channel: uri, provider: 'claude' } });
      await settle();
      // The same conversation, under the same name, with nothing on it - and a
      // client that watched it go has an empty row for it. The row it is sent
      // here is byte for byte the row the disposed session last sent.
      const before = rowsMoved(p, 'claude:/live').length;
      await retitle(client, uri, 'Paging');
      expect(rowsMoved(p, 'claude:/live')).toHaveLength(before + 1);
      await retitle(client, uri, 'Paging');
      expect(rowsMoved(p, 'claude:/live')).toHaveLength(before + 1);
    }
    finally {
      vi.useRealTimers();
    }
  });
});
