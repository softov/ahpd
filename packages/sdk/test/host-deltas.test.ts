/*
 * Streamed deltas, gathered in the host's dispatch.
 *
 * A turn sends one delta per token, and each one is an envelope: a sequence
 * number, a broadcast to every client watching, and a copy kept for a client
 * that comes back. What a client draws is the text, and the text is the same
 * in one envelope as in five hundred - so the deltas naming one part wait a
 * short window and leave as one action.
 *
 * The window is a delay and nothing more, which is what these tests are
 * about: what a client ends up holding is what it would have held anyway.
 * The three ways a delay could be seen are a stream that ends before the
 * window does, a client that subscribes while text is held, and a delta that
 * belongs to somebody else - and each of them is checked here.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { merger, DELTA_CAP_BYTES } from '../src/host/deltas.js';
import { chatUriFor } from '../src/host/channels.js';
import {
  claude, createHost, hello, machine, peer, resetSdk, actions, emit, running, sdk, settle,
} from './support/host.js';
import type { HostOptions } from '../src/types/host.js';

vi.mock('@anthropic-ai/claude-agent-sdk', async () => (await import('./support/claude-sdk.js')).fake);

beforeEach(resetSdk);

/** A session's directory, and the one the catalogue row lists. */
const DIR = '/home/softov/project';

/** A promise a test finishes by hand, so a read can be held open across an emit. */
function deferred<T>() {
  let finish: (value: T) => void = () => {};
  const waiting = new Promise<T>((done) => { finish = done; });
  return { waiting, finish };
}

/** One chunk of streamed prose, as the CLI reports one. */
const said = (text: string) => ({
  type: 'stream_event',
  event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } },
});

/** The length of the default window, plus enough for the timer to have run. */
const pastWindow = async (): Promise<void> => {
  await new Promise((r) => { setTimeout(r, 200); });
};

/** A client with a turn running and one empty markdown part open. */
async function opened(over: Partial<HostOptions> = {}) {
  const held = await running(over);
  held.client.handle({
    method: 'dispatchAction',
    params: { channel: held.uri, action: { type: 'chat/turnStarted', turnId: 't1', message: { text: 'hi' } } },
  });
  await settle();
  await emit(
    { type: 'stream_event', event: { type: 'message_start', message: { id: 'm1' } } },
    { type: 'stream_event', event: { type: 'content_block_start', index: 0, content_block: { type: 'text' } } },
  );
  return held;
}

/** Every text delta a client was sent on one channel, in order. */
const deltas = (p: Parameters<typeof actions>[0], channel: string) => actions(p, channel)
  .filter((e) => e.action.type === 'chat/delta')
  .map((e) => String(e.action.content ?? ''));

/** What a snapshot says the running turn's text is. */
const inSnapshot = (state: { activeTurn?: { responseParts?: { content?: unknown }[] } }): string =>
  (state.activeTurn?.responseParts ?? []).map((part) => String(part.content ?? '')).join('');

