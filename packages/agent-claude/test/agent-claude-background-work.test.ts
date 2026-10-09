import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import { subagentChatUri } from '@ahpd/sdk';
import type { Bag, SubagentChat, SubagentRequest } from '@ahpd/sdk';

/*
 * What each chat says it has running in its background.
 *
 * The harness reports its background tasks twice over: `background_tasks_changed`
 * is the whole set of tasks running after every change, and `task_started` says
 * what one task is, which the level never repeats. This replays the real capture
 * `claude-subagent-background.jsonl` frame by frame, so the moment each action is
 * emitted is what is checked, and then a set of frames written by hand for the
 * cases the capture does not have.
 */

/**
 * The SDK's stream as a queue a test pushes frames into.
 *
 * Pulled one frame at a time, so a test can push a run of frames, let the
 * session settle and read what it said before the next run.
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
      stopTask: async () => {},
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

/** What a test reads back: the lead chat's actions and each worker chat's. */
interface Opened {
  main: Bag[];
  workers: Map<string, Bag[]>;
  /** The URI the seam handed back for each worker, once it opened one. */
  handed: Map<string, string>;
  session: Awaited<ReturnType<typeof createSession>>;
}

/**
 * A session on the fake feed, with a host seam that opens worker chats.
 *
 * `seam` off is a host that hands the session no way to open a worker's chat,
 * which is the case a background subagent cannot be listed in.
 */
async function open(seam = true): Promise<Opened> {
  sdk.reset();
  const main: Bag[] = [];
  const workers = new Map<string, Bag[]>();
  const handed = new Map<string, string>();
  const session = 'ahp-session:/bg';
  const subagent = (toolCallId: string, _request: SubagentRequest): SubagentChat => {
    // The name the host really gives, so a listed entry is checked against the
    // chat the worker is handed rather than against a string of this test's.
    const uri = subagentChatUri(session, toolCallId);
    const held: Bag[] = [];
    workers.set(toolCallId, held);
    handed.set(toolCallId, uri);
    return {
      uri,
      turnId: `wturn-${toolCallId}`,
      emit: (action) => { held.push(action as Bag); },
      end: () => {},
    };
  };
  const running = createSession({
    uri: session,
    chatUri: 'ahp-chat:/bg',
    cwd: mkdtempSync(join(tmpdir(), 'ahpd-bg-')),
    emit: (_channel, action) => { main.push(action as Bag); },
    ...(seam ? { subagent } : {}),
  });
  await settle();
  return { main, workers, handed, session: running };
}

/** Everything one chat was told about its background work, in order. */
const told = (actions: Bag[]): Bag[] => actions.filter(
  (one) => one.type === 'chat/backgroundWorkSet' || one.type === 'chat/backgroundWorkRemoved',
);

/** One background shell's call, its `task_started` and its level. */
const shellFrames = (id: string, command: string): Record<string, unknown>[] => [
  {
    type: 'assistant',
    message: {
      id: `msg-${id}`,
      content: [{ type: 'tool_use', id: `toolu-${id}`, name: 'Bash', input: { command, run_in_background: true } }],
    },
  },
  {
    type: 'system',
    subtype: 'task_started',
    task_id: id,
    tool_use_id: `toolu-${id}`,
    description: command,
    task_type: 'local_bash',
  },
];

/** The level naming exactly these tasks, which is the whole live set. */
const level = (...tasks: Bag[]): Record<string, unknown> => ({
  type: 'system', subtype: 'background_tasks_changed', tasks,
});

it('lists the capture\'s background subagent, and takes it back when it goes', async () => {
  const lines = fixture('claude-subagent-background.jsonl');
  const { main, session, handed } = await open();
  const call = 'toolu_01Riysq5EgQZGcUE9kDMp6AB';
  const chat = subagentChatUri('ahp-session:/bg', call);

  sdk.push(...lines.slice(0, 3));
  await settle();
  expect(told(main)).toEqual([{
    type: 'chat/backgroundWorkSet',
    work: {
      kind: 'subagent',
      id: 'subagent:af279e8136cb23ae9',
      label: 'List files recursively',
      startedAt: expect.any(String),
      chat,
    },
  }]);
  expect(session.chatState().backgroundWork).toEqual([(told(main)[0]?.work as Bag)]);

  // The worker's own frames and the lead turn's result say nothing about it,
  // and the chat the entry named is the one its worker was handed when it
  // opened: listed before the chat existed, named as the chat it became.
  sdk.push(...lines.slice(3, 11));
  await settle();
  expect(told(main)).toHaveLength(1);
  expect(handed.get(call)).toBe(chat);

  // The empty level, which is the task no longer running.
  sdk.push(...lines.slice(11));
  await settle();
  expect(told(main)).toEqual([
    { type: 'chat/backgroundWorkSet', work: expect.anything() },
    { type: 'chat/backgroundWorkRemoved', id: 'subagent:af279e8136cb23ae9' },
  ]);
  expect(session.chatState()).not.toHaveProperty('backgroundWork');
});

