import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, expect, it, vi } from 'vitest';
import type { Bag } from '@ahpd/sdk';

/*
 * A prompt sent while a new CLI starts, and which CLI reads it.
 *
 * Every CLI a session starts reads the one list of prompts waiting to go out,
 * and a turn that starts on a new CLI - an agent the message picked, a record
 * edited since the last turn - pushes its prompt the moment that CLI exists.
 * The SDK reads a new CLI's input only after its initialize request is
 * written, and with an in-process MCP server declared it first asks that
 * server for its manifest, so the read comes late. The CLI it replaced is
 * still reading in the meantime, and the SDK drops whatever a closed query's
 * reader is handed (sdk.mjs 0.3.301, `Query.streamInput`).
 *
 * This fake reads each query's prompt the way the SDK does: the first at once,
 * a later one only when the test says, and a closed one drops what it gets.
 */

const sdk = vi.hoisted(() => ({
  queries: [] as { closed: boolean; got: string[]; dropped: string[]; done: boolean }[],
  /** Readers of the queries started after the first, held until the test lets them read. */
  later: [] as (() => void)[],
  feed: { held: [] as Record<string, unknown>[], wake: undefined as (() => void) | undefined },
  reset() {
    sdk.queries = [];
    sdk.later = [];
    sdk.feed.held = [];
    sdk.feed.wake = undefined;
  },
  push(...frames: Record<string, unknown>[]) {
    sdk.feed.held.push(...frames);
    sdk.feed.wake?.();
    sdk.feed.wake = undefined;
  },
  readLater() {
    const readers = sdk.later;
    sdk.later = [];
    for (const read of readers) read();
  },
}));

vi.mock('@anthropic-ai/claude-agent-sdk', async () => (await import('../../sdk/test/support/warmed.js')).warmed({
  createSdkMcpServer: (given: Record<string, unknown>) => ({ type: 'sdk', name: given.name, tools: given.tools }),
  query: (given: { prompt: AsyncIterable<{ message: { content: unknown } }> }) => {
    const query = { closed: false, got: [] as string[], dropped: [] as string[], done: false };
    sdk.queries.push(query);
    const textOf = (content: unknown): string => typeof content === 'string'
      ? content
      : (content as { text?: string }[]).map((block) => block.text ?? '').join('');
    const read = async (): Promise<void> => {
      for await (const message of given.prompt) {
        const text = textOf(message.message.content);
        if (query.closed) { query.dropped.push(text); break; }
        query.got.push(text);
      }
      query.done = true;
    };
    if (sdk.queries.length === 1) void read();
    else sdk.later.push(() => { void read(); });
    const wake = async (): Promise<void> => {
      while (sdk.feed.held.length === 0) {
        if (query.closed) return;
        await new Promise<void>((resolve) => { sdk.feed.wake = resolve; });
      }
    };
    return {
      async *[Symbol.asyncIterator]() {
        for (;;) {
          await wake();
          if (query.closed) return;
          yield sdk.feed.held.shift();
        }
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
      close: () => {
        query.closed = true;
        sdk.feed.wake?.();
        sdk.feed.wake = undefined;
      },
    };
  },
}));

const { createSession } = await import('../src/session.js');

const settle = async (times = 30): Promise<void> => {
  for (let i = 0; i < times; i++) await new Promise((r) => { setTimeout(r, 0); });
};

/** A session whose first CLI its first turn started is up, reading its input, and has said its id, the turn over. */
async function open() {
  sdk.reset();
  const said: Bag[] = [];
  const session = createSession({
    uri: 'ahp-session:/restart',
    chatUri: 'ahp-chat:/restart',
    cwd: mkdtempSync(join(tmpdir(), 'ahpd-restart-')),
    emit: (_channel, action) => { said.push(action as Bag); },
  });
  session.sendMessage('t0', 'hello');
  await settle();
  sdk.push({ type: 'system', subtype: 'init', session_id: 'cli-1' }, { type: 'result', subtype: 'success', is_error: false, duration_ms: 1, session_id: 'cli-1' });
  await settle();
  return { session, said };
}

beforeEach(() => { sdk.reset(); });

it('hands a prompt sent while a new CLI starts to that CLI', async () => {
  const { session } = await open();
  session.changeAgent({ uri: 'claude-internal:/agent/Plan' });
  session.sendMessage('t1', 'plan this');
  await settle();
  // The new CLI reads its input only now, as one does once its initialize is out.
  sdk.readLater();
  await settle();

  expect(sdk.queries).toHaveLength(2);
  expect(sdk.queries[1]?.got).toEqual(['plan this']);
});

it('ends the reader of the CLI it replaced without handing it anything', async () => {
  const { session } = await open();
  session.changeAgent({ uri: 'claude-internal:/agent/Plan' });
  session.sendMessage('t1', 'plan this');
  await settle();

  expect(sdk.queries[0]?.done).toBe(true);
  expect(sdk.queries[0]?.dropped).toEqual([]);
});
