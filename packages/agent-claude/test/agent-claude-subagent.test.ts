import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import type { Bag, BoundTool, SubagentChat, SubagentRequest } from '@ahpd/sdk';

/*
 * A subagent's frames, drawn on the chat that call opened.
 *
 * The SDK sends the main turn and every subagent it delegates to down one
 * stream, told apart only by `parent_tool_use_id`. This replays a real
 * capture - `claude-subagent.jsonl`, from a `claude -p` session with
 * `forwardSubagentText` on - through a session with a fake host seam, and
 * checks the two halves: the worker's text, thinking and tool calls are on
 * its own chat, and the main turn keeps the call that spawned it, linked to
 * that chat.
 */

/**
 * The SDK's stream as a queue a test pushes frames into.
 *
 * Pulled one frame at a time, so a test can cancel, answer or begin a turn
 * between two frames the way a live stream allows. Each query reads the feed
 * that was current when it was made, so a session left over from an earlier
 * case never takes a later case's frames.
 */
const sdk = vi.hoisted(() => {
  interface Feed { held: Record<string, unknown>[]; wake: (() => void) | undefined }
  const fresh = (): Feed => ({ held: [], wake: undefined });
  const state = {
    canUseTool: undefined as undefined | ((name: string, input: Bag, about?: Bag) => Promise<unknown>),
    /** The feed the next query reads, and the one `push` writes to. */
    feed: fresh(),
    /** The task ids `stopTask` was called with, in order. */
    stopped: [] as string[],
    /** How many times the query was interrupted. */
    interrupted: 0,
    /** Start a new feed for the next session. */
    reset() { state.feed = fresh(); state.stopped = []; state.interrupted = 0; },
    /** Queue frames for the current session to read. */
    push(...frames: Record<string, unknown>[]) {
      const feed = state.feed;
      feed.held.push(...frames);
      feed.wake?.();
      feed.wake = undefined;
    },
    /** One feed's next frame, once one is queued. */
    async next(feed: Feed): Promise<Record<string, unknown>> {
      while (feed.held.length === 0) await new Promise<void>((resolve) => { feed.wake = resolve; });
      return feed.held.shift() as Record<string, unknown>;
    },
  };
  return state;
});

vi.mock('@anthropic-ai/claude-agent-sdk', async () => (await import('../../sdk/test/support/warmed.js')).warmed({
  createSdkMcpServer: (given: Record<string, unknown>) => ({ type: 'sdk', name: given.name, tools: given.tools }),
  query: ({ options }: { options: Record<string, unknown> }) => {
    sdk.canUseTool = options.canUseTool as typeof sdk.canUseTool;
    const feed = sdk.feed;
    return {
      async *[Symbol.asyncIterator]() {
        for (;;) yield await sdk.next(feed);
      },
      interrupt: async () => { sdk.interrupted += 1; },
      stopTask: async (taskId: string) => { sdk.stopped.push(taskId); },
      setPermissionMode: async () => {},
      setModel: async () => {},
      applyFlagSettings: async () => {},
      toggleMcpServer: async () => {},
      reconnectMcpServer: async () => {},
      setMcpServers: async () => {},
      initializationResult: async () => ({}),
      mcpServerStatus: async () => [],
      reloadSkills: async () => ({ skills: [] }),
      reloadPlugins: async () => ({ plugins: [] }),
      supportedModels: async () => [],
      streamInput: async () => {},
      close: () => {},
    };
  },
}));

const { createSession } = await import('../src/session.js');
const { titleOf } = await import('../src/input.js');

const fixture = (name: string): Record<string, unknown>[] => readFileSync(
  new URL(`./fixtures/${name}`, import.meta.url),
  'utf8',
).split('\n').filter((line) => line.trim() !== '').map((line) => JSON.parse(line) as Record<string, unknown>);

const settle = async (times = 30): Promise<void> => {
  for (let i = 0; i < times; i++) await new Promise((r) => { setTimeout(r, 0); });
};

interface Worker {
  uri: string;
  request: SubagentRequest;
  actions: Bag[];
  ended: { state: string; why?: string }[];
}

