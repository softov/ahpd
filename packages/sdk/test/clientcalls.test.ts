import { afterEach, describe, expect, it, vi } from 'vitest';
import { createClientCalls, DEFAULT_CLIENT_TOOL_TIMEOUT_MS } from '../src/clientcalls.js';
import type { ClientCallAnswer, ClientCallsOptions } from '../src/clientcalls.js';
import type { Bag } from '../src/types/common.js';
import type { OnWire } from '../src/types/wire.js';
import type { ToolResultContent } from '@microsoft/agent-host-protocol';

/*
 * A call a client runs, held in one place.
 *
 * Every backend that takes a client's tools needs the same thing: a row raised
 * on the session so a client that watches only the session finds the call, a
 * promise the harness blocks on, one answer from the client that owns it, and
 * an end for every way the call can go - answered, abandoned, released or
 * timed out. This is that, with no backend in it.
 *
 * The cases are the endings: which of them settles the wait, which of them
 * refuses, and what the model is told when nobody answers.
 */

const CHAT = 'ahp-chat:/live';

/** A holder, and the actions it sent, as a backend's own emitter would hear them. */
const holder = (options: Partial<ClientCallsOptions> = {}) => {
  const said: { channel: string; action: Bag }[] = [];
  const calls = createClientCalls({
    chat: CHAT,
    emit: (channel, action) => { said.push({ channel, action }); },
    ...options,
  });
  const requests = (): Bag[] => said
    .filter((one) => one.action.type === 'session/inputNeededSet')
    .map((one) => one.action.request as Bag);
  const removed = (): string[] => said
    .filter((one) => one.action.type === 'session/inputNeededRemoved')
    .map((one) => String(one.action.id));
  return { calls, said, requests, removed };
};

/** A call as a backend reports it, before the holder marks it running and owned. */
const running = (toolCallId: string, name = 'openFile'): Bag => ({
  toolCallId,
  toolName: name,
  displayName: name,
  invocationMessage: `Run ${name}`,
  confirmed: 'not-needed',
});

const text = (value: string): OnWire<ToolResultContent> => ({ type: 'text', text: value });
const png = (data: string): OnWire<ToolResultContent> => ({ type: 'embeddedResource', data, contentType: 'image/png' });

/** What a client said its call did, with its whole content. */
const answered = (value: string, ...content: OnWire<ToolResultContent>[]): ClientCallAnswer => ({
  ok: true,
  text: value,
  content: content.length === 0 ? [text(value)] : content,
});

afterEach(() => { vi.useRealTimers(); });

