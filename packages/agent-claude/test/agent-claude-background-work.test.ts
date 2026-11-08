import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import { subagentChatUri } from '@ahpd/sdk';
import type { BackgroundTask, Bag, SubagentChat, SubagentRequest } from '@ahpd/sdk';

/*
 * What each chat says it has running in its background.
 *
 * The harness reports its background tasks twice over: `background_tasks_changed`
 * is the whole set of tasks running after every change, and `task_started` says
 * what one task is, which the level never repeats. This replays the real capture
 * `claude-subagent-background.jsonl` frame by frame, so the moment each task is
 * reported through the host's seam is what is checked, and then a set of frames
 * written by hand for the cases the capture does not have.
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
    /** The hooks the last query was built with. */
    hooks: undefined as undefined | Record<string, { matcher?: string; hooks: ((input: Bag, id: unknown, about: Bag) => Promise<unknown>)[] }[]>,
    /** The feed the next query reads, and the one `push` writes to. */
    feed: fresh(),
    /** The task ids `stopTask` was asked to stop, in order. */
    stopped: [] as string[],
    /** Start a new feed for the next session. */
    reset() { state.feed = fresh(); state.stopped = []; },
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
    sdk.hooks = options.hooks as typeof sdk.hooks;
    const feed = sdk.feed;
    return {
      async *[Symbol.asyncIterator]() {
        for (;;) yield await sdk.next(feed);
      },
      interrupt: async () => {},
      stopTask: async (id: string) => { sdk.stopped.push(id); },
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
  /** What the session reported to the host's background-task seam. */
  tasks: {
    set: { chat: string; task: BackgroundTask }[];
    remove: { chat: string; id: string }[];
  };
  session: Awaited<ReturnType<typeof createSession>>;
}

/**
 * A session on the fake feed, with a host seam that opens worker chats.
 *
 * `seam` off is a host that hands the session no way to open a worker's chat,
 * which is the case a background subagent cannot be listed in. `turn` is the
 * turn the frames a case feeds answer, running from the start.
 */
async function open(seam = true, turn = true): Promise<Opened> {
  sdk.reset();
  const main: Bag[] = [];
  const workers = new Map<string, Bag[]>();
  const handed = new Map<string, string>();
  const tasks: Opened['tasks'] = { set: [], remove: [] };
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
    backgroundTasks: {
      set: (chat, task) => { tasks.set.push({ chat, task }); },
      remove: (chat, id) => { tasks.remove.push({ chat, id }); },
    },
  });
  await settle();
  if (turn) {
    running.sendMessage('t1', 'go');
    await settle();
  }
  return { main, workers, handed, tasks, session: running };
}

/** Everything one chat was reported as running, in order. */
const said = (tasks: Opened['tasks'], chat: string): BackgroundTask[] => tasks.set
  .filter((one) => one.chat === chat)
  .map((one) => one.task);

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
  const { session, handed, tasks } = await open();
  const call = 'toolu_01Riysq5EgQZGcUE9kDMp6AB';
  const chat = subagentChatUri('ahp-session:/bg', call);

  sdk.push(...lines.slice(0, 3));
  await settle();
  expect(said(tasks, 'ahp-chat:/bg')).toEqual([{
    kind: 'subagent',
    id: 'subagent:af279e8136cb23ae9',
    label: 'List files recursively',
    startedAt: expect.any(String),
    chat,
  }]);
  // The backend reports; the row and the snapshot a late subscriber reads are
  // the host's, so the session's own state says nothing about it.
  expect(session.chatState()).not.toHaveProperty('backgroundWork');

  // The worker's own frames and the lead turn's result say nothing about it,
  // and the chat the entry named is the one its worker was handed when it
  // opened: listed before the chat existed, named as the chat it became.
  sdk.push(...lines.slice(3, 11));
  await settle();
  expect(tasks.set).toHaveLength(1);
  expect(handed.get(call)).toBe(chat);

  // The empty level, which is the task no longer running.
  sdk.push(...lines.slice(11));
  await settle();
  expect(tasks.set).toHaveLength(1);
  expect(tasks.remove).toEqual([{ chat: 'ahp-chat:/bg', id: 'subagent:af279e8136cb23ae9' }]);
});