it('lists a background shell with the command it runs', async () => {
  const { main, session } = await open();

  sdk.push(...shellFrames('t-sleep', 'sleep 100'));
  sdk.push(level({ task_id: 't-sleep', task_type: 'local_bash', description: 'sleep 100' }));
  await settle();

  expect(told(main)).toEqual([{
    type: 'chat/backgroundWorkSet',
    work: {
      kind: 'shell',
      id: 'shell:t-sleep',
      label: 'sleep 100',
      startedAt: expect.any(String),
      command: 'sleep 100',
    },
  }]);
  expect(session.chatState().backgroundWork).toHaveLength(1);

  // The level saying the same thing again is not a change, so it is not said.
  sdk.push(level({ task_id: 't-sleep', task_type: 'local_bash', description: 'sleep 100' }));
  await settle();
  expect(told(main)).toHaveLength(1);
});

it('never lists an ambient task', async () => {
  const { main } = await open();

  sdk.push(...shellFrames('t-house', 'sleep 1'));
  sdk.push(level({ task_id: 't-house', task_type: 'local_bash', description: 'sleep 1', ambient: true }));
  await settle();

  expect(told(main)).toEqual([]);
});

it('lists a task the level named before its task_started said what it is', async () => {
  const { main } = await open();

  sdk.push(...shellFrames('t-sleep', 'sleep 100').slice(0, 1));
  sdk.push(level({ task_id: 't-sleep', task_type: 'local_bash', description: 'sleep 100' }));
  await settle();
  expect(told(main)).toEqual([]);

  sdk.push(shellFrames('t-sleep', 'sleep 100')[1] as Record<string, unknown>);
  await settle();
  expect(told(main)).toHaveLength(1);
});

it('never lists a task no level names', async () => {
  const { main } = await open();

  sdk.push(...shellFrames('t-now', 'ls -la'));
  sdk.push(level());
  await settle();

  expect(told(main)).toEqual([]);
});

it('takes an entry back on a terminal notification alone', async () => {
  const { main } = await open();

  sdk.push(...shellFrames('t-sleep', 'sleep 100'));
  sdk.push(level({ task_id: 't-sleep', task_type: 'local_bash', description: 'sleep 100' }));
  await settle();
  expect(told(main)).toHaveLength(1);

  // No level follows: the notification is the only thing that says it ended.
  sdk.push({
    type: 'system',
    subtype: 'task_notification',
    task_id: 't-sleep',
    tool_use_id: 'toolu-t-sleep',
    status: 'completed',
  });
  await settle();
  expect(told(main)).toEqual([
    { type: 'chat/backgroundWorkSet', work: expect.anything() },
    { type: 'chat/backgroundWorkRemoved', id: 'shell:t-sleep' },
  ]);
});

it('lists a worker\'s own background shell on the worker\'s chat', async () => {
  const { main, workers } = await open();

  sdk.push({
    type: 'assistant',
    message: {
      id: 'msg-spawn',
      content: [{ type: 'tool_use', id: 'toolu-spawn', name: 'Agent', input: { description: 'A worker', prompt: 'go', subagent_type: 'Explore' } }],
    },
  });
  // The worker's first frame, which is what opens its chat.
  sdk.push({
    type: 'assistant',
    parent_tool_use_id: 'toolu-spawn',
    message: {
      id: 'msg-worker',
      content: [{ type: 'tool_use', id: 'toolu-sh', name: 'Bash', input: { command: 'sleep 5', run_in_background: true } }],
    },
  });
  sdk.push({
    type: 'system',
    subtype: 'task_started',
    task_id: 't-sh',
    tool_use_id: 'toolu-sh',
    description: 'sleep 5',
    task_type: 'local_bash',
  });
  sdk.push(level({ task_id: 't-sh', task_type: 'local_bash', description: 'sleep 5' }));
  await settle();

  const worker = workers.get('toolu-spawn');
  expect(worker).toBeDefined();
  expect(told(worker as Bag[])).toEqual([{
    type: 'chat/backgroundWorkSet',
    work: {
      kind: 'shell',
      id: 'shell:t-sh',
      label: 'sleep 5',
      startedAt: expect.any(String),
      command: 'sleep 5',
    },
  }]);
  expect(told(main)).toEqual([]);
});

it('lists nothing for a subagent when the host cannot open its chat', async () => {
  const lines = fixture('claude-subagent-background.jsonl');
  const { main } = await open(false);

  sdk.push(...lines);
  await settle();

  expect(told(main)).toEqual([]);
});

it('says nothing more when the session is closed', async () => {
  const { main, session } = await open();

  sdk.push(...shellFrames('t-sleep', 'sleep 100'));
  sdk.push(level({ task_id: 't-sleep', task_type: 'local_bash', description: 'sleep 100' }));
  await settle();
  expect(told(main)).toHaveLength(1);

  await session.close();
  await settle();
  expect(told(main)).toHaveLength(1);
});
