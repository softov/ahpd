import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import type { Bag } from '@ahpd/sdk';
import { contextOf } from '../src/session/contextusage.js';
import { learnLimits, limitOf, onLimitLearned } from '../src/session/parts.js';

/*
 * A turn says what fills its context window.
 *
 * The CLI's model list carries no limit, so a model row learns its window and
 * output cap from the result that names them, and each turn asks the CLI for a
 * breakdown once it has ended. The breakdown is VS Code's `contextAttribution`
 * beside `ahpd.context`, and an answer that is late or fails leaves the usage
 * without either rather than holding the turn open.
 */

const sdk = vi.hoisted(() => {
  interface Feed { held: Record<string, unknown>[]; wake: (() => void) | undefined }
  const fresh = (): Feed => ({ held: [], wake: undefined });
  const state = {
    /** The feed the next query reads, and the one `push` writes to. */
    feed: fresh(),
    reset() { state.feed = fresh(); },
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
    /** What `getContextUsage` answers, how often it was asked, and when. */
    answer: (async () => undefined) as () => Promise<unknown>,
    asked: 0,
  };
  return state;
});

vi.mock('@anthropic-ai/claude-agent-sdk', async () => (await import('../../sdk/test/support/warmed.js')).warmed({
  createSdkMcpServer: (given: Record<string, unknown>) => ({ type: 'sdk', name: given.name, tools: given.tools }),
  query: ({ prompt }: { prompt: unknown }) => {
    // The CLI reads every prompt it is handed, which is when a turn's prompt leaves the queue.
    if (typeof prompt === 'object' && prompt !== null && Symbol.asyncIterator in prompt) {
      void (async () => { for await (const _ of prompt as AsyncIterable<unknown>) { /* read */ } })();
    }
    const feed = sdk.feed;
    return {
      async *[Symbol.asyncIterator]() {
        for (;;) yield await sdk.next(feed);
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
      getContextUsage: async () => {
        sdk.asked += 1;
        return sdk.answer();
      },
      streamInput: async () => {},
      close: () => {},
    };
  },
}));

const { createSession } = await import('../src/session.js');

const settle = async (times = 40): Promise<void> => {
  for (let i = 0; i < times; i++) await new Promise((r) => { setImmediate(r); });
};

/** The frame a turn ends with, priced at a query's running cost so far. */
const result = (costUSD = 0.5): Record<string, unknown> => ({
  type: 'result',
  subtype: 'success',
  is_error: false,
  duration_ms: 1,
  total_cost_usd: costUSD,
  modelUsage: {
    'claude-opus-5': {
      inputTokens: 6,
      outputTokens: 167,
      cacheReadInputTokens: 10,
      cacheCreationInputTokens: 3,
      webSearchRequests: 0,
      contextWindow: 200000,
      maxOutputTokens: 64000,
      costUSD,
      costBasis: 'list',
    },
  },
});

/** One turn's own frames: enough for the stream to open a turn. */
const round = (): Record<string, unknown>[] => [
  {
    type: 'stream_event',
    event: { type: 'message_start', message: { id: 'msg-one', model: 'claude-opus-5', usage: { input_tokens: 6 } } },
  },
  {
    type: 'stream_event',
    event: { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 167 } },
  },
];

/** The answer of a CLI that had a busy context window. */
const contextAnswer = (): Bag => ({
  model: 'claude-opus-5',
  totalTokens: 50000,
  rawMaxTokens: 200000,
  maxTokens: 1000000,
  percentage: 25,
  categories: [
    // The counted categories add up to the total, as the CLI counts them.
    { name: 'System prompt', tokens: 3000, kind: 'used', color: '#000' },
    { name: 'System tools', tokens: 25000, kind: 'used', color: '#000' },
    { name: 'MCP tools', tokens: 400, kind: 'used', color: '#000' },
    { name: 'Custom agents', tokens: 700, kind: 'used', color: '#000' },
    { name: 'Memory files', tokens: 1200, kind: 'used', color: '#000' },
    { name: 'Skills', tokens: 500, kind: 'used', color: '#000' },
    { name: 'Messages', tokens: 19200, kind: 'used', color: '#000' },
    { name: 'Free space', tokens: 120000, kind: 'free', color: '#000' },
    { name: 'Autocompact buffer', tokens: 30000, kind: 'buffer', color: '#000' },
    { name: 'MCP tools (deferred)', tokens: 8000, kind: 'deferred', color: '#000', isDeferred: true },
  ],
  systemPromptSections: [{ name: 'System prompt', tokens: 3000 }],
  memoryFiles: [{ path: '/repo/CLAUDE.md', type: 'Project', tokens: 1200 }],
  systemTools: [{ name: 'Bash', tokens: 900 }],
  skills: { totalSkills: 1, includedSkills: 1, tokens: 500, skillFrontmatter: [{ name: 'deploy', source: 'userSettings', tokens: 500 }] },
  agents: [{ agentType: 'reviewer', source: 'projectSettings', tokens: 700 }],
  mcpTools: [
    { name: 'mcp__linear__create_issue', serverName: 'linear', tokens: 400 },
    // Deferred: its schema is not in the window, so it is no entry.
    { name: 'mcp__linear__list_issues', serverName: 'linear', tokens: 300, isLoaded: false },
  ],
});

