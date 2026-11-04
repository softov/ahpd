import { expect, it, vi } from 'vitest';
import type { AgentSessionEvent } from '@earendil-works/pi-coding-agent';
import type { Bag, Start } from '../../sdk/src/types/index.js';
import { activityOf, mapEvent, resultText } from '../src/mapping.js';
import { answer, callIn, driveCall, opened, settled, streamed, turn } from './fake-pi.js';

// Mapping -----------------------------------------------------------------

it('streams text into the part its block opened, and into the snapshot', () => {
  const one = turn();
  const [started] = streamed([]);
  mapEvent(one, started!);
  // A text block opens its part at its first words, not at its start.
  expect(mapEvent(one, {
    type: 'message_update',
    message: {} as never,
    assistantMessageEvent: { type: 'text_start', contentIndex: 0, partial: {} as never },
  })).toEqual([]);
  const actions = mapEvent(one, {
    type: 'message_update',
    message: {} as never,
    assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta: 'hello', partial: {} as never },
  });
  expect(actions).toEqual([
    { type: 'chat/responsePart', turnId: 't1', part: { id: 't1:1:0', kind: 'markdown', content: '' } },
    { type: 'chat/delta', turnId: 't1', partId: 't1:1:0', content: 'hello' },
  ]);
  // The snapshot is the parts, not a replay of the actions.
  expect(one.parts[0]?.content).toBe('hello');
});

it('keeps the whitespace a text block starts with in its one part', () => {
  const one = turn();
  const [started] = streamed([]);
  mapEvent(one, started!);
  const text = (delta: string): AgentSessionEvent => ({
    type: 'message_update',
    message: {} as never,
    assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta, partial: {} as never },
  });
  expect(mapEvent(one, text(' '))).toEqual([]);
  expect(mapEvent(one, text('\n'))).toEqual([]);
  expect(mapEvent(one, text('hello'))).toEqual([
    { type: 'chat/responsePart', turnId: 't1', part: { id: 't1:1:0', kind: 'markdown', content: '' } },
    { type: 'chat/delta', turnId: 't1', partId: 't1:1:0', content: ' \nhello' },
  ]);
  expect(mapEvent(one, text(' '))).toEqual([{ type: 'chat/delta', turnId: 't1', partId: 't1:1:0', content: ' ' }]);
  expect(one.parts.map((p) => [p.kind, p.content])).toEqual([['markdown', ' \nhello ']]);
});

it('opens a thought\'s part once, however much pi thinks, and the next thought its own', () => {
  const one = turn();
  const thinking = (contentIndex: number, delta: string): AgentSessionEvent => ({
    type: 'message_update',
    message: {} as never,
    assistantMessageEvent: { type: 'thinking_delta', contentIndex, delta, partial: {} as never },
  });
  // A delta whose block never announced a start still opens it first.
  const first = mapEvent(one, thinking(0, 'hm'));
  expect(first.map((a) => a.type)).toEqual(['chat/responsePart', 'chat/reasoning']);
  const second = mapEvent(one, thinking(0, 'm'));
  expect(second.map((a) => a.type)).toEqual(['chat/reasoning']);
  const third = mapEvent(one, thinking(1, 'so'));
  expect(third.map((a) => a.type)).toEqual(['chat/responsePart', 'chat/reasoning']);
  expect(one.parts.map((p) => [p.kind, p.content])).toEqual([['reasoning', 'hmm'], ['reasoning', 'so']]);
});