/** Replay one fixture through a real session with a recording host seam. */
async function replay(name: string, frames: Record<string, unknown>[] = fixture(name), tools: BoundTool[] = [], preset?: Bag) {
  sdk.reset();
  const main: { channel: string; action: Bag }[] = [];
  const workers = new Map<string, Worker>();
  /** Every call id the seam was asked for, once per ask. */
  const asked: string[] = [];
  /** How many lead actions had been emitted when each call's worker was asked for. */
  const askedAt = new Map<string, number>();
  const subagent = (toolCallId: string, request: SubagentRequest): SubagentChat => {
    asked.push(toolCallId);
    if (!askedAt.has(toolCallId)) askedAt.set(toolCallId, main.length);
    const uri = `ahp-chat://subagent/fake/${encodeURIComponent(toolCallId)}`;
    const held: Worker = { uri, request, actions: [], ended: [] };
    workers.set(toolCallId, held);
    return {
      uri,
      turnId: `wturn-${toolCallId}`,
      emit: (action) => { held.actions.push(action); },
      end: (state, why) => { held.ended.push({ state, ...(why !== undefined ? { why } : {}) }); },
    };
  };
  const session = createSession({
    uri: 'ahp-session:/sub',
    chatUri: 'ahp-chat:/sub',
    cwd: mkdtempSync(join(tmpdir(), 'ahpd-sub-')),
    emit: (channel, action) => { main.push({ channel, action: action as Bag }); },
    subagent,
    ...(tools.length > 0 ? { tools } : {}),
    ...(preset === undefined ? {} : { preset }),
  });
  await settle();
  // The turn the frames answer.
  session.sendMessage('t1', 'go');
  await settle();
  sdk.push(...frames);
  await settle();
  return { main, workers, session, asked, askedAt };
}

/** The worker's own actions, flattened in arrival order. */
const drew = (held: Worker): Bag[] => held.actions;

it('draws a subagent\'s text, thinking and tool call on its own chat', async () => {
  const { main, workers } = await replay('claude-subagent.jsonl');

  const worker = workers.get('toolu_01SvkwpPC6azWzz1jZ8nEtV6');
  expect(worker).toBeDefined();
  // What the harness said about the worker, which is what names its chat.
  expect(worker?.request).toMatchObject({
    title: 'List files in folder',
    agentName: 'Explore',
    description: 'List files in folder',
  });
  expect(worker?.request.prompt).toContain('List all the files');

  const actions = drew(worker as Worker);
  const text = actions.filter((one) => one.type === 'chat/responsePart' && (one.part as Bag).kind === 'markdown');
  expect(text.length).toBeGreaterThan(0);
  expect(JSON.stringify(text)).toContain('directory contents');

  // The tool call the subagent made, and its result, both on its chat.
  const starts = actions.filter((one) => one.type === 'chat/toolCallStart');
  expect(starts.some((one) => one.toolName === 'Bash')).toBe(true);
  const completes = actions.filter((one) => one.type === 'chat/toolCallComplete');
  expect(completes.length).toBeGreaterThanOrEqual(1);

  // None of that is on the lead chat.
  const lead = main.map((one) => one.action);
  expect(lead.some((one) => one.type === 'chat/responsePart'
    && (one.part as Bag).kind === 'markdown'
    && String((one.part as Bag).content).includes('directory contents'))).toBe(false);
  expect(lead.some((one) => one.type === 'chat/toolCallStart' && one.toolName === 'Bash')).toBe(false);
});

it('keeps the spawning call in the lead turn, with the worker linked from it', async () => {
  const { main, workers } = await replay('claude-subagent.jsonl');

  const lead = main.map((one) => one.action);
  const start = lead.find((one) => one.type === 'chat/toolCallStart' && one.toolName === 'Agent');
  expect(start).toBeDefined();

  const complete = lead.find((one) => one.type === 'chat/toolCallComplete'
    && one.toolCallId === 'toolu_01SvkwpPC6azWzz1jZ8nEtV6');
  expect(complete).toBeDefined();
  const result = complete?.result as Bag;
  const content = result.content as Bag[];
  const link = content.find((one) => one.type === 'subagent');
  expect(link).toMatchObject({
    resource: 'ahp-chat://subagent/fake/toolu_01SvkwpPC6azWzz1jZ8nEtV6',
    title: 'List files in folder',
    agentName: 'Explore',
    description: 'List files in folder',
  });
  expect(workers.get('toolu_01SvkwpPC6azWzz1jZ8nEtV6')?.ended).toEqual([{ state: 'complete' }]);
});