/** Replay frames through a real session with a recording host seam. */
/** The lines a session wrote to the daemon's log, since the last one was made. */
const logged: string[] = [];

async function replay(frames: Record<string, unknown>[]) {
  sdk.reset();
  sdk.asked = 0;
  const main: Bag[] = [];
  logged.length = 0;
  const session = createSession({
    log: (line: string) => { logged.push(line); },
    uri: 'ahp-session:/context',
    chatUri: 'ahp-chat:/context',
    cwd: mkdtempSync(join(tmpdir(), 'ahpd-context-')),
    emit: (_channel, action) => { main.push(action as Bag); },
  });
  // The turn the frames answer: a lead frame no prompt is pending for opens none.
  session.sendMessage('t1', 'go');
  await settle();
  sdk.push(...frames);
  await settle();
  return { main, session };
}

/** The last `chat/usage` action the session's own chat received. */
const lastUsage = (main: Bag[]): Bag => {
  const said = main.filter((one) => one.type === 'chat/usage');
  return (said.at(-1)?.usage ?? {}) as Bag;
};

it('maps the answer to VS Code entries and the bar, leaving the messages out', () => {
  const figure = contextOf(contextAnswer(), 1000000);

  expect(figure?.attribution).toEqual({
    totalTokens: 50000,
    entries: [
      { kind: 'system', id: 'system:prompt:System prompt', label: 'System prompt', tokens: 3000 },
      { kind: 'toolDefinition', id: 'toolDefinition:Bash', label: 'Bash', tokens: 900 },
      // The rows name one tool of the category; the rest is the category's own.
      { kind: 'toolDefinition', id: 'category:System tools', label: 'System tools', tokens: 24100 },
      { kind: 'mcpServer', id: 'mcpServer:linear:mcp__linear__create_issue', label: 'mcp__linear__create_issue', tokens: 400 },
      { kind: 'subagent', id: 'subagent:reviewer', label: 'reviewer', tokens: 700 },
      { kind: 'system', id: 'system:memory:/repo/CLAUDE.md', label: '/repo/CLAUDE.md', tokens: 1200 },
      { kind: 'skill', id: 'skill:deploy', label: 'deploy', tokens: 500 },
    ],
    compactions: { count: 0 },
  });
  // The size is the autocompact window, and the model's own limit is apart.
  expect(figure?.context).toEqual({ used: 50000, size: 200000, limit: 1000000, free: 120000, buffer: 30000, deferred: 8000 });
});

it('takes a category with no rows as one entry, so only the messages are left over', () => {
  // The summary a CLI answers before any turn: no tool rows and no prompt sections.
  const figure = contextOf({
    totalTokens: 32878,
    rawMaxTokens: 600000,
    categories: [
      { name: 'System prompt', tokens: 463, kind: 'used' },
      { name: 'System tools', tokens: 25299, kind: 'used' },
      { name: 'System tools (deferred)', tokens: 31915, kind: 'deferred', isDeferred: true },
      { name: 'Custom agents', tokens: 61, kind: 'used' },
      { name: 'Memory files', tokens: 889, kind: 'used' },
      { name: 'Skills', tokens: 6166, kind: 'used' },
      { name: 'Autocompact buffer', tokens: 33000, kind: 'buffer' },
      { name: 'Free space', tokens: 534122, kind: 'free' },
    ],
    memoryFiles: [{ path: '/home/me/CLAUDE.md', type: 'User', tokens: 889 }],
    agents: [{ agentType: 'reviewer', source: 'userSettings', tokens: 61 }],
    skills: { skillFrontmatter: [{ name: 'deploy', source: 'plugin', tokens: 6166 }] },
  });

  const entries = figure?.attribution.entries ?? [];
  expect(entries.map((one) => [one.id, one.tokens])).toEqual([
    ['category:System prompt', 463],
    ['category:System tools', 25299],
    ['subagent:reviewer', 61],
    ['system:memory:/home/me/CLAUDE.md', 889],
    ['skill:deploy', 6166],
  ]);
  expect(entries.reduce((sum, one) => sum + one.tokens, 0)).toBe(32878);
  expect(figure?.context).toMatchObject({ deferred: 31915 });
});