it('keeps thinking, a call and thinking again in the order pi wrote them, live and replayed', async () => {
  const { replayEntries } = await import('../src/replay.js');
  const call = { type: 'toolCall', id: 'c1', name: 'read', arguments: { path: 'a.ts' } };
  const shapes: Bag[][][] = [
    // One message holding all four blocks.
    [[{ type: 'thinking', thinking: 'THINK-1' }, call, { type: 'thinking', thinking: 'THINK-2' }, { type: 'text', text: 'REPLY' }]],
    // The call ending the first message, and the answer in a second.
    [[{ type: 'thinking', thinking: 'THINK-1' }, call], [{ type: 'thinking', thinking: 'THINK-2' }, { type: 'text', text: 'REPLY' }]],
  ];
  for (const messages of shapes) {
    const live = turn('u1');
    for (const content of messages) for (const event of streamed(content)) mapEvent(live, event);
    const seen = live.parts.map((p) => [p.id, p.kind, p.kind === 'toolCall' ? (p.toolCall as Bag).toolCallId : p.content]);
    expect(seen.map(([, kind, content]) => [kind, content])).toEqual([
      ['reasoning', 'THINK-1'], ['toolCall', 'c1'], ['reasoning', 'THINK-2'], ['markdown', 'REPLY'],
    ]);

    const at = new Date().toISOString();
    const entries: Bag[] = [
      { type: 'message', id: 'u1', parentId: null, timestamp: at, message: { role: 'user', content: 'go', timestamp: 0 } },
    ];
    messages.forEach((content, index) => {
      entries.push({ type: 'message', id: `a${index}`, parentId: 'u1', timestamp: at, message: answer(content, 'stop') });
      if (content.includes(call)) {
        entries.push({
          type: 'message',
          id: `r${index}`,
          parentId: `a${index}`,
          timestamp: at,
          message: { role: 'toolResult', toolCallId: 'c1', toolName: 'read', content: [{ type: 'text', text: 'ok' }], isError: false, timestamp: 0 },
        });
      }
    });
    const { turns } = replayEntries(entries as never);
    const replayed = turns[0]!.parts.map((p) => [p.id, p.kind, p.kind === 'toolCall' ? (p.toolCall as Bag).toolCallId : p.content]);
    expect(replayed).toEqual(seen);
  }
});

it('opens no part for a text block that is only whitespace, live and replayed', async () => {
  const { replayEntries } = await import('../src/replay.js');
  const call = { type: 'toolCall', id: 'c1', name: 'read', arguments: { path: 'a.ts' } };
  // Kimi K2.6's shape: a blank text block between each thought and its call.
  const messages: Bag[][] = [
    [{ type: 'thinking', thinking: 'THINK-1' }, { type: 'text', text: ' ' }, call],
    [{ type: 'thinking', thinking: 'THINK-2' }, { type: 'text', text: 'REPLY' }],
  ];
  const live = turn('u1');
  const sent: Bag[] = [];
  for (const content of messages) for (const event of streamed(content)) sent.push(...mapEvent(live, event));
  const seen = live.parts.map((p) => [p.id, p.kind, p.kind === 'toolCall' ? (p.toolCall as Bag).toolCallId : p.content]);
  // A tool call part has no id of its own: the id is its call's.
  expect(seen).toEqual([
    ['u1:1:0', 'reasoning', 'THINK-1'], [undefined, 'toolCall', 'c1'], ['u1:2:0', 'reasoning', 'THINK-2'], ['u1:2:1', 'markdown', 'REPLY'],
  ]);
  expect(sent.filter((a) => a.type === 'chat/delta').map((a) => a.content)).toEqual(['REPLY']);

  const at = new Date().toISOString();
  const entries: Bag[] = [
    { type: 'message', id: 'u1', parentId: null, timestamp: at, message: { role: 'user', content: 'go', timestamp: 0 } },
    { type: 'message', id: 'a0', parentId: 'u1', timestamp: at, message: answer(messages[0]!, 'toolUse') },
    {
      type: 'message',
      id: 'r0',
      parentId: 'a0',
      timestamp: at,
      message: { role: 'toolResult', toolCallId: 'c1', toolName: 'read', content: [{ type: 'text', text: 'ok' }], isError: false, timestamp: 0 },
    },
    { type: 'message', id: 'a1', parentId: 'r0', timestamp: at, message: answer(messages[1]!, 'stop') },
  ];
  const { turns } = replayEntries(entries as never);
  const replayed = turns[0]!.parts.map((p) => [p.id, p.kind, p.kind === 'toolCall' ? (p.toolCall as Bag).toolCallId : p.content]);
  expect(replayed).toEqual(seen);
});

it('opens a call\'s row when the model starts writing it, and starts it once', () => {
  const one = turn();
  const events = streamed([{ type: 'toolCall', id: 'c1', name: 'bash', arguments: { command: 'ls' } }]);
  const starts = events
    .map((event) => [event, mapEvent(one, event).filter((a) => a.type === 'chat/toolCallStart')] as const)
    .filter(([, found]) => found.length > 0);
  expect(starts).toHaveLength(1);
  expect(starts[0]![1]).toHaveLength(1);
  expect((starts[0]![0] as Bag).assistantMessageEvent).toMatchObject({ type: 'toolcall_start' });
});

