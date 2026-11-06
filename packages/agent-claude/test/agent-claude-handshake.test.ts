import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, expect, it, vi } from 'vitest';
import type { Bag } from '@ahpd/sdk';

/*
 * The CLI has a bound to answer its handshake, the SDK's own.
 *
 * `initializationResult` is the one call that says the process is up and
 * talking, and a CLI that never takes it is a session drawn as thinking for as
 * long as anyone watches - a machine whose `docker exec` never returns, or a
 * wrapper waiting on something that will not come. A session starts its CLI
 * through the SDK's `startup`, as VS Code's Claude session does, which waits
 * for the handshake under the bound it is handed and rejects in its own words
 * when the CLI does not answer: the turn that asked fails in those words, and
 * the next send starts a CLI again. A start a stop overtook fails nothing.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/claude/claudeAgentSession.ts#L676-L681
 */

const sdk = vi.hoisted(() => ({
  /** Whether the CLIs started from here on answer their handshake at all. */
  answers: true,
  built: 0,
  closed: 0,
  /** The bound each start was handed. */
  bounds: [] as (number | undefined)[],
  feed: { held: [] as Record<string, unknown>[], wake: undefined as (() => void) | undefined },
  reset() {
    sdk.answers = true;
    sdk.built = 0;
    sdk.closed = 0;
    sdk.bounds = [];
    sdk.feed.held = [];
    sdk.feed.wake = undefined;
  },
  push(...frames: Record<string, unknown>[]) {
    sdk.feed.held.push(...frames);
    sdk.feed.wake?.();
    sdk.feed.wake = undefined;
  },
}));

/** The SDK's words for a CLI that did not answer within `ms`, its dash (U+2014) its own. */
const unanswered = vi.hoisted(() => (ms: number): string =>
  `Subprocess initialization did not complete within ${ms}ms ${String.fromCharCode(0x2014)} check authentication and network connectivity`);