describe('a streamed delta', () => {
  it('reaches the client as the same text in one envelope instead of five hundred', async () => {
    const { peer: p, chatUri } = await opened();
    const letters = Array.from({ length: 500 }, (_, at) => String.fromCharCode(97 + (at % 26)));

    await emit(...letters.map(said));
    await pastWindow();

    /*
     * How many envelopes a burst becomes is the machine's business: the
     * window closes while the stream is still running, so a slower one sends
     * a few more. What is not the machine's business is the text, which is
     * what a client draws - and that it is the same words in a small fraction
     * of the envelopes is the whole of the change.
     */
    const arrived = deltas(p, chatUri);
    expect(arrived.length).toBeLessThan(50);
    expect(arrived.join('')).toBe(letters.join(''));
  });

  it('is followed by the ending of the turn it belongs to', async () => {
    const { peer: p, chatUri } = await opened();

    // The window has not closed when the turn ends, so this is the ordering
    // the flush exists for: an ending sent ahead of the words it ends leaves
    // a client with a finished turn and text arriving after it.
    await emit(said('done'), { type: 'result', subtype: 'success', duration_ms: 5 });

    const types = actions(p, chatUri).map((e) => e.action.type);
    expect(types).toContain('chat/delta');
    expect(types).toContain('chat/turnComplete');
    expect(types.indexOf('chat/delta')).toBeLessThan(types.indexOf('chat/turnComplete'));
    expect(deltas(p, chatUri).join('')).toBe('done');
  });

  it('is not written twice into a client that subscribes mid-stream', async () => {
    const { client, peer: p, chatUri } = await opened();
    await emit(said('one'), said(' two'));

    /*
     * The snapshot is read off the parts the backend is still writing into,
     * so it already carries the held text. The client applies the snapshot
     * and then every action numbered after it, which is the rule the sequence
     * numbers are for - so a held delta sent after the snapshot writes those
     * words a second time.
     */
    const opened2 = await client.handle({ method: 'subscribe', params: { channel: chatUri } }) as {
      snapshot: { state: { activeTurn?: { responseParts?: { content?: unknown }[] } }; fromSeq: number };
    };
    const at = opened2.snapshot.fromSeq;
    const sofar = inSnapshot(opened2.snapshot.state);
    expect(sofar).toBe('one two');

    await emit(said(' three'), { type: 'result', subtype: 'success', duration_ms: 5 });

    // Deduplicated by sequence number: a re-subscribe replays what it missed
    // to the same connection that already heard it live.
    const after = new Map<number, string>();
    for (const e of actions(p, chatUri)) {
      if (e.action.type === 'chat/delta' && e.serverSeq > at) after.set(e.serverSeq, String(e.action.content ?? ''));
    }
    expect(sofar + [...after.values()].join('')).toBe('one two three');
  });

  it('goes out as it arrives when the window is off', async () => {
    const { peer: p, chatUri } = await opened({ deltaWindowMs: 0 });

    await emit(said('a'), said('b'), said('c'));
    expect(deltas(p, chatUri)).toEqual(['a', 'b', 'c']);
  });

  it('is not written twice into a client whose snapshot read awaited', async () => {
    sdk.sessions.push({ sessionId: 'older', summary: 'Older', lastModified: 1, cwd: DIR });
    sdk.transcript.push({ type: 'user', uuid: 'u1', message: { role: 'user', content: 'earlier' } });
    /*
     * A backend whose worker list this test finishes itself, so a delta can
     * arrive while the snapshot is out. A resumed session is what reads it:
     * the workers of the session's own transcript, listed beside the live
     * ones, and nothing can list them until the backend has answered.
     */
    const workers = deferred<undefined>();
    const host = createHost({
      path: DIR,
      agents: [{ ...claude({ paths: [DIR] }), subagents: async () => await workers.waiting }],
      ...machine(),
    });
    const client = host.accept(peer());
    await client.handle(hello(['0.9.0']));
    const listed = await client.handle({ method: 'listSessions', params: { channel: 'ahp-root://' } }) as {
      items: { resource: string }[];
    };
    const chatUri = chatUriFor(listed.items[0]?.resource as string);
    // Somebody says something, which resumes the session rather than replaying
    // it. Not awaited: the request is answered when the turn it began ends.
    void client.handle({
      method: 'dispatchAction',
      params: { channel: chatUri, action: { type: 'chat/turnStarted', turnId: 't1', message: { text: 'hi' } } },
    });
    await settle(6);
    await emit(
      { type: 'stream_event', event: { type: 'message_start', message: { id: 'm1' } } },
      { type: 'stream_event', event: { type: 'content_block_start', index: 0, content_block: { type: 'text' } } },
    );

    const latePeer = peer();
    const late = host.accept(latePeer);
    await late.handle(hello(['0.9.0']));
    // Parked in the backend's answer, so the delta below lands while it waits.
    const reading = late.handle({ method: 'subscribe', params: { channel: chatUri } }) as Promise<{
      snapshot: { state: { activeTurn?: { responseParts?: { content?: unknown }[] } }; fromSeq: number };
    }>;
    await settle();
    await emit(said('held'));
    workers.finish(undefined);
    const { snapshot } = await reading;
    // Whatever was held has left by now, and this client has been watching
    // since the snapshot, so anything sent from here it would draw.
    await pastWindow();

    /*
     * The words once. The state holds them, because the backend wrote them
     * into the part before it emitted the action - so the action has to sit at
     * or below `fromSeq`, where no client replaying what it missed is handed
     * it again.
     */
    const arrived = actions(latePeer, chatUri);
    expect(inSnapshot(snapshot.state)).toBe('held');
    expect(arrived.filter((one) => one.serverSeq > snapshot.fromSeq)).toEqual([]);
  });
});

describe('a host closing', () => {
  it('sends a delta pushed on the way down on that tick, not on a timer', async () => {
    /*
     * A session that says nothing of its own as it goes, so the delta below is
     * the last thing this host has to send. A backend that did emit at its end
     * would flush the window itself, and the timer this is about is the one
     * nothing else reaches.
     */
    const base = claude({ paths: [DIR] });
    const host = createHost({
      path: DIR,
      agents: [{ ...base, create: (start) => ({ ...base.create(start), close: () => {} }) }],
      ...machine(),
    });
    const p = peer();
    const client = host.accept(p);
    await client.handle(hello(['0.9.0']));
    const uri = 'ahp-session:/live';
    await client.handle({ method: 'createSession', params: { channel: uri, provider: 'claude' } });
    const opened_ = await client.handle({ method: 'subscribe', params: { channel: uri } }) as {
      snapshot: { state: { defaultChat: string } };
    };
    const chatUri = opened_.snapshot.state.defaultChat;
    await client.handle({ method: 'subscribe', params: { channel: chatUri } });
    await client.handle({
      method: 'dispatchAction',
      params: { channel: chatUri, action: { type: 'chat/turnStarted', turnId: 't1', message: { text: 'hi' } } },
    });
    await settle();
    await emit(
      { type: 'stream_event', event: { type: 'message_start', message: { id: 'm1' } } },
      { type: 'stream_event', event: { type: 'content_block_start', index: 0, content_block: { type: 'text' } } },
    );

    const closing = host.close();
    // The window is let go of before this, so the delta is sent now rather
    // than waiting on a timer that would outlive the host.
    await emit(said('bye'));
    await closing;
    expect(deltas(p, chatUri).join('')).toBe('bye');

    // And nothing follows the host's own end.
    const atClose = actions(p, chatUri).length;
    await pastWindow();
    expect(actions(p, chatUri).length).toBe(atClose);
    client.close();
  });
});

