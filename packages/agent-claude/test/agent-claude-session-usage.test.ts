import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import type { Bag } from '@ahpd/sdk';

/*
 * A session says its context, plan limits and plan before a turn.
 *
 * The CLI starts with the session, so once it has answered its handshake the
 * session asks its account, its context breakdown and its plan limits, and
 * its `_meta` carries them beside `ahpd.model`. Only the plan type and the
 * provider of the account are kept. A usage request with no limits to answer
 * keeps the events' windows, and only an account with no plan has an empty
 * map.
 */

const sdk = vi.hoisted(() => {
  interface Feed { held: Record<string, unknown>[]; wake: (() => void) | undefined }
  const fresh = (): Feed => ({ held: [], wake: undefined });
  const state = {
    /** The feed the next query reads, and the one `push` writes to. */
    feed: fresh(),
    reset() {
      state.feed = fresh();
      state.account = async () => undefined;
      state.context = async () => undefined;
      state.usage = async () => undefined;
    },
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
    /** What `accountInfo` answers. */
    account: (async () => undefined) as () => Promise<unknown>,
    /** What `getContextUsage` answers. */
    context: (async () => undefined) as () => Promise<unknown>,
    /** What the usage request answers. */
    usage: (async () => undefined) as () => Promise<unknown>,
  };
  return state;
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
      accountInfo: () => sdk.account(),
      getContextUsage: () => sdk.context(),
      usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET: () => sdk.usage(),
      streamInput: async () => {},
      close: () => {},
    };
  },
}));

const { createSession } = await import('../src/session.js');
const { OpenLogins } = await import('../src/logins.js');

const settle = async (times = 40): Promise<void> => {
  for (let i = 0; i < times; i++) await new Promise((r) => { setTimeout(r, 0); });
};

/** Wait for `done` to hold, for three seconds at most, and then for what follows from it. */
const until = async (done: () => boolean): Promise<void> => {
  for (let i = 0; i < 300 && !done(); i++) await new Promise((r) => { setTimeout(r, 10); });
  await settle();
  if (!done()) throw new Error('still waiting');
};

/** The account a Max plan answers, with the fields that must never leave. */
const maxAccount = (): Bag => ({
  email: 'someone@example.com',
  organization: 'Example Org',
  subscriptionType: 'max',
  tokenSource: 'CLAUDE_CODE_OAUTH_TOKEN',
  apiProvider: 'firstParty',
});

/** A context breakdown of a session that has run nothing yet. */
const contextAnswer = (used = 12000): Bag => ({
  model: 'claude-opus-5',
  totalTokens: used,
  rawMaxTokens: 200000,
  categories: [{ name: 'Free space', tokens: 200000 - used, kind: 'free' }],
  systemPromptSections: [{ name: 'System prompt', tokens: 3000 }],
});

/** A usage answer with a session window and a week. */
const usageAnswer = (): Bag => ({
  rate_limits_available: true,
  rate_limits: {
    five_hour: { utilization: 40, resets_at: '2026-11-04T12:00:00+00:00' },
    seven_day: { utilization: 10, resets_at: '2026-11-10T12:00:00.000Z' },
  },
});

/** A turn's own answer and its result. */
const answered = (id: string): Record<string, unknown>[] => [
  {
    type: 'assistant', parent_tool_use_id: null, uuid: `end-${id}`, session_id: 'cli-1',
    message: { id: `msg-${id}`, role: 'assistant', model: 'claude-opus-5', content: [{ type: 'text', text: `answer ${id}` }] },
  },
  {
    type: 'result', subtype: 'success', is_error: false, session_id: 'cli-1', duration_ms: 5,
    usage: { input_tokens: 10, output_tokens: 5 },
  },
];

/** A session on a fresh CLI, with what it says on the session channel. */
const open = (name: string, extra: Bag = {}): { session: ReturnType<typeof createSession>; said: Bag[] } => {
  const said: Bag[] = [];
  const session = createSession({
    uri: `ahp-session:/${name}`,
    chatUri: `ahp-chat:/${name}`,
    cwd: mkdtempSync(join(tmpdir(), 'ahpd-session-usage-')),
    emit: (channel, action) => { if (channel === 'session') said.push(action as Bag); },
    ...extra,
  });
  return { session, said };
};

/** The session's `_meta`, as its state says it. */
const metaOf = (session: ReturnType<typeof createSession>): Bag =>
  ((session.sessionState() as Bag)._meta ?? {}) as Bag;

/** Every `session/metaChanged` the session sent. */
const moved = (said: Bag[]): Bag[] => said.filter((one) => one.type === 'session/metaChanged');

it('says its context, plan limits and plan once the handshake is answered, before any turn', async () => {
  sdk.reset();
  sdk.account = async () => maxAccount();
  sdk.context = async () => contextAnswer();
  sdk.usage = async () => usageAnswer();
  const { session, said } = open('before');

  await until(() => moved(said).length > 0);

  const meta = metaOf(session);
  expect(meta['ahpd.account']).toEqual({ subscriptionType: 'max', apiProvider: 'firstParty' });
  expect((meta.contextAttribution as Bag).totalTokens).toBe(12000);
  expect(meta['ahpd.context']).toEqual({ used: 12000, size: 200000, free: 188000 });
  expect(meta.quotaSnapshots).toEqual({
    session: { remainingPercentage: 60, resetDate: '2026-11-04T12:00:00.000Z' },
    weekly: { remainingPercentage: 90, resetDate: '2026-11-10T12:00:00.000Z' },
  });
  // One action said all four, with the same map the state holds.
  expect(moved(said)).toHaveLength(1);
  expect(moved(said)[0]?._meta).toEqual(meta);
  // No email, organization or token source anywhere the session said.
  const everything = JSON.stringify([meta, said]);
  expect(everything).not.toContain('someone@example.com');
  expect(everything).not.toContain('Example Org');
  expect(everything).not.toContain('CLAUDE_CODE_OAUTH_TOKEN');
  await session.close();
});

