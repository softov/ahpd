import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Turn } from '@microsoft/agent-host-protocol';
import type { WireTurn } from '../src/types/wire.js';
import {
  resetSdk, actions, claude, createHost, defaultChatOf, echo, emit, flushed, hello, machine, open, peer, sdk, sendAnswered, serving,
  sessionQueries, settle, running, wrote,
} from './support/host.js';
import { fileSessions, memorySessions } from '../src/sessions/sessions.js';
import { idOf, Status } from '../src/sessions/catalog.js';
import { chatUriFor } from '../src/host/channels.js';
import { undeclaredIn } from './support/wire.js';
import { startedNow } from './support/started.js';
import type { Agent, Bag, HostOptions, Session, Start } from '@ahpd/sdk';

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
    // The chat of `ahp-session:/live` both of them watch.
    const LIVE = await defaultChatOf(a, 'ahp-session:/live');
    for (const client of [a, b]) {
      await client.handle({ method: 'subscribe', params: { channel: LIVE } });
    }

    a.handle({
      method: 'dispatchAction',
      params: {
        channel: LIVE,
        action: { type: 'chat/draftChanged', draft: { text: 'half a th', origin: { kind: 'user' } } },
      },
    });
    await settle();
    // The only reason a draft is on the wire at all: a client that kept its
    // own would need nothing from a host for it.
    const typed = actions(two, LIVE)
      .find((e) => e.action.type === 'chat/draftChanged')?.action.draft as { text?: string } | undefined;
    expect(typed?.text).toBe('half a th');

    // And somebody arriving later gets it from the snapshot.
    const three = host.accept(peer());
    await three.handle(hello(['0.9.0']));
    const opened = await three.handle({ method: 'subscribe', params: { channel: LIVE } }) as {
      snapshot: { state: { draft?: { text?: string } } };
    };
    expect(opened.snapshot.state.draft?.text).toBe('half a th');
  });

  it('says a draft the chat already holds to everybody on the chat, as the sender\'s own action', async () => {
    const host = serving('/home/softov');
    const one = peer();
    const a = host.accept(one);
    const two = peer();
    const b = host.accept(two);
    await a.handle(hello(['0.9.0'], { clientId: 'one' }));
    await b.handle(hello(['0.9.0'], { clientId: 'two' }));
    await a.handle({ method: 'createSession', params: { channel: 'ahp-session:/live', provider: 'claude' } });
    const LIVE = await defaultChatOf(a, 'ahp-session:/live');
    for (const client of [a, b]) {
      await client.handle({ method: 'subscribe', params: { channel: LIVE } });
    }
    const draft = { text: 'half a th', origin: { kind: 'user' } };
    const typed = (clientSeq: number) => a.handle({
      method: 'dispatchAction',
      params: { channel: LIVE, clientSeq, action: { type: 'chat/draftChanged', draft } },
    });
    const drafts = (p: ReturnType<typeof peer>) => actions(p, LIVE).filter((e) => e.action.type === 'chat/draftChanged');

    void typed(1);
    await settle();
    expect(drafts(two)).toHaveLength(1);

    void typed(2);
    await settle();
    const answer = drafts(one).find((e) => e.origin?.clientSeq === 2);
    expect(answer?.origin?.clientId).toBe('one');
    expect(answer?.rejectionReason).toBeUndefined();
    // The other person on the chat hears it too, under the sender's origin.
    expect(drafts(two).map((e) => e.origin?.clientSeq)).toEqual([1, 2]);
  });
});