describe('the window', () => {
  /** A window whose sends are collected rather than broadcast. */
  function held(capBytes = DELTA_CAP_BYTES) {
    const sent: { channel: string; action: Record<string, unknown>; origin: unknown }[] = [];
    const window = merger({
      windowMs: 75,
      capBytes,
      send: (channel, action, origin) => sent.push({ channel, action, origin }),
    });
    return { window, sent };
  }

  const delta = (partId: string, content: string, extra: Record<string, unknown> = {}) =>
    ({ type: 'chat/delta', turnId: 't1', partId, content, ...extra });

  it('merges one part\'s text and leaves another part\'s alone', () => {
    const { window, sent } = held();
    expect(window.push('chat', delta('p1', 'one'), undefined)).toBe(true);
    expect(window.push('chat', delta('p2', 'other'), undefined)).toBe(true);
    expect(window.push('chat', delta('p1', ' two'), undefined)).toBe(true);

    // Everything is held, and nothing has been sent.
    expect(sent).toEqual([]);
    window.flush();
    // First-held order, which is the order they arrived in and the order a
    // client reading them draws.
    expect(sent.map((one) => one.action.content)).toEqual(['one two', 'other']);
    expect(sent.every((one) => one.action.type === 'chat/delta')).toBe(true);
  });

  it('sends everything held before an action it cannot merge', () => {
    const { window, sent } = held();
    window.push('chat', delta('p1', 'text'), undefined);
    expect(window.push('chat', { type: 'chat/turnComplete', turnId: 't1', duration: 1 }, undefined)).toBe(false);
    expect(sent.map((one) => one.action.type)).toEqual(['chat/delta']);
  });

  it('keeps an attribution change as its own action', () => {
    const { window, sent } = held();
    const mine = { clientId: 'probe', clientSeq: 1 };
    window.push('chat', delta('p1', 'mine '), mine);
    window.push('chat', delta('p1', 'somebody else\'s'), undefined);

    // The first delta's origin belongs to the first delta. Merged, it would
    // be the only attribution that ever reached a client - and a client
    // reading it takes the words for the client that sent them.
    expect(sent.map((one) => one.action.content)).toEqual(['mine ']);
    window.flush();
    expect(sent.map((one) => one.action.content)).toEqual(['mine ', 'somebody else\'s']);
  });

  it('keeps a `_meta` change as its own action', () => {
    const { window, sent } = held();
    window.push('chat', delta('p1', 'the lead ', { _meta: { subagent: 'a' } }), undefined);
    window.push('chat', delta('p1', 'said'), undefined);

    expect(sent.map((one) => one.action.content)).toEqual(['the lead ']);
    window.flush();
    expect(sent.map((one) => one.action.content)).toEqual(['the lead ', 'said']);
  });

  it('lets go of an entry once it has enough text in it', () => {
    const { window, sent } = held(4);
    window.push('chat', delta('p1', 'abc'), undefined);
    expect(sent).toEqual([]);
    // Past the cap the entry goes out at once, and what follows starts a new
    // one rather than waiting behind it.
    window.push('chat', delta('p1', 'def'), undefined);
    expect(sent.map((one) => one.action.content)).toEqual(['abcdef']);
    window.push('chat', delta('p1', 'ghi'), undefined);
    window.flush();
    expect(sent.map((one) => one.action.content)).toEqual(['abcdef', 'ghi']);
  });

  it('holds nothing once it has been stopped', async () => {
    const { window, sent } = held();
    window.push('chat', delta('p1', 'one'), undefined);
    window.stop();
    // What it held goes out at the stop, and nothing after it is gathered.
    expect(sent.map((one) => one.action.content)).toEqual(['one']);
    expect(window.push('chat', delta('p1', ' two'), undefined)).toBe(false);
    await new Promise((r) => { setTimeout(r, 200); });
    // No timer outlives the stop, so 'two' is the caller's to send.
    expect(sent.map((one) => one.action.content)).toEqual(['one']);
  });

  it('takes the last invocation message a tool call was given', () => {
    const { window, sent } = held();
    window.push('chat', { type: 'chat/toolCallDelta', turnId: 't1', toolCallId: 'tc', content: '{"a"', invocationMessage: 'Reading' }, undefined);
    window.push('chat', { type: 'chat/toolCallDelta', turnId: 't1', toolCallId: 'tc', content: ':1}' }, undefined);
    window.flush();
    // The protocol's reducer replaces `invocationMessage` and appends
    // `content`, and a merged action has to reduce to the same thing.
    expect(sent.map((one) => one.action)).toEqual([
      { type: 'chat/toolCallDelta', turnId: 't1', toolCallId: 'tc', content: '{"a":1}', invocationMessage: 'Reading' },
    ]);
  });
});