it('ends a foreground worker once', async () => {
  const { workers } = await replay('claude-subagent.jsonl');
  const worker = workers.get('toolu_01SvkwpPC6azWzz1jZ8nEtV6');
  // The harness sends a notification for a foreground worker too, before the
  // call's result, and the two end it once between them.
  expect(worker?.ended).toHaveLength(1);
  expect(worker?.ended[0]?.state).toBe('complete');
});

it('keeps a background worker running until its task notification', async () => {
  const { main, workers, askedAt } = await replay('claude-subagent-background.jsonl');
  const worker = workers.get('toolu_01Riysq5EgQZGcUE9kDMp6AB');
  expect(worker).toBeDefined();
  // Its spawning call's result says only that it was launched, and it arrives
  // before any of the worker's frames; the worker is opened for it, so the
  // completion links the chat.
  const lead = main.map((one) => one.action);
  const at = lead.findIndex((one) => one.type === 'chat/toolCallComplete'
    && one.toolCallId === 'toolu_01Riysq5EgQZGcUE9kDMp6AB');
  expect(at).toBeGreaterThanOrEqual(0);
  expect(askedAt.get('toolu_01Riysq5EgQZGcUE9kDMp6AB')).toBeLessThanOrEqual(at);
  const content = ((lead[at]?.result as Bag).content ?? []) as Bag[];
  expect(content.find((one) => one.type === 'subagent')).toMatchObject({
    resource: worker?.uri, title: 'List files recursively', agentName: 'Explore',
  });
  expect(worker?.ended).toEqual([{ state: 'complete' }]);
  // Its frames after the lead turn ended are still its own.
  const actions = drew(worker as Worker);
  expect(actions.some((one) => one.type === 'chat/toolCallStart' && one.toolName === 'Bash')).toBe(true);
});

/*
 * The hold is bounded as VS Code's host bounds it: a worker whose spawning
 * call has not come within 30 s is failed, its held frames dropped, and the
 * call that comes later announces no chat for it.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentSideEffects.ts#L144-L175
 */
it('drops a worker whose spawning call never came within the hold\'s 30 s', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  try {
    const lines = fixture('claude-subagent.jsonl');
    const { asked } = await replay('none', [
      lines[0] as Record<string, unknown>,
      lines[4] as Record<string, unknown>,
    ]);
    expect(asked).toEqual([]);
    vi.advanceTimersByTime(30_000);

    sdk.push(...[lines[1], lines[2], lines[3], ...lines.slice(5)] as Record<string, unknown>[]);
    await settle();
    expect(asked).toEqual([]);
  }
  finally {
    vi.useRealTimers();
  }
});

it('drops a worker whose spawning call never came within the record\'s subagentStartTimeoutMs', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  try {
    const lines = fixture('claude-subagent.jsonl');
    const { asked } = await replay('none', [
      lines[0] as Record<string, unknown>,
      lines[4] as Record<string, unknown>,
    ], [], { subagentStartTimeoutMs: 1000 });
    expect(asked).toEqual([]);
    vi.advanceTimersByTime(1000);

    sdk.push(...[lines[1], lines[2], lines[3], ...lines.slice(5)] as Record<string, unknown>[]);
    await settle();
    expect(asked).toEqual([]);
  }
  finally {
    vi.useRealTimers();
  }
});

it('waits for the spawning call when the worker speaks first', async () => {
  /*
   * The capture's own order is the `tool_use` before the worker's first frame,
   * by 8-18 ms - which is a race the worker wins whenever the daemon is loaded.
   * The same frames, with the worker's answer delivered first: nothing is said
   * for it until the call that says what it is for arrives, and then it is said
   * all at once, on a chat named by the task.
   */
  const lines = fixture('claude-subagent.jsonl');
  const call = 'toolu_01SvkwpPC6azWzz1jZ8nEtV6';
  const { workers, asked } = await replay('none', [
    lines[0] as Record<string, unknown>,
    lines[4] as Record<string, unknown>,
  ]);
  // The frame is held, not drawn on a chat named `Subagent` and not drawn on
  // the lead chat: there is nothing to name a worker by until its call says so.
  expect(asked).toEqual([]);

  sdk.push(...[lines[1], lines[2], lines[3], ...lines.slice(5)] as Record<string, unknown>[]);
  await settle();

  // One chat, opened by the call rather than by the frame that arrived first.
  expect(asked).toEqual([call]);
  const worker = workers.get(call);
  expect(worker?.request).toMatchObject({
    title: 'List files in folder',
    agentName: 'Explore',
    description: 'List files in folder',
  });
  expect(worker?.request.prompt).toContain('List all the files');

  // And the frame that raced the call is the worker's first part, not the
  // second one - held whole, then delivered, rather than merged in later.
  const drawn = drew(worker as Worker);
  expect(drawn[0]).toMatchObject({ type: 'chat/responsePart' });
  expect((drawn[0]?.part as Bag)?.kind).toBe('markdown');
  expect(JSON.stringify(drawn[0])).toContain('directory contents');
});