vi.mock('@anthropic-ai/claude-agent-sdk', () => {
  const made = () => {
    sdk.built += 1;
    // Read once, at the start: a test that turns the answer back on is doing
    // so for a CLI that comes after this one.
    const answers = sdk.answers;
    let closed = false;
    const wake = async (): Promise<void> => {
      while (sdk.feed.held.length === 0) {
        if (closed) return;
        await new Promise<void>((resolve) => { sdk.feed.wake = resolve; });
      }
    };
    return {
      async *[Symbol.asyncIterator]() {
        for (;;) {
          await wake();
          if (closed) return;
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
      // The handshake itself: what a CLI that is there answers, and what a CLI
      // that never came up leaves hanging for ever.
      initializationResult: () => (answers ? Promise.resolve({}) : new Promise(() => {})),
      mcpServerStatus: async () => [],
      reloadSkills: async () => ({ skills: [] }),
      reloadPlugins: async () => ({ plugins: [] }),
      supportedModels: async () => [],
      streamInput: async () => {},
      close: () => {
        if (closed) return;
        closed = true;
        sdk.closed += 1;
        sdk.feed.wake?.();
        sdk.feed.wake = undefined;
      },
    };
  };
  return {
    createSdkMcpServer: (given: Record<string, unknown>) => ({ type: 'sdk', name: given.name, tools: given.tools }),
    /*
     * The SDK's `startup` as 0.3.301 runs it: the CLI spawned, its handshake
     * waited for under the bound, and one that does not answer within it
     * closed and the start rejected in the SDK's words.
     */
    startup: async ({ initializeTimeoutMs = 60000 }: { initializeTimeoutMs?: number }) => {
      sdk.bounds.push(initializeTimeoutMs);
      const cli = made();
      const answered = await Promise.race([
        cli.initializationResult().then(() => true),
        new Promise<boolean>((resolve) => { setTimeout(() => { resolve(false); }, initializeTimeoutMs); }),
      ]);
      if (!answered) {
        cli.close();
        throw new Error(unanswered(initializeTimeoutMs));
      }
      return { query: () => cli, close: () => { cli.close(); }, [Symbol.asyncDispose]: async () => { cli.close(); } };
    },
  };
});

const { createSession } = await import('../src/session.js');

/** Wait in real time, because the bound is a real timer. */
const waited = async (ms: number): Promise<void> => new Promise((resolve) => { setTimeout(resolve, ms); });

/** The bound a case runs on, short enough to wait on. */
const BOUND = 25;

/** One session, over the options `createSession` is given. */
const opened = (options: Record<string, unknown>): { session: ReturnType<typeof createSession>; said: Bag[] } => {
  const said: Bag[] = [];
  const session = createSession({
    uri: 'ahp-session:/handshake',
    chatUri: 'ahp-chat:/handshake',
    cwd: mkdtempSync(join(tmpdir(), 'ahpd-handshake-')),
    emit: (_channel: string, action: Bag) => { said.push(action); },
    ...options,
  } as never);
  return { session, said };
};

/** What the session said each turn failed with. */
const failuresOf = (said: Bag[]): string[] => said
  .filter((one) => one.type === 'chat/error')
  .map((one) => String(((one.part as Bag).error as Bag).message));

beforeEach(() => { sdk.reset(); });

it('fails the turn of a CLI that never answers its handshake in the SDK\'s words, and starts one again at the next send', async () => {
  sdk.answers = false;
  const { session, said } = opened({ handshakeTimeoutMs: BOUND });
  session.sendMessage('t1', 'hello');
  await waited(BOUND * 3);

  expect(failuresOf(said)).toEqual([unanswered(BOUND)]);
  expect(session.status()).toBe(2);
  expect(sdk.closed).toBe(1);

  sdk.answers = true;
  session.sendMessage('t2', 'again');
  await waited(BOUND * 3);
  expect(sdk.built).toBe(2);
  expect(failuresOf(said)).toEqual([unanswered(BOUND)]);
  sdk.push({ type: 'result', subtype: 'success', is_error: false, duration_ms: 1, session_id: 'cli-2' });
  await waited(BOUND);
  expect(said.some((one) => one.type === 'chat/turnComplete')).toBe(true);
  await session.close();
});

it('keeps the turn of a CLI that answers in time', async () => {
  const { session, said } = opened({ handshakeTimeoutMs: BOUND });
  session.sendMessage('t1', 'hello');
  await waited(BOUND * 3);

  expect(failuresOf(said)).toEqual([]);
  expect(sdk.closed).toBe(0);
  expect(session.status()).toBe(8);

  sdk.push({ type: 'result', subtype: 'success', is_error: false, duration_ms: 1, session_id: 'cli-1' });
  await waited(BOUND);
  expect(said.some((one) => one.type === 'chat/turnComplete')).toBe(true);
  await session.close();
});

it('fails nothing for a start a stop overtook', async () => {
  sdk.answers = false;
  const { session, said } = opened({ handshakeTimeoutMs: BOUND });
  session.sendMessage('t1', 'hello');
  await waited(1);

  // The first turn is stopped while its CLI starts, and the next turn's CLI
  // answers: what the first would have said is about a start nobody waits on.
  session.abort();
  sdk.answers = true;
  session.sendMessage('t2', 'plan this');
  await waited(BOUND * 3);

  expect(sdk.built).toBe(2);
  expect(failuresOf(said)).toEqual([]);
  await session.close();
});

it('hands the SDK the bound, 120 seconds where nothing names one, and the plugin option\'s where it does', async () => {
  const { session } = opened({});
  session.sendMessage('t1', 'hello');
  await waited(1);
  expect(sdk.bounds).toEqual([120000]);
  await session.close();

  sdk.reset();
  sdk.answers = false;
  const { claude } = await import('../src/claude.js');
  const said: Bag[] = [];
  const agent = claude({
    paths: [mkdtempSync(join(tmpdir(), 'ahpd-handshake-'))],
    handshakeTimeoutMs: BOUND * 2,
  });
  const made = await agent.create({
    uri: 'ahp-session:/plugin',
    chatUri: 'ahp-chat:/plugin',
    workingDirectory: '/',
    settings: {},
    emit: (_channel: string, action: Bag) => { said.push(action); },
  } as never);
  made.sendMessage('t1', 'hello');
  await waited(BOUND * 6);

  expect(sdk.bounds).toEqual([BOUND * 2]);
  expect(failuresOf(said)).toEqual([unanswered(BOUND * 2)]);
  await made.close();
});
