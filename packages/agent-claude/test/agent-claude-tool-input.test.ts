import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import type { Bag, Session } from '@ahpd/sdk';

/*
 * A tool call's `toolInput`, live and read back.
 *
 * `toolInput` is the call's whole input as JSON, so a client can parse it;
 * `invocationMessage` is the short line the row draws. Bash is the one tool
 * whose `toolInput` is its command, because a terminal row reads the command
 * there.
 *
 * The row line is never cut JSON. It is the call's `description` for Bash, Task,
 * Agent and Monitor; otherwise VS Code's line for a tool VS Code maps, as
 * markdown where VS Code sends markdown; otherwise the subject of
 * AskUserQuestion, WebSearch or an MCP tool, or the display name. The past
 * tense is the same rule, success or not.
 */

const sdk = vi.hoisted(() => ({
  frames: [] as Record<string, unknown>[],
  /** Frames queued after the stream was held, which it reads on waking. */
  pushed: [] as Record<string, unknown>[],
  /** What the stream waits on after its frames, so a test can keep it open. */
  hold: Promise.resolve() as Promise<void>,
  canUseTool: undefined as undefined | ((name: string, input: Record<string, unknown>, about?: Record<string, unknown>) => Promise<unknown>),
}));

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  createSdkMcpServer: (given: Record<string, unknown>) => ({ type: 'sdk', name: given.name, tools: given.tools }),
  getSessionMessages: async () => sdk.frames,
  query: ({ options }: { options: Record<string, unknown> }) => ({
    async *[Symbol.asyncIterator]() {
      sdk.canUseTool = options.canUseTool as typeof sdk.canUseTool;
      for (const frame of sdk.frames) yield frame;
      await sdk.hold;
      while (sdk.pushed.length > 0) yield sdk.pushed.shift() as Record<string, unknown>;
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
  }),
}));

const { createSession } = await import('../src/session.js');
const { turnsOf } = await import('../src/transcript.js');

/** An input whose JSON is well past 400 characters, for a tool with no subject. */
const long = { todos: [{ content: 'x'.repeat(500), status: 'pending', activeForm: 'Doing x' }], nested: { keep: true } };

const calls = [
  { type: 'tool_use', id: 'toolu_long', name: 'TodoWrite', input: long },
  { type: 'tool_use', id: 'toolu_bash', name: 'Bash', input: { command: 'ls -la', description: 'List files' } },
  {
    type: 'tool_use', id: 'toolu_ask', name: 'AskUserQuestion', input: {
      questions: [
        { question: 'Which colour?', header: 'Colour', multiSelect: false, options: [{ label: 'Red' }, { label: 'Blue' }] },
        { question: 'Which size?', header: 'Size', multiSelect: false, options: [{ label: 'S' }, { label: 'L' }] },
      ],
    },
  },
  { type: 'tool_use', id: 'toolu_fetch', name: 'WebFetch', input: { prompt: 'Summarize it', url: 'https://example.com/page' } },
  { type: 'tool_use', id: 'toolu_search', name: 'WebSearch', input: { allowed_domains: ['example.com'], query: 'kqueue linux' } },
  { type: 'tool_use', id: 'toolu_mcp', name: 'mcp__docs__search', input: { limit: 5, topic: 'kqueue', scope: 'all' } },
  { type: 'tool_use', id: 'toolu_numbers', name: 'mcp__pager__page', input: { page: 2, size: 50 } },
];

/** Each call's row line and past tense, as the task names them. */
const rows: [string, unknown, unknown][] = [
  ['toolu_long', 'Update todo list', 'Update todo list'],
  ['toolu_bash', 'List files', 'List files'],
  ['toolu_ask', 'Which colour?', 'Which colour?'],
  ['toolu_fetch', { markdown: 'Fetching [https://example.com/page](https://example.com/page)' }, { markdown: 'Fetched [https://example.com/page](https://example.com/page)' }],
  ['toolu_search', 'kqueue linux', 'kqueue linux'],
  ['toolu_mcp', 'kqueue', 'kqueue'],
  ['toolu_numbers', 'mcp__pager__page', 'mcp__pager__page'],
];

/** The text of a line, whether it is a string or markdown. */
const textOf = (line: unknown): string => (typeof line === 'string' ? line : String((line as Bag | undefined)?.markdown));