it('records the spawn from the permission callback, which the SDK runs first', async () => {
  /*
   * A call confirmed while its input was still streaming: `assistant()` skips
   * it afterwards, because it is no longer streaming and something already
   * opened the row. The callback was handed the whole input, and is the only
   * place left the harness said what the worker is for.
   */
  const lines = fixture('claude-subagent.jsonl');
  const call = 'toolu_01SvkwpPC6azWzz1jZ8nEtV6';
  const { main, workers, session, asked: askedFor } = await replay('none', [lines[0] as Record<string, unknown>]);

  const input = { subagent_type: 'Explore', description: 'List files in folder', prompt: 'List all the files under src' };
  const asked = sdk.canUseTool?.('Agent', input, { toolUseID: call });
  await settle();
  session.confirm(call, true);
  await expect(asked).resolves.toMatchObject({ behavior: 'allow' });
  // The record is all the call ever got: nothing has opened a worker yet,
  // because a worker's chat is opened by its own frames or by its call's end.
  expect(askedFor).toEqual([]);

  sdk.push(lines[4] as Record<string, unknown>, lines[12] as Record<string, unknown>);
  await settle();

  // The worker's chat is named by that record and opened on its prompt, and
  // the frames that followed land on it.
  const worker = workers.get(call);
  expect(worker?.request).toMatchObject({ title: 'List files in folder', agentName: 'Explore' });
  expect(worker?.request.prompt).toBe('List all the files under src');
  expect(drew(worker as Worker).some((one) => JSON.stringify(one).includes('directory contents'))).toBe(true);
  // The canonical message never arrived, so the lead's row is the ask's own.
  expect(main.some((one) => one.action.toolCallId === call)).toBe(true);
});

/*
 * A worker no spawn was recorded for is never announced, its frames held, as
 * VS Code's host holds a subagent's signals for a chat not yet announced: its
 * spawning call's result and a stop open nothing.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/claude/claudeSubagentSignals.ts#L60-L66
 */
it('opens no chat for a worker no spawn was recorded for, on its result or at a stop', async () => {
  const lines = fixture('claude-subagent.jsonl');
  const call = 'toolu_01SvkwpPC6azWzz1jZ8nEtV6';
  // The harness's `tool_use` never arrives: all there is of the spawning call
  // is a result, naming a worker that has already spoken.
  const { main, session, asked } = await replay('none', [
    lines[0] as Record<string, unknown>,
    lines[4] as Record<string, unknown>,
  ]);
  expect(asked).toEqual([]);

  sdk.push({ type: 'user', parent_tool_use_id: null, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: call, content: 'done' }] } });
  await settle();
  expect(asked).toEqual([]);
  // Nothing on the lead either: a result with no call behind it draws no row.
  expect(main.some((one) => one.action.type === 'chat/toolCallComplete')).toBe(false);

  session.abort();
  await settle();
  expect(asked).toEqual([]);
});

/*
 * A spawn recorded at its call's block start, before its input exists: a
 * worker that speaks before the input arrives opens its chat with what the
 * spawn holds, as VS Code's mapper records a spawn at the block's start.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/claude/claudeMapSessionEvents.ts#L646-L653
 */
it('opens a worker that speaks after its call\'s block start with what the spawn holds then', async () => {
  const lines = fixture('claude-subagent.jsonl');
  const call = 'toolu_01SvkwpPC6azWzz1jZ8nEtV6';
  const { workers, asked } = await replay('none', [
    { type: 'stream_event', parent_tool_use_id: null, event: { type: 'message_start', message: { id: 'msg_spawn' } } },
    { type: 'stream_event', parent_tool_use_id: null, event: { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: call, name: 'Agent', input: {} } } },
    lines[4] as Record<string, unknown>,
  ]);
  expect(asked).toEqual([call]);
  expect(workers.get(call)?.request).toMatchObject({ title: 'Subagent' });
  expect(drew(workers.get(call) as Worker).some((one) => JSON.stringify(one).includes('directory contents'))).toBe(true);
});