it('says nothing when the CLI answers none of them', async () => {
  sdk.reset();
  const { session, said } = open('silent');
  await settle();
  expect(moved(said)).toEqual([]);
  expect(metaOf(session)).not.toHaveProperty('quotaSnapshots');
  expect(metaOf(session)).not.toHaveProperty('ahpd.account');
  await session.close();
});

it('has an empty map for an account on a cloud provider, which has no plan limits', async () => {
  sdk.reset();
  sdk.account = async () => ({ apiProvider: 'bedrock' });
  sdk.usage = async () => ({ rate_limits_available: false, rate_limits: null });
  const { session, said } = open('bedrock');
  await until(() => moved(said).length > 0);
  expect(metaOf(session).quotaSnapshots).toEqual({});
  expect(metaOf(session)['ahpd.account']).toEqual({ apiProvider: 'bedrock' });
  await session.close();
});

it('has an empty map for a first-party account with no plan type', async () => {
  sdk.reset();
  sdk.account = async () => ({ apiProvider: 'firstParty', apiKeySource: 'ANTHROPIC_API_KEY' });
  const { session, said } = open('api-key');
  await until(() => moved(said).length > 0);
  expect(metaOf(session).quotaSnapshots).toEqual({});
  await session.close();
});

it('keeps no map for a plan the usage request cannot answer, and takes the event\'s window at a turn', async () => {
  sdk.reset();
  sdk.account = async () => maxAccount();
  sdk.usage = async () => ({ rate_limits_available: false, rate_limits: null });
  const { session, said } = open('unavailable');
  await until(() => moved(said).length > 0);
  // An account on a plan whose limits nobody has answered: unknown, not none.
  expect(metaOf(session)).not.toHaveProperty('quotaSnapshots');

  sdk.context = async () => contextAnswer(30000);
  session.sendMessage('one', 'hello');
  await settle();
  sdk.push(
    { type: 'rate_limit_event', rate_limit_info: { rateLimitType: 'seven_day', utilization: 0.2, resetsAt: 1_800_000_000 } },
    ...answered('one'),
  );
  await until(() => moved(said).length > 1);

  // After the turn, the session's `_meta` says the event's window and the
  // turn's breakdown.
  const meta = metaOf(session);
  expect(meta.quotaSnapshots).toEqual({
    weekly: { remainingPercentage: 80, resetDate: new Date(1_800_000_000_000).toISOString() },
  });
  expect((meta['ahpd.context'] as Bag).used).toBe(30000);
  expect(moved(said).at(-1)?._meta).toEqual(meta);
  await session.close();
});

it('draws a login\'s plan with its limits and its masked email, and nothing else of the account', async () => {
  sdk.reset();
  sdk.account = async () => maxAccount();
  sdk.usage = async () => usageAnswer();
  const logins = new OpenLogins();
  const shown: Bag[] = [];
  logins.opened(
    { id: 'usage-work', adapter: 'claude-login', owner: 'host', config: { token: 'token-usage-work' } },
    { showView: () => {}, setViewData: (_path, data) => { shown.push(data as Bag); }, clearView: () => {} },
  );
  const { session } = open('login', {
    preset: { logins: ['usage-work'] },
    logins: { open: logins, owner: () => 'host' },
  });

  const windowsOf = (one: Bag | undefined): Bag[] => (one?.['windows'] as Bag[] | undefined) ?? [];
  await until(() => shown.some((one) => windowsOf(one).some((window) => window['name'] === 'Weekly')));
  expect(shown.at(-1)).toEqual({
    email: 'som****@example.com',
    plan: 'max',
    windows: [
      { name: 'Session', left: 60, used: 40, reset: '2026-11-04T12:00:00.000Z', resetInSeconds: 0 },
      { name: 'Weekly', left: 90, used: 10, reset: '2026-11-10T12:00:00.000Z', resetInSeconds: expect.any(Number) },
    ],
  });
  expect(JSON.stringify(shown)).not.toContain('someone@example.com');
  expect(JSON.stringify(shown)).not.toContain('Example Org');
  await session.close();
});

it('goes on without the account when it does not answer in time', { timeout: 15000 }, async () => {
  sdk.reset();
  sdk.account = () => new Promise(() => {});
  sdk.context = async () => contextAnswer();
  const { session, said } = open('late-account');
  await settle();
  expect(moved(said)).toEqual([]);

  await new Promise((r) => { setTimeout(r, 2300); });
  await until(() => moved(said).length > 0);
  expect(metaOf(session)).not.toHaveProperty('ahpd.account');
  expect((metaOf(session)['ahpd.context'] as Bag).used).toBe(12000);
  await session.close();
});