const settle = async (times = 30): Promise<void> => {
  for (let i = 0; i < times; i++) await new Promise((r) => { setTimeout(r, 0); });
};

/** The calls as a live session announces them: its snapshot calls and its ready actions. */
async function live(frames: Record<string, unknown>[] = [{
  type: 'assistant', parent_tool_use_id: null, uuid: 'a1',
  message: { id: 'msg_1', role: 'assistant', content: calls },
}], asking?: () => void): Promise<{ held: Map<string, Bag>; ready: Map<string, Bag>; sent: Bag[]; session: Session }> {
  sdk.frames = frames;
  sdk.pushed = [];
  const sent: Bag[] = [];
  const session = createSession({
    uri: 'ahp-session:/input',
    chatUri: 'ahp-chat:/input',
    cwd: mkdtempSync(join(tmpdir(), 'ahpd-input-')),
    emit: (_channel, action) => { sent.push(action as Bag); },
  });
  await settle();
  if (asking !== undefined) {
    asking();
    await settle();
  }
  const ready = new Map<string, Bag>();
  for (const action of sent) {
    if (action.type === 'chat/toolCallReady') ready.set(action.toolCallId as string, action);
  }
  const chat = session.chatState() as Bag;
  const turns = [...(chat.turns ?? []) as Bag[], ...(chat.activeTurn ? [chat.activeTurn as Bag] : [])];
  const held = new Map<string, Bag>();
  for (const part of turns.flatMap((turn) => (turn.responseParts ?? []) as Bag[])) {
    if (part.kind === 'toolCall') {
      const call = part.toolCall as Bag;
      held.set(call.toolCallId as string, call);
    }
  }
  return { held, ready, sent, session };
}

/** The `_meta` an action carries, or an empty bag for one that carries none. */
const metaOf = (action: Bag | undefined): Bag => (action?._meta ?? {}) as Bag;

/** The one action of a call's kind that a session sent, or nothing. */
const actionOf = (sent: Bag[], type: string, id: string): Bag | undefined =>
  sent.find((one) => one.type === type && one.toolCallId === id);

/** Whether an action carries a call's start, its end and how long it took. */
const timed = (action: Bag | undefined): boolean => {
  const meta = metaOf(action);
  return typeof meta['ahpd.startedAt'] === 'string'
    && typeof meta['ahpd.endedAt'] === 'string'
    && typeof meta['ahpd.durationMs'] === 'number';
};

/** The same calls read back from a transcript, with any frames that follow them. */
async function restored(content: Bag[] = calls, after: Record<string, unknown>[] = []): Promise<Map<string, Bag>> {
  sdk.frames = [
    { type: 'user', uuid: 'u1', timestamp: '2020-01-01T00:00:00.000Z', message: { role: 'user', content: 'go' } },
    { type: 'assistant', uuid: 'a1', timestamp: '2020-01-01T00:00:00.000Z', message: { id: 'msg_1', role: 'assistant', content } },
    ...after,
  ];
  const turns = await turnsOf('session', '/tmp/project') as unknown as Bag[];
  const out = new Map<string, Bag>();
  for (const part of (turns[0]?.responseParts ?? []) as Bag[]) {
    if (part.kind === 'toolCall') {
      const call = part.toolCall as Bag;
      out.set(call.toolCallId as string, call);
    }
  }
  return out;
}

it('carries a live call\'s whole input in toolInput', async () => {
  const { held, ready } = await live();
  for (const call of [ready.get('toolu_long'), held.get('toolu_long')]) {
    expect(JSON.parse(call?.toolInput as string)).toEqual(long);
    expect(call?.invocationMessage).toBe('Update todo list');
  }
});

it('carries a restored call\'s whole input in toolInput', async () => {
  const call = (await restored()).get('toolu_long');
  expect(JSON.parse(call?.toolInput as string)).toEqual(long);
  expect(call?.invocationMessage).toBe('Update todo list');
});

it('keeps Bash\'s command in toolInput, live and restored', async () => {
  const { held, ready } = await live();
  const back = (await restored()).get('toolu_bash');
  for (const call of [ready.get('toolu_bash'), held.get('toolu_bash'), back]) {
    expect(call?.toolInput).toBe('ls -la');
    expect(call?.invocationMessage).toBe('List files');
  }
});