it('names a worker chat by its task, cut to sixty characters', () => {
  expect(titleOf('x'.repeat(80), 'Explore')).toBe(`${'x'.repeat(60)}…`);
  // No task, or nothing but whitespace in one, is the kind of worker it is.
  expect(titleOf(undefined, 'Explore')).toBe('Explore');
  expect(titleOf('   ', 'Explore')).toBe('Explore');
  // Trimmed first, so a description padded out is not cut before it is read.
  expect(titleOf(`  ${'y'.repeat(80)}  `, undefined)).toBe(`${'y'.repeat(60)}…`);
  expect(titleOf(undefined, undefined)).toBe('Subagent');
  expect(titleOf('Rewrite refs: host 49, 50', 'Explore')).toBe('Rewrite refs: host 49, 50');
});

it('cuts a worker chat\'s title to the record\'s subagentTitleMax', () => {
  expect(titleOf('x'.repeat(80), 'Explore', 20)).toBe(`${'x'.repeat(20)}…`);
});

it('says nothing for a subagent when the host has no seam', async () => {
  // The same fixture, without `subagent`: a worker's frames stay in the turn
  // that spawned them.
  sdk.reset();
  const main: Bag[] = [];
  const session = createSession({
    uri: 'ahp-session:/plain',
    chatUri: 'ahp-chat:/plain',
    cwd: mkdtempSync(join(tmpdir(), 'ahpd-plain-')),
    emit: (_channel, action) => { main.push(action as Bag); },
  });
  await settle();
  session.sendMessage('t1', 'go');
  await settle();
  sdk.push(...fixture('claude-subagent.jsonl'));
  await settle();
  // The lead turn still draws the worker's frames inline.
  expect(main.some((one) => one.type === 'chat/toolCallStart' && one.toolName === 'Bash')).toBe(true);
  expect(main.some((one) => one.type === 'chat/toolCallComplete'
    && one.toolCallId === 'toolu_01SvkwpPC6azWzz1jZ8nEtV6')).toBe(true);
});

it('asks about a tool inside a subagent on that subagent\'s chat', async () => {
  /*
   * A captured turn whose subagent writes a file, with the permission ask
   * recorded where it arrived: after the worker's own frame naming the call,
   * with the call's id on `toolUseID` and the worker's on `agentID`.
   */
  const lines = fixture('claude-subagent-ask.jsonl');
  const at = lines.findIndex((one) => one.type === 'canUseTool');
  const ask = lines[at] as { toolName: string; input: Bag; options: Bag };
  const { main, workers, session } = await replay('claude-subagent-ask.jsonl', lines.slice(0, at));
  const worker = workers.get('toolu_01E8tKqC8MnZY1MrcVsb2ho4') as Worker;
  expect(worker).toBeDefined();
  const write = String(ask.options.toolUseID);

  const asked = sdk.canUseTool?.(ask.toolName, ask.input, ask.options);
  expect(asked).toBeDefined();
  await settle();

  // The question is drawn on the worker's chat, against the call already there.
  const ready = worker.actions.filter((one) => one.type === 'chat/toolCallReady' && one.toolCallId === write);
  expect(ready.filter((one) => one.confirmationTitle !== undefined)).toHaveLength(1);
  // And not on the lead chat, where it would read as the parent's own question.
  const lead = main.map((one) => one.action);
  expect(lead.some((one) => one.toolCallId === write)).toBe(false);
  const needed = (session.sessionState().inputNeeded as Bag[]) ?? [];
  expect(needed.some((one) => one.chat === worker.uri)).toBe(true);

  // Approving it there lets the tool run. The confirmation is the client's,
  // which the host says where it was asked, so the backend says none of its own.
  session.confirm(write, true);
  await expect(asked).resolves.toMatchObject({ behavior: 'allow' });
  expect(worker.actions.some((one) => one.type === 'chat/toolCallConfirmed')).toBe(false);

  // The rest of the turn: the tool's result on the worker's chat, which ends once.
  sdk.push(...lines.slice(at + 1));
  await settle();
  expect(worker.actions.some((one) => one.type === 'chat/toolCallComplete' && one.toolCallId === write)).toBe(true);
  expect(worker.ended).toEqual([{ state: 'complete' }]);
});

