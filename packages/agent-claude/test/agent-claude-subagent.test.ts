import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import type { Bag, SubagentChat, SubagentRequest } from '@ahpd/sdk';

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
    /** Start a new feed for the next session. */
    reset() { state.feed = fresh(); },
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

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  createSdkMcpServer: (given: Record<string, unknown>) => ({ type: 'sdk', name: given.name, tools: given.tools }),
  query: ({ options }: { options: Record<string, unknown> }) => {
    sdk.canUseTool = options.canUseTool as typeof sdk.canUseTool;
    const feed = sdk.feed;
    return {
      async *[Symbol.asyncIterator]() {
        for (;;) yield await sdk.next(feed);
      },
      interrupt: async () => {},
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
async function replay(name: string, frames: Record<string, unknown>[] = fixture(name)) {
  sdk.reset();
  sdk.push(...frames);
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
  });
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
    title: 'Explore',
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
    title: 'Explore',
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
    resource: worker?.uri, title: 'Explore', agentName: 'Explore',
  });
  expect(worker?.ended).toEqual([{ state: 'complete' }]);
  // Its frames after the lead turn ended are still its own.
  const actions = drew(worker as Worker);
  expect(actions.some((one) => one.type === 'chat/toolCallStart' && one.toolName === 'Bash')).toBe(true);
});

it('says nothing for a subagent when the host has no seam', async () => {
  // The same fixture, without `subagent`: a worker's frames stay in the turn
  // that spawned them.
  sdk.reset();
  sdk.push(...fixture('claude-subagent.jsonl'));
  const main: Bag[] = [];
  createSession({
    uri: 'ahp-session:/plain',
    chatUri: 'ahp-chat:/plain',
    cwd: mkdtempSync(join(tmpdir(), 'ahpd-plain-')),
    emit: (_channel, action) => { main.push(action as Bag); },
  });
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

  // Approving it there lets the tool run and is said back where it was asked.
  session.confirm(write, true);
  await expect(asked).resolves.toMatchObject({ behavior: 'allow' });
  expect(worker.actions.some((one) => one.type === 'chat/toolCallConfirmed' && one.toolCallId === write)).toBe(true);

  // The rest of the turn: the tool's result on the worker's chat, which ends once.
  sdk.push(...lines.slice(at + 1));
  await settle();
  expect(worker.actions.some((one) => one.type === 'chat/toolCallComplete' && one.toolCallId === write)).toBe(true);
  expect(worker.ended).toEqual([{ state: 'complete' }]);
});

it('ends a cancelled turn\'s worker once, and a late frame does not reopen it', async () => {
  const lines = fixture('claude-subagent.jsonl');
  const { workers, session, asked } = await replay('claude-subagent.jsonl', lines.slice(0, 6));
  const call = 'toolu_01SvkwpPC6azWzz1jZ8nEtV6';
  session.cancel('');
  await settle();
  expect(workers.get(call)?.ended).toEqual([{ state: 'cancelled' }]);
  // The inner tool's result, which the harness sends after the interrupt.
  sdk.push(lines[6] as Record<string, unknown>);
  await settle();
  expect(asked.filter((one) => one === call)).toHaveLength(1);
  expect(workers.get(call)?.ended).toEqual([{ state: 'cancelled' }]);
});

it('leaves a background worker from an earlier turn running when a later turn is cancelled', async () => {
  const lines = fixture('claude-subagent-background.jsonl');
  // Through the lead turn's result and the worker's first frame after it, so
  // the worker is open when the next turn begins.
  const { workers, session } = await replay('claude-subagent-background.jsonl', lines.slice(0, 7));
  const call = 'toolu_01Riysq5EgQZGcUE9kDMp6AB';
  expect(workers.has(call)).toBe(true);
  session.begin('t2', 'and another thing');
  await settle();
  session.cancel('t2');
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

it('describes the spawning call in its _meta, on its start and its ready action', async () => {
  const { main } = await replay('claude-subagent.jsonl');
  const call = 'toolu_01SvkwpPC6azWzz1jZ8nEtV6';
  const lead = main.map((one) => one.action);
  const described = { toolKind: 'subagent', subagentDescription: 'List files in folder', subagentAgentName: 'Explore' };
  expect(lead.find((one) => one.type === 'chat/toolCallReady' && one.toolCallId === call)?._meta).toEqual(described);
  expect(lead.find((one) => one.type === 'chat/toolCallStart' && one.toolCallId === call)?._meta).toEqual(described);
});
