import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { agentNameOf } from '../src/session.js';
import type { Bag } from '@ahpd/sdk';

/*
 * The agent a message picked, and the CLI it runs on.
 *
 * The SDK reads `agent` when the query is built and has nowhere to put a later
 * one, so the only way to answer a message that names a different agent is to
 * start a new CLI on it and resume the conversation into it. The cost is a
 * restart on the send that switches, which is why a picker that sends the same
 * agent on every message has to cost nothing at all.
 */

const sdk = vi.hoisted(() => ({
  /** What each query was built with, in the order they were started. */
  built: [] as { agent?: string; resume?: string; sessionId?: string }[],
  /** The queries this fake handed out, so a close can be seen. */
  open: 0,
  feed: { held: [] as Record<string, unknown>[], wake: undefined as (() => void) | undefined },
  reset() {
    sdk.built = [];
    sdk.open = 0;
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
  query: (given: { options: { agent?: string; resume?: string; sessionId?: string } }) => {
    sdk.built.push({
      ...(given.options.agent === undefined ? {} : { agent: given.options.agent }),
      ...(given.options.resume === undefined ? {} : { resume: given.options.resume }),
      ...(given.options.sessionId === undefined ? {} : { sessionId: given.options.sessionId }),
    });
    sdk.open += 1;
    let closed = false;
    const wake = async (): Promise<void> => {
      while (sdk.feed.held.length === 0) {
        if (closed) return;
        await new Promise<void>((resolve) => { sdk.feed.wake = resolve; });
      }
    };
    return {
      async *[Symbol.asyncIterator]() {
        try {
          for (;;) {
            await wake();
            // A closed CLI stops mid-turn the way the real one does, rather
            // than running the query that replaced it to the end.
            if (closed) return;
            yield sdk.feed.held.shift();
          }
        } finally { sdk.open -= 1; }
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
        closed = true;
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

/**
 * A session over a CLI that reports the id it was given, which is what a
 * rebuild has to resume into.
 *
 * The id arrives with the message stream's own init, so it is pushed as soon
 * as the query exists rather than assumed: a session that had never been told
 * its id is a different case and is not what these tests are about.
 */
async function open() {
  sdk.reset();
  const said: Bag[] = [];
  const session = createSession({
    uri: 'ahp-session:/agent',
    chatUri: 'ahp-chat:/agent',
    cwd: mkdtempSync(join(tmpdir(), 'ahpd-agent-')),
    emit: (_channel, action) => { said.push(action as Bag); },
  });
  await settle();
  sdk.push({ type: 'system', subtype: 'init', session_id: 'cli-1' });
  await settle();
  return { session, said, prompts: () => sdk.built.length };
}

beforeEach(() => { sdk.reset(); });

it('starts the query on the agent the message picked, and resumes into that one', async () => {
  const { session } = await open();
  session.begin('t1', 'plan this', undefined, { agent: { uri: 'claude-internal:/agent/Plan' } });
  await settle();

  // Two queries, not one: the CLI was already up when the pick arrived, and the
  // SDK reads the agent at startup. The turn runs on the second.
  expect(sdk.built).toHaveLength(2);
  expect(sdk.built[1]).toEqual({ agent: 'Plan', resume: 'cli-1' });
  // And the one it replaced is closed, rather than left running beside it.
  expect(sdk.open).toBe(1);
});

it('does not restart a CLI for a message that picked the agent already running', async () => {
  const { session } = await open();
  session.begin('t1', 'plan this', undefined, { agent: { uri: 'claude-internal:/agent/Plan' } });
  await settle();
  session.begin('t2', 'and this', undefined, { agent: { uri: 'claude-internal:/agent/Plan' } });
  await settle();
  expect(sdk.built).toHaveLength(2);
});

it('goes back to the default agent for a message that picked none, on the same conversation', async () => {
  const { session } = await open();
  session.begin('t1', 'plan this', undefined, { agent: { uri: 'claude-internal:/agent/Plan' } });
  await settle();
  session.begin('t2', 'now just answer', undefined, { agent: { uri: 'claude-internal:/agent/Plan' } });
  await settle();
  session.begin('t3', 'actually, no plan', undefined);
  await settle();

  expect(sdk.built).toHaveLength(3);
  // Absent rather than an empty name, because that is what a query built with
  // no agent runs as.
  expect(sdk.built[2]).toEqual({ resume: 'cli-1' });
  expect(sdk.open).toBe(1);
});

it('runs a queued message on the agent that message picked, when its turn comes', async () => {
  const { session } = await open();
  session.begin('t1', 'first', undefined, { agent: { uri: 'claude-internal:/agent/Plan' } });
  await settle();
  session.queue('q1', 'and then this', undefined, { agent: { uri: 'claude-internal:/agent/Explore' } });
  await settle();

  // Queued, so nothing has moved: the pick belongs to the message, not to the
  // turn that is running.
  expect(sdk.built).toHaveLength(2);
  sdk.push({ type: 'result', subtype: 'success', is_error: false, duration_ms: 1 });
  await settle(40);

  expect(sdk.built).toHaveLength(3);
  expect(sdk.built[2]).toEqual({ agent: 'Explore', resume: 'cli-1' });
});

describe('the name behind a uri', () => {
  it('is the file\'s frontmatter name, not its own', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ahpd-name-'));
    writeFileSync(join(dir, 'reviewer.md'), '---\nname: reviewer\ndescription: Reviews\n---\n\nThe prompt.\n');
    expect(agentNameOf(`file://${join(dir, 'reviewer.md')}`)).toBe('reviewer');
  });

  it('is the file\'s own name when its frontmatter names nothing', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ahpd-name-'));
    writeFileSync(join(dir, 'plain.md'), 'No frontmatter at all.\n');
    writeFileSync(join(dir, 'empty.md'), '---\ndescription: No name here\n---\n');
    expect(agentNameOf(`file://${join(dir, 'plain.md')}`)).toBe('plain');
    expect(agentNameOf(`file://${join(dir, 'empty.md')}`)).toBe('empty');
  });

  it('is the file\'s own name when the file has gone since the listing was made', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ahpd-name-'));
    expect(agentNameOf(`file://${join(dir, 'deleted.md')}`)).toBe('deleted');
  });

  it('reads a file in a folder with a space, however its uri is spelt', () => {
    const dir = join(mkdtempSync(join(tmpdir(), 'ahpd-name-')), 'my agents');
    mkdirSync(dir);
    writeFileSync(join(dir, 'review.MD'), '---\nname: reviewer\n---\n');
    expect(agentNameOf(pathToFileURL(join(dir, 'review.MD')).href)).toBe('reviewer');
    expect(agentNameOf(`file://${join(dir, 'review.MD')}`)).toBe('reviewer');
    expect(agentNameOf(pathToFileURL(join(dir, 'gone.MD')).href)).toBe('gone');
  });

  it('reads no device and no oversized file, and names it by its file name', () => {
    expect(agentNameOf('file:///dev/zero')).toBe('zero');
    const dir = mkdtempSync(join(tmpdir(), 'ahpd-name-'));
    writeFileSync(join(dir, 'huge.md'), `---\nname: inside\n---\n${'x'.repeat(70 * 1024)}`);
    expect(agentNameOf(`file://${join(dir, 'huge.md')}`)).toBe('huge');
  });

  it('is nothing for an internal uri whose escape is broken', () => {
    expect(agentNameOf('claude-internal:/agent/%E0%A4%A')).toBeUndefined();
  });

  it('is the last segment of an internal uri', () => {
    expect(agentNameOf('claude-internal:/agent/Explore')).toBe('Explore');
  });

  it('is nothing for a uri that names neither a file nor an internal agent', () => {
    // Handing the CLI an agent it does not have would fail the turn over a
    // picker, which is the one thing a pick must never do.
    expect(agentNameOf('https://example.test/agents/Plan')).toBeUndefined();
    expect(agentNameOf('claude-internal:/agent/')).toBeUndefined();
  });
});