it('asks a client to run a worker\'s call on the worker\'s chat', async () => {
  /*
   * Every input-needed entry carries the chat it is in, with the turn and the
   * call a client answers by on that chat's channel.
   * https://github.com/microsoft/agent-host-protocol/blob/5f16d81bb7045b66d7bc768d244feab75002d943/docs/specification/session-channel.md#L118
   */
  const lines = fixture('claude-subagent.jsonl');
  const call = 'toolu_01SvkwpPC6azWzz1jZ8nEtV6';
  // The client's tool on offer from the session's start, so the turn has it.
  const { main, workers } = await replay('none', lines.slice(0, 5), [{
    owner: 'probe',
    definition: { name: 'probe__openFile', description: 'Open a file', inputSchema: { type: 'object', properties: {} } },
  } as unknown as BoundTool]);
  const worker = workers.get(call) as Worker;
  expect(worker).toBeDefined();

  sdk.push({
    type: 'assistant',
    parent_tool_use_id: call,
    uuid: 'worker-open',
    message: {
      id: 'msg-worker-open',
      role: 'assistant',
      content: [{ type: 'tool_use', id: 'toolu_open', name: 'mcp__client__probe__openFile', input: { path: '/a.txt' } }],
    },
  });
  await settle();

  const raised = main
    .filter((one) => one.channel === 'session' && one.action.type === 'session/inputNeededSet')
    .map((one) => one.action.request as Bag)
    .filter((one) => one.kind === 'toolClientExecution');
  expect(raised).toHaveLength(1);
  expect(raised[0]).toMatchObject({
    chat: worker.uri,
    turnId: `wturn-${call}`,
    clientId: 'probe',
    toolCall: { toolCallId: 'toolu_open', toolName: 'openFile' },
  });
});

it('ends a cancelled turn\'s worker once, and a late frame does not reopen it', async () => {
  const lines = fixture('claude-subagent.jsonl');
  const { workers, session, asked } = await replay('claude-subagent.jsonl', lines.slice(0, 6));
  const call = 'toolu_01SvkwpPC6azWzz1jZ8nEtV6';
  session.abort();
  await settle();
  expect(workers.get(call)?.ended).toEqual([{ state: 'cancelled' }]);
  // The inner tool's result, which the harness sends after the interrupt.
  sdk.push(lines[6] as Record<string, unknown>);
  await settle();
  expect(asked.filter((one) => one === call)).toHaveLength(1);
  expect(workers.get(call)?.ended).toEqual([{ state: 'cancelled' }]);
});

/*
 * A stop interrupts the turn and keeps the CLI, so a background worker an
 * earlier turn spawned is not the stopped turn's: it keeps running in that CLI
 * and ends on its own notification.
 * https://code.claude.com/docs/en/agent-sdk/typescript#query-object
 */
it('leaves a background worker from an earlier turn running when a later turn is stopped', async () => {
  const lines = fixture('claude-subagent-background.jsonl');
  // Through the lead turn's result and the worker's first frame after it, so
  // the worker is open when the next turn begins.
  const { workers, session } = await replay('claude-subagent-background.jsonl', lines.slice(0, 7));
  const call = 'toolu_01Riysq5EgQZGcUE9kDMp6AB';
  expect(workers.has(call)).toBe(true);
  session.sendMessage('t2', 'and another thing');
  await settle();
  session.abort();
  await settle();
  expect(workers.get(call)?.ended ?? []).toEqual([]);
  sdk.push(...lines.slice(7));
  await settle();
  expect(workers.get(call)?.ended).toEqual([{ state: 'complete' }]);
});

it('ends a foreground worker on its notification, and its result ends nothing more', async () => {
  const lines = fixture('claude-subagent.jsonl');
  const call = 'toolu_01SvkwpPC6azWzz1jZ8nEtV6';
  const { main, workers } = await replay('claude-subagent.jsonl', lines.slice(0, 12));
  expect(workers.get(call)?.ended).toEqual([{ state: 'complete' }]);
  sdk.push(...lines.slice(12));
  await settle();
  expect(workers.get(call)?.ended).toEqual([{ state: 'complete' }]);
  // The call's completion still carries the link to the worker that ended first.
  const complete = main.map((one) => one.action).find((one) => one.type === 'chat/toolCallComplete' && one.toolCallId === call);
  const content = ((complete?.result as Bag | undefined)?.content ?? []) as Bag[];
  expect(content.some((one) => one.type === 'subagent' && one.resource === workers.get(call)?.uri)).toBe(true);
});