it('lists a background shell with the command it runs', async () => {
  const { tasks } = await open();

  sdk.push(...shellFrames('t-sleep', 'sleep 100'));
  sdk.push(level({ task_id: 't-sleep', task_type: 'local_bash', description: 'sleep 100' }));
  await settle();

  expect(said(tasks, 'ahp-chat:/bg')).toEqual([{
    kind: 'shell',
    id: 'shell:t-sleep',
    label: 'sleep 100',
    startedAt: expect.any(String),
    command: 'sleep 100',
    stop: expect.any(Function),
  }]);

  // The level saying the same thing again is not a change, so it is not said.
  sdk.push(level({ task_id: 't-sleep', task_type: 'local_bash', description: 'sleep 100' }));
  await settle();
  expect(tasks.set).toHaveLength(1);
});

it('stops a live shell through the harness, and answers true', async () => {
  const { tasks } = await open();

  sdk.push(...shellFrames('t-sleep', 'sleep 100'));
  sdk.push(level({ task_id: 't-sleep', task_type: 'local_bash', description: 'sleep 100' }));
  await settle();

  const task = said(tasks, 'ahp-chat:/bg')[0];
  expect(task?.stop).toBeDefined();
  expect(await task?.stop?.()).toBe(true);
  // The harness's own stop, by the task id it named.
  expect(sdk.stopped).toEqual(['t-sleep']);
});

it('answers false from a stop once the shell has ended', async () => {
  const { tasks } = await open();

  sdk.push(...shellFrames('t-sleep', 'sleep 100'));
  sdk.push(level({ task_id: 't-sleep', task_type: 'local_bash', description: 'sleep 100' }));
  await settle();
  const task = said(tasks, 'ahp-chat:/bg')[0];
  sdk.push(level());
  await settle();

  // The row is gone, and the stop it carried would have nothing to stop.
  expect(tasks.remove).toHaveLength(1);
  expect(await task?.stop?.()).toBe(false);
  expect(sdk.stopped).toEqual([]);
});

it('never lists an ambient task', async () => {
  const { tasks } = await open();

  sdk.push(...shellFrames('t-house', 'sleep 1'));
  sdk.push(level({ task_id: 't-house', task_type: 'local_bash', description: 'sleep 1', ambient: true }));
  await settle();

  expect(tasks.set).toEqual([]);
});

it('lists a task the level named before its task_started said what it is', async () => {
  const { tasks } = await open();

  sdk.push(...shellFrames('t-sleep', 'sleep 100').slice(0, 1));
  sdk.push(level({ task_id: 't-sleep', task_type: 'local_bash', description: 'sleep 100' }));
  await settle();
  expect(tasks.set).toEqual([]);

  sdk.push(shellFrames('t-sleep', 'sleep 100')[1] as Record<string, unknown>);
  await settle();
  expect(tasks.set).toHaveLength(1);
});

it('never lists a task no level names', async () => {
  const { tasks } = await open();

  sdk.push(...shellFrames('t-now', 'ls -la'));
  sdk.push(level());
  await settle();

  expect(tasks.set).toEqual([]);
});

it('takes an entry back on a terminal notification alone', async () => {
  const { tasks } = await open();

  sdk.push(...shellFrames('t-sleep', 'sleep 100'));
  sdk.push(level({ task_id: 't-sleep', task_type: 'local_bash', description: 'sleep 100' }));
  await settle();
  expect(tasks.set).toHaveLength(1);

  // No level follows: the notification is the only thing that says it ended.
  sdk.push({
    type: 'system',
    subtype: 'task_notification',
    task_id: 't-sleep',
    tool_use_id: 'toolu-t-sleep',
    status: 'completed',
  });
  await settle();
  expect(tasks.set).toHaveLength(1);
  expect(tasks.remove).toEqual([{ chat: 'ahp-chat:/bg', id: 'shell:t-sleep' }]);
});

/*
 * The lead turn ends with two shells still running. The turn's parts go with
 * it, so each row keeps the chat and the command found while its call was open:
 * a stop of one shell, or a level that drops one, takes back only that row.
 */
it('takes back only the stopped shell after the turn that started both has ended', async () => {
  const { tasks } = await open();

  sdk.push(...shellFrames('t-sleep', 'sleep 600'), ...shellFrames('t-loop', 'while true; do date; sleep 5; done'));
  sdk.push(level(
    { task_id: 't-sleep', task_type: 'local_bash', description: 'sleep 600' },
    { task_id: 't-loop', task_type: 'local_bash', description: 'a loop' },
  ));
  sdk.push({ type: 'result', subtype: 'success', is_error: false, duration_ms: 1 });
  await settle();
  expect(said(tasks, 'ahp-chat:/bg').map((one) => one.id)).toEqual(['shell:t-sleep', 'shell:t-loop']);

  sdk.push({
    type: 'system',
    subtype: 'task_notification',
    task_id: 't-sleep',
    tool_use_id: 'toolu-t-sleep',
    status: 'stopped',
  });
  await settle();
  expect(tasks.remove).toEqual([{ chat: 'ahp-chat:/bg', id: 'shell:t-sleep' }]);
});

