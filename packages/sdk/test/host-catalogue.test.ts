import { WAIT_MS } from '../../../tools/wait.ts';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { chatUriFor } from '../src/host/channels.js';
import { Status } from '../src/sessions/catalog.js';
import { uriOf } from '../src/resources/resources.js';
import { fileSessions, memorySessions } from '../src/sessions/sessions.js';
import type { Request } from '../src/types/rpc.js';
import type { HostOptions } from '../src/types/host.js';
import {
  claude, createHost, defaultChatOf, echo, firstMessage, flushed, machine, resetSdk, actions, emit, hello, open, peer,
  sdk, serving, sessionQueries, settle, showExternal, running, wrote,
} from './support/host.js';
import type { Agent, Listed } from '../src/types/agent.js';

vi.mock('@anthropic-ai/claude-agent-sdk', async () => (await import('./support/claude-sdk.js')).fake);

beforeEach(resetSdk);

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
/** A moment this long before now, as a transcript's `lastModified` is stamped. */
const ago = (ms: number): number => Date.now() - ms;

describe('the catalogue', () => {
  it('orders it most-recently-modified first, as the protocol asks', async () => {
    sdk.sessions.push(
      { sessionId: 'old', summary: 'Older', lastModified: ago(2 * DAY), cwd: '/home/softov' },
      { sessionId: 'new', summary: 'Newer', lastModified: ago(HOUR), cwd: '/home/softov' },
    );
    const client = open();
    await client.handle(hello(['0.9.0']));
    await showExternal(client);
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

  /*
   * A session made fresh is provisional until its first message: its state is
   * there for the client that made it, creating, and nobody is told of it or
   * handed it in a listing; its first turn announces it and then says it
   * ready, as VS Code's host keeps a provisional session unannounced until it
   * materializes, and one never announced goes without a word.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentService.ts#L6347-L6362
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentService.ts#L10835-L10841
   */
  it('keeps a session it made unannounced and unlisted until its first message, which announces it and then says it ready', async () => {
    const { client, peer: p, uri, chatUri } = await running();
    const listed = async (): Promise<string[]> => ((await client.handle({ method: 'listSessions', params: { channel: 'ahp-root://' } })) as {
      items: { resource: string }[];
    }).items.map((one) => one.resource);
    const added = () => p.notes.filter((n) => n.method === 'root/sessionAdded'
      && (n.params as { summary: { resource: string } }).summary.resource === uri);
    expect(added()).toEqual([]);
    expect(await listed()).not.toContain(uri);
    const before = await client.handle({ method: 'subscribe', params: { channel: uri } }) as { snapshot: { state: { lifecycle: string } } };
    expect(before.snapshot.state.lifecycle).toBe('creating');

    client.handle({ method: 'dispatchAction', params: { channel: chatUri, clientSeq: 1, action: { type: 'chat/turnStarted', turnId: 't1', startedAt: new Date().toISOString(), message: { origin: { kind: 'user' }, text: 'hi' } } } });
    await settle();
    expect(added()).toHaveLength(1);
    const order = p.notes.flatMap((n): string[] => {
      if (n.method === 'root/sessionAdded') return ['added'];
      const sent = n.params as { channel?: string; action?: { type?: string } };
      if (n.method === 'action' && sent.channel === uri && sent.action?.type === 'session/ready') return ['ready'];
      if (n.method === 'action' && sent.channel === chatUri && sent.action?.type === 'chat/turnStarted') return ['started'];
      return [];
    });
    expect(order).toEqual(['started', 'added', 'ready']);
    expect(await listed()).toContain(uri);
  });

  it('removes a session it never announced without a word', async () => {
    const { client, peer: p, uri } = await running();
    await client.handle({ method: 'disposeSession', params: { channel: uri } });
    await settle();
    expect(p.notes.filter((n) => n.method === 'root/sessionRemoved')).toEqual([]);
  });

  /*
   * The sessions running a turn, as VS Code's host counts its active sessions:
   * a session counts while one of its chats has an active turn. A transcript
   * the catalogue lists, and a session at rest, count nothing. VS Code's
   * Sessions window reads the number as a host's running sessions, and starts
   * a new session on the host with the fewest.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentHostStateManager.ts#L3250-L3263
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/sessions/contrib/remoteSessions/browser/remoteSessionService.ts#L252
   */
  it('counts the sessions running a turn, as VS Code\'s host, the transcripts it lists and a session at rest counting none', async () => {
    sdk.sessions.push({ sessionId: 'a', lastModified: ago(2 * MINUTE), cwd: '/home/softov' });
    sdk.sessions.push({ sessionId: 'b', lastModified: ago(MINUTE), cwd: '/home/softov' });
    const { client, peer: p, uri, chatUri } = await running();
    await showExternal(client);
    const count = async (): Promise<number> => (await client.handle({ method: 'subscribe', params: { channel: 'ahp-root://' } }) as {
      snapshot: { state: { activeSessions: number } };
    }).snapshot.state.activeSessions;
    // The two transcripts; the session is listed from its first message.
    const listed = await client.handle({ method: 'listSessions', params: { channel: 'ahp-root://' } }) as { items: unknown[] };
    await settle();
    expect(listed.items).toHaveLength(2);
    expect(await count()).toBe(0);

    client.handle({ method: 'dispatchAction', params: { channel: chatUri, action: { type: 'chat/turnStarted', turnId: 't1', startedAt: new Date().toISOString(), message: { origin: { kind: 'user' }, text: 'hi' } } } });
    await settle();
    expect(await count()).toBe(1);
    await emit({ type: 'result', subtype: 'success', is_error: false, duration_ms: 4 });
    expect(await count()).toBe(0);

    await client.handle({ method: 'disposeSession', params: { channel: uri } });
    expect(await count()).toBe(0);
    // Said as it moved, once each way, and never while the number stood still.
    expect(actions(p, 'ahp-root://').filter((e) => e.action.type === 'root/activeSessionsChanged').map((e) => e.action.activeSessions))
      .toEqual([1, 0]);
  });

  it('refuses a session channel it has no agent for', async () => {
    const client = open();
    await client.handle(hello(['0.9.0']));
    await expect(client.handle({ method: 'subscribe', params: { channel: 'ahp-session:/nope' } }))
      .rejects.toMatchObject({ code: -32001 });
  });

  it('hands over the whole catalogue to a client that asked for no page size', async () => {
    for (let i = 0; i < 120; i++)
      sdk.sessions.push({ sessionId: `s${i}`, lastModified: ago((120 - i) * 1000), cwd: '/home/softov' });
    const client = open();
    await client.handle(hello(['0.9.0']));
    await showExternal(client);
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
      sdk.sessions.push({ sessionId: `s${i}`, lastModified: ago((1_002 - i) * 1000), cwd: '/home/softov' });
    const client = open();
    await client.handle(hello(['0.9.0']));
    await showExternal(client);
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
      sdk.sessions.push({ sessionId: `s${i}`, lastModified: ago((120 - i) * 1000), cwd: '/home/softov' });
    const client = open();
    await client.handle(hello(['0.9.0']));
    await showExternal(client);
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
  const older = { sessionId: 'older', summary: 'A real title', lastModified: ago(DAY), cwd: '/home/softov' };

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
    await showExternal(client);
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
    await showExternal(client);
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
        channel: chatUriFor('ahp-session:/older'),
        action: { type: 'chat/turnStarted', turnId: 't1', startedAt: new Date().toISOString(), message: { origin: { kind: 'user' }, text: 'and now?' } },
      },
    });
    await settle(6);

    // Resumed: the agent gets the context it built before, not a transcript
    // it has merely been shown.
    expect(sessionQueries()).toHaveLength(1);
    expect(sessionQueries()[0]?.options.resume).toBe('older');
    expect(sdk.said).toEqual(['and now?']);

    // And the channel does not open empty while it resumes.
    const chat = (await client.handle({ method: 'subscribe', params: { channel: chatUriFor('ahp-session:/older') } }) as {
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

  /*
   * A default chat derived from a session nothing here registers has no owner,
   * as the reference host's index maps the derived default chats of its
   * registered sessions alone, and its subscribe is refused in the words that
   * host refuses a channel it finds nothing for.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentHostChatOwnershipService.ts#L267-L291
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/protocolServerHandler.ts#L2199
   */
  it('refuses the default chat derived from a session nothing here registers', async () => {
    const client = open();
    await client.handle(hello(['0.9.0']));
    const ghost = chatUriFor('ahp-session:/ghost');
    await expect(client.handle({ method: 'subscribe', params: { channel: ghost } }))
      .rejects.toMatchObject({ code: -32001, message: `Resource not found: ${ghost}` });
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

  /** The default chat of the long session, the chat every case here pages. */
  const LONG = chatUriFor('ahp-session:/long');

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
      params: { channel: LONG, ...(view === null ? {} : { view }) },
    }) as {
      snapshot: { state: { turns: { message: { text: string } }[]; turnsNextCursor?: string } };
    }).snapshot.state;
    const pages = () => actions(p, LONG)
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
      params: { channel: LONG, action: { type: 'chat/turnStarted', turnId: 't1', startedAt: new Date().toISOString(), message: { origin: { kind: 'user' }, text: 'say ok' } } },
    });
    await settle(6);
    await emit({ type: 'result', subtype: 'success', is_error: false, duration_ms: 1 });

    // Live now, so the state is the backend's rather than the transcript's.
    const chat = (await client.handle({ method: 'subscribe', params: { channel: LONG } }) as {
      snapshot: { state: { turns: { message: { text: string } }[]; turnsNextCursor?: string } };
    }).snapshot.state;
    expect(chat.turns).toHaveLength(121);
    expect(chat.turnsNextCursor).toBeUndefined();
  });

  it('gives a live chat the window its view names', async () => {
    const { client } = await opened();
    await client.handle({
      method: 'dispatchAction',
      params: { channel: LONG, action: { type: 'chat/turnStarted', turnId: 't1', startedAt: new Date().toISOString(), message: { origin: { kind: 'user' }, text: 'say ok' } } },
    });
    await settle(6);
    await emit({ type: 'result', subtype: 'success', is_error: false, duration_ms: 1 });

    // The backend gives every turn, so the host is the one that cuts.
    const chat = (await client.handle({
      method: 'subscribe',
      params: { channel: LONG, view: { turns: 20 } },
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
      params: { channel: LONG, cursor: '70' },
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
      await client.handle({ method: 'fetchTurns', params: { channel: LONG, cursor } });
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
    await expect(client.handle({ method: 'fetchTurns', params: { channel: LONG } }))
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
    await expect(client.handle({ method: 'fetchTurns', params: { channel: LONG } }))
      .resolves.toEqual({});
    expect(pages()).toHaveLength(0);
  });

  /*
   * A channel with no chat behind it is refused as VS Code's host refuses one
   * it holds no chat state for, in its words.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/protocolServerHandler.ts#L2455-L2459
   */
  it('refuses a page of a channel that is no chat, as VS Code\'s host', async () => {
    const { client } = await opened();
    for (const channel of ['ahp-terminal:/t', 'ahp-chat:/nowhere']) {
      await expect(client.handle({ method: 'fetchTurns', params: { channel } }))
        .rejects.toMatchObject({ code: -32001, message: `Session not found: ${channel}` });
    }
  });

  it('refuses a cursor it did not issue', async () => {
    const { client } = await opened();
    // Guessing would answer a question about old turns with new ones, and the
    // client would page for ever without noticing.
    await expect(client.handle({ method: 'fetchTurns', params: { channel: LONG, cursor: 'banana' } }))
      .rejects.toMatchObject({ code: -32602 });
    await expect(client.handle({ method: 'fetchTurns', params: { channel: LONG, cursor: '9999' } }))
      .rejects.toMatchObject({ code: -32602 });
  });
});

/*
 * A session's row reads its default chat unless another chat needs input or
 * runs, and a failed chat stays on its own row, as the reference host
 * aggregates a session made of chats.
 * https://github.com/microsoft/vscode/blob/37eba0937fdca3097d4bb88e870abf3fc70dbde0/src/vs/platform/agentHost/node/agentHostStateManager.ts#L3339-L3367
 */
describe('a session row\'s status', () => {
  it('reads its idle default chat when a second chat fails, and the failure on that chat\'s own row', async () => {
    const { client, uri } = await running();
    const second = 'ahp-chat:/second';
    await client.handle({ method: 'createChat', params: { channel: uri, chat: second } });
    await client.handle({ method: 'subscribe', params: { channel: second } });
    client.handle({
      method: 'dispatchAction',
      params: { channel: second, action: { type: 'chat/turnStarted', turnId: 's1', startedAt: new Date().toISOString(), message: { origin: { kind: 'user' }, text: 'hi' } } },
    });
    await settle();
    await emit({ type: 'result', subtype: 'error_during_execution', is_error: true, errors: ['no'], duration_ms: 4 });

    const listed = await client.handle({ method: 'listSessions', params: { channel: 'ahp-root://' } }) as {
      items: { resource: string; status: number; chats?: { resource: string; status?: number }[] }[];
    };
    const row = listed.items.find((one) => one.resource === uri);
    expect((row?.chats?.find((one) => one.resource === second)?.status ?? 0) & 31).toBe(Status.Error);
    expect((row?.status ?? 0) & 31).toBe(Status.Idle);
  });

  /*
   * The session's state holds the chats' aggregate as its row does, as VS
   * Code's state manager keeps a session's derived status in its state.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentHostStateManager.ts#L3301-L3325
   */
  it('says in the session\'s state that a chat of it runs, and that it no longer does', async () => {
    const { client, uri, chatUri } = await running();
    const status = async (): Promise<number> => ((await client.handle({ method: 'subscribe', params: { channel: uri } })) as {
      snapshot: { state: { status: number } };
    }).snapshot.state.status & 31;
    client.handle({
      method: 'dispatchAction',
      params: { channel: chatUri, action: { type: 'chat/turnStarted', turnId: 't1', startedAt: new Date().toISOString(), message: { origin: { kind: 'user' }, text: 'hi' } } },
    });
    await settle();
    expect(await status()).toBe(Status.InProgress);

    await emit({ type: 'result', subtype: 'success', is_error: false, duration_ms: 4 });
    await settle(8);
    expect(await status()).toBe(Status.Idle);
  });
});

/*
 * A session's `_meta` said as the whole map whatever runs it: the action
 * replaces the map, so a session nothing runs keeps its backend's keys beside
 * its artifacts, as VS Code's host merges every producer's keys into the one
 * it publishes.
 */
describe('a session\'s _meta', () => {
  it('says the whole map when an artifact of a session nothing runs goes', async () => {
    const stamp = new Date(0).toISOString();
    const store = memorySessions();
    // A session this host ran, which is what kept its artifacts.
    store.setProvider('kept', 'echo');
    store.setArtifacts?.('kept', [{ id: 'a1', type: 'website', label: 'Docs', isArtifact: false, link: 'https://example.com' }]);
    const host = createHost({
      path: '/tmp',
      agents: [{
        ...echo({ path: '/tmp', pace: 0 }),
        list: async () => [{ id: 'kept', title: 'Kept', createdAt: stamp, modifiedAt: stamp, workingDirectories: ['file:///tmp'], _meta: { 'probe.key': 'kept' } }],
        transcript: async () => [],
      }],
      sessions: store,
    });
    const p = peer();
    const client = host.accept(p);
    await client.handle(hello(['0.9.0']));
    const listed = await client.handle({ method: 'listSessions', params: { channel: 'ahp-root://' } }) as { items: { resource: string }[] };
    const uri = listed.items[0]?.resource ?? '';
    await client.handle({ method: 'subscribe', params: { channel: uri } });
    await client.handle({ method: 'vscode/removeSessionArtifact', params: { session: uri, artifactId: 'a1' } });
    await settle();
    const said = actions(p, uri).filter((one) => one.action.type === 'session/metaChanged');
    expect(said.map((one) => (one.action._meta as Record<string, unknown> | undefined)?.['probe.key'])).toEqual(['kept']);
  });
});

describe('the flags a client sets', () => {
  it('keeps read and archived, and tells everyone watching', async () => {
    sdk.sessions.push({ sessionId: 'old', summary: 'Older', lastModified: ago(HOUR), cwd: '/home/softov' });
    const host = serving('/home/softov');
    const p = peer();
    const client = host.accept(p);
    await client.handle(hello(['0.9.0'], { initialSubscriptions: ['ahp-root://'] }));
    await showExternal(client);
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
    sdk.sessions.push({ sessionId: 'old', summary: 'Older', lastModified: ago(HOUR), cwd: '/home/softov' });
    const client = open();
    await client.handle(hello(['0.9.0']));
    await showExternal(client);
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
 * A chat's read bit and its session's, moving each other as the reference
 * host couples them: a session read is said unread while one of its two or
 * more chats is unread, a session of one chat moves that chat with it, a chat
 * marked unread marks a read session unread, and the last chat read marks an
 * unread session read. A tool's chat and a hidden one move nothing of the
 * session's.
 * https://github.com/microsoft/vscode/blob/37eba0937fdca3097d4bb88e870abf3fc70dbde0/src/vs/platform/agentHost/node/agentHostStateManager.ts#L2869-L2878
 * https://github.com/microsoft/vscode/blob/37eba0937fdca3097d4bb88e870abf3fc70dbde0/src/vs/platform/agentHost/node/agentHostStateManager.ts#L2912-L2918
 * https://github.com/microsoft/vscode/blob/37eba0937fdca3097d4bb88e870abf3fc70dbde0/src/vs/platform/agentHost/node/agentHostStateManager.ts#L2993-L3008
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

  const chatRead = (on: boolean) => ({ type: 'chat/isReadChanged', isRead: on });
  const sessionRead = (on: boolean) => ({ type: 'session/isReadChanged', isRead: on });

  /** A live session somebody has read, its one chat with it, and nothing said since. */
  const read = async () => {
    const started = await running();
    await send(started.client, started.uri, sessionRead(true));
    started.peer.notes.length = 0;
    return started;
  };

  /** A live session somebody has read, with a second chat, both subscribed. */
  const twoChats = async () => {
    const started = await read();
    await started.client.handle({ method: 'createChat', params: { channel: started.uri, chat: second } });
    await started.client.handle({ method: 'subscribe', params: { channel: second } });
    return started;
  };

  /*
   * A new session's summary is `Idle`, and its default chat's is made from
   * it, as VS Code's host makes them; a chat added later opens `Idle |
   * IsRead`, as VS Code's host adds one.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentService.ts#L10705-L10711
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentHostStateManager.ts#L1744-L1746
   */
  it('starts a new session and its default chat unread, and a chat added to it read', async () => {
    const { client, peer: p, uri, chatUri } = await running();
    expect(await isRead(client, uri)).toBe(false);
    expect(await isRead(client, chatUri)).toBe(false);
    await client.handle({ method: 'createChat', params: { channel: uri, chat: second } });
    const chat = actions(p, uri).find((e) => e.action.type === 'session/chatAdded')?.action.summary as { status: number };
    expect(chat.status & Status.IsRead).toBe(Status.IsRead);
  });

  it('marks a read session unread when one of its chats turns unread, and leaves the other chat as it is', async () => {
    const { client, peer: p, uri, chatUri } = await twoChats();
    p.notes.length = 0;
    await send(client, second, chatRead(false));
    expect(await isRead(client, second)).toBe(false);
    expect(await isRead(client, uri)).toBe(false);
    expect(await isRead(client, chatUri)).toBe(true);
    // This host's own action, after the chat's and its row, so a client applies those first.
    const marked = actions(p, uri).filter((e) => e.action.type === 'session/isReadChanged');
    expect(marked.map((e) => [e.action.isRead, e.origin])).toEqual([[false, undefined]]);
    const said = actions(p).map((e) => `${String(e.action.type)} ${e.channel}`);
    expect(said.indexOf(`chat/isReadChanged ${second}`)).toBeLessThan(said.indexOf(`session/isReadChanged ${uri}`));
    // The chat's row in its session moves with the chat, which keeps the list in step.
    expect(actions(p, uri).filter((e) => e.action.type === 'session/chatUpdated').map((e) => e.action.chat)).toEqual([second]);
  });

  it('marks an unread session read when its last unread chat is read', async () => {
    const { client, uri, chatUri } = await twoChats();
    await send(client, uri, sessionRead(false));
    await send(client, second, chatRead(false));

    await send(client, second, chatRead(true));
    expect(await isRead(client, second)).toBe(true);
    expect(await isRead(client, chatUri)).toBe(true);
    expect(await isRead(client, uri)).toBe(true);
  });

  /*
   * A read said again keeps a session of several chats unread: only a chat
   * that was unread, or a sole one, reads its session read.
   * https://github.com/microsoft/vscode/blob/37eba0937fdca3097d4bb88e870abf3fc70dbde0/src/vs/platform/agentHost/node/agentHostStateManager.ts#L3002-L3003
   */
  it('keeps a session of two chats unread when a chat that is read is read again', async () => {
    const { client, peer: p, uri, chatUri } = await twoChats();
    await send(client, uri, sessionRead(false));
    p.notes.length = 0;

    await send(client, chatUri, chatRead(true));
    expect(await isRead(client, uri)).toBe(false);
    expect(actions(p, uri).filter((e) => e.action.type === 'session/isReadChanged')).toEqual([]);
  });

  it('marks the one chat unread after the session when a session with one chat is marked unread', async () => {
    const { client, peer: p, uri, chatUri } = await read();
    p.notes.length = 0;
    await send(client, uri, sessionRead(false));
    expect(await isRead(client, uri)).toBe(false);
    expect(await isRead(client, chatUri)).toBe(false);
    // This host's own action on the chat, after the client's on the session.
    expect(actions(p, chatUri).map((e) => [e.action.type, e.action.isRead, e.origin])).toEqual([['chat/isReadChanged', false, undefined]]);
    const said = actions(p).map((e) => `${String(e.action.type)} ${e.channel}`);
    expect(said.indexOf(`session/isReadChanged ${uri}`)).toBeLessThan(said.indexOf(`chat/isReadChanged ${chatUri}`));
  });

  it('marks the one chat read when its session is marked read, though the session was read already', async () => {
    const { client, peer: p, uri, chatUri } = await read();
    // A turn's start makes the chat unread and leaves the session read.
    await send(client, chatUri, { type: 'chat/turnStarted', turnId: 't1', startedAt: new Date().toISOString(), message: { origin: { kind: 'user' }, text: 'hi' } });
    expect(await isRead(client, chatUri)).toBe(false);
    expect(await isRead(client, uri)).toBe(true);
    p.notes.length = 0;

    await send(client, uri, sessionRead(true));
    expect(await isRead(client, chatUri)).toBe(true);
    expect(await isRead(client, uri)).toBe(true);
    const said = actions(p).map((e) => `${String(e.action.type)} ${e.channel}`);
    expect(said.indexOf(`session/isReadChanged ${uri}`)).toBeLessThan(said.indexOf(`chat/isReadChanged ${chatUri}`));
  });

  it('leaves each chat as it is when a session with two chats is marked unread', async () => {
    const { client, uri, chatUri } = await twoChats();
    await send(client, uri, sessionRead(false));
    expect(await isRead(client, chatUri)).toBe(true);
    expect(await isRead(client, second)).toBe(true);
  });

  it('says a session read as unread while one of its two chats is unread, under the client\'s own origin', async () => {
    const { client, peer: p, uri, chatUri } = await twoChats();
    await send(client, second, chatRead(false));
    p.notes.length = 0;

    client.handle({ method: 'dispatchAction', params: { channel: uri, clientSeq: 5, action: sessionRead(true) } });
    await settle();
    expect(await isRead(client, uri)).toBe(false);
    expect(await isRead(client, chatUri)).toBe(true);
    expect(await isRead(client, second)).toBe(false);
    // The session's bit did not move, so the answer is the one action, carrying the bit it holds.
    expect(actions(p).map((e) => [e.channel, e.action, e.origin])).toEqual([
      [uri, { type: 'session/isReadChanged', isRead: false }, { clientId: 'probe', clientSeq: 5 }],
    ]);

    // Said again, nothing moved: the action goes out, and no row with it.
    const said = p.notes.length;
    await send(client, uri, sessionRead(true));
    expect(p.notes.slice(said).map((one) => one.method)).toEqual(['action']);
    expect(actions(p, uri).at(-1)?.action).toEqual({ type: 'session/isReadChanged', isRead: false });
  });

  /*
   * A client's reducer clears the bit from the turn's start itself, and the
   * reference host says nothing more there.
   * https://github.com/microsoft/agent-host-protocol/blob/5f16d81bb7045b66d7bc768d244feab75002d943/types/channels-chat/reducer.ts#L358-L372
   */
  it('marks a chat unread when a turn starts, as a client reduces it, saying nothing of its own, and leaves its session read', async () => {
    const { client, peer: p, uri, chatUri } = await read();
    await send(client, chatUri, { type: 'chat/turnStarted', turnId: 't1', startedAt: new Date().toISOString(), message: { origin: { kind: 'user' }, text: 'hi' } });

    expect(await isRead(client, chatUri)).toBe(false);
    expect(await isRead(client, uri)).toBe(true);
    expect(actions(p, chatUri).filter((e) => e.action.type === 'chat/isReadChanged')).toEqual([]);
    expect(actions(p, uri).filter((e) => e.action.type === 'session/isReadChanged')).toEqual([]);
  });

  /*
   * A turn's end marks its chat unread, and a read session unread, each with
   * this host's own action on its own channel, as the reference host does at
   * a turn's end.
   * https://github.com/microsoft/vscode/blob/1306698e328e5e531f5e632301d30020aa994eff/src/vs/platform/agentHost/node/chatContributions/markUnread/markUnreadContribution.ts#L27-L48
   */
  it('keeps a chat marked read while its turn runs, and marks the chat and its session unread when the turn completes', async () => {
    const { client, peer: p, uri, chatUri } = await read();
    await send(client, chatUri, { type: 'chat/turnStarted', turnId: 't1', startedAt: new Date().toISOString(), message: { origin: { kind: 'user' }, text: 'hi' } });
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

  it('says a chat unread at a turn\'s end though nobody read it while the turn ran', async () => {
    const { client, peer: p, chatUri } = await running();
    await send(client, chatUri, { type: 'chat/turnStarted', turnId: 't1', startedAt: new Date().toISOString(), message: { origin: { kind: 'user' }, text: 'hi' } });
    expect(await isRead(client, chatUri)).toBe(false);

    await emit({ type: 'result', subtype: 'success', is_error: false, duration_ms: 4 });
    const said = actions(p, chatUri).map((e) => e.action);
    const ended = said.findIndex((one) => one.type === 'chat/turnComplete');
    expect(ended).toBeGreaterThanOrEqual(0);
    expect(said.slice(ended).filter((one) => one.type === 'chat/isReadChanged')).toEqual([chatRead(false)]);
  });

  it('marks a chat and its session unread when a turn fails', async () => {
    const { client, uri, chatUri } = await running();
    await send(client, chatUri, { type: 'chat/turnStarted', turnId: 't1', startedAt: new Date().toISOString(), message: { origin: { kind: 'user' }, text: 'hi' } });
    await emit({ type: 'result', subtype: 'error_during_execution', is_error: true, errors: ['no'], duration_ms: 4 });

    expect(await isRead(client, chatUri)).toBe(false);
    expect(await isRead(client, uri)).toBe(false);
  });

  it('marks a chat and its session unread when a turn is cancelled', async () => {
    const { client, peer: p, uri, chatUri } = await running();
    await send(client, chatUri, { type: 'chat/turnStarted', turnId: 't1', startedAt: new Date().toISOString(), message: { origin: { kind: 'user' }, text: 'hi' } });
    await send(client, chatUri, { type: 'chat/turnCancelled', turnId: 't1', duration: 0 });

    expect(actions(p, chatUri).some((e) => e.action.type === 'chat/turnCancelled')).toBe(true);
    expect(await isRead(client, chatUri)).toBe(false);
    expect(await isRead(client, uri)).toBe(false);
  });

  it('says nothing more of a session that is unread when a turn ends', async () => {
    const { client, peer: p, uri, chatUri } = await running();
    await send(client, uri, sessionRead(false));
    await send(client, chatUri, { type: 'chat/turnStarted', turnId: 't1', startedAt: new Date().toISOString(), message: { origin: { kind: 'user' }, text: 'hi' } });
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
   * A stop with no turn running stops nothing, and the reference host takes
   * it as the client's own action, said to every client of the chat: "Ignoring
   * cancellation of an inactive turn". The chat's reducer leaves the chat as
   * it was, and no backend is asked to stop anything.
   * https://github.com/microsoft/vscode/blob/37eba0937fdca3097d4bb88e870abf3fc70dbde0/src/vs/platform/agentHost/node/agentService.ts#L13530-L13535
   */
  it('says a cancel with no turn running to every client, whatever turn it names, and stops nothing', async () => {
    const started = await running();
    const { peer: two } = await alsoWatching(started);
    started.peer.notes.length = 0;
    two.notes.length = 0;

    for (const [clientSeq, turnId] of [[7, 't1'], [8, '']] as const) {
      started.client.handle({
        method: 'dispatchAction',
        params: { channel: started.chatUri, clientSeq, action: { type: 'chat/turnCancelled', turnId, duration: 0 } },
      });
      await settle();
    }

    for (const p of [started.peer, two]) {
      const said = actions(p, started.chatUri);
      expect(said.map((e) => [e.action, e.origin, e.rejectionReason])).toEqual([
        [{ type: 'chat/turnCancelled', turnId: 't1', duration: 0 }, { clientId: 'probe', clientSeq: 7 }, undefined],
        [{ type: 'chat/turnCancelled', turnId: '', duration: 0 }, { clientId: 'probe', clientSeq: 8 }, undefined],
      ]);
    }
    expect(sdk.interrupted).toBe(0);
  });

  it('stops the running turn when the cancel names it, and tells every client', async () => {
    const started = await running();
    const { peer: two } = await alsoWatching(started);
    await send(started.client, started.chatUri, { type: 'chat/turnStarted', turnId: 't1', startedAt: new Date().toISOString(), message: { origin: { kind: 'user' }, text: 'hi' } });
    started.peer.notes.length = 0;
    two.notes.length = 0;

    await send(started.client, started.chatUri, { type: 'chat/turnCancelled', turnId: 't1', duration: 0 });

    expect(actions(started.peer, started.chatUri).some((e) => e.action.type === 'chat/turnCancelled')).toBe(true);
    expect(actions(two, started.chatUri).some((e) => e.action.type === 'chat/turnCancelled')).toBe(true);
  });

  it('leaves the running turn alone when the cancel names another one', async () => {
    const started = await running();
    await send(started.client, started.chatUri, { type: 'chat/turnStarted', turnId: 't1', startedAt: new Date().toISOString(), message: { origin: { kind: 'user' }, text: 'hi' } });
    started.peer.notes.length = 0;

    started.client.handle({
      method: 'dispatchAction',
      params: { channel: started.chatUri, clientSeq: 9, action: { type: 'chat/turnCancelled', turnId: 't2', duration: 0 } },
    });
    await settle();

    // The only stop on this channel is the echo, which is what says the
    // backend was never asked to end the turn that is really running.
    const said = actions(started.peer, started.chatUri).filter((e) => e.action.type === 'chat/turnCancelled');
    expect(said).toHaveLength(1);
    expect(said[0]?.action).toEqual({ type: 'chat/turnCancelled', turnId: 't2', duration: 0 });
    expect(said[0]?.origin).toEqual({ clientId: 'probe', clientSeq: 9 });
  });

  /*
   * A chat archived on its own is marked read, as the reference host marks it,
   * with the read action that moves its session after it.
   * https://github.com/microsoft/vscode/blob/37eba0937fdca3097d4bb88e870abf3fc70dbde0/src/vs/platform/agentHost/node/chatContributions/chatArchive/chatArchiveContribution.ts#L50-L51
   */
  it('marks an unread chat read when it is archived, after the archive, and keeps its session unread while another chat is', async () => {
    const { client, peer: p, uri, chatUri } = await twoChats();
    await send(client, chatUri, chatRead(false));
    await send(client, second, chatRead(false));
    p.notes.length = 0;

    await send(client, second, { type: 'chat/isArchivedChanged', isArchived: true });
    expect(actions(p, second).map((e) => e.action.type)).toEqual(['chat/isArchivedChanged', 'chat/isReadChanged']);
    expect(await isRead(client, second)).toBe(true);
    expect(await isRead(client, chatUri)).toBe(false);
    expect(await isRead(client, uri)).toBe(false);
  });

  it('marks an unread session read when its last unread chat is archived', async () => {
    const { client, peer: p, uri } = await twoChats();
    await send(client, uri, sessionRead(false));
    await send(client, second, chatRead(false));
    p.notes.length = 0;

    await send(client, second, { type: 'chat/isArchivedChanged', isArchived: true });
    expect(await isRead(client, second)).toBe(true);
    expect(await isRead(client, uri)).toBe(true);
    const said = actions(p).map((e) => `${String(e.action.type)} ${e.channel}`);
    expect(said.indexOf(`chat/isReadChanged ${second}`)).toBeLessThan(said.indexOf(`session/isReadChanged ${uri}`));
  });

  /*
   * The reference host marks an unread chat read at every archive, whether or
   * not its archived bit moved.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/chatContributions/chatArchive/chatArchiveContribution.ts#L46-L52
   */
  it('marks an unread chat read when it is archived again', async () => {
    const { client, peer: p } = await twoChats();
    await send(client, second, { type: 'chat/isArchivedChanged', isArchived: true });
    await send(client, second, chatRead(false));
    p.notes.length = 0;

    await send(client, second, { type: 'chat/isArchivedChanged', isArchived: true });
    expect(actions(p, second).map((e) => e.action.type)).toEqual(['chat/isArchivedChanged', 'chat/isReadChanged']);
    expect(await isRead(client, second)).toBe(true);
  });

  /*
   * An archived chat on its session's row says so in its status and in the
   * `archived` an AHP 0.9 client reads, as VS Code's host projects a session's
   * chats into its summary.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentHostStateManager.ts#L682-L700
   */
  it('lists an archived chat on its session\'s row with the archived flag an AHP 0.9 client reads', async () => {
    const { client, uri, chatUri } = await twoChats();
    await firstMessage(client, chatUri);
    await send(client, second, { type: 'chat/isArchivedChanged', isArchived: true });
    const listed = await client.handle({ method: 'listSessions', params: { channel: 'ahp-root://' } }) as {
      items: { resource: string; chats?: { resource: string; status?: number; archived?: boolean }[] }[];
    };
    const chats = listed.items.find((one) => one.resource === uri)?.chats ?? [];
    expect(chats.find((one) => one.resource === second)).toMatchObject({ archived: true });
    expect((chats.find((one) => one.resource === second)?.status ?? 0) & Status.IsArchived).toBe(Status.IsArchived);
    expect(chats.find((one) => one.resource === chatUri)).not.toHaveProperty('archived');
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
    const opened = await client.handle({ method: 'subscribe', params: { channel: chatUriFor('ahp-session:/old') } }) as {
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
    // Only a refused call carries an `error`, as VS Code's Claude mapper
    // completes one; a call that ran and failed says so in `success`.
    expect(call?.error).toBeUndefined();
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

  /*
   * A chat opened while its record read nothing takes the conversation its
   * backend holds once the session starts, as the reference host refreshes a
   * chat's persisted history: chat/truncated, then chat/turnsLoaded.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentHostStateManager.ts#L759-L767
   */
  it('takes the history its backend holds as chat/truncated then chat/turnsLoaded, when the chat opened with none', async () => {
    sdk.sessions.push({ sessionId: 'late', summary: 'Late', lastModified: 1, cwd: '/home/softov' });
    wrote('late', '/home/softov');
    const p = peer();
    const client = serving('/home/softov').accept(p);
    await client.handle(hello(['0.9.0']));
    const chat = chatUriFor('ahp-session:/late');
    const opened = await client.handle({ method: 'subscribe', params: { channel: chat } }) as {
      snapshot: { state: { turns: unknown[] } };
    };
    expect(opened.snapshot.state.turns).toEqual([]);

    sdk.transcript.push(
      { type: 'user', uuid: 'u1', message: { role: 'user', content: 'said late' } },
      { type: 'assistant', uuid: 'a1', message: { content: [{ type: 'text', text: 'replied late' }] } },
    );
    // An action that wakes the session and starts no turn.
    client.handle({ method: 'dispatchAction', params: { channel: chat, action: { type: 'chat/pendingMessageRemoved', kind: 'queued', id: 'none' } } });
    await settle(20);
    const said = actions(p, chat).map((e) => e.action);
    const at = said.findIndex((one) => one.type === 'chat/turnsLoaded');
    expect(at).toBeGreaterThan(0);
    expect(said[at - 1]?.type).toBe('chat/truncated');
    expect((said[at]?.turns as { message: { text: string } }[]).map((turn) => turn.message.text)).toEqual(['said late']);
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
      params: { channel: chatUriFor('ahp-session:/old'), action: { type: 'chat/turnStarted', turnId: 't1', startedAt: new Date().toISOString(), message: { origin: { kind: 'user' }, text: 'carry on' } } },
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
    const first = await client.handle({ method: 'subscribe', params: { channel: chatUriFor('ahp-session:/late') } }) as {
      snapshot: { state: { turns: unknown[] } };
    };
    expect(first.snapshot.state.turns).toEqual([]);
    expect(sdk.reads).toBe(1);

    // The turns are there now. The next open reads again rather than serving
    // the empty answer it kept, which is what made one bad read permanent for
    // the life of the process.
    sdk.transcript.push({ type: 'user', uuid: 'u1', message: { role: 'user', content: 'now' } });
    const second = await client.handle({ method: 'subscribe', params: { channel: chatUriFor('ahp-session:/late') } }) as {
      snapshot: { state: { turns: { message: { text: string } }[] } };
    };
    expect(sdk.reads).toBe(2);
    expect(second.snapshot.state.turns[0]?.message.text).toBe('now');

    // And a read that has turns is still kept, which is the large transcript
    // this cache was added for: a third open does not read at all.
    await client.handle({ method: 'subscribe', params: { channel: chatUriFor('ahp-session:/late') } });
    expect(sdk.reads).toBe(2);
  });

  it('tries a transcript that failed once more before calling it empty', async () => {
    sdk.sessions.push({ sessionId: 'flaky', summary: 'Flaky', lastModified: 1, cwd: '/home/softov' });
    sdk.transcript.push({ type: 'user', uuid: 'u1', message: { role: 'user', content: 'there' } });
    sdk.throwOnce = 1;

    const client = open();
    await client.handle(hello(['0.9.0']));
    const opened = await client.handle({ method: 'subscribe', params: { channel: chatUriFor('ahp-session:/flaky') } }) as {
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
    const { client, uri, chatUri } = await running();
    await firstMessage(client, chatUri);
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
    // The chat the host minted for the session.
    expect(row?.defaultChat).toBe(chatUri);
    expect(row?.chats?.every((one) => typeof one.status === 'number')).toBe(true);
  });

  it("says a chat's status in the row when a turn starts in it", async () => {
    const { client, peer: p, uri } = await running();
    const second = 'ahp-chat:/second';
    await client.handle({ method: 'createChat', params: { channel: uri, chat: second } });
    client.handle({
      method: 'dispatchAction',
      params: { channel: second, action: { type: 'chat/turnStarted', turnId: 't1', startedAt: new Date().toISOString(), message: { origin: { kind: 'user' }, text: 'go' } } },
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
    await flushed();
    expect(chatsOf(p, 'ahp-session:/live').find((one) => one.resource === second)?.status).toBe(status);
    // The default chat at rest, unread as a new session's starts.
    expect(chatsOf(p, 'ahp-session:/live').find((one) => one.resource === rowOf(p, 'ahp-session:/live')?.defaultChat)?.status)
      .toBe(Status.Idle);
  });

  /*
   * VS Code marks a running session's summary dirty and flushes on a 100 ms
   * debounce, so a burst of moves is one notification.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentHostStateManager.ts#L212-L330
   */
  it('says a burst of a running session\'s moves as one notification, once they are quiet', async () => {
    const { client, peer: p, uri, chatUri } = await running();
    await firstMessage(client, chatUri);
    await flushed();
    const said = () => p.notes.filter((n) => n.method === 'root/sessionSummaryChanged'
      && (n.params as { session?: string }).session === uri);
    const before = said().length;
    for (const title of ['One', 'Two', 'Three']) {
      await client.handle({ method: 'dispatchAction', params: { channel: uri, action: { type: 'session/titleChanged', title } } });
    }
    expect(said()).toHaveLength(before);
    await flushed();
    expect(said()).toHaveLength(before + 1);
    expect((said().at(-1)?.params as { changes: { title?: string } }).changes.title).toBe('Three');
  });

  it('says the row again when a chat opens and when one closes', async () => {
    const { client, peer: p, uri, chatUri } = await running();
    await firstMessage(client, chatUri);
    const second = 'ahp-chat:/second';
    const said = () => p.notes.filter((n) => n.method === 'root/sessionSummaryChanged'
      && (n.params as { session?: string }).session === 'ahp-session:/live').length;

    await flushed();
    const before = said();
    await client.handle({ method: 'createChat', params: { channel: uri, chat: second } });
    await flushed();
    expect(said()).toBeGreaterThan(before);
    expect(resourcesOf(p, 'ahp-session:/live')).toContain(second);

    const opened = said();
    await client.handle({ method: 'disposeChat', params: { channel: second } });
    await flushed();
    expect(said()).toBeGreaterThan(opened);
    // The list replaces the catalog, so the chat being gone from it is what
    // takes it out of a client's list.
    expect(resourcesOf(p, 'ahp-session:/live')).not.toContain(second);
    expect(resourcesOf(p, 'ahp-session:/live')).toEqual([rowOf(p, 'ahp-session:/live')?.defaultChat]);
  });

  /*
   * A worker read back is a chat of its session, read-only, and no row lists
   * it, as VS Code's host registers a restored worker in its session's chats
   * and leaves a worker off a summary.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentService.ts#L16562-L16572
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentHostStateManager.ts#L682-L700
   */
  it('lists a worker chat read back from a backend among its session\'s chats, read-only, and on no row', async () => {
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
      params: { channel: chatUriFor('ahp-session:/restored'), action: { type: 'chat/turnStarted', turnId: 't1', startedAt: new Date().toISOString(), message: { origin: { kind: 'user' }, text: 'and now?' } } },
    });
    await settle(8);
    // Subscribing again is what reads the backend's record of the workers it
    // ran, which is where the session's list of them comes from.
    await client.handle({ method: 'subscribe', params: { channel: 'ahp-session:/restored' } });
    await settle();
    const opened = await client.handle({ method: 'subscribe', params: { channel: 'ahp-session:/restored' } }) as {
      snapshot: { state: { chats: { resource: string; title: string; interactivity?: string }[] } };
    };

    const worker = opened.snapshot.state.chats.find((one) => one.interactivity === 'read-only');
    // A worker is a chat of its session even though no `Session` holds it, and
    // a client that never subscribes to it still has to see that it is there.
    expect(worker?.title).toBe('Explore');
    expect(worker?.resource).toContain('toolu_task');
    const listed = await client.handle({ method: 'listSessions', params: { channel: 'ahp-root://' } }) as {
      items: { resource: string; chats?: { resource: string }[] }[];
    };
    const row = listed.items.find((one) => one.resource === 'ahp-session:/restored');
    expect(row?.chats?.map((one) => one.resource)).toEqual([chatUriFor('ahp-session:/restored')]);
  });
});

describe('one conversation, one row', () => {
  it('hides the transcript a running session is writing', async () => {
    const { client, chatUri } = await running();
    client.handle({
      method: 'dispatchAction',
      params: { channel: chatUri, action: { type: 'chat/turnStarted', turnId: 't1', startedAt: new Date().toISOString(), message: { origin: { kind: 'user' }, text: 'hi' } } },
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
    params: { channel: uri, clientSeq: 3, action: { type: 'session/activeClientSet', activeClient: { clientId: 'probe' } } },
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
    params: { channel: uri, clientSeq: 5, action: { type: 'session/activeClientSet', activeClient: { clientId: 'probe' } } },
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

  /**
   * A title, and the row it moves once the moves are quiet: a session a turn
   * has run in is said on VS Code's 100 ms debounce.
   */
  const retitle = async (client: { handle(request: Request): Promise<unknown> }, channel: string, title: string) => {
    await client.handle({ method: 'dispatchAction', params: { channel, action: { type: 'session/titleChanged', title } } });
    await flushed();
  };

  it('sends one summary for however many calls moved nothing', async () => {
    const { client, peer: p, chatUri } = await running();
    // The row a session sends once its customizations arrive comes first, and
    // a session is said at all from its first message.
    await firstMessage(client, chatUri);
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

  it('sends again for a title that moved, and for a turn that started', async () => {
    const { client, peer: p, chatUri } = await running();
    // Said from its first message, which ends before the turn below starts.
    await firstMessage(client, chatUri);
    await emit({ type: 'result', subtype: 'success', is_error: false, duration_ms: 1 });
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
      params: { channel: chatUri, action: { type: 'chat/turnStarted', turnId: 't1', startedAt: new Date().toISOString(), message: { origin: { kind: 'user' }, text: 'read it' } } },
    });
    await flushed();
    const busy = rowsMoved(p, 'ahp-session:/live');
    expect(busy.length).toBeGreaterThan(said);
    expect(Number(busy.at(-1)?.status ?? 0) & Status.InProgress).toBe(Status.InProgress);
  });

  /**
   * A host whose directories say four files, and remember how to say it again.
   *
   * A directory is read at boot and again for every watcher a client opened on
   * it, so the same answer comes back more than once about a row that did not
   * move. Which is the case this is here for.
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

  /*
   * A row carries the session's own counts, kept where the next daemon reads
   * them, and none of its folder's, so the startup read of a stored session's
   * folder says nothing of its row; a re-read a client showing its diff makes
   * says the row once, with its own counts, and not again for the same read,
   * and a flag on it is said once.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentHostChangesetService.ts#L480-L493
   */
  it('sends a listed row once, and not again for the same read of it', async () => {
    // The host's own path, and every directory its backend claims, is browsed
    // before the stored rows are read - so the row has to live somewhere else
    // for the startup read of its folder to be one of its own.
    sdk.sessions.push({ sessionId: 'old', summary: 'Older', lastModified: ago(HOUR), cwd: '/github/elsewhere' });
    // A session this host ran, under the name it was made with, and the two
    // files its own work came to.
    const store = memorySessions();
    store.setProvider('old', 'claude');
    store.setUri?.('old', 'ahp-session:/old');
    store.setChanges('old', { files: 2 });
    const counted_ = counted();
    const host = createHost({
      path: '/home/softov', agents: [claude({ paths: ['/home/softov'] })], ...machine(), changes: counted_.source, sessions: store,
    });
    const p = peer();
    const client = host.accept(p);
    await client.handle(hello(['0.9.0'], { initialSubscriptions: ['ahp-root://'] }));
    const listed = await client.handle({ method: 'listSessions', params: { channel: 'ahp-root://' } }) as {
      items: { resource: string; changes?: { files?: number } }[];
    };
    expect(listed.items.find((one) => one.resource === 'ahp-session:/old')?.changes).toEqual({ files: 2 });
    await settle(12);
    expect(rowsMoved(p, 'ahp-session:/old')).toEqual([]);

    // A client showing the row's diff re-reads the directory on every change
    // the source reports: the row is said once, with its own counts, and the
    // same read again says nothing.
    await client.handle({ method: 'subscribe', params: { channel: 'ahp-session:/old/changeset/uncommitted' } });
    await vi.waitFor(() => { expect(counted_.watching).toHaveLength(1); }, { timeout: WAIT_MS });
    counted_.watching[0]?.();
    await settle(12);
    expect(rowsMoved(p, 'ahp-session:/old')).toEqual([{ status: 1, changes: { files: 2 } }]);
    counted_.watching[0]?.();
    await settle(12);
    expect(rowsMoved(p, 'ahp-session:/old')).toHaveLength(1);

    // And a flag is a change, so it goes out - once, and not twice.
    client.handle({
      method: 'dispatchAction',
      params: { channel: 'ahp-session:/old', action: { type: 'session/isReadChanged', isRead: true } },
    });
    await settle();
    expect(rowsMoved(p, 'ahp-session:/old')).toHaveLength(2);
    expect(rowsMoved(p, 'ahp-session:/old').at(-1)?.status).toBe(33);
    counted_.watching[0]?.();
    await settle(12);
    expect(rowsMoved(p, 'ahp-session:/old')).toHaveLength(2);
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
      const { client, peer: p, uri, chatUri } = await running();
      await firstMessage(client, chatUri);

      await client.handle({ method: 'disposeSession', params: { channel: uri } });
      await settle();
      const added = p.notes.filter((n) => n.method === 'root/sessionAdded').length;
      await client.handle({ method: 'createSession', params: { channel: uri, provider: 'claude' } });
      // On the chat the host minted for the session made again.
      await firstMessage(client, await defaultChatOf(client, uri));
      // The same conversation, under the same name, added whole: what a client
      // that watched it go now holds, and what the next move is a change from.
      expect(p.notes.filter((n) => n.method === 'root/sessionAdded')).toHaveLength(added + 1);
      await flushed();
      const before = rowsMoved(p, 'ahp-session:/live');
      await retitle(client, uri, 'Paging');
      await flushed();
      const moved = rowsMoved(p, 'ahp-session:/live');
      expect(moved).toHaveLength(before.length + 1);
      expect(moved.at(-1)).toMatchObject({ title: 'Paging' });
      await retitle(client, uri, 'Paging');
      await flushed();
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
      params: { channel: chatUri, action: { type: 'chat/turnStarted', turnId, startedAt: new Date().toISOString(), message: { origin: { kind: 'user' }, text: 'go' } } },
    });
    await settle();
    client.handle({
      method: 'dispatchAction',
      params: { channel: chatUri, action: { type: 'chat/turnCancelled', turnId, duration: 0 } },
    });
    await settle();
    // The stop interrupts the CLI, which keeps running and reports the
    // interrupted turn's result, so the next turn is its own.
    await emit({ type: 'result', subtype: 'error_during_execution', is_error: true, user_message_uuids: [sdk.uuids.at(-1)] });
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
      params: { channel: chatUri, action: { type: 'chat/turnStarted', turnId, startedAt: new Date().toISOString(), message: { origin: { kind: 'user' }, text: 'go' } } },
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
    // Said once the session's moves are quiet, on VS Code's 100 ms debounce.
    await flushed();
    expect(countsOf(p, 'ahp-session:/live')).toMatchObject({ files: 6 });
  });

  it('says zero counts once a session\'s own work comes to nothing', async () => {
    let files = 4;
    const source = { ...ownWork({ live: 4 }), sessionSummary: async () => ({ files }) };
    const { client, peer: p, chatUri } = await turned({ changes: source }, 'live');
    expect(countsOf(p, 'ahp-session:/live')).toMatchObject({ files: 4 });

    // Everything committed: the change has to say so, because a change
    // without `changes` keeps the counts the client holds.
    files = 0;
    await turn(client, chatUri, 't2');
    await flushed();
    expect(countsOf(p, 'ahp-session:/live')).toEqual({ files: 0, additions: 0, deletions: 0 });
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
    await flushed();
    expect(countsOf(p, 'ahp-session:/live')).toMatchObject({ files: 5 });
  });

  it("reads a row's counts back from the store after a restart", async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ahpd-counts-'));
    made.push(dir);
    const first = await turned({ changes: ownWork({ live: 4 }), sessions: fileSessions({ dir }) }, 'live');
    expect(countsOf(first.peer, 'ahp-session:/live')).toMatchObject({ files: 4 });
    // Written after the change rather than during it, so the next store waits
    // for the file to hold the counts.
    await vi.waitFor(() => { expect(readFileSync(join(dir, 'live.json'), 'utf8')).toMatch(/"files":\s*4/u); }, { timeout: WAIT_MS });

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
    await vi.waitFor(() => { expect(asked).toBe(true); }, { timeout: WAIT_MS });

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
  const STAMP = new Date(ago(DAY)).toISOString();
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
    await showExternal(client);

    const listed = await client.handle({ method: 'listSessions', params: { channel: 'ahp-root://' } }) as { items: Row[] };
    expect(listed.items.find((one) => one.resource === 'ahp-session:/one')?._meta)
      .toEqual({ bot: 'motion', color: 'red', 'vscode.external': true });
  });

  it("sends a row's _meta when the row is found rather than listed", async () => {
    const found = row('late', { bot: 'motion' });
    // A session this host ran, which its record names the backend to ask about.
    const kept = memorySessions();
    kept.setProvider('late', 'slow');
    kept.setUri?.('late', 'ahp-session:/late');
    const host = createHost({
      path: PATH,
      agents: [backend([], (id) => (id === 'late' ? found : undefined))],
      ...machine(),
      sessions: kept,
    });
    const p = peer();
    const client = host.accept(p);
    await client.handle(hello(['0.9.0'], { initialSubscriptions: ['ahp-root://'] }));
    await client.handle({ method: 'listSessions', params: { channel: 'ahp-root://' } });

    const opened = await client.handle({ method: 'subscribe', params: { channel: 'ahp-session:/late' } }) as {
      snapshot: { state: { _meta?: Record<string, unknown> } };
    };
    expect(opened.snapshot.state._meta).toEqual({ bot: 'motion' });
    // And the row it announced, so a client that never opened it has the keys.
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
    await showExternal(client);

    const listed = await client.handle({ method: 'listSessions', params: { channel: 'ahp-root://' } }) as { items: Row[] };
    expect(listed.items.find((one) => one.resource === 'ahp-session:/one')?._meta)
      .toEqual({ git: { branchName: 'main' }, bot: 'motion', 'vscode.external': true });
  });
});

/*
 * A session a backend lists that this host never ran is external, as VS Code's
 * agent host calls a session its provider's CLI made outside the host: marked
 * `vscode.external`, listed by the root's `showExternalSessions` (none by
 * default), and made this host's own by a person's turn going out in it.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentService.ts#L5764-L5791
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/chatContributions/externalSessionAdoption/externalSessionAdoptionContribution.ts#L25-L30
 */
describe('a session made outside this host', () => {
  const at = (before: number) => ({ lastModified: ago(before), cwd: '/home/softov' });
  type Row = { resource: string; title: string; _meta?: Record<string, unknown> };

  /** A client of a host over `store`, watching the root, and a way to set the mode and list. */
  const watching = async (store = memorySessions()) => {
    const p = peer();
    const client = serving('/home/softov', [], { sessions: store }).accept(p);
    await client.handle(hello(['0.9.0'], { initialSubscriptions: ['ahp-root://'] }));
    const mode = async (value: string): Promise<void> => {
      await showExternal(client, value);
      await settle();
    };
    const listed = async (): Promise<Row[]> =>
      (await client.handle({ method: 'listSessions', params: { channel: 'ahp-root://' } }) as { items: Row[] }).items;
    const said = (method: string): unknown[] => p.notes.filter((one) => one.method === method).map((one) => one.params);
    return { client, p, mode, listed, said };
  };

  it('lists none of them by default, and every session this host made', async () => {
    sdk.sessions.push({ sessionId: 'theirs', summary: 'Theirs', ...at(HOUR) });
    const { client, listed } = await watching();
    await client.handle({ method: 'createSession', params: { channel: 'ahp-session:/mine', provider: 'claude' } });
    await firstMessage(client, await defaultChatOf(client, 'ahp-session:/mine'));
    expect((await listed()).map((one) => one.resource)).toEqual(['ahp-session:/mine']);
  });

  it('lists the ones the mode names, each marked external', async () => {
    sdk.sessions.push(
      { sessionId: 'hour', summary: 'An hour ago', ...at(HOUR) },
      { sessionId: 'days', summary: 'Two days ago', ...at(2 * DAY) },
      { sessionId: 'weeks', summary: 'Ten days ago', ...at(10 * DAY) },
      { sessionId: 'months', summary: 'Forty days ago', ...at(40 * DAY) },
    );
    const { mode, listed } = await watching();
    const titles = async (value: string): Promise<string[]> => {
      await mode(value);
      return (await listed()).map((one) => one.title);
    };
    expect(await titles('none')).toEqual([]);
    expect(await titles('last24Hours')).toEqual(['An hour ago']);
    expect(await titles('last7Days')).toEqual(['An hour ago', 'Two days ago']);
    expect(await titles('last30Days')).toEqual(['An hour ago', 'Two days ago', 'Ten days ago']);
    expect(await titles('recent')).toEqual(['An hour ago', 'Two days ago']);
    expect((await listed())[0]?._meta).toEqual({ 'vscode.external': true });
  });

  it('keeps recent to the two updated last, none older than the second most recent of this host\'s own', async () => {
    // Two sessions this host ran, an hour and three hours ago: the cutoff is three hours.
    const store = memorySessions();
    store.setProvider('mine1', 'claude');
    store.setProvider('mine2', 'claude');
    sdk.sessions.push(
      { sessionId: 'mine1', summary: 'Mine, an hour ago', ...at(HOUR) },
      { sessionId: 'mine2', summary: 'Mine, three hours ago', ...at(3 * HOUR) },
      { sessionId: 'ten', summary: 'Theirs, ten minutes ago', ...at(HOUR / 6) },
      { sessionId: 'half', summary: 'Theirs, half an hour ago', ...at(HOUR / 2) },
      { sessionId: 'two', summary: 'Theirs, two hours ago', ...at(2 * HOUR) },
      { sessionId: 'four', summary: 'Theirs, four hours ago', ...at(4 * HOUR) },
    );
    const { mode, listed } = await watching(store);
    await mode('recent');
    expect((await listed()).map((one) => one.title))
      .toEqual(['Theirs, ten minutes ago', 'Theirs, half an hour ago', 'Mine, an hour ago', 'Mine, three hours ago']);
  });

  it('keeps one this host opened external across a restart until a turn adopts it', async () => {
    // What a run that opened it and saw no person's turn in it wrote down.
    const store = memorySessions();
    store.setProvider('older', 'claude');
    store.setExternal?.('older', true);
    sdk.sessions.push({ sessionId: 'older', summary: 'Opened, not adopted', ...at(HOUR) });
    const { mode, listed } = await watching(store);
    expect(await listed()).toEqual([]);
    await mode('last24Hours');
    expect((await listed()).map((one) => one._meta)).toEqual([{ 'vscode.external': true }]);
  });

  it('adopts one when a person\'s turn goes out in it, announcing it and listing it under every mode', async () => {
    sdk.sessions.push({ sessionId: 'older', summary: 'Theirs', ...at(HOUR) });
    sdk.transcript.push({ type: 'user', uuid: 'u1', message: { role: 'user', content: 'earlier' } });
    wrote('older', '/home/softov');
    const store = memorySessions();
    const { client, listed, said } = await watching(store);
    expect(await listed()).toEqual([]);
    const opened = await client.handle({ method: 'subscribe', params: { channel: 'ahp-session:/older' } }) as {
      snapshot: { state: { _meta?: Record<string, unknown> } };
    };
    expect(opened.snapshot.state._meta).toEqual({ 'vscode.external': true });

    await client.handle({
      method: 'dispatchAction',
      params: {
        channel: chatUriFor('ahp-session:/older'),
        action: { type: 'chat/turnStarted', turnId: 't1', startedAt: new Date().toISOString(), message: { origin: { kind: 'user' }, text: 'and now?' } },
      },
    });
    await settle(6);
    expect(store.external?.('older')).toBeUndefined();
    expect((said('root/sessionAdded') as { summary: Row }[]).map((one) => one.summary.resource)).toContain('ahp-session:/older');
    const row = (await listed()).find((one) => one.resource === 'ahp-session:/older');
    expect(row?._meta?.['vscode.external']).toBeUndefined();
  });

  it('tells every client what a change of mode shows and what it hides', async () => {
    sdk.sessions.push({ sessionId: 'hour', summary: 'An hour ago', ...at(HOUR) });
    const { mode, listed, said } = await watching();
    await listed();
    await mode('last24Hours');
    expect((said('root/sessionAdded') as { summary: Row }[]).map((one) => one.summary.resource)).toEqual(['ahp-session:/hour']);
    await mode('none');
    expect((said('root/sessionRemoved') as { session: string }[]).map((one) => one.session)).toEqual(['ahp-session:/hour']);
  });
});
