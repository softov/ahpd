import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import type { BoundTool } from '@ahpd/sdk';

/*
 * Claude's own task tools, and the host tools that take their place.
 *
 * A session denies `TodoWrite`, `TaskCreate`, `TaskUpdate`, `TaskList` and
 * `TaskGet` when `hostTasks` is on and the host offers the tasks plugin's
 * `task_add`. A host without that tool offers nothing in their place, so the
 * harness keeps its own list. The query's `disallowedTools` is the list the CLI
 * is started with, and that is what the first cases read; the rest replay a
 * stream whose calls are Claude's own, and read what the session handed the
 * host through `planUpdate`.
 */

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  createSdkMcpServer: (given: Record<string, unknown>) => ({ type: 'sdk', name: given.name, tools: given.tools }),
  query: ({ prompt, options }: { prompt: AsyncIterable<unknown>; options: Record<string, unknown> }) => {
    sdk.options.push(options);
    return {
      async *[Symbol.asyncIterator]() {
        // The frames answer the turn's prompt, as a CLI's do.
        await prompt[Symbol.asyncIterator]().next();
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

const sdk = vi.hoisted(() => ({ options: [] as Record<string, unknown>[], frames: [] as Record<string, unknown>[] }));

const { createSession } = await import('../src/session.js');

const settle = async (times = 8): Promise<void> => {
  for (let i = 0; i < times; i++) await new Promise((done) => { setTimeout(done, 0); });
};

/** The host's `task_add`, which is what puts the host list in reach of a session. */
const taskAdd = (): BoundTool => ({
  definition: { name: 'task_add', description: 'Add a task.', inputSchema: { type: 'object', properties: {} } },
  run: async () => '',
}) as unknown as BoundTool;

/** One session's `query()` options, over the tools and values given here. */
const queried = async (given: {
  preset?: Record<string, unknown>;
  tools?: BoundTool[];
  settings?: Record<string, unknown>;
  machine?: boolean;
} = {}): Promise<Record<string, unknown>> => {
  sdk.options = [];
  sdk.frames = [];
  // A value the daemon inherits is kept, so the cases start without one.
  vi.stubEnv('CLAUDE_CODE_ENABLE_TASKS', undefined);
  createSession({
    uri: 'ahp-session:/tasks',
    chatUri: 'ahp-chat:/tasks',
    cwd: mkdtempSync(join(tmpdir(), 'ahpd-tasks-')),
    emit: () => {},
    ...(given.preset === undefined ? {} : { preset: given.preset }),
    ...(given.tools === undefined ? {} : { tools: given.tools }),
    ...(given.settings === undefined ? {} : { settings: given.settings }),
    ...(given.machine === true
      ? {
        spawn: () => { throw new Error('the CLI is not started here'); },
        spawnExecutable: 'claude',
        spawnConfigDir: '/ahpd/claude',
      }
      : {}),
  });
  await settle();
  const one = sdk.options.at(0);
  if (one === undefined) throw new Error('no query was built');
  return one;
};

afterEach(() => { vi.unstubAllEnvs(); });

/** The task tools Claude keeps to itself when the host takes their place. */
const OWN = ['TodoWrite', 'TaskCreate', 'TaskUpdate', 'TaskList', 'TaskGet'];

it('denies its own task tools by default, when the host offers task_add', async () => {
  const options = await queried({ tools: [taskAdd()] });
  expect(options.disallowedTools).toEqual(OWN);
});

it('keeps its own task tools when the setting is off', async () => {
  const options = await queried({ preset: { hostTasks: false }, tools: [taskAdd()] });
  expect(options.disallowedTools).toBeUndefined();
});

it('keeps its own task tools when the host offers no task_add', async () => {
  const options = await queried();
  expect(options.disallowedTools).toBeUndefined();
});

it('keeps the deny list of a person, and adds the task tools to it', async () => {
  const options = await queried({
    tools: [taskAdd()],
    settings: { permissions: { deny: ['Bash', 'TodoWrite'] } },
  });
  // A name a person already denied is not written twice.
  expect(options.disallowedTools).toEqual(['Bash', 'TodoWrite', 'TaskCreate', 'TaskUpdate', 'TaskList', 'TaskGet']);
});

it('turns Claude\'s own task tools on when it keeps them', async () => {
  const options = await queried({ preset: { hostTasks: false }, tools: [taskAdd()] });
  expect(options.env).toMatchObject({ CLAUDE_CODE_ENABLE_TASKS: '1' });
});

it('turns them on in a machine too', async () => {
  const options = await queried({ preset: { hostTasks: false }, tools: [taskAdd()], machine: true });
  expect(options.env).toMatchObject({ CLAUDE_CODE_ENABLE_TASKS: '1', CLAUDE_CONFIG_DIR: '/ahpd/claude' });
});

it('sets no variable when the host holds the list', async () => {
  const options = await queried({ tools: [taskAdd()] });
  expect(options.env).toBeUndefined();
});

it('sets no variable when enableTasks is off', async () => {
  const options = await queried({ preset: { hostTasks: false, enableTasks: false }, tools: [taskAdd()] });
  expect(options.env).toBeUndefined();
});

it('keeps a value a preset gives for the variable', async () => {
  const options = await queried({
    preset: { hostTasks: false, env: { CLAUDE_CODE_ENABLE_TASKS: '0' } },
    tools: [taskAdd()],
  });
  expect(options.env).toMatchObject({ CLAUDE_CODE_ENABLE_TASKS: '0' });
});

/**
 * One assistant message carrying a call of Claude's own task tools.
 *
 * The call id is the block's, and the message id names the part the call is
 * drawn in; two calls in one test need two of each.
 */
const call = (id: string, name: string, input: Record<string, unknown>): Record<string, unknown> => ({
  type: 'assistant',
  parent_tool_use_id: null,
  message: {
    id: `msg_${id}`,
    role: 'assistant',
    content: [{ type: 'tool_use', id, name, input }],
  },
});

/** The user message a tool's result arrives in, with the structured output beside it. */
const result = (id: string, content: string, structured?: unknown): Record<string, unknown> => ({
  type: 'user',
  parent_tool_use_id: null,
  message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content }] },
  ...(structured === undefined ? {} : { tool_use_result: structured }),
});