it('draws each live call\'s row line as its subject or its display name', async () => {
  const { held, ready } = await live();
  for (const [id, line] of rows) {
    for (const call of [ready.get(id), held.get(id)]) {
      expect(call?.invocationMessage, id).toEqual(line);
      expect(textOf(call?.invocationMessage), id).not.toMatch(/^\{/);
    }
  }
});

it('draws a restored call\'s row line as the live one does', async () => {
  const back = await restored();
  for (const [id, line, past] of rows) {
    const call = back.get(id);
    expect(call?.invocationMessage, id).toEqual(line);
    expect(call?.pastTenseMessage, id).toEqual(past);
    expect(textOf(call?.invocationMessage), id).not.toMatch(/^\{/);
  }
});

it('gives a call confirmed while it streams its whole input', async () => {
  const input = { url: 'https://example.com/page', prompt: 'y'.repeat(500) };
  sdk.hold = new Promise(() => {});
  const { held, ready } = await live([
    {
      type: 'stream_event', parent_tool_use_id: null, uuid: 's1',
      event: { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'toolu_held', name: 'WebFetch', input: {} } },
    },
    {
      type: 'stream_event', parent_tool_use_id: null, uuid: 's2',
      event: { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{"url":"https://exa' } },
    },
  ], () => { void sdk.canUseTool?.('WebFetch', input, { toolUseID: 'toolu_held' }); });
  sdk.hold = Promise.resolve();
  const call = held.get('toolu_held');
  expect(call?.status).toBe('pending-confirmation');
  expect(JSON.parse(call?.toolInput as string)).toEqual(input);
  expect(call).not.toHaveProperty('partialInput');
  expect(JSON.parse(ready.get('toolu_held')?.toolInput as string)).toEqual(input);
});

/** Calls whose row lines mirror VS Code's, each with its line and past tense. */
const mirrored: { block: Bag; line: unknown; past: unknown }[] = [
  {
    block: { type: 'tool_use', id: 'toolu_said', name: 'Bash', input: { command: 'ls -la /tmp/scratch', description: 'Check scratch directory' } },
    line: 'Check scratch directory', past: 'Check scratch directory',
  },
  {
    block: { type: 'tool_use', id: 'toolu_plain', name: 'Bash', input: { command: 'ls -la' } },
    line: { markdown: 'Running `ls -la`' }, past: { markdown: 'Ran `ls -la`' },
  },
  {
    block: { type: 'tool_use', id: 'toolu_lines', name: 'Bash', input: { command: 'cd /tmp\nls -la' } },
    line: { markdown: 'Running `cd /tmp`' }, past: { markdown: 'Ran `cd /tmp`' },
  },
  {
    block: { type: 'tool_use', id: 'toolu_wide', name: 'Bash', input: { command: `echo ${'a'.repeat(100)}` } },
    line: { markdown: `Running \`echo ${'a'.repeat(75)}…\`` }, past: { markdown: `Ran \`echo ${'a'.repeat(75)}…\`` },
  },
  {
    block: { type: 'tool_use', id: 'toolu_ticks', name: 'Bash', input: { command: 'echo `date`' } },
    line: { markdown: 'Running `` echo `date` ``' }, past: { markdown: 'Ran `` echo `date` ``' },
  },
  {
    block: { type: 'tool_use', id: 'toolu_grep', name: 'Grep', input: { pattern: 'kqueue', path: '/src' } },
    line: { markdown: 'Search for `kqueue`' }, past: { markdown: 'Search for `kqueue`' },
  },
  {
    block: { type: 'tool_use', id: 'toolu_glob', name: 'Glob', input: { pattern: '**/*.ts' } },
    line: { markdown: 'Find files matching `**/*.ts`' }, past: { markdown: 'Find files matching `**/*.ts`' },
  },
  {
    block: { type: 'tool_use', id: 'toolu_read', name: 'Read', input: { file_path: '/tmp/a b(1).txt' } },
    line: { markdown: 'Read [a b(1).txt](file:///tmp/a%20b%281%29.txt)' }, past: { markdown: 'Read [a b(1).txt](file:///tmp/a%20b%281%29.txt)' },
  },
  {
    block: { type: 'tool_use', id: 'toolu_skill', name: 'Skill', input: { skill: 'do-spec' } },
    line: { markdown: 'Running skill `do-spec`' }, past: { markdown: 'Ran skill `do-spec`' },
  },
  {
    block: { type: 'tool_use', id: 'toolu_task', name: 'Task', input: { description: 'Find the reducer', prompt: 'Look for it', subagent_type: 'Explore' } },
    line: 'Find the reducer', past: 'Find the reducer',
  },
  {
    block: { type: 'tool_use', id: 'toolu_monitor', name: 'Monitor', input: { description: 'Watch the build log', command: 'tail -f build.log', timeout_ms: 1000 } },
    line: 'Watch the build log', past: 'Watch the build log',
  },
  {
    block: { type: 'tool_use', id: 'toolu_done', name: 'TaskUpdate', input: { taskId: '3', status: 'completed', description: 'A new body for the task' } },
    line: 'Complete task', past: 'Complete task',
  },
  {
    block: { type: 'tool_use', id: 'toolu_create', name: 'TaskCreate', input: { subject: 'Write the docs', description: 'Every page, in full' } },
    line: 'Create task: Write the docs', past: 'Create task: Write the docs',
  },
  {
    block: { type: 'tool_use', id: 'toolu_topic', name: 'mcp__docs__search', input: { limit: 5, topic: 'kqueue' } },
    line: 'kqueue', past: 'kqueue',
  },
  {
    block: { type: 'tool_use', id: 'toolu_body', name: 'mcp__docs__write', input: { body: `${'z'.repeat(100)}\nsecond line` } },
    line: `${'z'.repeat(80)}…`, past: `${'z'.repeat(80)}…`,
  },
  {
    block: {
      type: 'tool_use', id: 'toolu_ask_wide', name: 'AskUserQuestion',
      input: { questions: [{ question: `${'q'.repeat(100)}\nwhy`, header: 'Why', multiSelect: false, options: [{ label: 'Red' }] }] },
    },
    line: `${'q'.repeat(80)}…`, past: `${'q'.repeat(80)}…`,
  },
  {
    block: { type: 'tool_use', id: 'toolu_search_wide', name: 'WebSearch', input: { query: 's'.repeat(100) } },
    line: `${'s'.repeat(80)}…`, past: `${'s'.repeat(80)}…`,
  },
  {
    block: { type: 'tool_use', id: 'toolu_body_blank', name: 'mcp__docs__write', input: { body: '\n\nfirst words\nmore' } },
    line: 'first words', past: 'first words',
  },
];

/** A result for each mirrored call; the first one failed. */
const answered = {
  type: 'user', parent_tool_use_id: null, uuid: 'u2', timestamp: '2020-01-01T00:00:00.000Z',
  message: {
    role: 'user',
    content: mirrored.map(({ block }, index) => ({
      type: 'tool_result', tool_use_id: block.id, content: 'ok', ...(index === 0 ? { is_error: true } : {}),
    })),
  },
};

it('draws a live call\'s row line as its description or VS Code\'s line, and its past tense the same way', async () => {
  const { held, ready } = await live([
    { type: 'assistant', parent_tool_use_id: null, uuid: 'a1', message: { id: 'msg_1', role: 'assistant', content: mirrored.map(({ block }) => block) } },
    answered,
  ]);
  for (const { block, line, past } of mirrored) {
    const id = block.id as string;
    expect(ready.get(id)?.invocationMessage, id).toEqual(line);
    expect(held.get(id)?.invocationMessage, id).toEqual(line);
    expect(held.get(id)?.pastTenseMessage, id).toEqual(past);
    const input = block.input as Bag;
    expect(held.get(id)?.toolInput, id).toBe(block.name === 'Bash' ? input.command : JSON.stringify(input));
  }
  expect(held.get('toolu_said')?.success).toBe(false);
});

it('draws a restored call\'s row line and past tense as the live one does', async () => {
  const back = await restored(mirrored.map(({ block }) => block), [answered]);
  for (const { block, line, past } of mirrored) {
    const id = block.id as string;
    expect(back.get(id)?.invocationMessage, id).toEqual(line);
    expect(back.get(id)?.pastTenseMessage, id).toEqual(past);
    const input = block.input as Bag;
    expect(back.get(id)?.toolInput, id).toBe(block.name === 'Bash' ? input.command : JSON.stringify(input));
  }
  expect(back.get('toolu_said')?.success).toBe(false);
});

it('cuts a subject over 80 characters to its first line', async () => {
  const { held, ready } = await live([
    { type: 'assistant', parent_tool_use_id: null, uuid: 'a1', message: { id: 'msg_1', role: 'assistant', content: mirrored.map(({ block }) => block) } },
  ]);
  for (const id of ['toolu_body', 'toolu_ask_wide', 'toolu_search_wide']) {
    for (const line of [ready.get(id)?.invocationMessage, held.get(id)?.pastTenseMessage]) {
      const text = textOf(line);
      expect(text, id).not.toMatch(/\n/);
      expect(text.length, id).toBeLessThanOrEqual(81);
    }
  }
});

it('gives a confirmation card the row line, not the CLI\'s title', async () => {
  sdk.hold = new Promise(() => {});
  const input = { command: 'rm -rf /tmp/scratch', description: 'Clear scratch directory' };
  const { held, ready } = await live([], () => {
    void sdk.canUseTool?.('Bash', input, { toolUseID: 'toolu_card', title: 'Claude wants to run rm -rf /tmp/scratch' });
  });
  sdk.hold = Promise.resolve();
  expect(held.get('toolu_card')?.invocationMessage).toBe('Clear scratch directory');
  expect(ready.get('toolu_card')?.invocationMessage).toBe('Clear scratch directory');
  expect(held.get('toolu_card')?.confirmationTitle).toBe('Claude wants to run rm -rf /tmp/scratch');
  expect(held.get('toolu_card')?.toolInput).toBe('rm -rf /tmp/scratch');
});

/*
 * When a tool call ran, live and restored.
 *
 * The protocol gives a call no time of its own, so the times ride in its
 * `_meta` and this plugin's clock stamps them: the ready for a call nobody is
 * asked about, the approval for one that is, and the result for the end. An
 * action carrying a `_meta` replaces the call's whole bag, so every action
 * after the start has to carry them again.
 */

const bash = { type: 'tool_use', id: 'toolu_bash', name: 'Bash', input: { command: 'ls -la', description: 'List files' } };
const opened = [{ type: 'assistant', parent_tool_use_id: null, uuid: 'a1', message: { id: 'msg_1', role: 'assistant', content: [bash] } }];
const result = (id: string, uuid: string): Record<string, unknown> => ({
  type: 'user', parent_tool_use_id: null, uuid, timestamp: '2020-01-01T00:00:00.000Z',
  message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: 'a b c' }] },
});