it('takes back only the shell a level drops after the turn has ended, and keeps the other\'s command', async () => {
  const { tasks } = await open();

  sdk.push(...shellFrames('t-sleep', 'sleep 600'), ...shellFrames('t-loop', 'while true; do date; sleep 5; done'));
  sdk.push(level(
    { task_id: 't-sleep', task_type: 'local_bash', description: 'sleep 600' },
    { task_id: 't-loop', task_type: 'local_bash', description: 'a loop' },
  ));
  sdk.push({ type: 'result', subtype: 'success', is_error: false, duration_ms: 1 });
  await settle();
  const before = tasks.set.length;

  sdk.push(level({ task_id: 't-loop', task_type: 'local_bash', description: 'a loop' }));
  await settle();
  expect(tasks.remove).toEqual([{ chat: 'ahp-chat:/bg', id: 'shell:t-sleep' }]);
  // Nothing about the loop changed, so nothing about it is said again.
  expect(tasks.set).toHaveLength(before);
  expect(said(tasks, 'ahp-chat:/bg').filter((one) => one.id === 'shell:t-loop').map((one) => (one.kind === 'shell' ? one.command : undefined)))
    .toEqual(['while true; do date; sleep 5; done']);
});

it('lists a worker\'s own background shell on the worker\'s chat', async () => {
  const { tasks, handed } = await open();

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

  const chat = handed.get('toolu-spawn');
  expect(chat).toBeDefined();
  expect(said(tasks, chat as string)).toEqual([{
    kind: 'shell',
    id: 'shell:t-sh',
    label: 'sleep 5',
    startedAt: expect.any(String),
    command: 'sleep 5',
    stop: expect.any(Function),
  }]);
  expect(said(tasks, 'ahp-chat:/bg')).toEqual([]);
});

it('lists nothing for a subagent when the host cannot open its chat', async () => {
  const lines = fixture('claude-subagent-background.jsonl');
  const { tasks } = await open(false);

  sdk.push(...lines);
  await settle();

  expect(tasks.set).toEqual([]);
});

it('says nothing more when the session is closed', async () => {
  const { tasks, session } = await open();

  sdk.push(...shellFrames('t-sleep', 'sleep 100'));
  sdk.push(level({ task_id: 't-sleep', task_type: 'local_bash', description: 'sleep 100' }));
  await settle();
  expect(tasks.set).toHaveLength(1);

  await session.close();
  await settle();
  expect(tasks.set).toHaveLength(1);
});

/*
 * The turn a background task's end wakes.
 *
 * A notification that arrives while no turn is open is the CLI's cue to start
 * a turn of its own, and that turn answers the notification rather than the
 * person: its message is the task's summary, drawn as one muted line. One that
 * arrives inside a turn starts no turn, so it gives the next one nothing.
 */
it('opens the turn a finished task wakes with the task\'s summary as a notice', async () => {
  const { main } = await open();

  sdk.push(...shellFrames('t-sleep', 'sleep 100'));
  sdk.push(level({ task_id: 't-sleep', task_type: 'local_bash', description: 'sleep 100' }));
  sdk.push({ type: 'result', subtype: 'success', is_error: false, duration_ms: 1 });
  await settle();

  sdk.push({
    type: 'system',
    subtype: 'task_notification',
    task_id: 't-sleep',
    tool_use_id: 'toolu-t-sleep',
    status: 'completed',
    summary: 'sleep 100 finished',
  });
  // The turn the CLI starts once the notification has woken it.
  sdk.push({
    type: 'assistant',
    message: { id: 'msg-wake', content: [{ type: 'text', text: 'The shell finished.' }] },
  });
  await settle();

  // The client's turn is the host's to say, so the one start here is the notice's.
  const started = main.filter((action) => action.type === 'chat/turnStarted');
  expect(started).toHaveLength(1);
  expect(started.at(-1)?.message).toEqual({ text: 'sleep 100 finished', origin: { kind: 'systemNotification' } });
});