describe('dropping the turns after one', () => {
  /** Two finished turns, with the backend's own names for what they did. */
  async function twice() {
    const running_ = await running();
    const { client, chatUri } = running_;
    client.handle({
      method: 'dispatchAction',
      params: { channel: chatUri, action: { type: 'chat/turnStarted', turnId: 't1', startedAt: new Date().toISOString(), message: { origin: { kind: 'user' }, text: 'first' } } },
    });
    await settle();
    await emit({ type: 'system', subtype: 'init', session_id: 'sdk-1' });
    await emit({ type: 'assistant', uuid: 'reply-1', message: { id: 'm1', content: [{ type: 'text', text: 'one' }] } });
    await emit({ type: 'result', subtype: 'success', is_error: false, duration_ms: 1 });
    // Written, where the CLI runs, once the first message reached it.
    wrote('sdk-1', String(sessionQueries().at(-1)?.options.cwd));
    client.handle({
      method: 'dispatchAction',
      params: { channel: chatUri, action: { type: 'chat/turnStarted', turnId: 't2', startedAt: new Date().toISOString(), message: { origin: { kind: 'user' }, text: 'second' } } },
    });
    await settle();
    await emit({ type: 'system', subtype: 'init', session_id: 'sdk-1' });
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

    // The history through that turn is still here: a truncation that emptied
    // the chat is not what the action asks for.
    const state = (await client.handle({ method: 'subscribe', params: { channel: chatUri } }) as {
      snapshot: { state: { turns: { id: string }[] } };
    }).snapshot.state;
    expect(state.turns.map((one) => one.id)).toEqual(['t1']);

    // A CLI that still remembered the dropped turn would answer the edited
    // message with the one it replaced still in front of it. The next send
    // starts one on the cut.
    client.handle({
      method: 'dispatchAction',
      params: { channel: chatUri, action: { type: 'chat/turnStarted', turnId: 't3', startedAt: new Date().toISOString(), message: { origin: { kind: 'user' }, text: 'again' } } },
    });
    await settle();
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
  });

  /*
   * The cut is the kept turn's last assistant message on the main chain, as
   * VS Code's resolveForkAnchorUuid reads it: a tool's result after it, and a
   * worker's frames, are no anchor.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/claude/claudeReplayMapper.ts#L72-L112
   */
  it('rewinds to the kept turn\'s last assistant message, past a tool\'s result and a worker\'s frame', async () => {
    const { client, chatUri } = await running();
    client.handle({
      method: 'dispatchAction',
      params: { channel: chatUri, action: { type: 'chat/turnStarted', turnId: 't1', startedAt: new Date().toISOString(), message: { origin: { kind: 'user' }, text: 'first' } } },
    });
    await settle();
    await emit({ type: 'system', subtype: 'init', session_id: 'sdk-1' });
    await emit({ type: 'assistant', uuid: 'reply-1', message: { id: 'm1', content: [{ type: 'tool_use', id: 'toolu_1', name: 'Bash', input: { command: 'ls' } }] } });
    await emit({ type: 'user', uuid: 'result-1', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: 'a b' }] } });
    await emit({ type: 'assistant', uuid: 'worker-1', parent_tool_use_id: 'toolu_task', message: { id: 'w1', content: [{ type: 'text', text: 'working' }] } });
    await emit({ type: 'result', subtype: 'success', is_error: false, duration_ms: 1 });
    wrote('sdk-1', String(sessionQueries().at(-1)?.options.cwd));
    client.handle({
      method: 'dispatchAction',
      params: { channel: chatUri, action: { type: 'chat/turnStarted', turnId: 't2', startedAt: new Date().toISOString(), message: { origin: { kind: 'user' }, text: 'second' } } },
    });
    await settle();
    await emit({ type: 'assistant', uuid: 'reply-2', message: { id: 'm2', content: [{ type: 'text', text: 'two' }] } });
    await emit({ type: 'result', subtype: 'success', is_error: false, duration_ms: 1 });

    client.handle({
      method: 'dispatchAction',
      params: { channel: chatUri, action: { type: 'chat/truncated', turnId: 't1' } },
    });
    await settle();
    // The next send starts the CLI on the cut.
    client.handle({
      method: 'dispatchAction',
      params: { channel: chatUri, action: { type: 'chat/turnStarted', turnId: 't3', startedAt: new Date().toISOString(), message: { origin: { kind: 'user' }, text: 'again' } } },
    });
    await settle();
    expect(sessionQueries().at(-1)?.options.resumeSessionAt).toBe('reply-1');
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

  /*
   * A truncation its backend cannot make is said all the same, and the backend
   * keeps its history, as VS Code's host says a truncation and its provider
   * without one cuts nothing.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentSideEffects.ts#L1968-L1990
   */
  it('says a truncation at a turn it has no rewind point for, and starts no CLI again', async () => {
    const { client, peer: p, chatUri } = await running();
    client.handle({
      method: 'dispatchAction',
      params: { channel: chatUri, action: { type: 'chat/turnStarted', turnId: 't1', startedAt: new Date().toISOString(), message: { origin: { kind: 'user' }, text: 'hi' } } },
    });
    await settle();
    // Finished without the CLI ever naming what it did - which is every turn
    // read back off a transcript rather than watched running.
    await emit({ type: 'result', session_id: 'sdk-1', subtype: 'success', is_error: false, duration_ms: 1 });
    const queries = sdk.queries.length;

    client.handle({
      method: 'dispatchAction',
      params: { channel: chatUri, clientSeq: 4, action: { type: 'chat/truncated', turnId: 't1' } },
    });
    await settle();
    const said = actions(p, chatUri).filter((e) => e.action.type === 'chat/truncated');
    expect(said.map((e) => [e.origin?.clientSeq, e.rejectionReason])).toEqual([[4, undefined]]);
    // The CLI was not started again: it keeps the history it has.
    expect(sdk.queries.length).toBe(queries);
  });

  /*
   * A truncation at a turn the chat does not hold is said as it was sent, and
   * the reducer leaves the chat as it was, as VS Code's host says every
   * truncation.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentSideEffects.ts#L1968-L1995
   */
  it('says a truncation at a turn the chat does not hold, and starts no CLI again', async () => {
    const { client, peer: p, chatUri } = await running();
    const queries = sdk.queries.length;
    client.handle({
      method: 'dispatchAction',
      params: { channel: chatUri, clientSeq: 5, action: { type: 'chat/truncated', turnId: 'nowhere' } },
    });
    await settle();
    const said = actions(p, chatUri).filter((e) => e.action.type === 'chat/truncated');
    expect(said.map((e) => [e.origin?.clientSeq, e.rejectionReason])).toEqual([[5, undefined]]);
    expect(sdk.queries.length).toBe(queries);
  });

  it('drops the turn that is running, and comes back idle', async () => {
    const { client, peer: p, chatUri } = await twice();
    client.handle({
      method: 'dispatchAction',
      params: { channel: chatUri, action: { type: 'chat/turnStarted', turnId: 't3', startedAt: new Date().toISOString(), message: { origin: { kind: 'user' }, text: 'third' } } },
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

  it('starts a conversation emptied entire over, with the agent\'s copy deleted', async () => {
    const { client, peer: p, chatUri } = await twice();
    const before = sessionQueries().length;
    client.handle({
      method: 'dispatchAction',
      params: { channel: chatUri, action: { type: 'chat/truncated' } },
    });
    await settle();
    /*
     * `turnId` is optional and its absence means "clear everything", which as
     * a rewind is a cut before the first prompt, with no entry to name. The
     * CLI forgets it instead, as the reference's agent does: its conversation
     * is deleted and the next send starts a CLI with nothing to resume.
     */
    expect(actions(p).filter((e) => e.rejectionReason !== undefined)).toEqual([]);
    expect(sdk.deleted).toEqual(['sdk-1']);
    expect(actions(p, chatUri).some((e) => e.action.type === 'chat/truncated')).toBe(true);
    const state = (await client.handle({ method: 'subscribe', params: { channel: chatUri } }) as {
      snapshot: { state: { turns: unknown[] } };
    }).snapshot.state;
    expect(state.turns).toEqual([]);
    client.handle({
      method: 'dispatchAction',
      params: { channel: chatUri, action: { type: 'chat/turnStarted', turnId: 't3', startedAt: new Date().toISOString(), message: { origin: { kind: 'user' }, text: 'again' } } },
    });
    await settle();
    expect(sessionQueries().length).toBe(before + 1);
    const fresh = sessionQueries().at(-1);
    expect(fresh?.options.resume).toBeUndefined();
    expect(fresh?.options.resumeSessionAt).toBeUndefined();
  });

  it('says a conversation started over back with the origin of the client that asked', async () => {
    const { client, peer: p, chatUri } = await twice();
    client.handle({
      method: 'dispatchAction',
      params: { channel: chatUri, clientSeq: 6, action: { type: 'chat/truncated' } },
    });
    await settle();
    // Said once the agent's copy is deleted, which is after the dispatch was
    // applied: the client still holds the action, and this is its answer.
    const truncated = actions(p, chatUri).find((e) => e.action.type === 'chat/truncated');
    expect(truncated?.origin).toEqual({ clientId: 'probe', clientSeq: 6 });
  });
});

describe('a chat made out of another', () => {
  /*
   * A chat is named by the request's title, trimmed, and a fork given none is
   * named after the chat it came from, as VS Code's host names one; the
   * prefix is not said twice.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentService.ts#L7370
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentService.ts#L7458-L7461
   */
  it('names a chat by the title it was asked for, and an untitled fork after its source, as VS Code\'s host', async () => {
    const { client, uri, chatUri } = await running();
    client.handle({
      method: 'dispatchAction',
      params: { channel: chatUri, action: { type: 'chat/turnStarted', turnId: 't1', startedAt: new Date().toISOString(), message: { origin: { kind: 'user' }, text: 'hi' } } },
    });
    await settle();
    await emit({ type: 'system', subtype: 'init', session_id: 'sdk-1' });
    await emit({ type: 'assistant', uuid: 'sdk-reply-1', message: { id: 'm1', content: [{ type: 'text', text: 'hello' }] } });
    await emit({ type: 'result', subtype: 'success', is_error: false, duration_ms: 1 });
    wrote('sdk-1', String(sessionQueries().at(-1)?.options.cwd));
    await client.handle({ method: 'dispatchAction', params: { channel: chatUri, action: { type: 'session/titleChanged', title: 'The plan' } } });
    await settle();
    const titleOf = async (chat: string): Promise<unknown> =>
      ((await client.handle({ method: 'subscribe', params: { channel: chat } })) as { snapshot: { state: { title?: unknown } } }).snapshot.state.title;

    await client.handle({ method: 'createChat', params: { channel: uri, chat: 'ahp-chat:/named', title: '  Review  ' } });
    expect(await titleOf('ahp-chat:/named')).toBe('Review');
    await client.handle({ method: 'createChat', params: { channel: uri, chat: 'ahp-chat:/forked', source: { kind: 'fork', chat: chatUri, turnId: 't1' } } });
    expect(await titleOf('ahp-chat:/forked')).toBe('Forked: The plan');
    await client.handle({ method: 'createChat', params: { channel: uri, chat: 'ahp-chat:/again', source: { kind: 'fork', chat: 'ahp-chat:/forked', turnId: 't1' } } });
    expect(await titleOf('ahp-chat:/again')).toBe('Forked: The plan');
  });

  it('forks at the turn it was told to, and brings the history through it', async () => {
    const { client, uri, chatUri } = await running();
    client.handle({
      method: 'dispatchAction',
      params: { channel: chatUri, action: { type: 'chat/turnStarted', turnId: 't1', startedAt: new Date().toISOString(), message: { origin: { kind: 'user' }, text: 'hi' } } },
    });
    await settle();
    // The CLI names its conversation and then answers, and the answer's id is
    // the one a fork cuts at.
    await emit({ type: 'system', subtype: 'init', session_id: 'sdk-1' });
    await emit({ type: 'assistant', uuid: 'sdk-reply-1', message: { id: 'm1', content: [{ type: 'text', text: 'hello' }] } });
    await emit({ type: 'result', subtype: 'success', is_error: false, duration_ms: 1 });
    // Written, where the CLI runs, once the first message reached it.
    wrote('sdk-1', String(sessionQueries().at(-1)?.options.cwd));

    await client.handle({
      method: 'createChat',
      params: {
        channel: uri, chat: 'ahp-chat:/forked',
        source: { kind: 'fork', chat: chatUri, turnId: 't1' },
      },
    });
    // The conversation through that turn is visible in the new chat: a fork
    // that starts empty is a new chat, not a fork.
    const state = (await client.handle({ method: 'subscribe', params: { channel: 'ahp-chat:/forked' } }) as {
      snapshot: { state: { turns: { id: string }[] } };
    }).snapshot.state;
    expect(state.turns.map((one) => one.id)).toEqual(['t1']);

    // The new chat's first send starts its CLI, on the conversation forked there.
    client.handle({
      method: 'dispatchAction',
      params: { channel: 'ahp-chat:/forked', action: { type: 'chat/turnStarted', turnId: 't2', startedAt: new Date().toISOString(), message: { origin: { kind: 'user' }, text: 'go on' } } },
    });
    await settle();
    const fresh = sessionQueries().at(-1);
    expect(fresh?.options.forkSession).toBe(true);
    // The turn's *last* entry, not the prompt it began with: a fork copies the
    // conversation through the chosen turn, answer included, so cutting at the
    // prompt would leave the new chat showing an answer its agent never gave.
    expect(fresh?.options.resumeSessionAt).toBe('sdk-reply-1');
  });

  /*
   * A turn its backend names no fork point for is forked all the same, into a
   * conversation of the new chat's own, as VS Code's host hands its provider
   * the host's turns and forks what it can.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentService.ts#L7424-L7476
   */
  it('forks at a turn it has no fork point for into a conversation of the new chat\'s own', async () => {
    const { client, uri, chatUri } = await running();
    client.handle({
      method: 'dispatchAction',
      params: { channel: chatUri, action: { type: 'chat/turnStarted', turnId: 't1', startedAt: new Date().toISOString(), message: { origin: { kind: 'user' }, text: 'hi' } } },
    });
    await settle();
    // Finished without the CLI ever naming what it did, so nothing names where
    // the turn ended.
    await emit({ type: 'result', session_id: 'sdk-1', subtype: 'success', is_error: false, duration_ms: 1 });

    await client.handle({
      method: 'createChat',
      params: { channel: uri, chat: 'ahp-chat:/forked', source: { kind: 'fork', chat: chatUri, turnId: 't1' } },
    });
    const fresh = sessionQueries().at(-1);
    expect(fresh?.options.forkSession).toBeUndefined();
    expect(fresh?.options.resume).toBeUndefined();
    const state = (await client.handle({ method: 'subscribe', params: { channel: 'ahp-chat:/forked' } }) as {
      snapshot: { state: { turns: { id: string }[] } };
    }).snapshot.state;
    expect(state.turns.map((one) => one.id)).toEqual(['t1']);
  });

  /*
   * The turn still running bounds a side chat as a completed one does, as VS
   * Code's host takes either.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentService.ts#L7715-L7720
   */
  it('makes a side chat of the turn still running', async () => {
    const { client, uri, chatUri } = await running();
    client.handle({
      method: 'dispatchAction',
      params: { channel: chatUri, action: { type: 'chat/turnStarted', turnId: 't1', startedAt: new Date().toISOString(), message: { origin: { kind: 'user' }, text: 'the weather' } } },
    });
    await settle();

    expect(await client.handle({
      method: 'createChat',
      params: { channel: uri, chat: 'ahp-chat:/side', source: { kind: 'sideChat', chat: chatUri, turnId: 't1' } },
    })).toBeNull();
    const state = (await client.handle({ method: 'subscribe', params: { channel: 'ahp-chat:/side' } }) as {
      snapshot: { state: { origin?: unknown } };
    }).snapshot.state;
    expect(state.origin).toEqual({ kind: 'sideChat', chat: chatUri, turnId: 't1' });
  });

  it('tells a side chat what the turn said, and keeps it out of the history', async () => {
    const { client, uri, chatUri } = await running();
    client.handle({
      method: 'dispatchAction',
      params: { channel: chatUri, action: { type: 'chat/turnStarted', turnId: 't1', startedAt: new Date().toISOString(), message: { origin: { kind: 'user' }, text: 'the weather' } } },
    });
    await settle();
    await emit({ type: 'result', session_id: 'sdk-1', subtype: 'success', is_error: false, duration_ms: 1 });

    await client.handle({
      method: 'createChat',
      params: {
        channel: uri, chat: 'ahp-chat:/side',
        source: { kind: 'sideChat', chat: chatUri, turnId: 't1' },
        initialMessage: { text: 'and tomorrow?', origin: { kind: 'user' } },
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
   * A chat's first turn, finished, with the id the CLI gave its answer.
   *
   * What a fork resumes at, so a chat made out of this one has a turn to name.
   */
  const oneTurn = async (client: ReturnType<ReturnType<typeof serving>['accept']>, chatUri: string, turnId = 't1'): Promise<void> => {
    client.handle({
      method: 'dispatchAction',
      params: { channel: chatUri, action: { type: 'chat/turnStarted', turnId, startedAt: new Date().toISOString(), message: { text: 'hi', origin: { kind: 'user' } } } },
    });
    await settle();
    await emit({ type: 'system', subtype: 'init', session_id: 'sdk-1' });
    await emit({ type: 'assistant', uuid: `sdk-reply-${turnId}`, message: { id: `m-${turnId}`, content: [{ type: 'text', text: 'hello' }] } });
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

    // The row's change carries the fields that moved, never `resource`, and
    // it must not say `user` over what the chat was made from.
    client.handle({
      method: 'dispatchAction',
      params: { channel: 'ahp-chat:/forked', action: { type: 'session/titleChanged', title: 'Forked' } },
    });
    client.handle({
      method: 'dispatchAction',
      params: { channel: 'ahp-chat:/forked', action: { type: 'chat/turnStarted', turnId: 't2', startedAt: new Date().toISOString(), message: { origin: { kind: 'user' }, text: 'again' } } },
    });
    await settle();
    const updated = actions(p, uri)
      .filter((e) => e.action.type === 'session/chatUpdated' && e.action.chat === 'ahp-chat:/forked')
      .map((e) => e.action.changes as { origin?: unknown; resource?: unknown });
    expect(updated).not.toHaveLength(0);
    expect(updated.every((one) => one.resource === undefined)).toBe(true);
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

  it('names a secondary chat it was forked from as that chat, and the default chat by its own URI', async () => {
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

    const opened = await client.handle({ method: 'subscribe', params: { channel: uri } }) as {
      snapshot: { state: { defaultChat: string; chats: { resource: string; origin?: unknown }[] } };
    };
    const rows = opened.snapshot.state.chats;
    // Not the default chat: the chat it was made from is a peer of it.
    expect(rows.find((c) => c.resource === 'ahp-chat:/forked')?.origin)
      .toEqual({ kind: 'fork', chat: 'ahp-chat:/other', turnId: 't1' });
    // The default chat, by the one URI it has.
    expect(rows.find((c) => c.resource === 'ahp-chat:/lead-fork')?.origin)
      .toEqual({ kind: 'fork', chat: chatUri, turnId: 't1' });
    expect(opened.snapshot.state.defaultChat).toBe(chatUri);
    expect(defectsOf(p, [opened])).toEqual([]);
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

  /*
   * A fork at a turn the chat does not hold, as after another window cut the
   * chat back, is a fresh chat, as VS Code's host drops a fork whose point it
   * cannot find rather than seed nothing under a fork.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentService.ts#L7427-L7433
   */
  it('makes a fresh chat for a fork at a turn the chat does not hold, as VS Code\'s host', async () => {
    const { client, uri, chatUri } = await running();
    expect(await client.handle({
      method: 'createChat',
      params: { channel: uri, chat: 'ahp-chat:/fresh', source: { kind: 'fork', chat: chatUri, turnId: 'gone' } },
    })).toBeNull();
    const state = (await client.handle({ method: 'subscribe', params: { channel: 'ahp-chat:/fresh' } }) as {
      snapshot: { state: { turns: unknown[]; origin?: { kind?: string } } };
    }).snapshot.state;
    expect(state.turns).toEqual([]);
    expect(state.origin?.kind).not.toBe('fork');
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

  it('spreads a session-scoped key across every chat', async () => {
    const { client, uri } = await running();
    await client.handle({ method: 'createChat', params: { channel: uri, chat: second } });
    // The CLI each chat's first send starts.
    await sendAnswered(client, uri);
    await sendAnswered(client, second);
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
  });

  /*
   * A chat with an agent of its own is VS Code's `multipleChatProviders`,
   * which this host does not advertise, so a request naming one is refused in
   * VS Code's words rather than made on the session's agent.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/protocolServerHandler.ts#L2287-L2289
   */
  it('refuses a chat asked for on an agent of its own, as VS Code\'s host that offers none', async () => {
    const { client, uri } = await running();
    await expect(client.handle({ method: 'createChat', params: { channel: uri, chat: second, provider: 'claude' } }))
      .rejects.toMatchObject({ code: -32602, message: 'This host does not support chats with their own agent.' });
    const opened = await client.handle({ method: 'subscribe', params: { channel: uri } }) as {
      snapshot: { state: { chats: { resource: string }[] } };
    };
    expect(opened.snapshot.state.chats.map((c) => c.resource)).not.toContain(second);
  });

  /*
   * A chat's first message is its first turn, begun once the chat is made:
   * the request is answered with the chat there, and a turn this host will not
   * run ends in an error on the chat, which keeps the prompt, as VS Code's host
   * accepts an initial message. One that is not the user's is refused before
   * anything is made.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentService.ts#L7350-L7352
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentService.ts#L7670-L7698
   */
  it('answers with the chat made, and ends a first message it will not run on the chat, as VS Code\'s host', async () => {
    const { host, client, uri } = await running();
    host.refuseTurns('This host is stopping');
    expect(await client.handle({
      method: 'createChat', params: { channel: uri, chat: second, initialMessage: { text: 'hello', origin: { kind: 'user' } } },
    })).toBeNull();
    await settle();
    const state = (await client.handle({ method: 'subscribe', params: { channel: second } }) as {
      snapshot: { state: { turns: { message: { text: string }; state: string }[] } };
    }).snapshot.state;
    expect(state.turns.map((turn) => [turn.message.text, turn.state])).toEqual([['hello', 'error']]);
  });

  /*
   * And its `turn_end` says the start was refused, with nobody holding the
   * message once the chat is made, as VS Code's host starts a chat's first
   * turn with a rejection nobody can recover.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentService.ts#L7697
   */
  it('raises turn_end rejected for a first message it will not run, which nobody holds once the chat is made', async () => {
    const ends: unknown[] = [];
    const { host, client, uri } = await running({
      events: { turn_end: [{ by: 'probe', context: {} as never, handle: (event) => { ends.push(event); } }] },
    });
    host.refuseTurns('This host is stopping');
    await client.handle({
      method: 'createChat', params: { channel: uri, chat: second, initialMessage: { text: 'hello', origin: { kind: 'user' } } },
    });
    await settle();
    expect(ends).toEqual([expect.objectContaining({
      channel: second, reason: { kind: 'rejected', error: { errorType: 'rejected', message: 'This host is stopping' }, recoverable: false },
    })]);
  });

  it('refuses a first message that is not the user\'s before any chat is made, as VS Code\'s host', async () => {
    const { client, uri } = await running();
    await expect(client.handle({ method: 'createChat', params: { channel: uri, chat: second, initialMessage: { text: 'hello' } } }))
      .rejects.toMatchObject({ code: -32602, message: 'An initial chat message must have user origin.' });
    const opened = await client.handle({ method: 'subscribe', params: { channel: uri } }) as {
      snapshot: { state: { chats: { resource: string }[] } };
    };
    expect(opened.snapshot.state.chats.map((c) => c.resource)).not.toContain(second);
  });

  it('hands the backend a first message\'s model, as VS Code\'s host sends a turn with the model it names', async () => {
    const base = echo({ path: '/home/softov', pace: 0 });
    const models: unknown[] = [];
    const agent: Agent = {
      ...base,
      create: (start: Start): Session => {
        const session = base.create(start) as Session;
        return { ...session, changeModel: (model) => { models.push(model); return session.changeModel(model); } };
      },
    };
    const host = createHost({ path: '/home/softov', agents: [agent] });
    const client = host.accept(peer());
    await client.handle(hello(['0.9.0']));
    await client.handle({ method: 'createSession', params: { channel: 'ahp-session:/one', provider: 'echo' } });
    await client.handle({
      method: 'createChat',
      params: { channel: 'ahp-session:/one', chat: second, initialMessage: { text: 'hello', origin: { kind: 'user' }, model: { id: 'echo/fast' } } },
    });
    await settle();
    expect(models).toContainEqual({ id: 'echo/fast' });
    await host.close();
  });

  /*
   * A chat that is there already, as VS Code's host answers one: the default
   * chat, made with its session, answered `null` with nothing made, or its
   * first message taken as the default chat's turn; a fork with a first
   * message onto a chat that exists, and any other chat that exists, refused
   * AlreadyExists.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/protocolServerHandler.ts#L2272-L2282
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentService.ts#L7354-L7365
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentService.ts#L7663-L7668
   */
  it('answers a chat that is there already as VS Code\'s host answers it', async () => {
    const { client, peer: p, uri, chatUri } = await running();
    const added = (): number => actions(p, uri).filter((e) => e.action.type === 'session/chatAdded').length;
    expect(await client.handle({ method: 'createChat', params: { channel: uri, chat: chatUri } })).toBeNull();
    expect(added()).toBe(0);

    await expect(client.handle({
      method: 'createChat',
      params: { channel: uri, chat: chatUri, source: { kind: 'fork', chat: chatUri, turnId: 'none' }, initialMessage: { text: 'again', origin: { kind: 'user' } } },
    })).rejects.toMatchObject({ code: -32010, message: `Chat already exists: ${chatUri}` });

    expect(await client.handle({
      method: 'createChat', params: { channel: uri, chat: chatUri, initialMessage: { text: 'over here', origin: { kind: 'user' } } },
    })).toBeNull();
    await settle();
    const own = (await client.handle({ method: 'subscribe', params: { channel: chatUri } }) as {
      snapshot: { state: { activeTurn?: { message: { text: string } } } };
    }).snapshot.state;
    expect(own.activeTurn?.message.text).toBe('over here');
    expect(added()).toBe(0);

    await client.handle({ method: 'createChat', params: { channel: uri, chat: second } });
    await expect(client.handle({ method: 'createChat', params: { channel: uri, chat: second } }))
      .rejects.toMatchObject({ code: -32010, message: `Chat already exists: ${second}` });
  });

  it('opens one, and lists both on the session', async () => {
    const { client, peer: p, uri, chatUri } = await running();
    await client.handle({ method: 'createChat', params: { channel: uri, chat: second } });

    // `summary`, which is what the reducer reads: a chat announced under any
    // other name arrives as a TypeError inside it. Idle and read (32), because
    // a chat nobody has run anything in has nothing unread.
    expect(actions(p, uri).find((e) => e.action.type === 'session/chatAdded')?.action.summary)
      .toMatchObject({ resource: second, status: 1 | 32 });

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
      params: { channel: second, action: { type: 'chat/turnStarted', turnId: 't1', startedAt: new Date().toISOString(), message: { origin: { kind: 'user' }, text: 'over here' } } },
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
    await sendAnswered(client, second);
    // Config belongs to the session, not to whichever chat happened to be
    // open when it was answered.
    expect(sessionQueries().at(-1)?.options.permissionMode).toBe('plan');
  });

  it('says a session is waiting when any of its chats is', async () => {
    // `ls` and `sleep` are in VS Code's table, which would approve them: no table, so the call asks.
    const { client, uri } = await running({ terminalAutoApproveDefaults: 'none' });
    await client.handle({ method: 'createChat', params: { channel: uri, chat: second } });
    client.handle({
      method: 'dispatchAction',
      params: { channel: second, action: { type: 'chat/turnStarted', turnId: 't1', startedAt: new Date().toISOString(), message: { origin: { kind: 'user' }, text: 'go' } } },
    });
    await settle();
    void sdk.canUseTool?.('Bash', { command: 'ls' }, { toolUseID: 'toolu_1' });
    await settle();

    const listed = await client.handle({ method: 'listSessions', params: { channel: 'ahp-root://' } }) as {
      items: { status: number }[];
    };
    // A catalogue that only looked at the default chat would show this idle
    // while another chat in it is blocked on a person. Without the read bit,
    // which is the person's and not the turn's.
    expect((listed.items[0]?.status ?? 0) & ~Status.IsRead).toBe(24);
  });

  /*
   * VS Code answers null for a chat it finds no owner for, and its state
   * refuses to remove a session's default chat, so the default never changes
   * this way.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/protocolServerHandler.ts#L2380-L2389
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentHostStateManager.ts#L1871-L1880
   */
  it('answers null for the default chat and for a chat it does not hold, removing nothing, as VS Code\'s', async () => {
    const { client, peer: p, uri, chatUri } = await running();
    await client.handle({ method: 'createChat', params: { channel: uri, chat: second } });
    expect(await client.handle({ method: 'disposeChat', params: { channel: chatUri } })).toBeNull();
    expect(await client.handle({ method: 'disposeChat', params: { channel: 'ahp-chat:/nobody' } })).toBeNull();
    expect(actions(p, uri).some((e) => e.action.type === 'session/chatRemoved' || e.action.type === 'session/defaultChatChanged')).toBe(false);
    const session = await client.handle({ method: 'subscribe', params: { channel: uri } }) as {
      snapshot: { state: { defaultChat: string; chats: { resource: string }[] } };
    };
    expect(session.snapshot.state.defaultChat).toBe(chatUri);
    expect(session.snapshot.state.chats.map((one) => one.resource)).toEqual([chatUri, second]);
  });

  it('closes a chat that is not the default', async () => {
    const { client, peer: p, uri, chatUri } = await running();
    await client.handle({ method: 'createChat', params: { channel: uri, chat: second } });
    expect(await client.handle({ method: 'disposeChat', params: { channel: second } })).toBeNull();
    expect(actions(p, uri).find((e) => e.action.type === 'session/chatRemoved')?.action.chat).toBe(second);
    const session = await client.handle({ method: 'subscribe', params: { channel: uri } }) as {
      snapshot: { state: { defaultChat: string } };
    };
    expect(session.snapshot.state.defaultChat).toBe(chatUri);
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
  const renaming = (starts: Start[], firstChat = false): Agent => {
    // The example, so the transcript is kept under the id `create` is handed -
    // which is what makes the minted name the one a restart has to resume by.
    const base = echo({ path: DIR, pace: 0 });
    return {
      ...base,
      find: async (id) => (await base.list?.())?.find((one) => one.id === id),
      create: (start: Start): Session => {
        const mine = start.resume ?? (start.chatId === undefined || start.chatId === idOf(start.uri)
          ? `${idOf(start.uri)}${firstChat ? '-minted' : ''}`
          : `${start.chatId}-minted`);
        starts.push(start);
        const session = base.create({ ...start, resume: mine });
        return { ...session, agentId: () => mine };
      },
    };
  };

  /**
   * A host over one store folder, and a client whose window trusts and moves
   * chats, as a VS Code window with its move setting on turns it on.
   */
  const hostAt = async (dir: string, agent: Agent, over: Partial<HostOptions> = {}) => {
    const host = createHost({ path: DIR, agents: [agent], ...machine(), sessions: fileSessions({ dir }), ...over });
    const p = peer();
    // A folder is untrusted until the window it is in says otherwise, and the
    // window here is the client. Nothing else in these cases asks it anything.
    p.request = async () => ({ trusted: true });
    const client = host.accept(p);
    await client.handle(hello(['0.9.0'], { initialSubscriptions: ['ahp-root://'] }));
    await client.handle({
      method: 'dispatchAction',
      params: { channel: 'ahp-root://', action: { type: 'root/configChanged', config: { 'chatMoves.enabled': true } } },
    });
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
  const apart = async (dir: string, agent: Agent, beside: string[] = []) => {
    const { client, p } = await hostAt(dir, agent);
    /*
     * Both sessions work in `DIR`, which is what a chat's own folder set is
     * read against: a chat is its session's primary directory plus what it has
     * narrowed itself to, so a session with no directory has no folders for a
     * move to carry. `beside` are the folders the first works in beside it.
     */
    await client.handle({
      method: 'createSession',
      params: { channel: LIVE, provider: 'echo', workingDirectories: [`file://${DIR}`, ...beside.map((one) => `file://${one}`)] },
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
    return { ...base, create: (start: Start): Session => ({ ...startedNow(base.create(start)), resumable: () => false }) };
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

  /**
   * A chat's first turn, run to its end: a chat with no turn yet is one no move
   * is made of, as VS Code's host refuses moving it.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentService.ts#L8150-L8160
   */
  const firstTurn = async (client: { handle(request: unknown): Promise<unknown> }, chat: string, turnId: string): Promise<void> => {
    await send(client, chat, turnId, 'first');
    await vi.waitFor(async () => {
      const read = await opened(client, chat);
      expect(read.state.turns.length).toBeGreaterThan(0);
      expect((read.state as { activeTurn?: unknown }).activeTurn ?? undefined).toBeUndefined();
    });
  };

  const send = async (
    client: { handle(request: unknown): Promise<unknown> },
    channel: string,
    turnId: string,
    text: string,
  ): Promise<void> => {
    // A message for a session as a whole goes to its default chat, which a
    // client reads off the session: a chat's action travels on a chat's channel.
    const chat = channel.startsWith('ahp-session:')
      ? String((await client.handle({ method: 'subscribe', params: { channel } }) as { snapshot: { state: { defaultChat?: string } } }).snapshot.state.defaultChat)
      : channel;
    void client.handle({
      method: 'dispatchAction',
      params: { channel: chat, action: { type: 'chat/turnStarted', turnId, startedAt: new Date().toISOString(), message: { text, origin: { kind: 'user' } } } },
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
      await client.handle({ method: 'createSession', params: { channel: LIVE, provider: 'echo', workingDirectories: [`file://${DIR}`] } });
      await client.handle({ method: 'createChat', params: { channel: LIVE, chat: PEER } });
      await settle();
      await send(client, LIVE, 't1', 'first');
      await send(client, PEER, 't2', 'second');
      const before = starts.length;

      // The window puts another folder in the first one's place, which a
      // backend that takes its folders at startup answers by starting again
      // there, resumed: the in-process restart.
      void client.handle({
        method: 'dispatchAction',
        params: { channel: LIVE, action: { type: 'session/workingDirectoryReplaced', directory: `file://${DIR}`, replacement: `file://${DIR}/extra` } },
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
      expect(listed.items.map((one) => one.resource)).toEqual(['ahp-session:/live']);

      // The session lists both chats, and opening the peer one answers its own
      // turns rather than the session's. Read only: nothing is started here.
      const session = await opened(second.client, 'ahp-session:/live');
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
      await send(second.client, 'ahp-session:/live', 't1', 'again');
      // One start, and it is the chat that is the session: a chat somebody
      // closed is not one the session comes back with.
      expect(resuming(starts.slice(before))).toEqual([{ chatId: undefined, resume: 'live', first: 'first' }]);
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

  it.each([false, true])('lists the original session when its first chat has a backend-minted id (find only: %s)', async (findOnly) => {
    const root = mkdtempSync(join(tmpdir(), 'ahpd-chats-'));
    try {
      const dir = join(root, 'sessions');
      const starts: Start[] = [];
      const agent = renaming(starts, true);
      const first = await hostAt(dir, agent);
      await first.client.handle({
        method: 'createSession',
        params: { channel: LIVE, provider: 'echo', workingDirectories: [`file://${DIR}`] },
      });
      await first.client.handle({ method: 'createChat', params: { channel: LIVE, chat: PEER } });
      await send(first.client, LIVE, 't1', 'first');
      await send(first.client, PEER, 't2', 'second');
      await new Promise((tick) => { setTimeout(tick, 5); });

      const second = await hostAt(dir, findOnly ? { ...agent, directories: () => [], list: async () => [] } : agent);
      const rows = await second.client.handle({ method: 'listSessions', params: { channel: 'ahp-root://' } }) as {
        items: { resource: string }[];
      };
      expect(rows.items.map((one) => one.resource)).toEqual([LIVE]);
      expect(said(await opened(second.client, chatUriFor(LIVE)))).toEqual(['first']);
      expect(said(await opened(second.client, PEER))).toEqual(['second']);
      expect(starts).toHaveLength(2);
    }
    finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('does not list a recorded session whose backend-minted conversation is gone', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ahpd-chats-'));
    try {
      const dir = join(root, 'sessions');
      const agent = renaming([], true);
      const first = await chatty(dir, agent);
      await send(first.client, LIVE, 't1', 'first');
      await new Promise((tick) => { setTimeout(tick, 5); });

      const second = await hostAt(dir, { ...agent, list: async () => [], find: async () => undefined });
      const rows = await second.client.handle({ method: 'listSessions', params: { channel: 'ahp-root://' } }) as {
        items: { resource: string }[];
      };
      expect(rows.items).toEqual([]);
      await expect(opened(second.client, LIVE)).rejects.toMatchObject({ message: `No agent for session ${LIVE}` });
    }
    finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('opens and continues the original chats before listing when the first backend id was minted', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ahpd-chats-'));
    try {
      const dir = join(root, 'sessions');
      const starts: Start[] = [];
      const agent = renaming(starts, true);
      const first = await chatty(dir, agent);
      await send(first.client, LIVE, 't1', 'first');
      await send(first.client, PEER, 't2', 'second');
      await new Promise((tick) => { setTimeout(tick, 5); });

      const second = await hostAt(dir, agent);
      expect(said(await opened(second.client, chatUriFor(LIVE)))).toEqual(['first']);
      expect(said(await opened(second.client, PEER))).toEqual(['second']);
      const session = await opened(second.client, LIVE);
      expect(session.state.defaultChat).toBe(chatUriFor(LIVE));
      expect(listed(session)).toEqual([chatUriFor(LIVE), PEER]);
      const before = starts.length;
      await send(second.client, chatUriFor(LIVE), 't3', 'again');
      await send(second.client, PEER, 't4', 'also again');
      expect(resuming(starts.slice(before))).toEqual([
        { chatId: undefined, resume: 'live-minted', first: 'first' },
        { chatId: `${UUID}-minted`, resume: `${UUID}-minted`, first: 'second' },
      ]);
      expect(said(await opened(second.client, chatUriFor(LIVE)))).toEqual(['first', 'again']);
      expect(said(await opened(second.client, PEER))).toEqual(['second', 'also again']);
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

  /*
   * A row's time moves forward only, so a chat closed takes nothing back with
   * it, as VS Code's host rolls a session's chats into the session's catalogue
   * timestamp only where they are later.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentHostStateManager.ts#L3325-L3332
   */
  it('keeps the time a closed chat brought its session to', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ahpd-chats-'));
    try {
      const { client, p } = await chatty(join(root, 'sessions'), backend([]));
      await send(client, LIVE, 't0', 'here');
      await flushed();
      await send(client, PEER, 't1', 'over here');
      await flushed();
      const rowAt = async (): Promise<string | undefined> => ((await client.handle({ method: 'listSessions', params: { channel: 'ahp-root://' } })) as {
        items: { resource: string; modifiedAt: string }[];
      }).items.find((one) => one.resource === LIVE)?.modifiedAt;
      const held = await rowAt();
      expect(held).toBeDefined();
      const since = p.notes.length;

      expect(await client.handle({ method: 'disposeChat', params: { channel: PEER } })).toBeNull();
      await settle();
      await flushed();

      expect(await rowAt()).toBe(held);
      expect(p.notes.slice(since)
        .filter((n) => n.method === 'root/sessionSummaryChanged')
        .map((n) => (n.params as { changes: { modifiedAt?: string } }).changes.modifiedAt)
        .filter((one) => one !== undefined)).toEqual([]);
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
      // And the provider, which running a session records: a session this
      // host ran is no external one.
      seeding.setProvider('inner', 'echo');
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
   * Moving chats is VS Code's `chatMoves.enabled`, off until a window turns it
   * on: while it is off a chat is offered no move and a move is refused
   * `disabled` in VS Code's words, and turning it on offers the move.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/common/agentHostChatMove.ts#L21-L27
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/common/agentHostChatMove.ts#L62-L67
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentService.ts#L7892-L7896
   */
  it('offers and makes no move while moving chats is off, as VS Code\'s host', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ahpd-chats-'));
    try {
      const host = createHost({ path: DIR, agents: [backend([])], ...machine(), sessions: fileSessions({ dir: join(root, 'sessions') }) });
      const p = peer();
      p.request = async () => ({ trusted: true });
      const client = host.accept(p);
      await client.handle(hello(['0.9.0'], { initialSubscriptions: ['ahp-root://'] }));
      await client.handle({ method: 'createSession', params: { channel: LIVE, provider: 'echo' } });
      await client.handle({ method: 'createChat', params: { channel: LIVE, chat: PEER } });
      await settle();
      await firstTurn(client, PEER, 't0');
      expect((await opened(client, PEER)).state.movable).toBeUndefined();
      await expect(client.handle({ method: 'moveChat', params: { channel: PEER, destination: { kind: 'newSession' } } }))
        .rejects.toMatchObject({ code: -32602, message: 'Moving chats is not enabled.', data: { reason: 'disabled' } });

      await client.handle({
        method: 'dispatchAction',
        params: { channel: 'ahp-root://', action: { type: 'root/configChanged', config: { 'chatMoves.enabled': true } } },
      });
      await settle();
      expect((await opened(client, PEER)).state.movable).toBe(true);
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
      await firstTurn(client, PEER, 't0');
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

  /*
   * A chat with no turn yet is no chat a move is made of, and the end of its
   * first turn makes it one, said on the chat and on its row where the answer
   * differs from what they hold, as VS Code's host says a chat's `movable`.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/common/agentHostChatMove.ts#L69-L83
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentHostStateManager.ts#L2147-L2160
   */
  it('offers no move for a peer chat before its first turn, and says it movable once that turn ends', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ahpd-chats-'));
    try {
      const { client, p } = await chatty(join(root, 'sessions'), backend([]));
      expect((await opened(client, PEER)).state.movable).toBeUndefined();
      expect((await opened(client, LIVE)).state.chats?.find((one) => one.resource === PEER)).not.toHaveProperty('movable');
      await firstTurn(client, PEER, 't0');
      expect(moves(p, PEER)).toEqual([true]);
      expect(actions(p, LIVE).filter((e) => e.action.type === 'session/chatUpdated' && e.action.chat === PEER)
        .map((e) => (e.action.changes as { movable?: boolean }).movable).filter((one) => one !== undefined)).toEqual([true]);
    }
    finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  /*
   * An archived session's chats are not offered a move and a move out of it is
   * refused in VS Code's words, and unarchiving it offers the move again.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentService.ts#L9505-L9509
   */
  it('offers no move while its session is archived, refuses one in VS Code\'s words, and offers it again unarchived', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ahpd-chats-'));
    try {
      const { client, p } = await apart(join(root, 'sessions'), backend([]));
      await firstTurn(client, PEER, 't0');
      p.notes.length = 0;
      const archive = async (isArchived: boolean): Promise<void> => {
        await client.handle({ method: 'dispatchAction', params: { channel: LIVE, action: { type: 'session/isArchivedChanged', isArchived } } });
        await settle(8);
      };
      await archive(true);
      expect(moves(p, PEER)).toEqual([false]);
      await expect(client.handle({ method: 'moveChat', params: { channel: PEER, destination: { kind: 'session', session: TWO } } }))
        .rejects.toMatchObject({ code: -32602, message: expect.stringMatching(/^Session \S+ is archived\.$/), data: { reason: 'sessionArchived' } });
      await archive(false);
      expect(moves(p, PEER)).toEqual([false, true]);
    }
    finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('takes the move away for the length of a turn, and gives it back after', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ahpd-chats-'));
    try {
      const { client, p } = await chatty(join(root, 'sessions'), backend([]));
      await firstTurn(client, PEER, 't0');
      p.notes.length = 0;
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
      await firstTurn(client, PEER, 't0');
      p.notes.length = 0;
      expect((await opened(client, PEER)).state.movable).toBe(true);

      // A worker, opened by the backend on the start the host handed it. A move
      // takes a chat's workers with it, so one running a turn is the chat's own
      // delay.
      const worker = starts.at(-1)?.subagent?.('toolu_task', { title: 'Explore', prompt: 'list the files' });
      await settle();
      // What `chat/movableChanged` left it, as every client that watched it.
      expect((await opened(client, PEER)).state.movable).toBe(false);
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
      await firstTurn(client, THIRD, 't0');
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
      expect(order[3]).toBe(worker?.uri);
      expect(reorders(p, LIVE)).toEqual([order]);

      /*
       * And the answer names the session the chat is in, under the name this
       * host publishes it as rather than the alias this client asked with.
       *
       * That is where a client that asked for a move between sessions reads the
       * one it landed in, so it has to be a name the host answers about - the
       * same one a catalogue row offers.
       */
      expect(answer.session).toBe('ahp-session:/live');
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
      await firstTurn(client, PEER, 't0');
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
      await firstTurn(client, PEER, 't0');
      const first = (await opened(client, LIVE)).state.defaultChat as string;
      const before = listed(await opened(client, LIVE));
      const ask = (channel: string, destination: unknown) =>
        client.handle({ method: 'moveChat', params: { channel, destination } });

      // The chat the session hands out, which the protocol says MUST NOT move.
      // Each refusal is VS Code's: its words, and its reason in `data`.
      // https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/common/agentHostChatMove.ts#L90-L144
      await expect(ask(first, { kind: 'session', session: LIVE }))
        .rejects.toMatchObject({ code: -32602, message: `Chat ${first} can't be moved.`, data: { reason: 'notMovable' } });
      // A chat with no turn yet, of which nothing exists beyond its composer,
      // whether it is reordered or made a session of its own.
      // https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentService.ts#L8150-L8176
      await expect(ask(THIRD, { kind: 'session', session: LIVE }))
        .rejects.toMatchObject({ message: `Chat ${THIRD} has no turns yet; send a message before moving it.`, data: { reason: 'notStarted' } });
      await expect(ask(THIRD, { kind: 'newSession' }))
        .rejects.toMatchObject({ message: `Chat ${THIRD} has no turns yet; send a message before moving it to its own session.`, data: { reason: 'notStarted' } });
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
        .rejects.toMatchObject({ message: 'Session ahp-session:/elsewhere is not available.', data: { reason: 'destinationNotFound' } });
      // Itself as its own anchor, and an anchor this session does not hold.
      await expect(ask(PEER, { kind: 'session', session: LIVE, after: PEER }))
        .rejects.toMatchObject({ message: 'A chat can\'t be placed after itself.', data: { reason: 'invalidAnchor' } });
      await expect(ask(PEER, { kind: 'session', session: LIVE, after: 'ahp-chat:/nowhere' }))
        .rejects.toMatchObject({ message: `Chat ahp-chat:/nowhere is not a visible chat of ${LIVE}.`, data: { reason: 'invalidAnchor' } });

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

  /*
   * A chat of a workspace-less session works in the session's scratch folder,
   * which its default chat, staying, works in too: it is offered no move and
   * a move is refused, in VS Code's reason and words.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentService.ts#L9526-L9528
   */
  it('refuses a move of a chat working in its session\'s scratch folder, which the default chat shares', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ahpd-chats-'));
    vi.stubEnv('HOME', root);
    vi.stubEnv('USERPROFILE', root);
    try {
      const { client } = await hostAt(join(root, 'sessions'), backend([]), { workspacelessFolder: 'scratch' });
      await client.handle({ method: 'createSession', params: { channel: LIVE, provider: 'echo' } });
      await client.handle({ method: 'createChat', params: { channel: LIVE, chat: PEER } });
      await settle();
      await opened(client, LIVE);
      await firstTurn(client, PEER, 't0');
      expect((await opened(client, PEER)).state.movable).toBeUndefined();
      await expect(client.handle({ method: 'moveChat', params: { channel: PEER, destination: { kind: 'newSession' } } }))
        .rejects.toMatchObject({
          code: -32602,
          message: `Chat ${PEER} works in a scratch folder that another chat of ${LIVE} also uses.`,
          data: { reason: 'workspaceless' },
        });
    }
    finally {
      vi.unstubAllEnvs();
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
        params: { channel: THIRD, action: { type: 'chat/turnStarted', turnId: 't1', startedAt: new Date().toISOString(), message: { origin: { kind: 'user' }, text: 'hold on now' } } },
      });
      await settle();

      await expect(client.handle({
        method: 'moveChat',
        params: { channel: THIRD, destination: { kind: 'session', session: LIVE } },
      })).rejects.toThrow(/can't be moved/);
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
      const session = await opened(second.client, 'ahp-session:/live');
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
  /*
   * An unread chat that counts toward its session's read state takes the
   * unread with it: the destination is unread, and the source, its other
   * chats read, is read, as VS Code synchronizes them after a move.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentHostStateManager.ts#L2131-L2145
   */
  it('carries an unread chat\'s unread to the session it moves to, and leaves its source read', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ahpd-chats-'));
    try {
      const { client } = await apart(join(root, 'sessions'), backend([]));
      await firstTurn(client, PEER, 't0');
      const mark = async (channel: string, action: Record<string, unknown>) => {
        await client.handle({ method: 'dispatchAction', params: { channel, action } });
        await settle(8);
      };
      const lead = (await opened(client, LIVE)).state.defaultChat as string;
      await mark(lead, { type: 'chat/isReadChanged', isRead: true });
      await mark(PEER, { type: 'chat/isReadChanged', isRead: false });
      // The destination's default chat read, as a new session's starts unread,
      // which reads the destination, its other chat read already.
      await mark((await opened(client, TWO)).state.defaultChat as string, { type: 'chat/isReadChanged', isRead: true });
      const read = async (channel: string): Promise<boolean> =>
        (Number(((await opened(client, channel)).state as { status?: number }).status) & 32) !== 0;
      expect(await read(LIVE)).toBe(false);
      expect(await read(TWO)).toBe(true);

      await client.handle({ method: 'moveChat', params: { channel: PEER, destination: { kind: 'session', session: TWO } } });
      await settle(8);
      expect(await read(TWO)).toBe(false);
      expect(await read(LIVE)).toBe(true);
    }
    finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('makes a fork from its source alone, taking none of the folders it is asked for, as VS Code\'s host makes one', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ahpd-chats-'));
    try {
      const starts: Start[] = [];
      const agent = backend(starts);
      const { client } = await apart(join(root, 'sessions'), { ...agent, chats: { ...agent.chats, fork: true } }, [EXTRA, MORE]);
      await send(client, PEER, 't1', 'over here');
      const before = starts.length;
      // https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/protocolServerHandler.ts#L2302-L2310
      await client.handle({
        method: 'createChat',
        params: {
          channel: LIVE, chat: 'ahp-chat:/forked', source: { kind: 'fork', chat: PEER, turnId: 't1' },
          workingDirectories: [`file://${DIR}`, `file://${EXTRA}`],
        },
      });
      await settle(20);
      expect(starts.slice(before).map((one) => one.additional)).toEqual([[EXTRA, MORE]]);
    }
    finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('moves a chat into another session, with its turns and its own folders', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ahpd-chats-'));
    try {
      const starts: Start[] = [];
      /*
       * Folders for the chat to work in beside its session's first.
       *
       * What travels is the chat's own set: one moved beside a session working
       * somewhere else goes on where it was, with every folder it had.
       */
      const { client, p } = await apart(join(root, 'sessions'), backend(starts), [EXTRA, MORE]);
      // The destination's first message, which announces it, so its row moves
      // are said, and then the chat's newer one.
      await send(client, TWO, 'w1', 'over there');
      await send(client, PEER, 't1', 'over here');
      // Each row's moves said before the next, past the catalogue's debounce.
      await flushed();
      const before = starts.length;
      const lead = (await opened(client, TWO)).state.defaultChat as string;
      // The source's row as it stands with the chat in it, which a client
      // listing the sessions holds.
      const held = ((await client.handle({ method: 'listSessions', params: { channel: 'ahp-root://' } })) as {
        items: { resource: string; modifiedAt: string }[];
      }).items.find((one) => one.resource === LIVE)?.modifiedAt as string;
      const since = p.notes.length;

      const answer = await client.handle({
        method: 'moveChat',
        params: { channel: PEER, destination: { kind: 'session', session: TWO, after: TAIL } },
      }) as { session: string };
      await settle(20);
      await flushed();

      /*
       * No start: the chat's runtime goes on under the session it was
       * launched for until its next turn boundary, as VS Code's move keeps a
       * chat's runtime and relaunches it there.
       * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/AGENTS.md#L374
       */
      expect(starts.slice(before)).toEqual([]);
      // The session it landed in, published under a name a client can ask about.
      expect(answer.session).toBe('ahp-session:/two');

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
       * A row's time is the latest its chats have brought it to, and it moves
       * forward only, as VS Code's host rolls a session's chats into the
       * session's catalogue timestamp only where they are later: the chat
       * arriving moves the destination's row to its own newer time, and the
       * source's row keeps the time the chat brought it to.
       * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentHostStateManager.ts#L3325-L3332
       */
      // Each change carries the fields that moved, so the times the move said
      // are the changes after it that carried one.
      const rows = p.notes.slice(since)
        .filter((n) => n.method === 'root/sessionSummaryChanged')
        .map((n) => n.params as { session: string; changes: { modifiedAt?: string } })
        .filter((one) => one.changes.modifiedAt !== undefined);
      expect(rows.filter((one) => one.session === TWO).at(-1)?.changes.modifiedAt).toBe(held);
      expect(rows.filter((one) => one.session === LIVE)).toEqual([]);
      const after = ((await client.handle({ method: 'listSessions', params: { channel: 'ahp-root://' } })) as {
        items: { resource: string; modifiedAt: string }[];
      }).items;
      expect(after.find((one) => one.resource === LIVE)?.modifiedAt).toBe(held);
      expect(after.find((one) => one.resource === TWO)?.modifiedAt).toBe(held);

      // Its turns came with it, and it goes on from there.
      expect(said(await opened(client, PEER))).toEqual(['over here']);
      await send(client, PEER, 't2', 'and again');
      expect(said(await opened(client, PEER))).toEqual(['over here', 'and again']);
      /*
       * Its next turn is where it starts again, and it is the one start: the
       * destination resumes the conversation the backend kept under the
       * chat's own name, seeded with the turns it had, in the folders it was
       * working in.
       */
      expect(resuming(starts.slice(before))).toEqual([{ chatId: UUID, resume: UUID, first: 'over here' }]);
      const mine = starts.at(-1) as Start;
      expect(mine.uri).toBe('ahp-session:/two');
      expect(mine.workingDirectory).toBe(DIR);
      expect(mine.additional).toEqual([EXTRA, MORE]);
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
      await firstTurn(client, PEER, 't0');
      // A worker on the chat that is about to move, which is a chat of the
      // session that is not one a client opened.
      const worker = starts.find((one) => one.chatId === UUID)
        ?.subagent?.('toolu_task', { title: 'Explore', prompt: 'list the files' });
      await settle();
      expect(worker).toBeDefined();
      // The one name the host minted for the worker, from the root chat and the
      // call, which every client holds.
      const called = String(worker?.uri);
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
      expect(actions(p, LIVE).some((e) => e.action.type === 'session/chatRemoved' && e.action.chat === called)).toBe(true);
      // And it still answers for itself, where its records now hold it.
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
      await client.handle({
        method: 'dispatchAction',
        params: { channel: 'ahp-root://', action: { type: 'root/configChanged', config: { 'chatMoves.enabled': true } } },
      });
      await client.handle({ method: 'createSession', params: { channel: LIVE, provider: 'echo' } });
      await client.handle({ method: 'createChat', params: { channel: LIVE, chat: PEER } });
      await client.handle({ method: 'createSession', params: { channel: OTHERS, provider: 'claude' } });
      await client.handle({
        method: 'createSession',
        params: { channel: ONBOX, provider: 'echo', config: { computer: 'computer://box' } },
      });
      await settle(20);
      await opened(client, LIVE);
      await firstTurn(client, PEER, 't0');
      const before = starts.length;

      await expect(client.handle({
        method: 'moveChat',
        params: { channel: PEER, destination: { kind: 'session', session: OTHERS } },
      })).rejects.toMatchObject({
        message: 'Chats can only move between sessions of the same agent. Turn on chats with their own agents to move it to a session of another agent.',
        data: { reason: 'differentProvider' },
      });
      await expect(client.handle({
        method: 'moveChat',
        params: { channel: PEER, destination: { kind: 'session', session: ONBOX } },
      })).rejects.toMatchObject({ message: expect.stringMatching(/between computers is not supported yet/), data: { reason: 'unsupported' } });
      await expect(client.handle({
        method: 'moveChat',
        params: { channel: PEER, destination: { kind: 'session', session: 'ahp-session:/nowhere' } },
      })).rejects.toMatchObject({ message: 'Session ahp-session:/nowhere is not available.', data: { reason: 'destinationNotFound' } });

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

  /*
   * A move starts nothing: the chat's runtime goes on until its next turn
   * boundary relaunches it under the destination, as VS Code moves only
   * ownership, so a destination whose backend will not start the chat takes
   * the move, and the relaunch failing ends the turn that waited on it.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/AGENTS.md#L374
   */
  it('moves a chat to a session whose backend will not start it, and ends its next turn in that start\'s failure', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ahpd-chats-'));
    try {
      const starts: Start[] = [];
      const base = backend(starts);
      // A destination that will not take the conversation: the host asks it to
      // start the chat, and it says no.
      const refusing: Agent = {
        ...base,
        create: (start: Start): Session => {
          if (start.chatUri === PEER && start.uri === 'ahp-session:/two')
            throw new Error('this backend will not work there');
          return startedNow(base.create(start));
        },
      };
      const { client, p } = await apart(join(root, 'sessions'), refusing);
      await send(client, PEER, 't1', 'over here');

      await expect(client.handle({
        method: 'moveChat',
        params: { channel: PEER, destination: { kind: 'session', session: TWO } },
      })).resolves.toEqual({ session: TWO });
      await settle(20);
      const there = await opened(client, TWO);
      expect(listed(there)).toContain(PEER);

      // Its next turn is where it starts again under the destination, which
      // refuses it, and the turn ends in that failure.
      await send(client, PEER, 't2', 'and again');
      await settle(20);
      const ended = actions(p, PEER).filter((e) => e.action.type === 'chat/error' && e.action.turnId === 't2');
      expect(JSON.stringify(ended.map((e) => e.action.part))).toContain('will not work there');
    }
    finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('announces a session made for a moved chat once the chat has left its source, ready with the chat, as VS Code\'s host promotes one', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ahpd-chats-'));
    try {
      const first = await chatty(join(root, 'sessions'), backend([]));
      await send(first.client, PEER, 't1', 'over here');
      const outgoing = (await opened(first.client, LIVE)).state.defaultChat as string;
      await send(first.client, outgoing, 't0', 'the one it leaves');
      const from = first.p.notes.length;
      const answer = await first.client.handle({
        method: 'moveChat',
        params: { channel: PEER, destination: { kind: 'newSession' } },
      }) as { session: string };
      await settle(20);
      const told = first.p.notes.slice(from);
      const removedAt = told.findIndex((one) => one.method === 'action'
        && (one.params as Bag).channel === LIVE && ((one.params as Bag).action as Bag).type === 'session/chatRemoved');
      const addedAt = told.findIndex((one) => one.method === 'root/sessionAdded'
        && ((one.params as Bag).summary as Bag).resource === answer.session);
      expect(removedAt).toBeGreaterThanOrEqual(0);
      expect(addedAt).toBeGreaterThan(removedAt);
      // Nothing said on the new session itself: it is made ready, holding the chat.
      expect(told.filter((one) => one.method === 'action' && (one.params as Bag).channel === answer.session)
        .map((one) => ((one.params as Bag).action as Bag).type)).toEqual([]);
      const there = await opened(first.client, answer.session);
      expect((there.state as { lifecycle?: string }).lifecycle ?? 'ready').toBe('ready');
      expect(listed(there)).toEqual([PEER]);
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
      expect(answer.session).toBe(`ahp-session:/${UUID}`);
      // The chat's runtime goes on until its next turn boundary, as VS Code's
      // move keeps a chat's runtime and relaunches it there.
      expect(starts.slice(before)).toEqual([]);

      const there = await opened(first.client, answer.session);
      expect(there.state.defaultChat).toBe(PEER);
      expect(listed(there)).toEqual([PEER]);
      /*
       * The one chat a session has is the one a client gets when it names none,
       * and the protocol says that chat MUST NOT move. So the chat that could
       * be moved a moment ago cannot be now, and the client is told.
       */
      expect(moves(first.p, PEER).at(-1)).toBe(false);
      expect((await opened(first.client, PEER)).state.movable).toBe(false);
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
      expect(rows.items.map((one) => one.resource).sort()).toEqual([`ahp-session:/${UUID}`, 'ahp-session:/live']);
      const after = await opened(second.client, `ahp-session:/${UUID}`);
      expect(after.state.defaultChat).toBe(PEER);
      expect(listed(after)).toEqual([PEER]);
      expect(said(await opened(second.client, PEER))).toEqual(['over here']);
      // And the session it came back with is itself, not a chat of another one.
      const backAgain = await opened(second.client, 'ahp-session:/live');
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

/*
 * A chat of a session may run on another backend than the session does.
 *
 * A session is one harness; a chat of it is a conversation, and which harness
 * wrote that conversation is the chat's. What these cases check is that every
 * road which starts a chat again - a session restart, a chat restart, a rewind
 * and a daemon coming back - starts it on the backend it ran on, with that
 * backend's config, and that the session's own keys do not reach it.
 *
 * The seam that opens a chat on another backend is another task's, so these
 * begin where such a chat is already recorded: its row is written the way one
 * leaves it, and the host that restores the session is what starts it there.
 */
/*
 * A chat renamed on its own channel, as the reference host renames one: the
 * client's action goes out on that channel, then the chat's held title and
 * its row in the session move together, and a default chat renames its
 * session after its row.
 * https://github.com/microsoft/vscode/blob/37eba0937fdca3097d4bb88e870abf3fc70dbde0/src/vs/platform/agentHost/node/chatContributions/sessionTitle/sessionTitleContribution.ts#L53-L72
 * https://github.com/microsoft/vscode/blob/37eba0937fdca3097d4bb88e870abf3fc70dbde0/src/vs/platform/agentHost/node/agentHostStateManager.ts#L2316-L2331
 */
describe('a chat renamed on its own channel', () => {
  const titled = (p: ReturnType<typeof peer>) => actions(p)
    .filter((e) => e.action.type === 'session/titleChanged' || e.action.type === 'session/chatUpdated')
    .map((e) => [e.channel, e.action, e.origin]);

  it('answers a peer chat\'s rename there, and the chat keeps its new title past its next turn', async () => {
    const { client, peer: p, uri } = await running();
    const second = 'ahp-chat:/second';
    await client.handle({ method: 'createChat', params: { channel: uri, chat: second } });
    await client.handle({ method: 'subscribe', params: { channel: second } });
    p.notes.length = 0;

    client.handle({ method: 'dispatchAction', params: { channel: second, clientSeq: 4, action: { type: 'session/titleChanged', title: 'Renamed' } } });
    await settle();
    expect(titled(p)).toEqual([
      [second, { type: 'session/titleChanged', title: 'Renamed' }, { clientId: 'probe', clientSeq: 4 }],
      [uri, { type: 'session/chatUpdated', chat: second, changes: { title: 'Renamed' } }, undefined],
    ]);

    client.handle({ method: 'dispatchAction', params: { channel: second, action: { type: 'chat/turnStarted', turnId: 's1', startedAt: new Date().toISOString(), message: { origin: { kind: 'user' }, text: 'go' } } } });
    await settle();
    await emit({ type: 'result', subtype: 'success', is_error: false, duration_ms: 4 });
    const session = await client.handle({ method: 'subscribe', params: { channel: uri } }) as {
      snapshot: { state: { chats: { resource: string; title: string }[] } };
    };
    expect(session.snapshot.state.chats.find((one) => one.resource === second)?.title).toBe('Renamed');
    const own = await client.handle({ method: 'subscribe', params: { channel: second } }) as { snapshot: { state: { title: string } } };
    expect(own.snapshot.state.title).toBe('Renamed');
  });

  /*
   * VS Code's host takes a rename as its client sent it, a blank title and
   * one with spaces around it included.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/chatContributions/sessionTitle/sessionTitleContribution.ts#L53-L78
   */
  it('takes a blank title and an untrimmed one as they were sent', async () => {
    const { client, peer: p, uri } = await running();
    const second = 'ahp-chat:/second';
    await client.handle({ method: 'createChat', params: { channel: uri, chat: second } });
    await client.handle({ method: 'subscribe', params: { channel: second } });
    p.notes.length = 0;

    client.handle({ method: 'dispatchAction', params: { channel: second, clientSeq: 6, action: { type: 'session/titleChanged', title: '' } } });
    client.handle({ method: 'dispatchAction', params: { channel: second, clientSeq: 7, action: { type: 'session/titleChanged', title: '  Spaced  ' } } });
    await settle();
    expect(titled(p)).toEqual([
      [second, { type: 'session/titleChanged', title: '' }, { clientId: 'probe', clientSeq: 6 }],
      [uri, { type: 'session/chatUpdated', chat: second, changes: { title: '' } }, undefined],
      [second, { type: 'session/titleChanged', title: '  Spaced  ' }, { clientId: 'probe', clientSeq: 7 }],
      [uri, { type: 'session/chatUpdated', chat: second, changes: { title: '  Spaced  ' } }, undefined],
    ]);
  });

  it('renames a default chat on its channel in its row, then its session', async () => {
    const { client, peer: p, uri, chatUri } = await running();
    p.notes.length = 0;

    client.handle({ method: 'dispatchAction', params: { channel: chatUri, clientSeq: 5, action: { type: 'session/titleChanged', title: 'Main' } } });
    await settle();
    expect(titled(p)).toEqual([
      [chatUri, { type: 'session/titleChanged', title: 'Main' }, { clientId: 'probe', clientSeq: 5 }],
      [uri, { type: 'session/chatUpdated', chat: chatUri, changes: { title: 'Main' } }, undefined],
      [uri, { type: 'session/titleChanged', title: 'Main' }, undefined],
    ]);
    const session = await client.handle({ method: 'subscribe', params: { channel: uri } }) as {
      snapshot: { state: { title: string; chats: { resource: string; title: string }[] } };
    };
    expect(session.snapshot.state.title).toBe('Main');
    expect(session.snapshot.state.chats.find((one) => one.resource === chatUri)?.title).toBe('Main');
  });
});

/*
 * A session renamed on its own channel, as the reference host renames one: the
 * client's action goes out on the session's channel, and a session that counts
 * one chat has that chat's held title and its row moved after it. A session
 * with a peer chat keeps its default chat's title.
 * https://github.com/microsoft/vscode/blob/a12547442f722dfe0a6ec105f986cfe65b8d6f22/src/vs/platform/agentHost/node/chatContributions/sessionTitle/sessionTitleContribution.ts#L74-L100
 */
describe('a session renamed on its own channel', () => {
  const titled = (p: ReturnType<typeof peer>) => actions(p)
    .filter((e) => e.action.type === 'session/titleChanged' || e.action.type === 'session/chatUpdated')
    .map((e) => [e.channel, e.action, e.origin]);
  type Opened = { snapshot: { state: { title: string; chats: { resource: string; title: string }[] } } };

  it('retitles the default chat of a session with one chat, and the chat keeps the title past its next turn', async () => {
    const { client, peer: p, uri, chatUri } = await running();
    p.notes.length = 0;

    client.handle({ method: 'dispatchAction', params: { channel: uri, clientSeq: 6, action: { type: 'session/titleChanged', title: 'Whole' } } });
    await settle();
    expect(titled(p)).toEqual([
      [uri, { type: 'session/titleChanged', title: 'Whole' }, { clientId: 'probe', clientSeq: 6 }],
      [uri, { type: 'session/chatUpdated', chat: chatUri, changes: { title: 'Whole' } }, undefined],
    ]);

    client.handle({ method: 'dispatchAction', params: { channel: chatUri, action: { type: 'chat/turnStarted', turnId: 'w1', startedAt: new Date().toISOString(), message: { origin: { kind: 'user' }, text: 'go' } } } });
    await settle();
    await emit({ type: 'result', subtype: 'success', is_error: false, duration_ms: 4 });
    const session = await client.handle({ method: 'subscribe', params: { channel: uri } }) as Opened;
    expect(session.snapshot.state.title).toBe('Whole');
    expect(session.snapshot.state.chats.find((one) => one.resource === chatUri)?.title).toBe('Whole');
    const own = await client.handle({ method: 'subscribe', params: { channel: chatUri } }) as { snapshot: { state: { title: string } } };
    expect(own.snapshot.state.title).toBe('Whole');
  });

  it('keeps the default chat\'s title in a session with a peer chat', async () => {
    const { client, peer: p, uri, chatUri } = await running();
    await client.handle({ method: 'createChat', params: { channel: uri, chat: 'ahp-chat:/second' } });
    const before = await client.handle({ method: 'subscribe', params: { channel: uri } }) as Opened;
    const kept = before.snapshot.state.chats.find((one) => one.resource === chatUri)?.title;
    p.notes.length = 0;

    client.handle({ method: 'dispatchAction', params: { channel: uri, clientSeq: 7, action: { type: 'session/titleChanged', title: 'Whole' } } });
    await settle();
    expect(titled(p)).toEqual([
      [uri, { type: 'session/titleChanged', title: 'Whole' }, { clientId: 'probe', clientSeq: 7 }],
    ]);
    const session = await client.handle({ method: 'subscribe', params: { channel: uri } }) as Opened;
    expect(session.snapshot.state.title).toBe('Whole');
    expect(session.snapshot.state.chats.find((one) => one.resource === chatUri)?.title).toBe(kept);
  });
});

describe('a chat of another backend', () => {
  const DIR = '/home/softov';
  const LIVE = 'ahp-session:/live';
  // The name this host calls the session once a backend has it: the client's
  // alias is a spelling, and the row, the logs and the refusals use this one.
  const SESSION = 'ahp-session:/live';
  const TWO = 'ahp-session:/two';
  const THIRD = 'ahp-chat:/third';
  const UUID = '0f8fad5b-d9cb-469f-a165-70867728950e';
  const PEER = `ahp-chat:/${UUID}`;
  const EXTRA = `${DIR}/extra`;

  /** The turn the peer chat already had on the backend that wrote it. */
  const SECOND = [
    { uuid: 'u1', message: { role: 'user', content: 'second', text: 'second' } },
  ] as Bag[] as WireTurn<Turn>[];

  /**
   * The example backend, under a name of its own.
   *
   * `voice` is declared as the session's rather than a chat's, which is what
   * makes it a key a fan-out would push at every chat of the session. And
   * `endPoint` names the last entry a turn left, without which this host
   * refuses a rewind as one it has no point to cut at.
   */
  const backend = (provider: string, starts: Start[], told?: string[]): Agent => {
    const base = echo({ path: DIR, pace: 0 });
    const schema = base.schema();
    return {
      ...base,
      provider,
      multipleDirectories: true,
      /*
       * What this backend reads back for the peer chat.
       *
       * The first host runs that chat on `one`; the store says it is `two`'s,
       * so what `two` finds under its id is the conversation it wrote - the
       * turn the chat already had, before the one this host adds.
       */
      transcript: async (id: string) => (id === UUID ? SECOND : base.transcript?.(id)),
      schema: () => {
        const properties = { ...(schema.properties as Record<string, Record<string, unknown>>) };
        properties.voice = { ...properties.voice, scope: 'session' };
        return { ...schema, properties };
      },
      create: (start: Start): Session => {
        starts.push(start);
        const session = base.create(start.chatId === undefined ? start : { ...start, resume: start.chatId });
        return {
          ...session,
          ...(told === undefined ? {} : {
            setConfig: (key: string, value: unknown): true => {
              told.push(`${provider}:${key}=${String(value)}`);
              return true;
            },
          }),
          endPoint: (turnId: string) => `${turnId}-end`,
        };
      },
    };
  };

  /**
   * A host serving these backends over one store, and a client whose window
   * trusts and moves chats.
   */
  const hostAt = async (agents: Agent[], store: ReturnType<typeof memorySessions>, over: Partial<HostOptions> = {}) => {
    const host = createHost({ path: DIR, agents, ...machine(), sessions: store, ...over });
    const p = peer();
    p.request = async () => ({ trusted: true });
    const client = host.accept(p);
    await client.handle(hello(['0.9.0'], { initialSubscriptions: ['ahp-root://'] }));
    await client.handle({
      method: 'dispatchAction',
      params: { channel: 'ahp-root://', action: { type: 'root/configChanged', config: { 'chatMoves.enabled': true } } },
    });
    return { host, client, p };
  };

  const send = async (
    client: { handle(request: unknown): Promise<unknown> },
    channel: string,
    turnId: string,
    text: string,
  ): Promise<void> => {
    // A message for a session as a whole goes to its default chat, which a
    // client reads off the session: a chat's action travels on a chat's channel.
    const chat = channel.startsWith('ahp-session:')
      ? String((await client.handle({ method: 'subscribe', params: { channel } }) as { snapshot: { state: { defaultChat?: string } } }).snapshot.state.defaultChat)
      : channel;
    void client.handle({
      method: 'dispatchAction',
      params: { channel: chat, action: { type: 'chat/turnStarted', turnId, startedAt: new Date().toISOString(), message: { text, origin: { kind: 'user' } } } },
    });
    await settle(8);
  };

  interface Read {
    state: {
      resource: string;
      defaultChat?: string;
      chats?: { resource: string; movable?: boolean }[];
      turns: { message?: { text?: string } }[];
    };
  }

  const opened = async (client: { handle(request: unknown): Promise<unknown> }, channel: string) =>
    (await client.handle({ method: 'subscribe', params: { channel } }) as { snapshot: Read }).snapshot;

  /** What each start was told it was resuming, and what it was seeded with. */
  const resuming = (starts: Start[]) => starts.map((one) => ({
    chatId: one.chatId,
    resume: one.resume,
    first: (one.seed?.[0] as unknown as { message?: { text?: string } } | undefined)?.message?.text,
  }));

  /**
   * A session on `one` with a peer chat the store says runs on `two`.
   *
   * The row is written after both chats have spoken, because a chat's backend
   * id is recorded when it does, and a start resumes by that id. What is left
   * is a store ready for the host that comes back: the session's own, with one
   * chat of another.
   */
  const recorded = async (one: Agent, two: Agent) => {
    const store = memorySessions();
    const first = await hostAt([one, two], store);
    await first.client.handle({ method: 'createSession', params: { channel: LIVE, provider: one.provider } });
    await first.client.handle({ method: 'createChat', params: { channel: LIVE, chat: PEER } });
    await settle();
    await send(first.client, LIVE, 't1', 'first');
    await send(first.client, PEER, 't2', 'second');
    const id = idOf(LIVE);
    store.setChats(id, store.chats(id).map((chat) => (chat.uri === PEER
      ? { ...chat, provider: two.provider, config: { voice: 'shouty' } }
      : chat)));
    return store;
  };

  /** The same, and the host that came back, listed and ready to answer. */
  const opening = async (one: Agent, two: Agent) => {
    const store = await recorded(one, two);
    const second = await hostAt([one, two], store);
    await second.client.handle({ method: 'listSessions', params: { channel: 'ahp-root://' } });
    return { store, second };
  };

  it('starts a chat of another backend on that backend after a daemon restart, and again when the session restarts', async () => {
    const startsOne: Start[] = [];
    const startsTwo: Start[] = [];
    const { second } = await opening(backend('one', startsOne), backend('two', startsTwo));

    // The turn that brings the session back, and the chat with it.
    const beganOne = startsOne.length;
    await send(second.client, PEER, 't3', 'third');
    expect(resuming(startsTwo)).toEqual([{ chatId: UUID, resume: UUID, first: 'second' }]);
    // The config the row recorded, which is the one it ran on.
    expect(startsTwo.at(-1)?.settings).toMatchObject({ voice: 'shouty' });
    // And the session's own chat did not come up on that backend.
    expect(startsOne.slice(beganOne).map((start) => start.chatUri)).not.toContain(PEER);

    const beganLead = startsOne.length;
    const beganTwo = startsTwo.length;
    // Another folder put in the first one's place, which a backend that takes
    // its folders at startup answers by starting again there.
    const first = ((await second.client.handle({ method: 'subscribe', params: { channel: LIVE } })) as {
      snapshot: { state: { workingDirectories?: string[] } };
    }).snapshot.state.workingDirectories?.[0];
    second.client.handle({
      method: 'dispatchAction',
      params: { channel: LIVE, action: { type: 'session/workingDirectoryReplaced', directory: first, replacement: `file://${EXTRA}` } },
    });
    await settle(20);
    expect(resuming(startsTwo.slice(beganTwo))).toEqual([{ chatId: UUID, resume: UUID, first: 'second' }]);
    expect(startsTwo.at(-1)?.settings).toMatchObject({ voice: 'shouty' });
    expect(resuming(startsOne.slice(beganLead))).toEqual([{ chatId: undefined, resume: 'live', first: 'first' }]);
  });

  it('keeps the session on its own backend when its default chat is one of another', async () => {
    const startsOne: Start[] = [];
    const startsTwo: Start[] = [];
    const one = backend('one', startsOne);
    const two = backend('two', startsTwo);
    const store = await recorded(one, two);
    /*
     * The session's own chat deleted, and its chat of `two` taking the default:
     * a client naming no chat is then handed a conversation `two` wrote, while
     * the session it belongs to is still the one `one` runs.
     */
    const id = idOf(LIVE);
    store.setChats(id, store.chats(id)
      .filter((chat) => chat.provider !== undefined)
      .map((chat) => (chat.uri === PEER ? { ...chat, default: true } : chat)));

    // The starts the host that wrote the store made, counted out of the rest.
    const beganOne = startsOne.length;
    const beganTwo = startsTwo.length;
    const second = await hostAt([one, two], store);
    await second.client.handle({ method: 'listSessions', params: { channel: 'ahp-root://' } });

    // The chat comes back on the backend that wrote it, with its conversation.
    await send(second.client, PEER, 't3', 'third');
    expect(resuming(startsTwo.slice(beganTwo))).toEqual([{ chatId: UUID, resume: UUID, first: 'second' }]);
    expect(startsTwo.at(-1)?.settings).toMatchObject({ voice: 'shouty' });

    /*
     * And the session is still `one`'s. Read from the catalogue row rather than
     * from the state, because a session's state carries what its default chat
     * says and this one's default is a chat of another backend.
     */
    const rows = await second.client.handle({ method: 'listSessions', params: { channel: 'ahp-root://' } }) as {
      items: { resource: string; provider: string }[];
    };
    expect(rows.items.find((row) => row.resource === SESSION)?.provider).toBe('one');
    // The chat that took the default is the one a client gets by naming none.
    const state = await opened(second.client, SESSION);
    expect(state.state.defaultChat).toBe(PEER);
    // And no chat of `one` was started to hold the session: the default chat is
    // the chat of `two`, and it is a chat of the session, not the session.
    expect(startsOne.slice(beganOne)).toEqual([]);
  });

  it('rewinds a chat of another backend on that backend', async () => {
    const startsOne: Start[] = [];
    const startsTwo: Start[] = [];
    const { second } = await opening(backend('one', startsOne), backend('two', startsTwo));
    await send(second.client, PEER, 't3', 'third');

    const beganOne = startsOne.length;
    const beganTwo = startsTwo.length;
    second.client.handle({
      method: 'dispatchAction',
      params: { channel: PEER, action: { type: 'chat/truncated', turnId: 't3' } },
    });
    await settle(8);
    expect(resuming(startsTwo.slice(beganTwo))).toEqual([{ chatId: UUID, resume: UUID, first: 'second' }]);
    // The point to cut at is the backend's own, asked of the chat's backend.
    expect(startsTwo.at(-1)?.rewindAt).toBe('t3-end');
    expect(startsOne.slice(beganOne)).toEqual([]);
  });

  it('leaves a chat of a backend this host is not serving where it is, and starts the rest', async () => {
    const startsOne: Start[] = [];
    const startsTwo: Start[] = [];
    const lines: string[] = [];
    // One instance of each backend behind both hosts, because the transcript a
    // resume reads is the backend's own and not the store's.
    const one = backend('one', startsOne);
    const store = await recorded(one, backend('two', startsTwo));
    // A host that serves one harness and reads a store another wrote.
    const second = await hostAt([one], store, { onEvent: (line) => lines.push(line) });
    await second.client.handle({ method: 'listSessions', params: { channel: 'ahp-root://' } });

    const began = startsOne.length;
    await send(second.client, LIVE, 't3', 'third');
    // The session came back, and it came back without the chat it cannot serve.
    expect(resuming(startsOne.slice(began))).toEqual([{ chatId: undefined, resume: 'live', first: 'first' }]);
    expect(startsTwo).toEqual([]);
    // Said once, and by name, because a chat that silently did not come back
    // is a conversation somebody will look for.
    expect(lines.filter((line) => line.includes(`${PEER}: two is not loaded on this host`))).toHaveLength(1);
  });

  it('keeps a session key from reaching a chat of another backend', async () => {
    const toldOne: string[] = [];
    const toldTwo: string[] = [];
    const { second } = await opening(
      backend('one', [], toldOne),
      backend('two', [], toldTwo),
    );
    await send(second.client, PEER, 't3', 'third');

    second.client.handle({
      method: 'dispatchAction',
      params: { channel: LIVE, action: { type: 'session/configChanged', config: { voice: 'plain' } } },
    });
    await settle(8);
    // The session's own chat took it. The other backend's chat was not asked,
    // because a key this session's schema calls the session's is not a key
    // another backend has agreed to hear.
    expect(toldOne).toEqual(['one:voice=plain']);
    expect(toldTwo).toEqual([]);

    // And sent to that chat itself it is refused, in a sentence that says
    // whose config it is rather than applying it to the wrong harness.
    second.client.handle({
      method: 'dispatchAction',
      params: { channel: PEER, action: { type: 'session/configChanged', config: { voice: 'plain' } } },
    });
    await settle(8);
    const refused = actions(second.p).filter((e) => e.rejectionReason !== undefined).at(-1);
    expect(refused?.rejectionReason).toContain(`its config is not ${SESSION}'s`);
    expect(toldTwo).toEqual([]);
  });

  it('refuses to move a chat of another backend, and does not offer it as movable', async () => {
    const { second } = await opening(backend('one', []), backend('two', []));
    await send(second.client, PEER, 't3', 'third');
    // A chat of the session's own, which says what a movable chat reads like:
    // the answer this chat does not get is a real one, not one never given.
    second.client.handle({ method: 'createChat', params: { channel: LIVE, chat: THIRD } });
    second.client.handle({ method: 'createSession', params: { channel: TWO, provider: 'one' } });
    await settle(8);
    // Its first turn, which a chat has run before a move is made of it.
    await send(second.client, THIRD, 't0', 'first');
    await vi.waitFor(async () => { expect((await opened(second.client, THIRD)).state.turns.length).toBeGreaterThan(0); });

    const here = await opened(second.client, LIVE);
    expect(here.state.chats?.find((chat) => chat.resource === THIRD)?.movable).toBe(true);
    expect(here.state.chats?.find((chat) => chat.resource === PEER)?.movable).toBeUndefined();

    await expect(second.client.handle({
      method: 'moveChat',
      params: { channel: PEER, destination: { kind: 'session', session: TWO } },
    })).rejects.toMatchObject({ data: { reason: 'differentProvider' } });
    // And nothing moved: it is still a chat of its session, answering on the
    // backend it runs on.
    const after = await opened(second.client, LIVE);
    expect(after.state.chats?.map((chat) => chat.resource)).toContain(PEER);
    expect((await opened(second.client, PEER)).state.turns.map((turn) => turn.message?.text))
      .toEqual(['second', 'third']);
  });
});

/*
 * An action naming a chat or a session this host does not know, answered as
 * the reference host answers it: a session's read or archive toggle is dropped
 * with nothing said or kept, any other session action is refused, a chat's read
 * or archive is refused, and any other action on the chat is said back on its
 * channel and runs nothing.
 * https://github.com/microsoft/vscode/blob/a12547442f722dfe0a6ec105f986cfe65b8d6f22/src/vs/platform/agentHost/node/agentService.ts#L12482-L12531
 * https://github.com/microsoft/vscode/blob/a12547442f722dfe0a6ec105f986cfe65b8d6f22/src/vs/platform/agentHost/node/agentService.ts#L13442-L13460
 */
describe('an action naming a chat or session nobody has', () => {
  const NOBODY = 'ahp-session:/nobody';
  const naming = (p: ReturnType<typeof peer>, word: string) => p.notes.filter((n) => JSON.stringify(n.params).includes(word));

  it('drops a session\'s read and archive toggles for a session nobody has, saying and keeping nothing', async () => {
    const store = memorySessions();
    const { client, peer: p } = await running({ sessions: store });
    p.notes.length = 0;

    client.handle({ method: 'dispatchAction', params: { channel: NOBODY, clientSeq: 1, action: { type: 'session/isReadChanged', isRead: true } } });
    client.handle({ method: 'dispatchAction', params: { channel: NOBODY, clientSeq: 2, action: { type: 'session/isArchivedChanged', isArchived: true } } });
    await settle(8);
    expect(naming(p, 'nobody')).toEqual([]);
    expect(store.flags('nobody')).toBe(0);
  });

  it('refuses any other session action on a session nobody has', async () => {
    const { client, peer: p } = await running();
    p.notes.length = 0;

    client.handle({ method: 'dispatchAction', params: { channel: NOBODY, clientSeq: 3, action: { type: 'session/titleChanged', title: 'Mine' } } });
    await settle(8);
    const said = actions(p, NOBODY);
    expect(said).toHaveLength(1);
    expect(said[0]?.origin).toEqual({ clientId: 'probe', clientSeq: 3 });
    expect(said[0]?.rejectionReason).toBeDefined();
  });

  it('refuses a read or an archive of a chat nobody has, in the reference host\'s words', async () => {
    const { client, peer: p } = await running();
    p.notes.length = 0;

    client.handle({ method: 'dispatchAction', params: { channel: 'ahp-chat:/nobody', clientSeq: 4, action: { type: 'chat/isReadChanged', isRead: true } } });
    client.handle({ method: 'dispatchAction', params: { channel: 'ahp-chat:/nobody', clientSeq: 5, action: { type: 'chat/isArchivedChanged', isArchived: true } } });
    await settle(8);
    expect(actions(p).map((e) => [e.origin?.clientSeq, e.rejectionReason])).toEqual([
      [4, 'Only a known chat can change its read state.'],
      [5, 'Only a known independently manageable non-default chat can be archived.'],
    ]);
  });

  it('says any other action on a chat nobody has back on its channel, and runs nothing', async () => {
    const { client, peer: p, uri } = await running();
    const gone = 'ahp-chat:/gone';
    await client.handle({ method: 'createChat', params: { channel: uri, chat: gone } });
    await client.handle({ method: 'subscribe', params: { channel: gone } });
    await client.handle({ method: 'disposeChat', params: { channel: gone } });
    const before = sessionQueries().length;
    p.notes.length = 0;

    client.handle({ method: 'dispatchAction', params: { channel: gone, clientSeq: 6, action: { type: 'chat/turnStarted', turnId: 'g1', startedAt: new Date().toISOString(), message: { origin: { kind: 'user' }, text: 'still here?' } } } });
    await settle(8);
    expect(actions(p).map((e) => [e.channel, e.action.type, e.origin, e.rejectionReason])).toEqual([
      [gone, 'chat/turnStarted', { clientId: 'probe', clientSeq: 6 }, undefined],
    ]);
    expect(sessionQueries().length).toBe(before);
    const session = await client.handle({ method: 'subscribe', params: { channel: uri } }) as {
      snapshot: { state: { chats: { resource: string }[] } };
    };
    expect(session.snapshot.state.chats.map((one) => one.resource)).not.toContain(gone);
  });
});

/*
 * A turn naming a model its chat's agent does not offer is decided once, by
 * the host, where VS Code's host decides it, before the turn reaches the
 * backend: `fail`, the default, ends it, as upstream decided, and `keep` is
 * VS Code's, a chat whose agent is not its session's keeping its model and any
 * other chat's agent handed the model as it is.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentSideEffects.ts#L2226-L2231
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentHostTurnTelemetryContext.ts#L44-L55
 */
describe('a turn naming a model its agent does not offer', () => {
  /** What each backend was handed: the models it was switched to and the turns it was sent. */
  interface Handed { models: string[]; sent: string[] }

  /** The example backend under `provider`, offering `m1` alone. */
  const offering = (provider: string, handed: Handed): Agent => {
    const base = echo({ path: '/home/softov', pace: 0 });
    return {
      ...base,
      provider,
      displayName: provider,
      create: (start: Start): Session => {
        const session = base.create(start) as Session;
        return {
          ...session,
          models: () => [{ id: 'm1', name: 'One' }],
          changeModel: (model) => { handed.models.push(`${provider}:${model.id}`); return session.changeModel(model); },
          sendMessage: (turnId, text, from, attachments, options) => {
            handed.sent.push(`${provider}:${turnId}`);
            return session.sendMessage(turnId, text, from, attachments, options);
          },
        };
      },
    };
  };

  /** A host with an `echo` session, and a client watching its chat. */
  const started = async (over: Partial<HostOptions> = {}) => {
    const handed: Handed = { models: [], sent: [] };
    const host = createHost({ path: '/home/softov', agents: [offering('echo', handed)], ...over });
    const p = peer();
    const client = host.accept(p);
    await client.handle(hello(['0.9.0']));
    await client.handle({ method: 'createSession', params: { channel: 'ahp-session:/one', provider: 'echo' } });
    const chat = await defaultChatOf(client, 'ahp-session:/one');
    await client.handle({ method: 'subscribe', params: { channel: chat } });
    const ask = async (turnId: string, model: string): Promise<void> => {
      await client.handle({
        method: 'dispatchAction',
        params: { channel: chat, action: { type: 'chat/turnStarted', turnId, startedAt: new Date().toISOString(), message: { text: 'hi', origin: { kind: 'user' }, model: { id: model } } } },
      });
      await settle(8);
    };
    const failed = (turnId: string): unknown => (actions(p, chat)
      .find((e) => e.action.type === 'chat/error' && e.action.turnId === turnId)?.action.part as Bag | undefined)?.error;
    return { host, handed, ask, failed };
  };

  it('ends the turn by default, its backend never handed it', async () => {
    const { host, handed, ask, failed } = await started();
    await ask('t1', 'm2');
    expect(failed('t1')).toEqual({ errorType: 'modelSelectionFailed', message: 'Its agent echo does not offer the turn\'s model m2' });
    expect(handed).toEqual({ models: [], sent: [] });
    // A model it offers is taken.
    await ask('t2', 'm1');
    expect(failed('t2')).toBeUndefined();
    expect(handed).toEqual({ models: ['echo:m1'], sent: ['echo:t2'] });
    await host.close();
  });

  it('hands the session\'s own agent the model as it is under keep, as VS Code\'s host does', async () => {
    const { host, handed, ask, failed } = await started({ unofferedModel: 'keep' });
    await ask('t1', 'm2');
    expect(failed('t1')).toBeUndefined();
    expect(handed).toEqual({ models: ['echo:m2'], sent: ['echo:t1'] });
    await host.close();
  });
});