it('says when a live call started, and when it ended', async () => {
  const { held, ready, sent } = await live([...opened, result('toolu_bash', 'u2')]);
  const complete = actionOf(sent, 'chat/toolCallComplete', 'toolu_bash');
  // The start is said at the ready, before there is any end to say.
  expect(metaOf(ready.get('toolu_bash'))['ahpd.startedAt']).toEqual(expect.any(String));
  expect(metaOf(ready.get('toolu_bash'))['ahpd.endedAt']).toBeUndefined();
  // And both, with how long it took, on the completion and on the call itself.
  expect(timed(complete)).toBe(true);
  expect(timed(held.get('toolu_bash'))).toBe(true);
  expect(metaOf(complete)).toMatchObject({
    'ahpd.startedAt': metaOf(complete)['ahpd.startedAt'],
    'ahpd.durationMs': expect.any(Number),
  });
  expect(Date.parse(metaOf(complete)['ahpd.endedAt'] as string))
    .toBeGreaterThanOrEqual(Date.parse(metaOf(complete)['ahpd.startedAt'] as string));
  // The kind a shell call carries rides along rather than being replaced.
  expect(metaOf(complete).toolKind).toBe('terminal');
});

it('carries the times on the progress a running call says', async () => {
  const frames = [
    ...opened,
    { type: 'system', parent_tool_use_id: null, uuid: 's1', subtype: 'task_progress', tool_use_id: 'toolu_bash', summary: 'Listing files' },
    result('toolu_bash', 'u2'),
  ];
  const { sent } = await live(frames);
  const progress = actionOf(sent, 'chat/toolCallContentChanged', 'toolu_bash');
  expect(metaOf(progress).progressMessage).toBe('Listing files');
  expect(metaOf(progress)['ahpd.startedAt']).toEqual(expect.any(String));
  // And the progress line is gone with the completion, which keeps the times.
  expect(metaOf(actionOf(sent, 'chat/toolCallComplete', 'toolu_bash')).progressMessage).toBeUndefined();
});

