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

const sdk = vi.hoisted(() => ({
  frames: [] as Record<string, unknown>[],
  canUseTool: undefined as undefined | ((name: string, input: Bag, about?: Bag) => Promise<unknown>),
}));

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  createSdkMcpServer: (given: Record<string, unknown>) => ({ type: 'sdk', name: given.name, tools: given.tools }),
  query: ({ options }: { options: Record<string, unknown> }) => {
    sdk.canUseTool = options.canUseTool as typeof sdk.canUseTool;
    return {
      async *[Symbol.asyncIterator]() {
        for (const frame of sdk.frames) yield frame;
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

const { createSession } = await import('../packages/agent-claude/src/session.js');

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
  sdk.frames = frames;
  const main: { channel: string; action: Bag }[] = [];
  const workers = new Map<string, Worker>();
  const subagent = (toolCallId: string, request: SubagentRequest): SubagentChat => {
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
  return { main, workers, session };
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

it('ends a foreground worker on the call\'s result, once', async () => {
  const { workers } = await replay('claude-subagent.jsonl');
  const worker = workers.get('toolu_01SvkwpPC6azWzz1jZ8nEtV6');
  // The harness sends a notification for a foreground worker too, and the
  // call's result is the one that ends it.
  expect(worker?.ended).toHaveLength(1);
  expect(worker?.ended[0]?.state).toBe('complete');
});

it('keeps a background worker running until its task notification', async () => {
  const { main, workers } = await replay('claude-subagent-background.jsonl');
  const worker = workers.get('toolu_01Riysq5EgQZGcUE9kDMp6AB');
  expect(worker).toBeDefined();
  // Its spawning call's result says only that it was launched, so nothing has
  // ended it yet.
  const lead = main.map((one) => one.action);
  expect(lead.some((one) => one.type === 'chat/toolCallComplete'
    && one.toolCallId === 'toolu_01Riysq5EgQZGcUE9kDMp6AB')).toBe(true);
  expect(worker?.ended).toEqual([{ state: 'complete' }]);
  // Its frames after the lead turn ended are still its own.
  const actions = drew(worker as Worker);
  expect(actions.some((one) => one.type === 'chat/toolCallStart' && one.toolName === 'Bash')).toBe(true);
});

it('says nothing for a subagent when the host has no seam', async () => {
  // The same fixture, without `subagent`: a worker's frames stay in the turn
  // that spawned them, which is what every session did before this existed.
  sdk.frames = fixture('claude-subagent.jsonl');
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
  // Up to the subagent's own Bash call, before its result: the permission ask
  // happens while the call is open.
  const { main, workers, session } = await replay('claude-subagent.jsonl', fixture('claude-subagent.jsonl').slice(0, 6));
  const worker = workers.get('toolu_01SvkwpPC6azWzz1jZ8nEtV6') as Worker;
  const bash = 'toolu_01LvQZ6De9mLFicNEgL4ekC8';

  const asked = sdk.canUseTool?.('Bash', { command: 'ls -la' }, { toolUseID: bash, agentID: 'agent-abc', title: 'Run the listing' });
  expect(asked).toBeDefined();
  await settle();

  // The question is drawn on the worker's chat, against the call already there.
  const ready = worker.actions.filter((one) => one.type === 'chat/toolCallReady' && one.toolCallId === bash);
  const confirmation = ready.filter((one) => one.confirmationTitle !== undefined);
  expect(confirmation).toHaveLength(1);
  expect(confirmation[0]).toMatchObject({ confirmationTitle: 'Run the listing' });
  // And not on the lead chat, where it would read as the parent's own question.
  const lead = main.map((one) => one.action);
  expect(lead.some((one) => one.type === 'chat/toolCallReady' && one.toolCallId === bash)).toBe(false);
  const needed = (session.sessionState().inputNeeded as Bag[]) ?? [];
  expect(needed.some((one) => one.chat === worker.uri)).toBe(true);

  // Approving it there lets the tool run and is said back where it was asked.
  session.confirm(bash, true);
  await expect(asked).resolves.toMatchObject({ behavior: 'allow' });
  expect(worker.actions.some((one) => one.type === 'chat/toolCallConfirmed' && one.toolCallId === bash)).toBe(true);
});
