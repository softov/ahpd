import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { pollTaskOutput, tailText } from '../src/session/taskoutput.js';
import type { TaskOutput } from '../src/session/taskoutput.js';
import type { OutputTerminal } from '@ahpd/sdk';

/*
 * What a background shell's output looks like as it arrives.
 *
 * The harness answers one task's output with the tail it holds and the size of
 * the whole output, so what the terminal is fed is a function of two reads
 * rather than of one. The poll cases below drive that with a fake read and a
 * fake terminal; the last case drives a whole session through the host's own
 * seam, because a row has to name the terminal it was given.
 */

/** The SDK's stream as a queue a test pushes frames into. */
const sdk = vi.hoisted(() => {
  interface Feed { held: Record<string, unknown>[]; wake: (() => void) | undefined }
  const fresh = (): Feed => ({ held: [], wake: undefined });
  const state = {
    feed: fresh(),
    /** What `getTaskOutput` answers next, by task id. */
    answers: new Map<string, { output: string; total_bytes: number; truncated: boolean }>(),
    reset() {
      state.feed = fresh();
      state.answers.clear();
    },
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

vi.mock('@anthropic-ai/claude-agent-sdk', async () => (await import('../../sdk/test/support/warmed.js')).warmed({
  createSdkMcpServer: (given: Record<string, unknown>) => ({ type: 'sdk', name: given.name, tools: given.tools }),
  query: () => {
    const feed = sdk.feed;
    return {
      async *[Symbol.asyncIterator]() {
        for (;;) yield await sdk.next(feed);
      },
      interrupt: async () => {},
      stopTask: async () => {},
      getTaskOutput: async (id: string) => sdk.answers.get(id) ?? { output: '', total_bytes: 0, truncated: false },
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

const settle = async (times = 30): Promise<void> => {
  for (let i = 0; i < times; i++) await new Promise((r) => { setImmediate(r); });
};

/** A terminal that keeps what it was told, in order. */
const fakeTerminal = (uri = 'ahp-terminal:/one'): OutputTerminal & { calls: [string, string | undefined][] } => {
  const calls: [string, string | undefined][] = [];
  return {
    uri,
    calls,
    append: (text: string) => { calls.push(['append', text]); },
    reset: () => { calls.push(['reset', undefined]); },
    replace: (text: string) => { calls.push(['replace', text]); },
    finalize: (code?: number) => { calls.push(['finalize', code === undefined ? undefined : String(code)]); },
    dispose: () => { calls.push(['dispose', undefined]); },
  };
};

/** One read's answer, from a list the test fills. */
const reader = (answers: TaskOutput[]) => async (): Promise<TaskOutput> => {
  const next = answers.shift();
  if (next === undefined) throw new Error('read past the end of the answers');
  return next;
};

describe('the poll', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('appends what the first read holds', async () => {
    const terminal = fakeTerminal();
    const poll = pollTaskOutput({
      taskId: 't-sleep',
      terminal,
      read: reader([{ output: 'hello\n', total_bytes: 6, truncated: false }]),
    });
    await vi.advanceTimersByTimeAsync(0);

    expect(terminal.calls).toEqual([['append', 'hello\n']]);
    poll.cancel();
  });

  it('appends only the growth between two reads', async () => {
    const terminal = fakeTerminal();
    const poll = pollTaskOutput({
      taskId: 't-sleep',
      terminal,
      read: reader([
        { output: 'hello\n', total_bytes: 6, truncated: false },
        // The tail is the end of the whole output, so what is appended is its
        // last 5 bytes rather than the whole of it.
        { output: 'hello\nworld\n', total_bytes: 12, truncated: false },
      ]),
    });
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(1000);

    expect(terminal.calls).toEqual([['append', 'hello\n'], ['append', 'world\n']]);
    poll.cancel();
  });

  it('replaces the content when the growth is larger than the tail', async () => {
    const terminal = fakeTerminal();
    const poll = pollTaskOutput({
      taskId: 't-sleep',
      terminal,
      read: reader([
        { output: 'start\n', total_bytes: 6, truncated: false },
        // 20 KB written, and the read holds the last 8 KB: the bytes in
        // between were never seen, so appending would claim them.
        { output: 'b'.repeat(8000), total_bytes: 20000, truncated: true },
      ]),
    });
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(1000);

    expect(terminal.calls).toEqual([['append', 'start\n'], ['replace', 'b'.repeat(8000)]]);
    poll.cancel();
  });

  it('reads once more after the task ends, then finalizes with no exit code', async () => {
    const terminal = fakeTerminal();
    const poll = pollTaskOutput({
      taskId: 't-sleep',
      terminal,
      read: reader([
        { output: 'one', total_bytes: 3, truncated: false },
        { output: 'one and two', total_bytes: 11, truncated: false },
      ]),
    });
    await vi.advanceTimersByTimeAsync(0);

    poll.finish();
    await vi.advanceTimersByTimeAsync(0);

    expect(terminal.calls).toEqual([['append', 'one'], ['append', ' and two'], ['finalize', undefined]]);
  });

  it('stops without a last read when the session closes', async () => {
    const terminal = fakeTerminal();
    const poll = pollTaskOutput({
      taskId: 't-sleep',
      terminal,
      read: reader([{ output: 'one', total_bytes: 3, truncated: false }]),
    });
    await vi.advanceTimersByTimeAsync(0);

    poll.cancel();
    await vi.advanceTimersByTimeAsync(5000);

    expect(terminal.calls).toEqual([['append', 'one']]);
  });

  /*
   * As VS Code's output monitor polls a running command: 500 ms to the first
   * read after the one made at once, each wait twice the last up to 10 s, and
   * 500 ms again once output comes after two reads in a row found none.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/workbench/contrib/terminalContrib/chatAgentTools/browser/tools/monitoring/outputMonitor.ts#L478-L500
   */
  it('waits 500 ms, then twice as long each read up to 10 s, and 500 ms again when output follows a quiet spell', async () => {
    const terminal = fakeTerminal();
    const start = Date.now();
    const at: number[] = [];
    // Five bytes at the first read, nothing more for the next four, then four more.
    const sizes = [5, 5, 5, 5, 5, 9];
    const poll = pollTaskOutput({
      taskId: 't-sleep',
      terminal,
      read: async () => {
        const size = sizes[Math.min(at.length, sizes.length - 1)] ?? 0;
        at.push(Date.now() - start);
        return { output: 'x'.repeat(size), total_bytes: size, truncated: false };
      },
    });
    await vi.advanceTimersByTimeAsync(17_000);
    poll.cancel();

    expect(at).toEqual([0, 500, 1500, 3500, 7500, 15_500, 16_000, 17_000]);
  });

  it('waits the first and longest waits the record names', async () => {
    const terminal = fakeTerminal();
    const start = Date.now();
    const at: number[] = [];
    const poll = pollTaskOutput({
      taskId: 't-sleep',
      terminal,
      firstWaitMs: 100,
      longestWaitMs: 300,
      read: async () => {
        at.push(Date.now() - start);
        return { output: 'x', total_bytes: 1, truncated: false };
      },
    });
    await vi.advanceTimersByTimeAsync(1000);
    poll.cancel();

    // 100 first, then 200, then 300 and no longer.
    expect(at.slice(0, 5)).toEqual([0, 100, 300, 600, 900]);
  });

  it('counts a shell quiet after the reads the record\'s taskOutputQuietReads names', async () => {
    const terminal = fakeTerminal();
    const start = Date.now();
    const at: number[] = [];
    // Five bytes, nothing more for one read, then four more.
    const sizes = [5, 5, 9];
    const poll = pollTaskOutput({
      taskId: 't-sleep',
      terminal,
      quietReads: 1,
      read: async () => {
        const size = sizes[Math.min(at.length, sizes.length - 1)] ?? 0;
        at.push(Date.now() - start);
        return { output: 'x'.repeat(size), total_bytes: size, truncated: false };
      },
    });
    await vi.advanceTimersByTimeAsync(3000);
    poll.cancel();

    // One quiet read is a quiet spell, so the output after it brings 500 ms back.
    expect(at).toEqual([0, 500, 1500, 2000, 3000]);
  });
});

it('cuts a tail on a character boundary, never inside one', () => {
  // Two bytes of `é`, and one byte of it is not a character.
  expect(tailText('aé', 2)).toBe('é');
  expect(tailText('aé', 1)).toBe('');
  expect(tailText('aé', 3)).toBe('aé');
});

/*
 * A whole session, to check the row names the terminal the host opened.
 */

it('gives a shell a terminal on its first set, and finishes it when the task ends', async () => {
  sdk.reset();
  const created: { title: string; chat: string }[] = [];
  const terminals: ReturnType<typeof fakeTerminal>[] = [];
  const rows: { chat: string; task: Record<string, unknown> }[] = [];
  const removed: { chat: string; id: string }[] = [];
  let at = 0;

  sdk.answers.set('t-sleep', { output: 'started\n', total_bytes: 8, truncated: false });
  const session = createSession({
    uri: 'ahp-session:/out',
    chatUri: 'ahp-chat:/out',
    cwd: mkdtempSync(join(tmpdir(), 'ahpd-out-')),
    emit: () => {},
    backgroundTasks: {
      set: (chat, task) => { rows.push({ chat, task: task as unknown as Record<string, unknown> }); },
      remove: (chat, id) => { removed.push({ chat, id }); },
    },
    outputTerminals: {
      create: ({ title, chat }) => {
        created.push({ title, chat });
        at += 1;
        const terminal = fakeTerminal(`ahp-terminal:/out-${at}`);
        terminals.push(terminal);
        return terminal;
      },
    },
  });
  await settle();
  // The turn the frames answer.
  session.sendMessage('t1', 'go');
  await settle();

  sdk.push(
    { type: 'assistant', message: { id: 'm1', content: [{ type: 'tool_use', id: 'toolu_bg', name: 'Bash', input: { command: 'sleep 100', run_in_background: true } }] } },
    { type: 'system', subtype: 'task_started', task_id: 't-sleep', tool_use_id: 'toolu_bg', description: 'sleep 100', task_type: 'local_bash' },
    { type: 'system', subtype: 'background_tasks_changed', tasks: [{ task_id: 't-sleep', task_type: 'local_bash', description: 'sleep 100' }] },
  );
  await settle();

  // Named with the label, held by the chat the row is drawn on.
  expect(created).toEqual([{ title: 'sleep 100', chat: 'ahp-chat:/out' }]);
  expect(rows).toHaveLength(1);
  expect(rows[0]?.task.terminal).toBe('ahp-terminal:/out-1');
  // The first read was taken as soon as the task was listed.
  expect(terminals[0]?.calls).toEqual([['append', 'started\n']]);

  // The task ended: the row goes, one last read is taken, and the output is
  // finished with no exit code, because a notification carries none.
  sdk.answers.set('t-sleep', { output: 'started\nfinished\n', total_bytes: 17, truncated: false });
  sdk.push({ type: 'system', subtype: 'background_tasks_changed', tasks: [] });
  await settle();

  expect(removed).toEqual([{ chat: 'ahp-chat:/out', id: 'shell:t-sleep' }]);
  expect(terminals[0]?.calls).toEqual([
    ['append', 'started\n'],
    ['append', 'finished\n'],
    ['finalize', undefined],
  ]);

  // Closing the session takes the channel with it.
  await session.close();
  expect(terminals[0]?.calls.at(-1)?.[0]).toBe('dispose');
});