/** Replay a stream through a real session, and collect what it handed the host. */
const replayed = async (
  frames: Record<string, unknown>[],
  given: { tools?: BoundTool[] } = {},
): Promise<Record<string, unknown>[]> => {
  sdk.options = [];
  sdk.frames = frames;
  const heard: Record<string, unknown>[] = [];
  const session = createSession({
    uri: 'ahp-session:/tasks',
    chatUri: 'ahp-chat:/tasks',
    cwd: mkdtempSync(join(tmpdir(), 'ahpd-tasks-')),
    emit: () => {},
    planUpdate: (update) => { heard.push(update as unknown as Record<string, unknown>); },
    ...(given.tools === undefined ? {} : { tools: given.tools }),
  });
  await settle(30);
  // The turn the frames answer.
  session.sendMessage('t1', 'go');
  await settle(30);
  return heard;
};

it('hands a whole TodoWrite list with each status', async () => {
  const heard = await replayed([
    call('toolu_todo', 'TodoWrite', {
      todos: [
        { content: 'Read the plan', status: 'completed', activeForm: 'Reading the plan' },
        { content: 'Build it', status: 'in_progress', activeForm: 'Building it' },
        { content: 'Write the docs', status: 'pending', activeForm: 'Writing the docs' },
      ],
    }),
  ]);
  expect(heard).toHaveLength(1);
  expect(heard[0]).toMatchObject({
    tool: 'TodoWrite',
    entries: [
      { text: 'Read the plan', status: 'completed' },
      { text: 'Build it', status: 'in_progress' },
      { text: 'Write the docs', status: 'pending' },
    ],
  });
  expect(typeof heard[0]?.['turn']).toBe('string');
});

it('hands a TaskCreate once its result names the harness id, then a TaskUpdate with it', async () => {
  const heard = await replayed([
    call('toolu_create', 'TaskCreate', { subject: 'Ship it', description: 'Out of the door' }),
    // The tool's input carries no id; its structured output does.
    result('toolu_create', 'Task #3 created successfully: Ship it', { task: { id: '3', subject: 'Ship it' } }),
    call('toolu_update', 'TaskUpdate', { taskId: '3', status: 'in_progress' }),
  ]);
  expect(heard).toHaveLength(2);
  expect(heard[0]).toMatchObject({ tool: 'TaskCreate', change: { id: '3', text: 'Ship it' } });
  expect(heard[1]).toMatchObject({ tool: 'TaskUpdate', change: { id: '3', status: 'in_progress' } });
});

it('hands an empty TodoWrite as an empty list', async () => {
  const heard = await replayed([call('toolu_todo', 'TodoWrite', { todos: [] })]);
  expect(heard).toEqual([expect.objectContaining({ tool: 'TodoWrite', entries: [] })]);
});

it('hands nothing when the host task tools are in place', async () => {
  const heard = await replayed([
    call('toolu_todo', 'TodoWrite', { todos: [{ content: 'Read the plan', status: 'pending' }] }),
    call('toolu_create', 'TaskCreate', { subject: 'Ship it', description: 'Out of the door' }),
    result('toolu_create', 'Task #3 created successfully: Ship it', { task: { id: '3', subject: 'Ship it' } }),
  ], { tools: [taskAdd()] });
  expect(heard).toEqual([]);
});