it('does not give a task notification inside a turn to the next turn', async () => {
  const { main } = await open();

  sdk.push(...shellFrames('t-sleep', 'sleep 100'));
  sdk.push(level({ task_id: 't-sleep', task_type: 'local_bash', description: 'sleep 100' }));
  // The notification arrives while the turn that started the task is open.
  sdk.push({
    type: 'system',
    subtype: 'task_notification',
    task_id: 't-sleep',
    tool_use_id: 'toolu-t-sleep',
    status: 'completed',
    summary: 'sleep 100 finished',
  });
  sdk.push({ type: 'result', subtype: 'success', is_error: false, duration_ms: 1 });
  await settle();

  sdk.push({
    type: 'assistant',
    message: { id: 'msg-next', content: [{ type: 'text', text: 'And then.' }] },
  });
  await settle();

  // No notice waits, so the frame after the turn opens none: a lead frame no
  // prompt is pending for is dropped.
  expect(main.filter((action) => action.type === 'chat/turnStarted')).toEqual([]);
});

/*
 * What keeps the session awake: a background task the level names, and a
 * timer of the CLI's own that the `Stop` hook lists.
 */

/** Run the `Stop` hooks the query was built with, as the CLI does at the end of a turn. */
const stop = async (input: Bag): Promise<void> => {
  for (const one of sdk.hooks?.Stop ?? []) {
    for (const hook of one.hooks) await hook({ hook_event_name: 'Stop', stop_hook_active: false, ...input }, undefined, { signal: new AbortController().signal });
  }
};

it('is busy while a background task runs, and not after it ends', async () => {
  const { session } = await open();
  expect(session.busy?.()).toBe(false);

  sdk.push(...shellFrames('t-sleep', 'sleep 100'));
  sdk.push(level({ task_id: 't-sleep', task_type: 'local_bash', description: 'sleep 100' }));
  await settle();
  expect(session.busy?.()).toBe(true);

  sdk.push(level());
  await settle();
  expect(session.busy?.()).toBe(false);
});

it('is busy while the Stop hook lists a session cron', async () => {
  const { session } = await open();
  await stop({ background_tasks: [], session_crons: [{ id: 'c1', cron: '*/5 * * * *', prompt: 'check the build' }] });
  expect(session.busy?.()).toBe(true);

  // A later turn's end with the timer spent.
  await stop({ background_tasks: [], session_crons: [] });
  expect(session.busy?.()).toBe(false);
});

it('keeps the hooks the session already had', async () => {
  await open();
  // None before a tool runs: a call is put to a person when the CLI asks about it.
  expect(sdk.hooks?.PreToolUse).toBeUndefined();
  expect(sdk.hooks?.UserPromptSubmit).toEqual([{ hooks: [expect.any(Function)] }]);
  expect(sdk.hooks?.Stop).toEqual([{ hooks: [expect.any(Function)] }]);
});

/** Run the `UserPromptSubmit` hooks the query was built with, as the CLI does when a prompt arrives. */
const submitted = async (): Promise<unknown[]> => {
  const answers: unknown[] = [];
  for (const one of sdk.hooks?.UserPromptSubmit ?? []) {
    for (const hook of one.hooks) {
      answers.push(await hook(
        { hook_event_name: 'UserPromptSubmit', prompt: 'do the thing' },
        undefined,
        { signal: new AbortController().signal },
      ));
    }
  }
  return answers;
};

/*
 * What the host asked said on a turn, which is context the person did not type.
 *
 * The CLI takes it from the `UserPromptSubmit` hook, so what the model is given
 * is this hook's answer - and the turn that is running is the only turn that
 * has one. It is read when the turn begins, which is what makes the host's
 * function, rather than a list captured earlier, what the hook answers from.
 */
it('gives a turn the instructions the host asked for, and nothing once it ends', async () => {
  const { session } = await open(true, false);
  const words = ['<remote_session_origin>', 'report back', '</remote_session_origin>'];

  // A turn the host said nothing about, which is every ordinary one: the hook
  // is registered with the CLI that turn starts, and has nothing to give.
  session.sendMessage('t-plain', 'hello');
  await settle();
  expect(await submitted()).toEqual([{}]);
  await session.abort();
  await settle();
  // The interrupted CLI ends the stopped turn with a result of its own, as the
  // real one does, and the next prompt goes out behind it.
  sdk.push({ type: 'result', subtype: 'error_during_execution', is_error: true, errors: [], duration_ms: 1 });
  await settle();

  let asked = 0;
  session.sendMessage('t-told', 'and this', undefined, undefined, {
    instructions: () => { asked += 1; return words; },
  });
  await settle();
  expect(asked).toBe(1);
  expect(await submitted()).toEqual([{
    hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: words.join('\n\n') },
  }]);

  // Taken with the turn that ended, rather than left for the next prompt.
  await session.abort();
  await settle();
  expect(await submitted()).toEqual([{}]);
});