it('ends a foreground worker on its result when no notification came', async () => {
  const lines = fixture('claude-subagent.jsonl');
  const call = 'toolu_01SvkwpPC6azWzz1jZ8nEtV6';
  const { workers } = await replay('claude-subagent.jsonl', lines.filter((_, index) => index !== 11));
  expect(workers.get(call)?.ended).toEqual([{ state: 'complete' }]);
});

/*
 * Whether a worker runs in the background is the SDK's own report of its
 * task, `task_started`'s `is_backgrounded` and a later `task_updated` patch,
 * as VS Code marks a spawn from `task_started`: a worker moved there is not
 * ended by its call's result, and ends on its notification.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/claude/claudeSubagentSignals.ts#L103-L111
 */
it('keeps a worker the SDK moved to the background running past its call\'s result', async () => {
  const lines = fixture('claude-subagent.jsonl');
  const call = 'toolu_01SvkwpPC6azWzz1jZ8nEtV6';
  const moved = { type: 'system', subtype: 'task_updated', task_id: 'a39214c163af9a96a', patch: { is_backgrounded: true } };
  const { workers } = await replay('claude-subagent.jsonl', [...lines.slice(0, 3), moved, ...lines.slice(3, 11), lines[12] as Record<string, unknown>]);
  expect(workers.get(call)?.ended).toEqual([]);
  sdk.push(lines[11] as Record<string, unknown>);
  await settle();
  expect(workers.get(call)?.ended).toEqual([{ state: 'complete' }]);
});

it('describes the spawning call in its _meta, on its start and its ready action', async () => {
  const { main } = await replay('claude-subagent.jsonl');
  const call = 'toolu_01SvkwpPC6azWzz1jZ8nEtV6';
  const lead = main.map((one) => one.action);
  const described = { toolKind: 'subagent', subagentDescription: 'List files in folder', subagentAgentName: 'Explore' };
  expect(lead.find((one) => one.type === 'chat/toolCallReady' && one.toolCallId === call)?._meta).toEqual(described);
  expect(lead.find((one) => one.type === 'chat/toolCallStart' && one.toolCallId === call)?._meta).toEqual(described);
});

/** The harness's word that one task was stopped, as `stopTask` makes it send. */
const stoppedNotice = (call: string, task: string): Record<string, unknown> => ({
  type: 'system', subtype: 'task_notification', tool_use_id: call, task_id: task, status: 'stopped', summary: 'stopped',
});

it('stops one foreground worker with its task id, and leaves the lead turn running', async () => {
  const lines = fixture('claude-subagent.jsonl');
  const call = 'toolu_01SvkwpPC6azWzz1jZ8nEtV6';
  const { main, workers, session } = await replay('claude-subagent.jsonl', lines.slice(0, 6));
  session.stopWorker?.(call);
  await settle();
  expect(sdk.stopped).toEqual(['a39214c163af9a96a']);
  expect(sdk.interrupted).toBe(0);
  expect(main.some((one) => one.action.type === 'chat/turnCancelled')).toBe(false);
  // Ended by the harness's own word that it stopped, once.
  expect(workers.get(call)?.ended).toEqual([]);
  sdk.push(stoppedNotice(call, 'a39214c163af9a96a'), stoppedNotice(call, 'a39214c163af9a96a'));
  await settle();
  expect(workers.get(call)?.ended).toEqual([{ state: 'complete' }]);
});

it('stops one background worker with its task id', async () => {
  const lines = fixture('claude-subagent-background.jsonl');
  const call = 'toolu_01Riysq5EgQZGcUE9kDMp6AB';
  const { workers, session } = await replay('claude-subagent-background.jsonl', lines.slice(0, 7));
  session.stopWorker?.(call);
  await settle();
  expect(sdk.stopped).toEqual(['af279e8136cb23ae9']);
  expect(sdk.interrupted).toBe(0);
  sdk.push(stoppedNotice(call, 'af279e8136cb23ae9'));
  await settle();
  expect(workers.get(call)?.ended).toEqual([{ state: 'complete' }]);
});

