import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, expect, it, vi } from 'vitest';
import type { Bag } from '@ahpd/sdk';

/*
 * The CLI has a bound to answer its handshake.
 *
 * `initializationResult` is the one call that says the process is up and
 * talking, and a CLI that never takes it is a session drawn as thinking for as
 * long as anyone watches - a machine whose `docker exec` never returns, or a
 * wrapper waiting on something that will not come. The bound is what turns that
 * into the ending a dead CLI gets, and it fails nothing it should not: a query
 * this host has since replaced is not the CLI the session is reading.
 */

const sdk = vi.hoisted(() => ({
  /** Whether the queries built from here on answer their handshake at all. */
  answers: true,
  built: 0,
  closed: 0,
  feed: { held: [] as Record<string, unknown>[], wake: undefined as (() => void) | undefined },
  reset() {
    sdk.answers = true;
    sdk.built = 0;
    sdk.closed = 0;
    sdk.feed.held = [];
    sdk.feed.wake = undefined;
  },
  push(...frames: Record<string, unknown>[]) {
    sdk.feed.held.push(...frames);
    sdk.feed.wake?.();
    sdk.feed.wake = undefined;
  },
}));

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  createSdkMcpServer: (given: Record<string, unknown>) => ({ type: 'sdk', name: given.name, tools: given.tools }),
  query: () => {
    sdk.built += 1;
    // Read once, at the build: a test that turns the answer back on is doing so
    // for a query that comes after this one.
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
        closed = true;
        sdk.closed += 1;
        sdk.feed.wake?.();
        sdk.feed.wake = undefined;
      },
    };
  },
}));

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

/** What the session said it failed with. */
const failureOf = (said: Bag[]): string | undefined => {
  const failure = said.find((one) => one.type === 'chat/error');
  return (failure?.part as Bag | undefined)?.error === undefined
    ? undefined
    : String(((failure?.part as Bag).error as Bag).message);
};

beforeEach(() => { sdk.reset(); });

it('fails the turn of a CLI that never answers its handshake', async () => {
  sdk.answers = false;
  const { session, said } = opened({ handshakeTimeoutMs: BOUND });
  session.sendMessage('t1', 'hello');
  await waited(BOUND * 3);

  expect(failureOf(said)).toBe(`Claude Code did not answer within ${BOUND / 1000} seconds`);
  // The session is over rather than waiting, which is the whole point: a turn
  // typed next reads the same reason instead of starting against nothing.
  expect(session.status()).toBe(2);
  expect(sdk.closed).toBe(1);
  session.close();
});

it('keeps the turn of a CLI that answers in time', async () => {
  const { session, said } = opened({ handshakeTimeoutMs: BOUND });
  session.sendMessage('t1', 'hello');
  await waited(BOUND * 3);

  expect(failureOf(said)).toBeUndefined();
  expect(sdk.closed).toBe(0);
  expect(session.status()).toBe(8);

  sdk.push({ type: 'result', subtype: 'success', is_error: false, duration_ms: 1, session_id: 'cli-1' });
  await waited(BOUND);
  expect(said.some((one) => one.type === 'chat/turnComplete')).toBe(true);
  session.close();
});

it('fails nothing for a query this host replaced before the bound', async () => {
  sdk.answers = false;
  const { session, said } = opened({ handshakeTimeoutMs: BOUND });
  session.sendMessage('t1', 'hello');
  await waited(1);

  // The first turn's CLI is stopped, and replaced by the next turn's before
  // the bound on the first is up, the pick of that turn replacing it again
  // with one that does answer: what the first would have said is about a
  // query nothing is reading any more.
  session.abort();
  sdk.answers = true;
  session.changeAgent({ uri: 'claude-internal:/agent/Plan' });
  session.sendMessage('t2', 'plan this');
  await waited(BOUND * 3);

  expect(sdk.built).toBe(3);
  expect(sdk.closed).toBe(2);
  expect(said.some((one) => one.type === 'chat/error')).toBe(false);
  session.close();
});

it('takes the bound from the plugin option', async () => {
  sdk.answers = false;
  const { claude } = await import('../src/claude.js');
  const said: Bag[] = [];
  const agent = claude({
    paths: [mkdtempSync(join(tmpdir(), 'ahpd-handshake-'))],
    handshakeTimeoutMs: BOUND * 2,
  });
  const session = agent.create({
    uri: 'ahp-session:/plugin',
    chatUri: 'ahp-chat:/plugin',
    workingDirectory: '/',
    settings: {},
    emit: (_channel: string, action: Bag) => { said.push(action); },
  } as never);
  session.sendMessage('t1', 'hello');
  await waited(BOUND * 6);

  expect(failureOf(said)).toBe(`Claude Code did not answer within ${(BOUND * 2) / 1000} seconds`);
  session.close();
});