it('opens a tool call and leaves its ready to the hook', () => {
  const one = turn();
  const actions = mapEvent(one, {
    type: 'tool_execution_start', toolCallId: 'c1', toolName: 'bash', args: { command: 'ls' },
  });
  expect(actions.map((a) => a.type)).toEqual(['chat/toolCallStart']);
  expect(actions[0]?.toolName).toBe('bash');
});

it('closes a failed call with the error a client shows', () => {
  const one = turn();
  mapEvent(one, { type: 'tool_execution_start', toolCallId: 'c1', toolName: 'bash', args: {} });
  const done = mapEvent(one, {
    type: 'tool_execution_end', toolCallId: 'c1', toolName: 'bash', result: 'no such file', isError: true,
  }).find((action) => action.type === 'chat/toolCallComplete');
  expect(done).toBeDefined();
  expect((done?.result as Bag).success).toBe(false);
  expect(((done?.result as Bag).error as Bag).message).toBe('no such file');
});

it('lands a shell delta on the call that opened the row, and drops an orphan', () => {
  const one = turn();
  mapEvent(one, { type: 'tool_execution_start', toolCallId: 'c1', toolName: 'bash', args: {} });
  expect(mapEvent(one, { type: 'bash_execution_update', id: 'c1', delta: 'line\n' })
    .map((a) => a.type)).toEqual(['chat/toolCallContentChanged']);
  expect(mapEvent(one, { type: 'bash_execution_update', id: 'nobody', delta: 'x' })).toEqual([]);
});

it('says nothing for an event it has no action for, rather than throwing', () => {
  expect(mapEvent(turn(), { type: 'summarization_retry_finished' })).toEqual([]);
  expect(mapEvent(turn(), { type: 'queue_update', steering: [], followUp: [] })).toEqual([]);
});

it('reads a tool result whatever shape it came in', () => {
  expect(resultText('plain')).toBe('plain');
  expect(resultText({ output: 'from output' })).toBe('from output');
  expect(resultText({ content: [{ text: 'a' }, { text: 'b' }] })).toBe('a\nb');
  expect(resultText(undefined)).toBe('');
});

it('tells "this event says nothing about activity" from "it is idle now"', () => {
  expect(activityOf({ type: 'agent_settled', aborted: false })).toBeUndefined();
  expect(activityOf({ type: 'summarization_retry_finished' })).toBe(false);
  expect(activityOf({ type: 'tool_execution_start', toolCallId: 'c', toolName: 'bash', args: {} }))
    .toBe('Running bash');
});

// When a call ran ----------------------------------------------------------

/*
 * How long a pi tool call ran, live and replayed.
 *
 * The protocol gives a call no time of its own, so how long it ran rides its
 * `_meta` at its completion, under the key VS Code's client reads it from:
 * measured on this plugin's clock live and from pi's own entries on a replay.
 */

/** The `_meta` an action carries, or an empty bag for one that carries none. */
const metaOf = (action: Bag | undefined): Bag => (action?._meta ?? {}) as Bag;

it('says how long a live call ran at its completion, and nothing of its times before', async () => {
  const { session, pi, sent } = opened({ settings: { permissionMode: 'bypassPermissions' } } as Partial<Start>);
  pi.hold();
  session.sendMessage('t1', 'hello');
  await settled();
  await driveCall(pi, 'c1', 'bash', { command: 'ls' });
  pi.raise({ type: 'tool_execution_end', toolCallId: 'c1', toolName: 'bash', result: 'ok', isError: false });
  const for1 = (type: string) => sent.find((one) => one.action.type === type && one.action.toolCallId === 'c1')?.action;
  expect(for1('chat/toolCallReady')?._meta).toBeUndefined();
  expect(metaOf(for1('chat/toolCallComplete'))).toEqual({ 'vscode.toolCallDurationMs': expect.any(Number) });
  const parts = (session.chatState().activeTurn as Bag).responseParts as Bag[];
  expect(callIn(parts, 'c1')?._meta).toEqual({ 'vscode.toolCallDurationMs': expect.any(Number) });
});

it('measures a call from when pi began running it, on a row the model opened', async () => {
  const one = turn();
  const message = { role: 'assistant', content: [{ type: 'toolCall', id: 'c1', name: 'bash', arguments: { command: 'ls' } }] };
  mapEvent(one, { type: 'message_update', message, assistantMessageEvent: { contentIndex: 0, partial: message, type: 'toolcall_start' } } as unknown as AgentSessionEvent);
  // The model's stream names the call; pi runs it afterwards, which is when it
  // started.
  const opened_ = mapEvent(one, { type: 'tool_execution_start', toolCallId: 'c1', toolName: 'bash', args: {} }, 1_700_000_000_000);
  expect(opened_).toEqual([]);
  expect((one.parts[0]?.toolCall as Bag)._meta).toBeUndefined();
  const ended_ = mapEvent(one, { type: 'tool_execution_end', toolCallId: 'c1', toolName: 'bash', result: 'ok', isError: false }, 1_700_000_002_500);
  expect(metaOf(ended_.find((action) => action.type === 'chat/toolCallComplete'))).toEqual({ 'vscode.toolCallDurationMs': 2_500 });
});