it('starts an approved call when it was approved, not at the ready before the question', async () => {
  let now = 1_700_000_000_000;
  const clock = vi.spyOn(Date, 'now').mockImplementation(() => now);
  const openedAt = new Date(now).toISOString();
  let held: (() => void) | undefined;
  sdk.hold = new Promise<void>((resolve) => { held = resolve; });
  const { sent, session } = await live(opened, () => {
    now += 5000;
    void sdk.canUseTool?.('Bash', bash.input, { toolUseID: 'toolu_bash' });
  });
  now += 30_000;
  const approvedAt = new Date(now).toISOString();
  session.confirm('toolu_bash', true);
  await settle();
  const confirmed = actionOf(sent, 'chat/toolCallConfirmed', 'toolu_bash');
  expect(metaOf(sent.find((one) => one.type === 'chat/toolCallReady' && one.toolCallId === 'toolu_bash'))['ahpd.startedAt']).toBe(openedAt);
  expect(metaOf(confirmed)['ahpd.startedAt']).toBe(approvedAt);
  // The completion measures from the approval, not from the ready.
  sdk.pushed.push(result('toolu_bash', 'u2'));
  now += 1000;
  held?.();
  await settle();
  expect(metaOf(actionOf(sent, 'chat/toolCallComplete', 'toolu_bash'))['ahpd.durationMs']).toBe(1000);
  clock.mockRestore();
  sdk.hold = Promise.resolve();
});