describe('a client call, held', () => {
  it('raises the protocol\'s execution request, and raises it once', () => {
    const { calls, requests } = holder();
    const id = calls.open({ turnId: 't1', toolCall: running('call-1'), owner: 'a' });

    // The entry id is the protocol's own spelling: what a client that reads
    // the session's `inputNeeded` keys on, and what the removal names.
    expect(id).toBe(`toolClientExecution:${CHAT}:t1:call-1`);
    // `SessionToolClientExecutionRequest`, with the call as a running state
    // carrying its client contributor - the shape vs Code's client reads.
    expect(requests()).toEqual([{
      id: `toolClientExecution:${CHAT}:t1:call-1`,
      kind: 'toolClientExecution',
      chat: CHAT,
      turnId: 't1',
      clientId: 'a',
      toolCall: {
        toolCallId: 'call-1',
        toolName: 'openFile',
        displayName: 'openFile',
        invocationMessage: 'Run openFile',
        confirmed: 'not-needed',
        status: 'running',
        contributor: { kind: 'client', clientId: 'a' },
      },
    }]);

    // `session/inputNeededSet` is an upsert keyed by `id`, so opening the same
    // call again is the same entry and not a second one.
    calls.open({ turnId: 't1', toolCall: running('call-1'), owner: 'a' });
    expect(requests()).toHaveLength(1);
    expect(calls.entries()).toHaveLength(1);
  });

  it('resolves the wait with the owner\'s answer, and removes the entry once', async () => {
    const { calls, removed } = holder();
    calls.open({ turnId: 't1', toolCall: running('call-1'), owner: 'a' });
    const waiting = calls.wait('call-1');
    expect(calls.complete('call-1', 'a', answered('opened /a.txt'))).toBe(true);
    expect(await waiting).toEqual({ ok: true, text: 'opened /a.txt', content: [text('opened /a.txt')] });
    expect(removed()).toEqual([`toolClientExecution:${CHAT}:t1:call-1`]);
    expect(calls.entries()).toEqual([]);

    // A second answer is a client out of step, and says so rather than
    // dragging the finished call back.
    expect(calls.complete('call-1', 'a', answered('again'))).toBe(false);
    expect(removed()).toHaveLength(1);
  });

  it('keeps the whole content, and the text blocks alone beside it', async () => {
    const { calls } = holder();
    calls.open({ turnId: 't1', toolCall: running('call-1'), owner: 'a' });
    const waiting = calls.wait('call-1');
    const content = [text('here it is'), png('iVBORw0KGgo=')];
    calls.complete('call-1', 'a', { ok: true, text: 'here it is', content });
    // A text-only harness reads `text`; one that takes images takes `content`.
    expect(await waiting).toEqual({ ok: true, text: 'here it is', content });
  });

  it('keeps an answer that arrives before anybody waits for it', async () => {
    const { calls } = holder();
    calls.open({ turnId: 't1', toolCall: running('call-1'), owner: 'a' });
    // A client starts at `running` and may answer before the harness runs the
    // tool, so the wait is registered when the call opens, not when it is asked.
    calls.complete('call-1', 'a', answered('already done'));
    expect(await calls.wait('call-1')).toEqual({ ok: true, text: 'already done', content: [text('already done')] });
  });

  it('refuses another client\'s answer and leaves the call waiting', async () => {
    const { calls, removed } = holder();
    calls.open({ turnId: 't1', toolCall: running('call-1'), owner: 'a' });
    // The protocol makes the call its contributor's to answer, so a result
    // from anybody else is a client answering for work it did not do.
    expect(calls.complete('call-1', 'b', answered('not mine'))).toBe(false);
    expect(calls.entries()).toHaveLength(1);
    expect(removed()).toEqual([]);

    expect(calls.complete('call-1', 'a', answered('mine'))).toBe(true);
    expect((await calls.wait('call-1')).text).toBe('mine');
  });

  it('fails a wait on a call that was never opened, rather than hanging', async () => {
    const { calls } = holder();
    // A backend that forgot `open` is a backend whose turn hangs; this is the
    // one place that can say so instead.
    await expect(calls.wait('call-1')).rejects.toThrow('call-1 is not a call a client is running here');
  });

  it('fails a gone client\'s calls, and names the other client\'s tool when there is one', async () => {
    const { calls } = holder({ providers: (name) => (name === 'openFile' ? ['a', 'b'] : []) });
    calls.open({ turnId: 't1', toolCall: running('call-1'), owner: 'a' });
    calls.open({ turnId: 't1', toolCall: running('call-2', 'readFile'), owner: 'b' });

    calls.gone('a');
    const lost = await calls.wait('call-1');
    expect(lost.ok).toBe(false);
    expect(lost.text).toBe(`The client a that was running openFile is no longer here. b__openFile provides the same tool`);
    // Only that client's calls: the other one is still running here.
    expect(calls.entries()).toHaveLength(1);
    expect(calls.owner('call-2')).toBe('b');
  });

  it('fails a gone client\'s call with no hint when nobody else provides the tool', async () => {
    const { calls } = holder({ providers: () => [] });
    calls.open({ turnId: 't1', toolCall: running('call-1'), owner: 'a' });
    calls.gone('a');
    expect((await calls.wait('call-1')).text).toBe('The client a that was running openFile is no longer here');
  });

  it('times an unanswered call out, and leaves no timer when the limit is off', async () => {
    vi.useFakeTimers();
    const { calls, removed } = holder({ timeoutMs: 50 });
    calls.open({ turnId: 't1', toolCall: running('call-1'), owner: 'a' });
    const waiting = calls.wait('call-1');
    expect(vi.getTimerCount()).toBe(1);

    vi.advanceTimersByTime(50);
    const lost = await waiting;
    expect(lost.ok).toBe(false);
    expect(lost.text).toBe('openFile got no answer from a in 0 s');
    expect(calls.entries()).toEqual([]);
    expect(removed()).toHaveLength(1);

    // Zero is no limit at all, which is what a deployment that wants a call to
    // wait however long its client takes asks for.
    const endless = holder({ timeoutMs: 0 });
    endless.calls.open({ turnId: 't1', toolCall: running('call-1'), owner: 'a' });
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(60 * 60 * 1000);
    expect(endless.calls.entries()).toHaveLength(1);
    expect(endless.removed()).toEqual([]);
  });

  it('defaults to ten minutes', async () => {
    vi.useFakeTimers();
    const { calls } = holder();
    calls.open({ turnId: 't1', toolCall: running('call-1'), owner: 'a' });
    const waiting = calls.wait('call-1');
    vi.advanceTimersByTime(DEFAULT_CLIENT_TOOL_TIMEOUT_MS - 1);
    expect(calls.entries()).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect((await waiting).text).toBe('openFile got no answer from a in 600 s');
  });

  it('clears the timer when the call ends, so nothing fires later', async () => {
    vi.useFakeTimers();
    const { calls } = holder({ timeoutMs: 1000 });
    calls.open({ turnId: 't1', toolCall: running('call-1'), owner: 'a' });
    calls.complete('call-1', 'a', answered('done'));
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(5000);
    expect((await calls.wait('call-1')).text).toBe('done');
  });

  it('releases every call with one reason, and leaves nothing open', async () => {
    const { calls, removed } = holder();
    calls.open({ turnId: 't1', toolCall: running('call-1'), owner: 'a' });
    calls.open({ turnId: 't1', toolCall: running('call-2', 'readFile'), owner: 'b' });

    calls.release('The turn was stopped');
    const [one, two] = await Promise.all([calls.wait('call-1'), calls.wait('call-2')]);
    expect(one.ok).toBe(false);
    expect(one.text).toBe('The turn was stopped');
    expect(two.text).toBe('The turn was stopped');
    expect(calls.entries()).toEqual([]);
    expect(removed()).toHaveLength(2);
  });

  it('answers the four session members in the shapes `Session` asks for', async () => {
    const { calls } = holder({ providers: () => [] });
    calls.open({ turnId: 't1', toolCall: running('call-1'), owner: 'a' });
    expect(calls.methods.toolCallOwner('call-1')).toBe('a');
    expect(calls.methods.toolCallOwner('nobody')).toBeUndefined();
    expect(calls.methods.completeToolCall('call-1', 'b', answered('no'))).toBe(false);
    expect(calls.methods.completeToolCall('call-1', 'a', answered('yes'))).toBe(true);

    const { calls: other } = holder();
    other.open({ turnId: 't1', toolCall: running('call-2'), owner: 'a' });
    other.methods.clientGone('a');
    expect((await other.wait('call-2')).ok).toBe(false);
  });
});
