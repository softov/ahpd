import { WAIT_MS } from '../../../tools/wait.ts';
import { mkdtempSync, truncateSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import { chatReducer } from '@microsoft/agent-host-protocol';
import type { Turn } from '@microsoft/agent-host-protocol';
import { bag } from '@ahpd/sdk';
import type { Bag, TerminalOutputs, WireTurn } from '@ahpd/sdk';
import type { ClaudeSessionOptions } from '../src/session/context.js';

/*
 * A `Bash` result too large to send, as a terminal on its call.
 *
 * Claude answers the model with a notice in place of such an output, saves the
 * whole output to a file, and names the file in the result's structured
 * output. The call keeps the notice as its text, the host keeps the whole
 * output for the call's chat, and the call names the terminal the host answers
 * from it. A call read back from the transcript names it again. Every other
 * result stays as it was. The cases are the reference's:
 * https://github.com/microsoft/vscode/blob/41c37d126aa93bece57534a18f0750e4dcb6b38c/src/vs/platform/agentHost/test/node/claudeTerminalOutput.test.ts
 */

/** The SDK's stream as a queue a test pushes frames into. */
const sdk = vi.hoisted(() => {
  interface Feed { held: Record<string, unknown>[]; wake: (() => void) | undefined }
  const fresh = (): Feed => ({ held: [], wake: undefined });
  const state = {
    feed: fresh(),
    reset() { state.feed = fresh(); },
    push(...frames: Record<string, unknown>[]) {
      const feed = state.feed;
      feed.held.push(...frames);
      feed.wake?.();
      feed.wake = undefined;
    },
    async next(feed: Feed): Promise<Record<string, unknown>> {
      while (feed.held.length === 0) await new Promise<void>((resolve) => { feed.wake = resolve; });
      return feed.held.shift() as Record<string, unknown>;
    },
  };
  return state;
});

/** A read the test holds open, so a turn can be stopped while the file is read. */
const reads = vi.hoisted(() => ({ hold: undefined as Promise<void> | undefined }));

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...actual,
    readFile: async (...args: unknown[]) => {
      await reads.hold;
      return await (actual.readFile as (...rest: unknown[]) => Promise<unknown>)(...args);
    },
  };
});

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  createSdkMcpServer: (given: Record<string, unknown>) => ({ type: 'sdk', name: given.name, tools: given.tools }),
  query: () => {
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
const { restoreSavedOutputs, SAVED_BYTES } = await import('../src/session/savedoutput.js');

/** The whole output, longer than the preview Claude gives the model. */
const OUTPUT = `FULL_OUTPUT_BEGIN\n${'x'.repeat(4096)}\nFULL_OUTPUT_END\n`;

/** The notice Claude returns to the model in place of `OUTPUT`, naming the file it saved it to. */
const noticeFor = (path: string): string => [
  '<persisted-output>',
  `Output too large (4.1KB). Full output saved to: ${path}`,
  '',
  'Preview (first 2KB):',
  'FULL_OUTPUT_BEGIN',
  '...',
  '</persisted-output>',
].join('\n');

/** A file holding `OUTPUT`, where Claude would have saved it. */
const saved = (): string => {
  const path = join(mkdtempSync(join(tmpdir(), 'ahpd-saved-')), 'b907a98.txt');
  writeFileSync(path, OUTPUT);
  return path;
};

/**
 * The outputs a host keeps for one chat, held in a map the test reads.
 *
 * `refuses` is a host that could not keep one: no folder, or over its limit.
 */
const fakeOutputs = (refuses = false): TerminalOutputs & { kept: Map<string, { output: string; exitCode?: number }> } => {
  const kept = new Map<string, { output: string; exitCode?: number }>();
  return {
    kept,
    uri: (key) => `ahp-terminal://shell/chat/${key}`,
    has: (key) => kept.has(key),
    keep: (key, output, exitCode) => {
      if (refuses) return false;
      kept.set(key, { output, ...(exitCode === undefined ? {} : { exitCode }) });
      return true;
    },
  };
};

const settle = async (times = 30): Promise<void> => {
  for (let i = 0; i < times; i++) await new Promise((r) => { setTimeout(r, 0); });
};

/** Wait for something the session does once a read on the thread pool has come back. */
const until = async (done: () => boolean): Promise<void> => {
  for (const by = Date.now() + WAIT_MS; !done() && Date.now() < by;) await new Promise((r) => { setTimeout(r, 2); });
  expect(done()).toBe(true);
};

/**
 * A session on the fake feed, whose kept outputs the test reads.
 *
 * `outputs` is what the host keeps outputs with, or `null` for a host that
 * keeps none.
 */
async function open(extra: Partial<ClaudeSessionOptions> = {}, outputs: ReturnType<typeof fakeOutputs> | null = fakeOutputs()) {
  sdk.reset();
  const sent: Bag[] = [];
  const session = createSession({
    uri: 'ahp-session:/saved',
    chatUri: 'ahp-chat:/saved',
    cwd: mkdtempSync(join(tmpdir(), 'ahpd-saved-cwd-')),
    emit: (channel, action) => { if (channel === 'chat') sent.push(action); },
    ...(outputs === null ? {} : { terminalOutputs: outputs }),
    ...extra,
  });
  await settle();
  return { session, sent, kept: outputs?.kept ?? new Map<string, { output: string; exitCode?: number }>() };
}

/** The model calls one tool, which is how a turn of the agent's own opens here. */
const called = (name: string, id = 'toolu_1', message = 'm1'): Record<string, unknown> => ({
  type: 'assistant',
  parent_tool_use_id: null,
  message: { id: message, role: 'assistant', content: [{ type: 'tool_use', id, name, input: { command: 'seq 1 100000', description: 'Count' } }] },
});

/**
 * The tool's result: the notice for the model, and the structured output
 * beside it. `failed` is a command that went wrong, which Claude says with
 * `is_error` and no exit code.
 */
const answered = (
  text: string,
  structured: Record<string, unknown> | undefined,
  extra: Record<string, unknown> = {},
  failed = false,
  id = 'toolu_1',
): Record<string, unknown> => ({
  type: 'user',
  parent_tool_use_id: null,
  message: {
    role: 'user',
    content: [{ type: 'tool_result', tool_use_id: id, content: text, ...(failed ? { is_error: true } : {}) }],
  },
  ...(structured === undefined ? {} : { tool_use_result: structured }),
  ...extra,
});

/** A `Bash` result's structured output, as Claude writes it for an output it saved. */
const structuredFor = (path: string): Record<string, unknown> => ({
  stdout: OUTPUT.slice(0, 1000),
  stderr: '',
  interrupted: false,
  persistedOutputPath: path,
  persistedOutputSize: OUTPUT.length,
});

const completionOf = (sent: Bag[]): Bag | undefined => sent.find((one) => one.type === 'chat/toolCallComplete');

it('keeps the output Claude saved for the chat, and names its terminal after the notice', async () => {
  const path = saved();
  const notice = noticeFor(path);
  const { session, sent, kept } = await open();
  const before = session.chatState();
  sdk.push(called('Bash'), answered(notice, structuredFor(path)));
  await until(() => completionOf(sent) !== undefined);

  // The whole output, under the call's id, with 0 for a command that worked.
  expect([...kept]).toEqual([['toolu_1', { output: OUTPUT, exitCode: 0 }]]);

  const content = [
    { type: 'text', text: notice },
    {
      type: 'terminal',
      resource: 'ahp-terminal://shell/chat/toolu_1',
      title: 'Bash',
      isPty: false,
      result: { exitCode: 0, preview: 'FULL_OUTPUT_BEGIN', truncated: true },
    },
  ];
  expect(bag(completionOf(sent)?.result).content).toEqual(content);
  // The call a client reads in a snapshot says the same as the action.
  expect(callOf(session.chatState()).content).toEqual(content);
  // And the protocol's own reducer, fed the actions in order, ends there too.
  let chat = before as Bag;
  for (const action of sent) chat = chatReducer(chat as never, action as never) as unknown as Bag;
  expect(callOf(chat)).toMatchObject({ status: 'completed', success: true, content });
});

it('keeps no exit code for a command that failed', async () => {
  const path = saved();
  const notice = noticeFor(path);
  const { sent, kept } = await open();
  sdk.push(called('Bash'), answered(notice, structuredFor(path), {}, true));
  await until(() => completionOf(sent) !== undefined);

  expect([...kept]).toEqual([['toolu_1', { output: OUTPUT }]]);
  const result = bag(completionOf(sent)?.result);
  expect(result.success).toBe(false);
  // Claude says a command failed, not what it exited with, so no code is said.
  expect((result.content as Bag[]).at(-1)).toEqual({
    type: 'terminal',
    resource: 'ahp-terminal://shell/chat/toolu_1',
    title: 'Bash',
    isPty: false,
    result: { preview: 'FULL_OUTPUT_BEGIN', truncated: true },
  });
});

it('names a terminal with no preview for a notice it does not read', async () => {
  const path = saved();
  const notice = '<persisted-output>\nA notice in words nobody here has seen\n</persisted-output>';
  const { sent, kept } = await open();
  sdk.push(called('Bash'), answered(notice, structuredFor(path)));
  await until(() => completionOf(sent) !== undefined);

  expect(kept.get('toolu_1')).toEqual({ output: OUTPUT, exitCode: 0 });
  expect((bag(completionOf(sent)?.result).content as Bag[]).at(-1)).toMatchObject({
    type: 'terminal', result: { exitCode: 0, truncated: true },
  });
  expect(bag((bag(completionOf(sent)?.result).content as Bag[]).at(-1)?.result).preview).toBeUndefined();
});

it('reads the preview from a result\'s first text block, as the reference does', async () => {
  const path = saved();
  const { sent } = await open();
  // The notice is the first text of a result in blocks, and only the first is read.
  const blocks = (first: string, second: string): Record<string, unknown> => {
    const frame = answered('', structuredFor(path));
    (bag(frame.message).content as Bag[])[0] = {
      type: 'tool_result', tool_use_id: 'toolu_1', content: [{ type: 'text', text: first }, { type: 'text', text: second }],
    };
    return frame;
  };
  sdk.push(called('Bash'), blocks(noticeFor(path), 'and a second block'));
  await until(() => completionOf(sent) !== undefined);
  expect(bag((bag(completionOf(sent)?.result).content as Bag[]).at(-1)?.result).preview).toBe('FULL_OUTPUT_BEGIN');

  // A notice split over two blocks is not read: the first holds no end to it.
  const notice = noticeFor(path);
  const cut = notice.indexOf('\n...');
  const later = await open();
  sdk.push(called('Bash'), blocks(notice.slice(0, cut), notice.slice(cut + 1)));
  await until(() => completionOf(later.sent) !== undefined);
  const terminal = (bag(completionOf(later.sent)?.result).content as Bag[]).at(-1);
  expect(terminal?.type).toBe('terminal');
  expect(bag(terminal?.result).preview).toBeUndefined();
});

/*
 * What gets no terminal: a result as Claude returned it stays exactly that.
 */
const none: {
  name: string;
  frames: (path: string) => Record<string, unknown>[];
  options?: Partial<ClaudeSessionOptions>;
  outputs?: ReturnType<typeof fakeOutputs> | null;
}[] = [
  {
    name: 'an ordinary result, with its output inline',
    frames: () => [called('Bash'), answered('1\n2\n3', { stdout: '1\n2\n3', stderr: '', interrupted: false })],
  },
  {
    name: 'a subagent\'s result',
    frames: (path) => [called('Bash'), answered(noticeFor(path), structuredFor(path), { parent_tool_use_id: 'toolu_task' })],
  },
  {
    name: 'a backgrounded command, whose file is a snapshot',
    frames: (path) => [called('Bash'), answered(noticeFor(path), { ...structuredFor(path), backgroundTaskId: 'b907a98' })],
  },
  {
    name: 'another tool',
    frames: (path) => [called('Read'), answered(noticeFor(path), structuredFor(path))],
  },
  {
    name: 'a file that is not there',
    frames: (path) => [called('Bash'), answered(noticeFor(path), structuredFor(join(path, '..', 'gone.txt')))],
  },
  {
    name: 'a path that is a folder',
    frames: (path) => [called('Bash'), answered(noticeFor(path), structuredFor(join(path, '..')))],
  },
  {
    name: 'a file over 10 MB, which is not read',
    frames: (path) => {
      // Sparse, so the size is there without writing the bytes.
      const large = join(path, '..', 'large.txt');
      writeFileSync(large, '');
      truncateSync(large, SAVED_BYTES + 1);
      return [called('Bash'), answered(noticeFor(large), structuredFor(large))];
    },
  },
  {
    name: 'a message with two results',
    frames: (path) => {
      const two = answered(noticeFor(path), structuredFor(path));
      const blocks = bag(two.message).content as Bag[];
      blocks.push({ type: 'tool_result', tool_use_id: 'toolu_2', content: 'and another' });
      return [called('Bash'), two];
    },
  },
  {
    name: 'a session in a machine, whose file is inside the machine',
    frames: (path) => [called('Bash'), answered(noticeFor(path), structuredFor(path))],
    options: { spawn: () => { throw new Error('the fake SDK starts no CLI'); } },
  },
  {
    name: 'a host that keeps no outputs',
    frames: (path) => [called('Bash'), answered(noticeFor(path), structuredFor(path))],
    outputs: null,
  },
  {
    name: 'a host that could not keep the output',
    frames: (path) => [called('Bash'), answered(noticeFor(path), structuredFor(path))],
    outputs: fakeOutputs(true),
  },
];

it.each(none)('names no terminal for $name', async ({ frames, options, outputs }) => {
  const path = saved();
  const { sent, kept } = await open(options, outputs);
  const pushed = frames(path);
  sdk.push(...pushed);
  await until(() => completionOf(sent) !== undefined);

  expect(kept.size).toBe(0);
  // The call's own result, its text alone, as Claude returned it.
  const first = (bag(pushed[1]?.message).content as Bag[])[0];
  expect(bag(completionOf(sent)?.result).content).toEqual([{ type: 'text', text: first?.content }]);
});

/** The turns the session has started, in order. */
const started = (sent: Bag[]): Bag[] => sent.filter((one) => one.type === 'chat/turnStarted');

it('keeps nothing for a turn stopped while the file was read', async () => {
  const path = saved();
  let release: (() => void) | undefined;
  reads.hold = new Promise<void>((resolve) => { release = resolve; });
  try {
    const { session, sent, kept } = await open();
    sdk.push(called('Bash'), answered(noticeFor(path), structuredFor(path)));
    await settle();
    session.cancel(String(started(sent)[0]?.turnId));
    // The model's next call waits behind the read, so its turn starts once the
    // stopped call's result has been read and mapped.
    sdk.push(called('Bash', 'toolu_2', 'm2'));
    release?.();
    await until(() => started(sent).length === 2);
    expect(kept.size).toBe(0);
    const completions = sent.filter((one) => one.type === 'chat/toolCallComplete');
    expect(completions.some((one) => (bag(one.result).content as Bag[] | undefined)?.some((block) => block.type === 'terminal'))).toBe(false);
  }
  finally {
    reads.hold = undefined;
    release?.();
  }
});

it('keeps nothing for a result that arrives after its turn was stopped', async () => {
  const path = saved();
  const { session, sent, kept } = await open();
  sdk.push(called('Bash'));
  await settle();
  session.cancel(String(started(sent)[0]?.turnId));
  // The model's next call opens a turn once the stopped call's result has been
  // read, so the result has been read when that turn starts.
  sdk.push(answered(noticeFor(path), structuredFor(path)), called('Bash', 'toolu_2', 'm2'));
  await until(() => started(sent).length === 2);
  expect(kept.size).toBe(0);
});

it('keeps nothing for a stopped turn\'s result that arrives while a later turn runs', async () => {
  const path = saved();
  const { session, sent, kept } = await open();
  sdk.push(called('Bash'));
  await settle();
  session.cancel(String(started(sent)[0]?.turnId));
  sdk.push(called('Bash', 'toolu_2', 'm2'));
  await until(() => started(sent).length === 2);
  // The stopped call's result, then the running call's: the second is read
  // after the first, so its completion says the first has been read.
  sdk.push(answered(noticeFor(path), structuredFor(path)), answered('done', undefined, {}, false, 'toolu_2'));
  await until(() => sent.some((one) => one.type === 'chat/toolCallComplete' && one.toolCallId === 'toolu_2'));
  expect(kept.size).toBe(0);
});

it('keeps nothing for a session closed while the file was read', async () => {
  const path = saved();
  let release: (() => void) | undefined;
  reads.hold = new Promise<void>((resolve) => { release = resolve; });
  try {
    const { session, sent, kept } = await open();
    sdk.push(called('Bash'), answered(noticeFor(path), structuredFor(path)));
    await settle();
    await session.close();
    release?.();
    await until(() => completionOf(sent) !== undefined);
    expect(kept.size).toBe(0);
  }
  finally {
    reads.hold = undefined;
    release?.();
  }
});

/*
 * A call read back from the transcript, which holds the notice alone.
 */

/** A turn with one restored call, as the transcript reader builds it. */
const restored = (call: Record<string, unknown>): WireTurn<Turn>[] => [{
  id: 'u1',
  startedAt: '2026-10-27T00:00:00.000Z',
  message: { text: 'count it', origin: { kind: 'user' } },
  state: 'complete',
  usage: undefined,
  responseParts: [{
    kind: 'toolCall',
    toolCall: {
      toolCallId: 'toolu_1',
      toolName: 'Bash',
      displayName: 'Bash',
      status: 'completed',
      invocationMessage: 'Count',
      confirmed: 'not-needed',
      success: true,
      pastTenseMessage: 'Counted',
      content: [{ type: 'text', text: noticeFor('/tmp/b907a98.txt') }],
      ...call,
    },
  }],
}] as unknown as WireTurn<Turn>[];

/** The restored call's content. */
const restoredContent = (turns: WireTurn<Turn>[]): Bag[] =>
  bag(bag((turns[0] as unknown as { responseParts: Bag[] }).responseParts[0]).toolCall).content as Bag[];

it('names the terminal again on a call read back whose output the host keeps', () => {
  const outputs = fakeOutputs();
  outputs.keep('toolu_1', OUTPUT, 0);
  const turns = restored({});
  restoreSavedOutputs(turns, outputs);
  expect(restoredContent(turns)).toEqual([
    { type: 'text', text: noticeFor('/tmp/b907a98.txt') },
    {
      type: 'terminal',
      resource: 'ahp-terminal://shell/chat/toolu_1',
      title: 'Bash',
      isPty: false,
      result: { exitCode: 0, preview: 'FULL_OUTPUT_BEGIN', truncated: true },
    },
  ]);

  // A call that failed says no code, as the live one does.
  const failed = restored({ success: false });
  restoreSavedOutputs(failed, outputs);
  expect(restoredContent(failed).at(-1)).toMatchObject({ type: 'terminal', result: { preview: 'FULL_OUTPUT_BEGIN', truncated: true } });
  expect(bag(restoredContent(failed).at(-1)?.result).exitCode).toBeUndefined();
});

it.each([
  { name: 'whose output the host does not keep', call: {}, keep: false },
  { name: 'of another tool', call: { toolName: 'Read', displayName: 'Read' }, keep: true },
  { name: 'that was not completed', call: { status: 'cancelled' }, keep: true },
])('names no terminal on a call read back $name', ({ call, keep }) => {
  const outputs = fakeOutputs();
  if (keep) outputs.keep('toolu_1', OUTPUT, 0);
  const turns = restored(call);
  restoreSavedOutputs(turns, outputs);
  expect(restoredContent(turns)).toEqual([{ type: 'text', text: noticeFor('/tmp/b907a98.txt') }]);
});

/** The one tool call of a chat's running turn. */
function callOf(chat: unknown): Bag {
  const turn = bag(bag(chat).activeTurn);
  const part = (turn.responseParts as Bag[] | undefined)?.find((one) => one.kind === 'toolCall');
  return bag(part?.toolCall);
}