it('measures an approved call from its approval, and a denied one not at all', async () => {
  let now = 1_700_000_000_000;
  const clock = vi.spyOn(Date, 'now').mockImplementation(() => now);
  const { session, pi, sent } = opened({ settings: { permissionMode: 'default' } } as Partial<Start>);
  pi.hold();
  session.sendMessage('t1', 'hello');
  await settled();
  const asked = now;
  const waiting = driveCall(pi, 'c1', 'bash', { command: 'ls' });
  await settled();
  now += 30_000;
  const approved = now;
  session.confirm('c1', true);
  await waiting;
  now += 2_000;
  pi.raise({ type: 'tool_execution_end', toolCallId: 'c1', toolName: 'bash', result: 'ok', isError: false });
  const complete = sent.find((one) => one.action.type === 'chat/toolCallComplete' && one.action.toolCallId === 'c1')?.action;
  // The question waited for a person, which is not work: the call ran from its
  // approval, not from the ready that asked.
  expect(approved - asked).toBe(30_000);
  expect(metaOf(complete)['vscode.toolCallDurationMs']).toBe(2_000);

  session.sendMessage('t2', 'again');
  await settled();
  const refused = driveCall(pi, 'c2', 'bash', { command: 'rm -rf /' });
  await settled();
  session.confirm('c2', false);
  await refused;
  pi.raise({ type: 'tool_execution_end', toolCallId: 'c2', toolName: 'bash', result: 'blocked', isError: true });
  // A call refused never ran, so nothing says how long it ran.
  const parts = (session.chatState().activeTurn as Bag).responseParts as Bag[];
  expect(callIn(parts, 'c2')?._meta ?? {}).not.toHaveProperty('vscode.toolCallDurationMs');
  clock.mockRestore();
});

it('measures a replayed call between the entries that ran it', async () => {
  const { replayEntries } = await import('../src/replay.js');
  const call = { type: 'toolCall', id: 'c1', name: 'bash', arguments: { command: 'ls' } };
  const entries: Bag[] = [
    { type: 'message', id: 'u1', parentId: null, timestamp: '2020-01-01T00:00:00.000Z', message: { role: 'user', content: 'go', timestamp: 0 } },
    { type: 'message', id: 'a0', parentId: 'u1', timestamp: '2020-01-01T00:00:05.000Z', message: answer([call], 'toolUse') },
    {
      type: 'message',
      id: 'r0',
      parentId: 'a0',
      timestamp: '2020-01-01T00:00:09.500Z',
      message: { role: 'toolResult', toolCallId: 'c1', toolName: 'bash', content: [{ type: 'text', text: 'ok' }], isError: false, timestamp: 0 },
    },
  ];
  const { turns } = replayEntries(entries as never);
  const row = callIn(turns[0]!.parts, 'c1') as Bag;
  // pi's own times, not the moment this process read the file.
  expect(row._meta).toEqual({ 'vscode.toolCallDurationMs': 4500 });
});

it('never writes a bare timing key on a pi tool call', async () => {
  const { session, pi, sent } = opened({ settings: { permissionMode: 'bypassPermissions' } } as Partial<Start>);
  pi.hold();
  session.sendMessage('t1', 'hello');
  await settled();
  await driveCall(pi, 'c1', 'bash', { command: 'ls' });
  pi.raise({ type: 'tool_execution_end', toolCallId: 'c1', toolName: 'bash', result: 'ok', isError: false });
  const parts = (session.chatState().activeTurn as Bag).responseParts as Bag[];
  for (const { action } of sent) {
    const keys = Object.keys(metaOf(action));
    expect(keys, String(action.type)).not.toContain('startedAt');
    expect(keys, String(action.type)).not.toContain('endedAt');
    expect(keys, String(action.type)).not.toContain('durationMs');
  }
  const keys = Object.keys(callIn(parts, 'c1')?._meta as Bag);
  expect(keys).not.toContain('startedAt');
});