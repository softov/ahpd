import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Status } from '../src/sessions/catalog.js';
import { uriOf } from '../src/resources/resources.js';
import { fileSessions, memorySessions } from '../src/sessions/sessions.js';
import type { Request } from '../src/types/rpc.js';
import type { HostOptions } from '../src/types/host.js';
import {
  claude, createHost, echo, machine, resetSdk, actions, emit, hello, open, peer,
  sdk, serving, sessionQueries, settle, running, wrote,
} from './support/host.js';
import type { Agent, Listed } from '../src/types/agent.js';

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
    expect(listed.items[0]?.resource).toBe('ahp-session:/new');
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
    expect(seen[0]).toBe('ahp-session:/s119');
    expect(seen.at(-1)).toBe('ahp-session:/s0');
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
    // A summary names only a folder that is there, so the row's is this test's
    // own, which exists on whichever machine runs it.
    const here = dirname(fileURLToPath(import.meta.url));
    sdk.sessions.push({ ...older, cwd: here });
    const client = open();
    await client.handle(hello(['0.9.0']));
    const listed = await client.handle({ method: 'listSessions', params: {} }) as {
      items: { resource: string; workingDirectories: string[] }[];
    };
    expect(listed.items[0]?.workingDirectories).toEqual([uriOf(here)]);
    const opened = (await client.handle({ method: 'subscribe', params: { channel: listed.items[0]?.resource } }) as {
      snapshot: { state: { workingDirectories: string[] } };
    }).snapshot.state;
    expect(opened.workingDirectories).toEqual([uriOf(here)]);
  });

  it('resumes rather than replays when somebody says something', async () => {
    sdk.sessions.push(older);
    sdk.transcript.push({ type: 'user', uuid: 'u1', message: { role: 'user', content: 'earlier' } });
    wrote(older.sessionId, older.cwd);
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

  /**
   * The session opened, with the window the paging cases page from.
   *
   * A view of 50 keeps the cursor these cases were written around; a case
   * about a subscribe that names no view passes `null` instead.
   */
  const opened = async (count = 120, view: { turns?: number } | null = { turns: 50 }) => {
    sdk.sessions.push({ sessionId: 'long', summary: 'A long one', lastModified: 1, cwd: '/home/softov' });
    sdk.transcript.push(...many(count));
    // The CLI wrote the conversation, so a turn sent to it resumes the session
    // rather than starting one under the id this test asked for.
    wrote('long', '/home/softov');
    const host = serving('/home/softov');
    const p = peer();
    const client = host.accept(p);
    await client.handle(hello(['0.9.0']));
    const chat = (await client.handle({
      method: 'subscribe',
      params: { channel: 'ahp-chat:/long', ...(view === null ? {} : { view }) },
    }) as {
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

  it('gives every turn of a chat that is not running when no view is named', async () => {
    // The protocol: a subscribe that names no `view` is answered with every
    // retained turn, and a cursor only where a window left older ones behind.
    const { chat } = await opened(120, null);
    expect(chat.turns).toHaveLength(120);
    expect(chat.turns[0]?.message.text).toBe('said 0');
    expect(chat.turnsNextCursor).toBeUndefined();
  });

  it('gives the window a view names, and a cursor for the rest', async () => {
    const { chat } = await opened(120, { turns: 20 });
    expect(chat.turns).toHaveLength(20);
    expect(chat.turns[19]?.message.text).toBe('said 119');
    expect(chat.turnsNextCursor).toBe('100');
  });

  it('gives the newest page for a view that names no positive count', async () => {
    // Zero, a negative number or a fraction names no window of its own, so
    // the page is what an unreadable count falls back to.
    const { chat } = await opened(120, { turns: 0 });
    expect(chat.turns).toHaveLength(50);
    expect(chat.turnsNextCursor).toBe('70');
  });

  it('gives every turn of a live chat when no view is named', async () => {
    const { client } = await opened();
    await client.handle({
      method: 'dispatchAction',
      params: { channel: 'ahp-chat:/long', action: { type: 'chat/turnStarted', turnId: 't1', message: { text: 'say ok' } } },
    });
    await settle(6);
    await emit({ type: 'result', subtype: 'success', is_error: false, duration_ms: 1 });

    // Live now, so the state is the backend's rather than the transcript's.
    const chat = (await client.handle({ method: 'subscribe', params: { channel: 'ahp-chat:/long' } }) as {
      snapshot: { state: { turns: { message: { text: string } }[]; turnsNextCursor?: string } };
    }).snapshot.state;
    expect(chat.turns).toHaveLength(121);
    expect(chat.turnsNextCursor).toBeUndefined();
  });

  it('gives a live chat the window its view names', async () => {
    const { client } = await opened();
    await client.handle({
      method: 'dispatchAction',
      params: { channel: 'ahp-chat:/long', action: { type: 'chat/turnStarted', turnId: 't1', message: { text: 'say ok' } } },
    });
    await settle(6);
    await emit({ type: 'result', subtype: 'success', is_error: false, duration_ms: 1 });

    // The backend gives every turn, so the host is the one that cuts.
    const chat = (await client.handle({
      method: 'subscribe',
      params: { channel: 'ahp-chat:/long', view: { turns: 20 } },
    }) as {
      snapshot: { state: { turns: { message: { text: string } }[]; turnsNextCursor?: string } };
    }).snapshot.state;
    expect(chat.turns).toHaveLength(20);
    expect(chat.turns[19]?.message.text).toBe('say ok');
    expect(chat.turnsNextCursor).toBe('101');
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

  it('answers nothing older when no cursor is given', async () => {
    const { client, pages } = await opened();
    // No cursor asks for whatever is next, and a snapshot that named a view
    // carries the cursor that names the page before it. The host keeps no
    // record of which window a client got, so there is nothing to guess at.
    await expect(client.handle({ method: 'fetchTurns', params: { channel: 'ahp-chat:/long' } }))
      .resolves.toEqual({});
    expect(pages()).toHaveLength(0);
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

/*
 * A chat's read bit and its session's, each moved by its own action alone:
 * "The action toggles `SessionStatus.IsRead` only on the addressed
 * `ChatState`; it does not change the read state of the owning session or
 * sibling chats ... `session/isReadChanged` independently changes the owning
 * session's read state; neither action implies the other."
 * https://github.com/microsoft/agent-host-protocol/blob/5f16d81bb7045b66d7bc768d244feab75002d943/docs/specification/chat-channel.md#L26-L36
 */
describe('a chat\'s read bit and its session\'s', () => {
  type Client = Awaited<ReturnType<typeof running>>['client'];
  const second = 'ahp-chat:/second';

  /** Send one action on one channel, as a client does. */
  const send = async (client: Client, channel: string, action: Record<string, unknown>) => {
    client.handle({ method: 'dispatchAction', params: { channel, action } });
    await settle();
  };

  /** Whether the state a client opening `channel` now gets says it is read. */
  const isRead = async (client: Client, channel: string): Promise<boolean> => {
    const opened = await client.handle({ method: 'subscribe', params: { channel } }) as {
      snapshot: { state: { status: number } };
    };
    return (opened.snapshot.state.status & Status.IsRead) !== 0;
  };

  /** A live session with a second chat, both subscribed. */
  const twoChats = async () => {
    const started = await running();
    await started.client.handle({ method: 'createChat', params: { channel: started.uri, chat: second } });
    await started.client.handle({ method: 'subscribe', params: { channel: second } });
    return started;
  };

  const chatRead = (on: boolean) => ({ type: 'chat/isReadChanged', isRead: on });
  const sessionRead = (on: boolean) => ({ type: 'session/isReadChanged', isRead: on });

  it('starts a new session and a new chat read', async () => {
    const { client, peer: p, uri } = await running();
    // Nothing has been said in either yet, so there is nothing in them to read.
    const added = p.notes.find((n) => n.method === 'root/sessionAdded')?.params as { summary: { status: number } };
    expect(added.summary.status & Status.IsRead).toBe(Status.IsRead);
    await client.handle({ method: 'createChat', params: { channel: uri, chat: second } });
    const chat = actions(p, uri).find((e) => e.action.type === 'session/chatAdded')?.action.summary as { status: number };
    expect(chat.status & Status.IsRead).toBe(Status.IsRead);
  });

  it('leaves the session and the other chat as they are when a chat turns unread', async () => {
    const { client, peer: p, uri, chatUri } = await twoChats();
    p.notes.length = 0;
    await send(client, second, chatRead(false));
    expect(await isRead(client, second)).toBe(false);
    expect(await isRead(client, uri)).toBe(true);
    expect(await isRead(client, chatUri)).toBe(true);
    expect(actions(p, uri).filter((e) => e.action.type === 'session/isReadChanged')).toEqual([]);
    // The chat's row in its session moves with the chat, which keeps the list in step.
    expect(actions(p, uri).filter((e) => e.action.type === 'session/chatUpdated').map((e) => e.action.chat)).toEqual([second]);
  });

  it('leaves an unread session unread when its chats are read', async () => {
    const { client, uri, chatUri } = await twoChats();
    await send(client, uri, sessionRead(false));
    await send(client, second, chatRead(false));

    await send(client, second, chatRead(true));
    expect(await isRead(client, second)).toBe(true);
    expect(await isRead(client, chatUri)).toBe(true);
    expect(await isRead(client, uri)).toBe(false);
  });

  it('leaves the one chat read when a session with one chat is marked unread', async () => {
    const { client, peer: p, uri, chatUri } = await running();
    p.notes.length = 0;
    await send(client, uri, sessionRead(false));
    expect(await isRead(client, uri)).toBe(false);
    expect(await isRead(client, chatUri)).toBe(true);
    expect(actions(p, chatUri)).toEqual([]);
  });

  it('leaves each chat as it is when a session with two chats is marked unread', async () => {
    const { client, uri, chatUri } = await twoChats();
    await send(client, uri, sessionRead(false));
    expect(await isRead(client, chatUri)).toBe(true);
    expect(await isRead(client, second)).toBe(true);
  });

  it('leaves unread chats unread when the session is marked read, and says the session once', async () => {
    const { client, peer: p, uri, chatUri } = await twoChats();
    await send(client, uri, sessionRead(false));
    await send(client, second, chatRead(false));
    await send(client, chatUri, chatRead(false));
    p.notes.length = 0;

    await send(client, uri, sessionRead(true));
    expect(await isRead(client, uri)).toBe(true);
    expect(await isRead(client, chatUri)).toBe(false);
    expect(await isRead(client, second)).toBe(false);
    expect(actions(p).map((e) => e.action.type)).toEqual(['session/isReadChanged']);

    // Said again, nothing moved: the sender alone is answered.
    const said = p.notes.length;
    await send(client, uri, sessionRead(true));
    expect(p.notes.slice(said).map((one) => one.method)).toEqual(['action']);
    expect(actions(p, uri).at(-1)?.action.type).toBe('session/isReadChanged');
  });

  it('marks a chat unread when a turn starts, as a client reduces it, and leaves its session read', async () => {
    const { client, peer: p, uri, chatUri } = await running();
    await send(client, chatUri, { type: 'chat/turnStarted', turnId: 't1', message: { text: 'hi' } });

    expect(await isRead(client, chatUri)).toBe(false);
    expect(await isRead(client, uri)).toBe(true);
    // After the turn's start, which is where a client's reducer clears it.
    const types = actions(p, chatUri).map((e) => e.action.type);
    expect(types.indexOf('chat/turnStarted')).toBeLessThan(types.indexOf('chat/isReadChanged'));
    expect(actions(p, uri).filter((e) => e.action.type === 'session/isReadChanged')).toEqual([]);
  });

  /*
   * A turn's end marks its chat unread, and a read session unread, each with
   * this host's own action on its own channel, as the reference host does at
   * a turn's end.
   * https://github.com/microsoft/vscode/blob/1306698e328e5e531f5e632301d30020aa994eff/src/vs/platform/agentHost/node/chatContributions/markUnread/markUnreadContribution.ts#L27-L48
   */
  it('keeps a chat marked read while its turn runs, and marks the chat and its session unread when the turn completes', async () => {
    const { client, peer: p, uri, chatUri } = await running();
    await send(client, chatUri, { type: 'chat/turnStarted', turnId: 't1', message: { text: 'hi' } });
    await send(client, chatUri, chatRead(true));
    expect(await isRead(client, chatUri)).toBe(true);
    expect(await isRead(client, uri)).toBe(true);

    await emit({ type: 'result', subtype: 'success', is_error: false, duration_ms: 4 });
    expect(await isRead(client, chatUri)).toBe(false);
    expect(await isRead(client, uri)).toBe(false);
    // After the ending, so a client applies the turn's end before the bits:
    // the chat's first, then the session's.
    const said = actions(p).map((e) => `${String(e.action.type)} ${e.channel}`);
    expect(said.indexOf(`chat/turnComplete ${chatUri}`)).toBeLessThan(said.lastIndexOf(`chat/isReadChanged ${chatUri}`));
    expect(said.lastIndexOf(`chat/isReadChanged ${chatUri}`)).toBeLessThan(said.indexOf(`session/isReadChanged ${uri}`));
  });

  it('marks a chat and its session unread when a turn fails', async () => {
    const { client, uri, chatUri } = await running();
    await send(client, chatUri, { type: 'chat/turnStarted', turnId: 't1', message: { text: 'hi' } });
    await emit({ type: 'result', subtype: 'error_during_execution', is_error: true, errors: ['no'], duration_ms: 4 });

    expect(await isRead(client, chatUri)).toBe(false);
    expect(await isRead(client, uri)).toBe(false);
  });

  it('marks a chat and its session unread when a turn is cancelled', async () => {
    const { client, peer: p, uri, chatUri } = await running();
    await send(client, chatUri, { type: 'chat/turnStarted', turnId: 't1', message: { text: 'hi' } });
    await send(client, chatUri, { type: 'chat/turnCancelled', turnId: 't1' });

    expect(actions(p, chatUri).some((e) => e.action.type === 'chat/turnCancelled')).toBe(true);
    expect(await isRead(client, chatUri)).toBe(false);
    expect(await isRead(client, uri)).toBe(false);
  });

  it('says nothing more of a session that is unread when a turn ends', async () => {
    const { client, peer: p, uri, chatUri } = await running();
    await send(client, uri, sessionRead(false));
    await send(client, chatUri, { type: 'chat/turnStarted', turnId: 't1', message: { text: 'hi' } });
    await emit({ type: 'result', subtype: 'success', is_error: false, duration_ms: 4 });

    expect(await isRead(client, uri)).toBe(false);
    expect(actions(p, uri).filter((e) => e.action.type === 'session/isReadChanged').map((e) => e.action.isRead))
      .toEqual([false]);
  });

  /** A second client of the same session, subscribed to both its channels. */
  const alsoWatching = async (started: Awaited<ReturnType<typeof running>>) => {
    const p = peer();
    const client = started.host.accept(p);
    await client.handle(hello(['0.9.0'], { clientId: 'second' }));
    await client.handle({ method: 'subscribe', params: { channel: started.uri } });
    await client.handle({ method: 'subscribe', params: { channel: started.chatUri } });
    return { client, peer: p };
  };

  /*
   * A stop with no turn running is one the protocol has the server refuse:
   * "`chat/turnCancelled` | No active turn | Server MUST reject the action".
   * https://github.com/microsoft/agent-host-protocol/blob/5f16d81bb7045b66d7bc768d244feab75002d943/docs/specification/chat-channel.md#L353
   * A refusal goes to its sender, who drops the stop it holds; no other client
   * applied it, so no other client hears of it.
   */
  it('refuses a cancel with no turn running, whatever turn it names, to its sender alone', async () => {
    const started = await running();
    const { peer: two } = await alsoWatching(started);
    started.peer.notes.length = 0;
    two.notes.length = 0;

    for (const [clientSeq, turnId] of [[7, 't1'], [8, '']] as const) {
      started.client.handle({
        method: 'dispatchAction',
        params: { channel: started.chatUri, clientSeq, action: { type: 'chat/turnCancelled', turnId } },
      });
      await settle();
    }

    const said = actions(started.peer, started.chatUri);
    expect(said.map((e) => e.origin)).toEqual([{ clientId: 'probe', clientSeq: 7 }, { clientId: 'probe', clientSeq: 8 }]);
    expect(said.map((e) => e.rejectionReason)).toEqual([
      `Nothing is running on ${started.chatUri} to stop`,
      `Nothing is running on ${started.chatUri} to stop`,
    ]);
    expect(actions(two)).toEqual([]);
  });

  it('stops the running turn when the cancel names it, and tells every client', async () => {
    const started = await running();
    const { peer: two } = await alsoWatching(started);
    await send(started.client, started.chatUri, { type: 'chat/turnStarted', turnId: 't1', message: { text: 'hi' } });
    started.peer.notes.length = 0;
    two.notes.length = 0;

    await send(started.client, started.chatUri, { type: 'chat/turnCancelled', turnId: 't1' });

    expect(actions(started.peer, started.chatUri).some((e) => e.action.type === 'chat/turnCancelled')).toBe(true);
    expect(actions(two, started.chatUri).some((e) => e.action.type === 'chat/turnCancelled')).toBe(true);
  });

  it('leaves the running turn alone when the cancel names another one', async () => {
    const started = await running();
    await send(started.client, started.chatUri, { type: 'chat/turnStarted', turnId: 't1', message: { text: 'hi' } });
    started.peer.notes.length = 0;

    started.client.handle({
      method: 'dispatchAction',
      params: { channel: started.chatUri, clientSeq: 9, action: { type: 'chat/turnCancelled', turnId: 't2' } },
    });
    await settle();

    // The only stop on this channel is the echo, which is what says the
    // backend was never asked to end the turn that is really running.
    const said = actions(started.peer, started.chatUri).filter((e) => e.action.type === 'chat/turnCancelled');
    expect(said).toHaveLength(1);
    expect(said[0]?.action).toEqual({ type: 'chat/turnCancelled', turnId: 't2' });
    expect(said[0]?.origin).toEqual({ clientId: 'probe', clientSeq: 9 });
  });

  /*
   * A chat archived on its own is marked read, as the reference host marks it.
   * https://github.com/microsoft/vscode/blob/1306698e328e5e531f5e632301d30020aa994eff/src/vs/platform/agentHost/node/chatContributions/chatArchive/chatArchiveContribution.ts#L50-L51
   */
  it('marks an unread chat read when it is archived, after the archive', async () => {
    const { client, peer: p, uri, chatUri } = await twoChats();
    await send(client, chatUri, chatRead(false));
    await send(client, second, chatRead(false));
    p.notes.length = 0;

    await send(client, second, { type: 'chat/isArchivedChanged', isArchived: true });
    expect(actions(p, second).map((e) => e.action.type)).toEqual(['chat/isArchivedChanged', 'chat/isReadChanged']);
    expect(await isRead(client, second)).toBe(true);
    expect(await isRead(client, chatUri)).toBe(false);
    expect(await isRead(client, uri)).toBe(true);
  });

  it('leaves an unread session unread when its last unread chat is archived', async () => {
    const { client, peer: p, uri } = await twoChats();
    await send(client, uri, sessionRead(false));
    await send(client, second, chatRead(false));
    p.notes.length = 0;

    await send(client, second, { type: 'chat/isArchivedChanged', isArchived: true });
    expect(await isRead(client, second)).toBe(true);
    expect(await isRead(client, uri)).toBe(false);
    expect(actions(p, uri).filter((e) => e.action.type === 'session/isReadChanged')).toEqual([]);
  });

  it('changes no read bit when a chat is taken out of the archive', async () => {
    const { client, peer: p } = await twoChats();
    await send(client, second, { type: 'chat/isArchivedChanged', isArchived: true });
    await send(client, second, chatRead(false));
    p.notes.length = 0;

    await send(client, second, { type: 'chat/isArchivedChanged', isArchived: false });
    expect(actions(p, second).map((e) => e.action.type)).toEqual(['chat/isArchivedChanged']);
    expect(await isRead(client, second)).toBe(false);
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

describe("a row lists the session's chats", () => {
  type Row = { chats?: { resource: string; title: string; status: number }[]; defaultChat?: string };
  /**
   * A session's row as the root said it last, from either notification.
   *
   * Read from the wire rather than from `listSessions`, because half of what
   * is checked here is that the notification carries the list: a client told
   * about a chat appearing and not told about it in the row is a client whose
   * list is one revision behind its own action.
   */
  const rowOf = (p: ReturnType<typeof peer>, session: string): Row | undefined => {
    let found: Row | undefined;
    for (const note of p.notes) {
      const params = note.params as Record<string, unknown>;
      const summary = note.method === 'root/sessionAdded' ? params.summary as Record<string, unknown> : undefined;
      if (summary?.resource === session) found = { ...(found ?? {}), ...summary } as Row;
      if (note.method === 'root/sessionSummaryChanged' && params.session === session)
        found = { ...(found ?? {}), ...(params.changes as Record<string, unknown>) } as Row;
    }
    return found;
  };
  const chatsOf = (p: ReturnType<typeof peer>, session: string) => rowOf(p, session)?.chats ?? [];
  const resourcesOf = (p: ReturnType<typeof peer>, session: string) => chatsOf(p, session).map((one) => one.resource);

  it("lists a session's chats and the one a client gets when it names none", async () => {
    const { client, uri } = await running();
    const second = 'ahp-chat:/second';
    await client.handle({ method: 'createChat', params: { channel: uri, chat: second } });

    const listed = await client.handle({ method: 'listSessions', params: { channel: 'ahp-root://' } }) as {
      items: { resource: string; chats?: { resource: string; title: string; status: number }[]; defaultChat?: string }[];
    };
    const row = listed.items.find((one) => one.resource === 'ahp-session:/live');
    // A client listing sessions draws their chats from the rows rather than
    // subscribing to each session, so the list has to be on the row - and the
    // default chat is the first of them and named as well.
    expect(row?.chats?.map((one) => one.resource)).toEqual([row?.defaultChat, second]);
    expect(row?.defaultChat).toMatch(/^ahp-chat:\/\/default\//);
    expect(row?.chats?.every((one) => typeof one.status === 'number')).toBe(true);
  });

  it("says a chat's status in the row when a turn starts in it", async () => {
    const { client, peer: p, uri } = await running();
    const second = 'ahp-chat:/second';
    await client.handle({ method: 'createChat', params: { channel: uri, chat: second } });
    client.handle({
      method: 'dispatchAction',
      params: { channel: second, action: { type: 'chat/turnStarted', turnId: 't1', message: { text: 'go' } } },
    });
    await settle();

    // Each row change carries the fields that moved, so the status is the
    // last one any of them carried.
    const updated = actions(p).filter((e) => e.action.type === 'session/chatUpdated' && e.action.chat === second
      && (e.action.changes as { status?: number }).status !== undefined).at(-1);
    const status = (updated?.action.changes as { status?: number } | undefined)?.status;
    expect(status).toBe(Status.InProgress);
    // And the row agrees with the chat, which is what a client listing
    // sessions with no subscription to either reads.
    expect(chatsOf(p, 'ahp-session:/live').find((one) => one.resource === second)?.status).toBe(status);
    expect(chatsOf(p, 'ahp-session:/live').find((one) => one.resource === rowOf(p, 'ahp-session:/live')?.defaultChat)?.status)
      .toBe(Status.Idle | Status.IsRead);
  });

  it('says the row again when a chat opens and when one closes', async () => {
    const { client, peer: p, uri } = await running();
    const second = 'ahp-chat:/second';
    const said = () => p.notes.filter((n) => n.method === 'root/sessionSummaryChanged'
      && (n.params as { session?: string }).session === 'ahp-session:/live').length;

    const before = said();
    await client.handle({ method: 'createChat', params: { channel: uri, chat: second } });
    expect(said()).toBeGreaterThan(before);
    expect(resourcesOf(p, 'ahp-session:/live')).toContain(second);

    const opened = said();
    await client.handle({ method: 'disposeChat', params: { channel: second } });
    expect(said()).toBeGreaterThan(opened);
    // The list replaces the catalog, so the chat being gone from it is what
    // takes it out of a client's list.
    expect(resourcesOf(p, 'ahp-session:/live')).not.toContain(second);
    expect(resourcesOf(p, 'ahp-session:/live')).toEqual([rowOf(p, 'ahp-session:/live')?.defaultChat]);
  });

  it('lists a worker chat read back from a backend, and read-only', async () => {
    sdk.sessions.push({ sessionId: 'restored', summary: 'Restored', lastModified: 2, cwd: '/home/softov' });
    sdk.transcript.push({ type: 'user', uuid: 'u1', message: { role: 'user', content: 'earlier' } });
    /*
     * A backend that says it once ran a worker. The Claude plugin reaches its
     * worker records through the SDK, which this file has faked away, so what
     * a restart finds is driven from the agent itself - the seam
     * `subagent-chat.test.ts` uses to open one live.
     */
    const base = claude({ paths: ['/home/softov'] });
    const host = serving('/home/softov', [], {
      agents: [{ ...base, subagents: async () => [{ toolCallId: 'toolu_task', title: 'Explore', turns: [] }] }],
    });
    const p = peer();
    const client = host.accept(p);
    await client.handle(hello(['0.9.0'], { initialSubscriptions: ['ahp-root://'] }));
    await client.handle({ method: 'subscribe', params: { channel: 'ahp-session:/restored' } });
    client.handle({
      method: 'dispatchAction',
      params: { channel: 'ahp-chat:/restored', action: { type: 'chat/turnStarted', turnId: 't1', message: { text: 'and now?' } } },
    });
    await settle(8);
    // Subscribing again is what reads the backend's record of the workers it
    // ran, which is where the row's copy of them comes from.
    await client.handle({ method: 'subscribe', params: { channel: 'ahp-session:/restored' } });
    await settle();

    const listed = await client.handle({ method: 'listSessions', params: { channel: 'ahp-root://' } }) as {
      items: { resource: string; chats?: { resource: string; title: string; interactivity?: string }[] }[];
    };
    const row = listed.items.find((one) => one.resource === 'ahp-session:/restored');
    const worker = row?.chats?.find((one) => one.interactivity === 'read-only');
    // A worker is a chat of its session even though no `Session` holds it, and
    // a client that never subscribes to it still has to see that it is there.
    expect(worker?.title).toBe('Explore');
    expect(worker?.resource).toContain('toolu_task');
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
    expect(listed.items.map((i) => i.resource)).toEqual(['ahp-session:/live']);
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
    // The row a session sends once its customizations arrive comes first.
    await settle();
    const opened = rowsMoved(p, 'ahp-session:/live').length;
    await retitle(client, 'ahp-session:/live', 'Paging');
    expect(rowsMoved(p, 'ahp-session:/live')).toHaveLength(opened + 1);

    // The same title again, and again: a rename a client makes twice, a
    // `rename_chat` the agent calls after its own, and the diff stat a
    // directory reports the same count for - all of it one row, unchanged.
    await retitle(client, 'ahp-session:/live', 'Paging');
    await retitle(client, 'ahp-session:/live', 'Paging');
    expect(rowsMoved(p, 'ahp-session:/live')).toHaveLength(opened + 1);
  });

  it('sends again for a title that moved, and for an activity that moved', async () => {
    const { client, peer: p, chatUri } = await running();
    await settle();
    const opened = rowsMoved(p, 'ahp-session:/live').length;
    await retitle(client, 'ahp-session:/live', 'Paging');
    expect(rowsMoved(p, 'ahp-session:/live')).toHaveLength(opened + 1);

    await retitle(client, 'ahp-session:/live', 'Paging, again');
    expect(rowsMoved(p, 'ahp-session:/live')).toHaveLength(opened + 2);
    expect(rowsMoved(p, 'ahp-session:/live').at(-1)?.title).toBe('Paging, again');

    // Which was the field that moved last in the measurements: a turn
    // starting and ending. Both have to get through, or the row a client
    // draws goes stale on exactly the session it is watching.
    const said = rowsMoved(p, 'ahp-session:/live').length;
    client.handle({
      method: 'dispatchAction',
      params: { channel: chatUri, action: { type: 'chat/turnStarted', turnId: 't1', message: { text: 'read it' } } },
    });
    await settle();
    const busy = rowsMoved(p, 'ahp-session:/live');
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
    // comes out is the row's `status` and its counts and nothing else. Waited
    // for by the clock: a read on Windows outlasts a count of ticks.
    await vi.waitFor(() => { expect(rowsMoved(p, 'ahp-session:/old')).not.toHaveLength(0); }, { timeout: 3000 });
    await settle(12);
    expect(rowsMoved(p, 'ahp-session:/old')).toHaveLength(1);
    expect(rowsMoved(p, 'ahp-session:/old')[0]).toMatchObject({ status: 1, changes: { files: 4 } });

    // A client showing the row's diff re-reads the directory on every change
    // the source reports, which is the same answer for a working tree nobody
    // touched.
    await client.handle({ method: 'subscribe', params: { channel: 'ahp-session:/old/changeset/uncommitted' } });
    await vi.waitFor(() => { expect(counted_.watching).toHaveLength(1); }, { timeout: 3000 });
    await settle(12);
    const read = rowsMoved(p, 'ahp-session:/old').length;
    expect(counted_.watching).toHaveLength(1);
    counted_.watching[0]?.();
    await settle(12);
    expect(rowsMoved(p, 'ahp-session:/old')).toHaveLength(read);

    // And a flag is a change, so it goes out - once, and not twice.
    client.handle({
      method: 'dispatchAction',
      params: { channel: 'ahp-session:/old', action: { type: 'session/isReadChanged', isRead: true } },
    });
    await settle();
    expect(rowsMoved(p, 'ahp-session:/old')).toHaveLength(read + 1);
    expect(rowsMoved(p, 'ahp-session:/old').at(-1)?.status).toBe(33);
    counted_.watching[0]?.();
    await settle(12);
    expect(rowsMoved(p, 'ahp-session:/old')).toHaveLength(read + 1);
  });

  it('sends zero counts for a listed row once its folder has no changes', async () => {
    sdk.sessions.push({ sessionId: 'old', summary: 'Older', lastModified: 1, cwd: '/github/elsewhere' });
    const counted_ = counted();
    let files = 4;
    counted_.source.summary = () => ({ files });
    const host = createHost({
      path: '/home/softov', agents: [claude({ paths: ['/home/softov'] })], ...machine(), changes: counted_.source,
    });
    const p = peer();
    const client = host.accept(p);
    await client.handle(hello(['0.9.0'], { initialSubscriptions: ['ahp-root://'] }));
    await client.handle({ method: 'listSessions', params: { channel: 'ahp-root://' } });
    await vi.waitFor(() => { expect(rowsMoved(p, 'ahp-session:/old').at(-1)).toMatchObject({ changes: { files: 4 } }); }, { timeout: 3000 });

    // Everything committed: the folder has no changes, and the partial has to
    // say so, because a partial without `changes` keeps the client's old counts.
    await client.handle({ method: 'subscribe', params: { channel: 'ahp-session:/old/changeset/uncommitted' } });
    await vi.waitFor(() => { expect(counted_.watching).toHaveLength(1); }, { timeout: 3000 });
    files = 0;
    counted_.watching[0]?.();
    await vi.waitFor(() => {
      expect(rowsMoved(p, 'ahp-session:/old').at(-1)?.changes).toEqual({ files: 0, additions: 0, deletions: 0 });
    }, { timeout: 3000 });
  });

  it('measures the first move of a session re-created under the same URI against its new row', async () => {
    /*
     * The clock held still, because what this is about is a row that comes
     * back exactly as it was: the last summary sent for the URI was recorded
     * against the session that was disposed, and a client has nothing of the
     * new one but the row it was added with.
     */
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-01-01T12:00:00.000Z'));
    try {
      const { client, peer: p, uri } = await running();
      await settle();

      await client.handle({ method: 'disposeSession', params: { channel: uri } });
      await settle();
      const added = p.notes.filter((n) => n.method === 'root/sessionAdded').length;
      await client.handle({ method: 'createSession', params: { channel: uri, provider: 'claude' } });
      await settle();
      // The same conversation, under the same name, added whole: what a client
      // that watched it go now holds, and what the next move is a change from.
      expect(p.notes.filter((n) => n.method === 'root/sessionAdded')).toHaveLength(added + 1);
      const before = rowsMoved(p, 'ahp-session:/live');
      await retitle(client, uri, 'Paging');
      const moved = rowsMoved(p, 'ahp-session:/live');
      expect(moved).toHaveLength(before.length + 1);
      expect(moved.at(-1)).toMatchObject({ title: 'Paging' });
      await retitle(client, uri, 'Paging');
      expect(rowsMoved(p, 'ahp-session:/live')).toHaveLength(before.length + 1);
    }
    finally {
      vi.useRealTimers();
    }
  });
});

/*
 * What the counts in a row are.
 *
 * What a session did, and not what the folder it worked in happens to hold:
 * two sessions in one directory did different work, and a commit takes neither
 * of them to nothing. So a row counts the session's own tree - the difference
 * between its baseline and the last turn it finished, or everything since the
 * branch of a worktree of its own was cut - and the answer is kept where the
 * next daemon reads it again.
 */
describe("a row's counts are the session's own", () => {
  type Client = Awaited<ReturnType<typeof running>>['client'];
  /** The folder every session here works in, which two of them share. */
  const FOLDER = '/home/softov';

  let made: string[] = [];
  afterEach(() => {
    for (const dir of made) rmSync(dir, { recursive: true, force: true });
    made = [];
  });

  /** The `changes` a session has been sent, in order. */
  const rowsMoved = (p: ReturnType<typeof peer>, session: string): Record<string, unknown>[] => p.notes
    .filter((n) => n.method === 'root/sessionSummaryChanged')
    .map((n) => n.params as { session: string; changes: Record<string, unknown> })
    .filter((n) => n.session === session)
    .map((n) => n.changes);

  /**
   * The counts a session's row carries, as a client holds them: the last
   * change that carried any, or the row it was added with. A change carries
   * the fields that moved, so a later one about the title leaves the counts.
   */
  const countsOf = (p: ReturnType<typeof peer>, session: string) => {
    const moved = rowsMoved(p, session).filter((changes) => changes.changes !== undefined).at(-1)?.changes;
    const added = p.notes.filter((n) => n.method === 'root/sessionAdded')
      .map((n) => (n.params as { summary: Record<string, unknown> }).summary)
      .filter((summary) => summary.resource === session).at(-1)?.changes;
    return (moved ?? added) as { files?: number; additions?: number; deletions?: number } | undefined;
  };

  /**
   * A source whose counts are the session's, with a directory's of its own.
   *
   * Two sessions in one folder have to come out as two different numbers, so
   * the folder is given a third one: a row that took the folder's answer, or
   * its neighbour's, is a row these cases can tell apart from the right one.
   */
  const ownWork = (counts: Record<string, number>, branch?: number) => ({
    scopes: () => [{ id: 'session', label: 'Session Changes', changeKind: 'session' as const }],
    state: async () => ({ status: 'ready' as const, files: [] }),
    summary: (_dir: string) => ({ files: 99, additions: 99, deletions: 99 }),
    sessionSummary: async (_dir: string, session: string) => ({ files: counts[session] ?? 0 }),
    ...(branch === undefined ? {} : { branchSummary: async () => ({ files: branch }) }),
    refresh: async () => true,
  });

  /** One turn in a chat, started and cancelled: a turn that ended, either way. */
  const turn = async (client: Client, chatUri: string, turnId = 't1') => {
    client.handle({
      method: 'dispatchAction',
      params: { channel: chatUri, action: { type: 'chat/turnStarted', turnId, message: { text: 'go' } } },
    });
    await settle();
    client.handle({
      method: 'dispatchAction',
      params: { channel: chatUri, action: { type: 'chat/turnCancelled', turnId } },
    });
    // The counts are read behind the checkpoint of that turn, which is two
    // answers away - and a row nobody waited for is a row a test cannot read.
    await settle(12);
  };

  /**
   * One turn in a chat the agent fails at the end of.
   *
   * A failure is the agent's to report, so this is what its own CLI says
   * rather than an action a client may send: the host turns it into the
   * `chat/error` that ends the turn.
   */
  const failed = async (client: Client, chatUri: string, turnId = 't1') => {
    client.handle({
      method: 'dispatchAction',
      params: { channel: chatUri, action: { type: 'chat/turnStarted', turnId, message: { text: 'go' } } },
    });
    await settle();
    await emit({ type: 'result', subtype: 'error_during_execution', is_error: true, errors: ['the agent died'], duration_ms: 12 });
    await settle(12);
  };

  /** A session in a folder, with one turn behind it: when its counts are read. */
  const opened = async (client: Client, name: string, folder = FOLDER) => {
    const uri = `ahp-session:/${name}`;
    await client.handle({
      method: 'createSession',
      params: { channel: uri, provider: 'claude', workingDirectories: [`file://${folder}`] },
    });
    const state = ((await client.handle({ method: 'subscribe', params: { channel: uri } })) as {
      snapshot: { state: { defaultChat: string } };
    }).snapshot.state;
    await client.handle({ method: 'subscribe', params: { channel: state.defaultChat } });
    await turn(client, state.defaultChat);
    return { uri, chatUri: state.defaultChat };
  };

  /** A host with one session in it that has done one turn. */
  const turned = async (over: Partial<HostOptions>, name: string, folder = FOLDER) => {
    const host = serving(FOLDER, [], over);
    const p = peer();
    const client = host.accept(p);
    await client.handle(hello(['0.9.0'], { initialSubscriptions: ['ahp-root://'] }));
    const at = await opened(client, name, folder);
    return { host, client, peer: p, ...at };
  };

  it('gives two sessions in one folder the counts each of them did', async () => {
    const source = ownWork({ one: 3, two: 5 });
    const host = serving(FOLDER, [], { changes: source });
    const p = peer();
    const client = host.accept(p);
    await client.handle(hello(['0.9.0'], { initialSubscriptions: ['ahp-root://'] }));

    await opened(client, 'one');
    await opened(client, 'two');

    expect(countsOf(p, 'ahp-session:/one')).toMatchObject({ files: 3 });
    expect(countsOf(p, 'ahp-session:/two')).toMatchObject({ files: 5 });
    // And the folder's own counts, which both of them are working in, are
    // neither session's: a row that took those would say 99 for each of them.
    expect(source.summary(FOLDER)).toMatchObject({ files: 99 });
  });

  it('gives a worktree session its branch changes', async () => {
    const source = ownWork({ live: 3 }, 7);
    const store = memorySessions();
    // The tree this session was given: the record is what says a row is
    // counted by a branch, and it is the record that outlives the run.
    store.setWorktree('live', { repository: FOLDER, path: `${FOLDER}/tree`, base: 'main' });
    const { peer: p } = await turned({ changes: source, sessions: store }, 'live');

    // Its own work is three files and its branch holds seven, and the row is
    // the branch: everything since the tree was cut is this session's work,
    // committed or not, since the directory is its own and nobody else's.
    expect(countsOf(p, 'ahp-session:/live')).toMatchObject({ files: 7 });
  });

  it('moves a row with the work the turn it just ran did', async () => {
    let files = 2;
    const source = { ...ownWork({ live: 2 }), sessionSummary: async () => ({ files }) };
    const { client, peer: p, chatUri } = await turned({ changes: source }, 'live');
    expect(countsOf(p, 'ahp-session:/live')).toMatchObject({ files: 2 });

    files = 6;
    await turn(client, chatUri, 't2');
    expect(countsOf(p, 'ahp-session:/live')).toMatchObject({ files: 6 });
  });

  it('moves a row with the work a turn did before it failed', async () => {
    let files = 2;
    const source = { ...ownWork({ live: 2 }), sessionSummary: async () => ({ files }) };
    const { client, peer: p, chatUri } = await turned({ changes: source }, 'live');
    expect(countsOf(p, 'ahp-session:/live')).toMatchObject({ files: 2 });

    // The turn wrote three more files and then the agent died. What it wrote
    // is still the session's work, so its row moves the way a finished turn's
    // does: a row left at the counts of the turn before is a client drawing
    // work nobody can see.
    files = 5;
    await failed(client, chatUri, 't2');
    expect(countsOf(p, 'ahp-session:/live')).toMatchObject({ files: 5 });
  });

  it("reads a row's counts back from the store after a restart", async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ahpd-counts-'));
    made.push(dir);
    const first = await turned({ changes: ownWork({ live: 4 }), sessions: fileSessions({ dir }) }, 'live');
    expect(countsOf(first.peer, 'ahp-session:/live')).toMatchObject({ files: 4 });
    // Written after the change rather than during it, so the next store is
    // given a tick to have a file to read.
    await settle();

    // The daemon stops here, and starts again over the folder of sessions it
    // left: the session is not running in the new one, so its row has nothing
    // but what was written down.
    sdk.sessions.push({ sessionId: 'live', summary: 'Live', lastModified: 1, cwd: FOLDER });
    const again = serving(FOLDER, [], { changes: ownWork({ live: 4 }), sessions: fileSessions({ dir }) });
    const p = peer();
    const client = again.accept(p);
    await client.handle(hello(['0.9.0']));
    const listed = await client.handle({ method: 'listSessions', params: { channel: 'ahp-root://' } }) as {
      items: { resource: string; changes?: { files?: number } }[];
    };

    // The folder says 99 of its own; what comes back is what the session was
    // measured at before the daemon stopped.
    expect(listed.items.find((one) => one.resource === 'ahp-session:/live')?.changes?.files).toBe(4);
  });

  it('keeps no file for a session disposed while its counts were being read', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ahpd-counts-'));
    made.push(dir);
    // The read held until the session is gone: a session disposed a second
    // after it was made, while the counts after its baseline are still running.
    let release = (): void => {};
    const held = new Promise<void>((resolve) => { release = resolve; });
    let asked = false;
    const source = {
      ...ownWork({ live: 4 }),
      sessionSummary: async () => { asked = true; await held; return { files: 4 }; },
    };
    const { client, uri } = await turned({ changes: source, sessions: fileSessions({ dir }) }, 'live');
    await vi.waitFor(() => { expect(asked).toBe(true); });

    await client.handle({ method: 'disposeSession', params: { channel: uri } });
    await settle();
    release();
    await settle();

    // A disposed session's file goes with it, and a count that arrives after
    // has nothing to be written into: a file of counts alone is a session the
    // next daemon lists and nobody can open.
    expect(existsSync(join(dir, 'live.json'))).toBe(false);
  });
});

describe("a listed row's _meta", () => {
  /*
   * What a backend knows about a session nothing runs.
   *
   * A row is listed once and answered many times: the summary a client reduces
   * its list against, and the state it reads when it opens the session. Both
   * are composed by `describes`, which reads a session's `_meta` from the agent
   * while one runs - so a browsed row's keys have to be kept where that read
   * finds them.
   */
  const PATH = '/home/softov';
  const STAMP = '2026-10-25T00:00:00.000Z';
  const row = (id: string, meta?: Record<string, unknown>): Listed => ({
    id,
    title: id,
    createdAt: STAMP,
    modifiedAt: STAMP,
    workingDirectories: [`file://${PATH}`],
    ...(meta === undefined ? {} : { _meta: meta }),
  });
  /** A backend over a store a test names, listing it and finding one id in it. */
  const backend = (listed: Listed[], known?: (id: string) => Listed | undefined): Agent => ({
    ...echo({ path: PATH, pace: 0 }),
    provider: 'slow',
    displayName: 'Slow',
    directories: () => [PATH],
    list: async () => [...listed],
    ...(known === undefined ? {} : { find: async (id: string) => known(id) }),
    transcript: async () => [],
  });
  type Row = { resource: string; _meta?: Record<string, unknown> };

  it("sends a row's _meta on the summary that lists it", async () => {
    const host = createHost({
      path: PATH,
      agents: [backend([row('one', { bot: 'motion', color: 'red' })])],
      ...machine(),
    });
    const client = host.accept(peer());
    await client.handle(hello(['0.9.0']));

    const listed = await client.handle({ method: 'listSessions', params: { channel: 'ahp-root://' } }) as { items: Row[] };
    expect(listed.items.find((one) => one.resource === 'ahp-session:/one')?._meta).toEqual({ bot: 'motion', color: 'red' });
  });

  it("sends a row's _meta when the row is found rather than listed", async () => {
    const found = row('late', { bot: 'motion' });
    const host = createHost({
      path: PATH,
      agents: [backend([], (id) => (id === 'late' ? found : undefined))],
      ...machine(),
    });
    const p = peer();
    const client = host.accept(p);
    await client.handle(hello(['0.9.0'], { initialSubscriptions: ['ahp-root://'] }));
    await client.handle({ method: 'listSessions', params: { channel: 'ahp-root://' } });

    const opened = await client.handle({ method: 'subscribe', params: { channel: 'ahp-session:/late' } }) as {
      snapshot: { state: { _meta?: Record<string, unknown> } };
    };
    expect(opened.snapshot.state._meta).toEqual({ bot: 'motion' });
    // And the row it announced, so a client that never opened it has the mark.
    const added = p.notes
      .filter((one) => one.method === 'root/sessionAdded')
      .map((one) => (one.params as { summary?: Row }).summary);
    expect(added.find((one) => one?.resource === 'ahp-session:/late')?._meta).toEqual({ bot: 'motion' });
  });

  it("lets the host's keys win a collision with a listed one", async () => {
    const host = createHost({
      path: PATH,
      agents: [backend([row('one', { git: 'listed', bot: 'motion' })])],
      ...machine(),
      // The directory's own answer, which is the host's and not the backend's.
      directories: { meta: () => ({ git: { branchName: 'main' } }), refresh: async () => false },
    });
    const client = host.accept(peer());
    await client.handle(hello(['0.9.0']));

    const listed = await client.handle({ method: 'listSessions', params: { channel: 'ahp-root://' } }) as { items: Row[] };
    expect(listed.items.find((one) => one.resource === 'ahp-session:/one')?._meta)
      .toEqual({ git: { branchName: 'main' }, bot: 'motion' });
  });
});