it('says no times for a call a person denied', async () => {
  let held: (() => void) | undefined;
  sdk.hold = new Promise<void>((resolve) => { held = resolve; });
  const { held: calls, sent, session } = await live(opened, () => {
    void sdk.canUseTool?.('Bash', bash.input, { toolUseID: 'toolu_bash' });
  });
  session.confirm('toolu_bash', false);
  await settle();
  const confirmed = actionOf(sent, 'chat/toolCallConfirmed', 'toolu_bash');
  expect(metaOf(confirmed)['ahpd.startedAt']).toBeUndefined();
  expect(metaOf(confirmed)['ahpd.endedAt']).toBeUndefined();
  expect(metaOf(confirmed)['ahpd.durationMs']).toBeUndefined();
  // The kind it was announced with is all a call that never ran has left.
  expect(metaOf(confirmed).toolKind).toBe('terminal');
  expect(metaOf(calls.get('toolu_bash'))['ahpd.startedAt']).toBeUndefined();
  // And the result the harness sends for it carries none either.
  sdk.pushed.push(result('toolu_bash', 'u2'));
  held?.();
  await settle();
  const complete = actionOf(sent, 'chat/toolCallComplete', 'toolu_bash');
  expect(complete).toBeDefined();
  expect(metaOf(complete)['ahpd.startedAt']).toBeUndefined();
  expect(metaOf(complete)['ahpd.durationMs']).toBeUndefined();
  sdk.hold = Promise.resolve();
});

it('says when a command of the person\'s own ran', async () => {
  const sent: Bag[] = [];
  const session = createSession({
    uri: 'ahp-session:/input',
    chatUri: 'ahp-chat:/input',
    cwd: mkdtempSync(join(tmpdir(), 'ahpd-input-')),
    emit: (_channel, action) => { sent.push(action as Bag); },
  });
  session.ran?.('t1', 'ls -la', async (toolCallId: string) => ({
    success: true, said: 'Listed files', output: 'a b c', terminal: `ahp-terminal:/${toolCallId}`,
  }));
  await settle();
  const ready = actionOf(sent, 'chat/toolCallReady', 't1:command');
  const complete = actionOf(sent, 'chat/toolCallComplete', 't1:command');
  expect(timed(complete)).toBe(true);
  expect(metaOf(complete).toolKind).toBe('terminal');
  expect(metaOf(ready)['ahpd.startedAt']).toEqual(expect.any(String));
  expect(metaOf(ready)['ahpd.endedAt']).toBeUndefined();
});

it('never writes a bare timing key on a tool call', async () => {
  const { sent } = await live([...opened, result('toolu_bash', 'u2')]);
  for (const action of sent) {
    const meta = metaOf(action);
    expect(Object.keys(meta), action.type as string).not.toContain('startedAt');
    expect(Object.keys(meta), action.type as string).not.toContain('endedAt');
    expect(Object.keys(meta), action.type as string).not.toContain('durationMs');
  }
});