it('reads the SDK\'s own spelling of the same report', () => {
  const figure = contextOf({
    model: 'claude-sonnet-5',
    total_tokens: 10,
    raw_max_tokens: 100,
    percentage: 10,
    categories: [{ name: 'Free space', tokens: 90, kind: 'free' }],
    mcp_tools: [{ name: 'mcp__x__y', server_name: 'x', tokens: 2 }],
    memory_files: [{ path: 'A.md', type: 'User', tokens: 3 }],
    agents: [{ agent_type: 'reviewer', source: 'userSettings', tokens: 4 }],
    skills: [{ name: 'deploy', source: 'plugin', tokens: 5 }],
  });

  expect(figure?.attribution.entries).toEqual([
    { kind: 'system', id: 'system:memory:A.md', label: 'A.md', tokens: 3 },
    { kind: 'skill', id: 'skill:deploy', label: 'deploy', tokens: 5 },
    { kind: 'subagent', id: 'subagent:reviewer', label: 'reviewer', tokens: 4 },
    { kind: 'mcpServer', id: 'mcpServer:x:mcp__x__y', label: 'mcp__x__y', tokens: 2 },
  ]);
  expect(figure?.context).toEqual({ used: 10, size: 100, free: 90 });
});

it('learns a limit under the raw key and the canonical model, and says so once', () => {
  const heard = vi.fn();
  const stop = onLimitLearned(heard);

  expect(learnLimits({ modelUsage: {} })).toBe(false);
  expect(learnLimits({
    modelUsage: {
      'claude-opus-5[1m]': { contextWindow: 1000000, maxOutputTokens: 64000, canonicalModel: 'claude-opus-5' },
    },
  })).toBe(true);
  expect(limitOf('claude-opus-5[1m]')).toEqual({ contextWindow: 1000000, maxOutputTokens: 64000 });
  expect(limitOf('claude-opus-5')).toEqual({ contextWindow: 1000000, maxOutputTokens: 64000 });
  expect(heard).toHaveBeenCalledTimes(1);

  // The same figures again teach nothing and tell nobody.
  expect(learnLimits({
    modelUsage: {
      'claude-opus-5[1m]': { contextWindow: 1000000, maxOutputTokens: 64000, canonicalModel: 'claude-opus-5' },
    },
  })).toBe(false);
  expect(heard).toHaveBeenCalledTimes(1);

  stop();
});

it('puts the breakdown and the bar on a turn\'s usage, beside its cost', async () => {
  sdk.answer = async () => contextAnswer();
  const { main } = await replay([...round(), result()]);

  const usage = lastUsage(main);
  const meta = usage._meta as Bag;
  // Once at the handshake, for the session, and once when the turn ended.
  expect(sdk.asked).toBe(2);
  expect(usage).toMatchObject({ inputTokens: 6, outputTokens: 167 });
  expect(meta['ahpd.cost']).toEqual({ amount: 0.5, currency: 'USD' });
  expect((meta.contextAttribution as Bag).totalTokens).toBe(50000);
  // The session's result named this model's window, and the figure carries it.
  expect(meta['ahpd.context']).toEqual({
    used: 50000,
    size: 200000,
    limit: 200000,
    free: 120000,
    buffer: 30000,
    deferred: 8000,
  });
});

it('ends the turn without the breakdown when the answer fails', { timeout: 15000 }, async () => {
  sdk.answer = async () => { throw new Error('the control channel is gone'); };
  const { main } = await replay([...round(), result()]);

  expect(lastUsage(main)._meta).not.toHaveProperty('contextAttribution');
  expect(lastUsage(main)._meta).toMatchObject({ 'ahpd.cost': { amount: 0.5, currency: 'USD' } });
  expect(logged.join('\n'))
    .toContain('the context breakdown failed: the control channel is gone');
});

it('ends the turn without the breakdown when the answer is late', { timeout: 20000 }, async () => {
  sdk.answer = () => new Promise(() => {});
  const { main } = await replay([...round(), result()]);

  // The turn is still open a moment after its result, because the figure is
  // still being waited on.
  await settle();
  expect(main.some((one) => one.type === 'chat/turnComplete')).toBe(false);

  await new Promise((r) => { setTimeout(r, 2300); });
  await settle();
  expect(main.some((one) => one.type === 'chat/turnComplete')).toBe(true);
  expect(lastUsage(main)._meta).not.toHaveProperty('contextAttribution');
  expect(logged.join('\n')).toContain('took too long');
});