/*
 * A worker's chat completes however its task ended, failed and stopped
 * alike, as VS Code completes a subagent's chat on its terminal notification.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/claude/claudeSubagentSignals.ts#L114-L130
 */
it('completes a worker\'s chat whose task failed', async () => {
  const lines = fixture('claude-subagent-background.jsonl');
  const call = 'toolu_01Riysq5EgQZGcUE9kDMp6AB';
  const { workers } = await replay('claude-subagent-background.jsonl', lines.slice(0, 7));
  sdk.push({ type: 'system', subtype: 'task_notification', tool_use_id: call, task_id: 'af279e8136cb23ae9', status: 'failed', summary: 'it broke' });
  await settle();
  expect(workers.get(call)?.ended).toEqual([{ state: 'complete' }]);
});

/*
 * A stop in a worker's chat never cancels the lead turn: VS Code's Claude
 * agent, asked to stop a subagent's chat, stops nothing else.
 */
it('stops nothing for a worker the CLI named no task for, and leaves the lead turn running', async () => {
  const lines = fixture('claude-subagent.jsonl');
  const call = 'toolu_01SvkwpPC6azWzz1jZ8nEtV6';
  const { main, session } = await replay('claude-subagent.jsonl', lines.slice(0, 2));
  session.stopWorker?.(call);
  await settle();
  expect(sdk.stopped).toEqual([]);
  expect(sdk.interrupted).toBe(0);
  expect(main.some((one) => one.action.type === 'chat/turnCancelled')).toBe(false);
});

/** A session with a lead turn open, and the asks and frames a test drives it with. */
async function leadTurn() {
  const { main, workers, session } = await replay('none', []);
  session.sendMessage('t1', 'hi');
  await settle();
  return { main, workers, session };
}

/** The tool call a chat's newest ended turn holds under an id. */
const keptCall = (session: Awaited<ReturnType<typeof leadTurn>>['session'], id: string): Bag | undefined => {
  const turns = (session.chatState().turns ?? []) as Bag[];
  const parts = (turns.at(-1)?.responseParts ?? []) as Bag[];
  return parts.map((one) => one.toolCall as Bag | undefined).find((call) => call?.toolCallId === id);
};

const done: Record<string, unknown> = { type: 'result', subtype: 'success', is_error: false, duration_ms: 1 };

it('settles an ask no scope claimed as skipped when the lead turn completes', async () => {
  const { session } = await leadTurn();
  // Neither the call nor the agent is one this session has seen, so the ask
  // lands on the lead turn, where no result for it will ever arrive.
  const asked = sdk.canUseTool?.('Bash', { command: 'ls' }, { toolUseID: 'toolu_orphan', agentID: 'agent-unknown' });
  await settle();
  expect(((session.sessionState().inputNeeded ?? []) as Bag[]).length).toBe(1);
  sdk.push(done);
  await settle();
  expect(keptCall(session, 'toolu_orphan')).toMatchObject({ status: 'cancelled', reason: 'skipped' });
  expect((session.sessionState().inputNeeded ?? []) as Bag[]).toEqual([]);
  await expect(asked).resolves.toMatchObject({ behavior: 'deny' });
});

it('settles a call still running as skipped when the lead turn completes', async () => {
  const { session } = await leadTurn();
  sdk.push({
    type: 'assistant', parent_tool_use_id: null,
    message: { id: 'msg_1', role: 'assistant', content: [{ type: 'tool_use', id: 'toolu_open', name: 'Bash', input: { command: 'sleep 9' } }] },
  }, done);
  await settle();
  const call = keptCall(session, 'toolu_open');
  expect(call).toMatchObject({ status: 'cancelled', reason: 'skipped', toolCallId: 'toolu_open', toolName: 'Bash' });
  expect(call?.confirmed).toBeUndefined();
});

it('settles an ask no scope claimed as skipped when the lead turn is cancelled', async () => {
  const { session } = await leadTurn();
  const asked = sdk.canUseTool?.('Bash', { command: 'ls' }, { toolUseID: 'toolu_orphan', agentID: 'agent-unknown' });
  await settle();
  session.abort();
  await settle();
  expect(keptCall(session, 'toolu_orphan')).toMatchObject({ status: 'cancelled', reason: 'skipped' });
  expect((session.sessionState().inputNeeded ?? []) as Bag[]).toEqual([]);
  await expect(asked).resolves.toMatchObject({ behavior: 'deny' });
});
