import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import type { Bag, ConnectorAccount, QuotaSnapshots } from '@ahpd/sdk';
import type { Login, PlanNote } from '../src/logins.js';
import type { SessionContext } from '../src/session/context.js';
import { limitsOf, noteAccount, noteLimit, quotaSnapshotsOf, refreshLimits } from '../src/session/limits.js';

/*
 * A login says its plan limits.
 *
 * The CLI names one window in each `rate_limit_event`, and the usage request
 * answers every window at once. Both are kept by the login's token and ride the
 * turn's usage as `quotaSnapshots`; the login's ui draws them through
 * `OpenLogins`. A login whose account has no plan reports an empty map rather
 * than nothing.
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
    /** How often the usage request ran. */
    usageAsked: 0,
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
      usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET: async () => {
        sdk.usageAsked += 1;
        return usageAnswer();
      },
      streamInput: async () => {},
      close: () => {},
    };
  },
}));

const { createSession } = await import('../src/session.js');
const { OpenLogins } = await import('../src/logins.js');

/** A usage answer, with the windows a plan reports. */
function usageAnswer(): Record<string, unknown> {
  return {
    rate_limits_available: true,
    rate_limits: {
      five_hour: { utilization: 40, resets_at: '2026-11-04T12:00:00+00:00' },
      seven_day: { utilization: 10, resets_at: '2026-11-10T12:00:00.000Z' },
      seven_day_opus: { utilization: 5, resets_at: '2026-11-10T12:00:00.000Z' },
      model_scoped: [
        { display_name: 'Opus 4', utilization: 20, resets_at: '2026-11-10T12:00:00.000Z' },
      ],
      extra_usage: { is_enabled: true, monthly_limit: 1000, used_credits: 250, utilization: 25 },
    },
  };
}

interface Noted {
  id: string;
  quotaSnapshots?: QuotaSnapshots;
  account?: ConnectorAccount;
}

interface Fake {
  login: Login | undefined;
  handle: Record<string, unknown>;
  noted: Noted[];
}

const fakeOf = (login: Login | undefined, handle: Record<string, unknown> = {}): Fake => ({
  login,
  handle,
  noted: [],
});

const ctxOf = (fake: Fake): SessionContext => ({
  login: fake.login,
  query: fake.handle,
  options: {
    logins: {
      open: {
        noted: (id: string, _token: string, said: PlanNote) => { fake.noted.push({ id, ...said }); },
      },
    },
  },
} as unknown as SessionContext);

const settle = async (times = 40): Promise<void> => {
  for (let i = 0; i < times; i++) await new Promise((r) => { setTimeout(r, 0); });
};

/** Wait for `done` to hold, for three seconds at most, and then for what follows from it. */
const until = async (done: () => boolean): Promise<void> => {
  for (let i = 0; i < 300 && !done(); i++) await new Promise((r) => { setTimeout(r, 10); });
  await settle();
  if (!done()) throw new Error('still waiting');
};

/** A turn's own answer and its result, with a usage the turn's `_meta` rides. */
const answered = (id: string): Record<string, unknown>[] => [
  {
    type: 'assistant', parent_tool_use_id: null, uuid: `end-${id}`, session_id: 'cli-1',
    message: { id: `msg-${id}`, role: 'assistant', model: 'claude-x', content: [{ type: 'text', text: `answer ${id}` }] },
  },
  {
    type: 'result', subtype: 'success', is_error: false, session_id: 'cli-1', duration_ms: 5,
    usage: { input_tokens: 10, output_tokens: 5 },
  },
];

/** The last `chat/usage` action a chat was sent, and its `_meta`. */
const lastUsage = (chat: Bag[]): Bag => {
  const said = chat.filter((one) => one.type === 'chat/usage');
  return (said.at(-1)?.usage ?? {}) as Bag;
};

it('maps each window of a usage answer to a snapshot', () => {
  const snapshots = quotaSnapshotsOf(usageAnswer().rate_limits);
  expect(snapshots).toEqual({
    session: { remainingPercentage: 60, resetDate: '2026-11-04T12:00:00.000Z' },
    weekly: {
      remainingPercentage: 90,
      resetDate: '2026-11-10T12:00:00.000Z',
      overageAllowedWithExhaustedQuota: true,
      overage: 250,
      overageEntitlement: 1000,
    },
    'weekly:opus': { remainingPercentage: 95, resetDate: '2026-11-10T12:00:00.000Z' },
    'weekly:opus 4': { remainingPercentage: 80, resetDate: '2026-11-10T12:00:00.000Z' },
  });
});

it('leaves the overage fields out for an account with no credits', () => {
  const snapshots = quotaSnapshotsOf({
    seven_day: { utilization: 10 },
    extra_usage: { is_enabled: false, monthly_limit: 1000, used_credits: 250 },
  });
  expect(snapshots).toEqual({ weekly: { remainingPercentage: 90 } });
});

it('keeps one window of an event with the windows already answered', async () => {
  const login: Login = { id: 'limits-event', token: 'token-event' };
  const fake = fakeOf(login, {
    usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET: async () => usageAnswer(),
  });
  const ctx = ctxOf(fake);
  await refreshLimits(ctx, 1_000);
  noteLimit(ctx, { rateLimitType: 'five_hour', utilization: 0.7, resetsAt: 1_800_000_000 });
  expect(limitsOf(ctx)).toEqual({
    session: { remainingPercentage: 30, resetDate: new Date(1_800_000_000_000).toISOString() },
    weekly: {
      remainingPercentage: 90,
      resetDate: '2026-11-10T12:00:00.000Z',
      overageAllowedWithExhaustedQuota: true,
      overage: 250,
      overageEntitlement: 1000,
    },
    'weekly:opus': { remainingPercentage: 95, resetDate: '2026-11-10T12:00:00.000Z' },
    'weekly:opus 4': { remainingPercentage: 80, resetDate: '2026-11-10T12:00:00.000Z' },
  });
  // The event replaced the session window, so the host heard twice.
  expect(fake.noted).toHaveLength(2);
  expect(fake.noted[1]?.quotaSnapshots?.session?.remainingPercentage).toBe(30);
});

it('asks the usage request once a minute for each login', async () => {
  const login: Login = { id: 'limits-minute', token: 'token-minute' };
  const asked: unknown[] = [];
  const fake = fakeOf(login, {
    usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET: async (opts: unknown) => {
      asked.push(opts);
      return usageAnswer();
    },
  });
  const ctx = ctxOf(fake);
  await refreshLimits(ctx, 100_000);
  await refreshLimits(ctx, 130_000);
  expect(asked).toHaveLength(1);
  expect(asked[0]).toEqual({ skipBehaviors: true });
  await refreshLimits(ctx, 161_000);
  expect(asked).toHaveLength(2);
});

it('keeps an empty map for a login whose account has no plan limits', async () => {
  const login: Login = { id: 'limits-none', token: 'token-none' };
  const fake = fakeOf(login, {
    usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET: async () => ({ rate_limits_available: false, rate_limits: null }),
  });
  const ctx = ctxOf(fake);
  noteAccount(ctx, { apiProvider: 'bedrock' });
  await refreshLimits(ctx, 1_000);
  expect(limitsOf(ctx)).toEqual({});
  expect(fake.noted).toEqual([{ id: 'limits-none', quotaSnapshots: {}, account: { apiProvider: 'bedrock' } }]);
});

it('keeps no map for a setup token, whose account names no plan type', async () => {
  const login: Login = { id: 'limits-setup', token: 'token-setup' };
  const fake = fakeOf(login, {
    usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET: async () => ({ rate_limits_available: false, rate_limits: null }),
  });
  const ctx = ctxOf(fake);
  // The CLI reads the plan type only for its own sign-in.
  noteAccount(ctx, { tokenSource: 'CLAUDE_CODE_OAUTH_TOKEN', apiProvider: 'firstParty' });
  await refreshLimits(ctx, 1_000);
  expect(limitsOf(ctx)).toBeUndefined();
  expect(fake.noted).toEqual([{ id: 'limits-setup', account: { apiProvider: 'firstParty' } }]);
});

it('keeps the events\' windows when the usage request has no limits to answer', async () => {
  const login: Login = { id: 'limits-unavailable', token: 'token-unavailable' };
  const fake = fakeOf(login, {
    usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET: async () => ({ rate_limits_available: false, rate_limits: null }),
  });
  const ctx = ctxOf(fake);
  noteLimit(ctx, { rateLimitType: 'seven_day', utilization: 0.25, resetsAt: 1_800_000_000 });
  await refreshLimits(ctx, 1_000);
  expect(limitsOf(ctx)).toEqual({
    weekly: { remainingPercentage: 75, resetDate: new Date(1_800_000_000_000).toISOString() },
  });
  expect(fake.noted).toHaveLength(1);
});

it('says nothing of a login nobody has answered for, or one with no request', async () => {
  const login: Login = { id: 'limits-silent', token: 'token-silent' };
  const fake = fakeOf(login);
  const ctx = ctxOf(fake);
  await refreshLimits(ctx, 1_000);
  expect(limitsOf(ctx)).toBeUndefined();
  expect(fake.noted).toEqual([]);
});

it('keeps the limits of a session on the CLI\'s own sign-in, and tells no connector', async () => {
  const fake = fakeOf(undefined, {
    usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET: async () => usageAnswer(),
  });
  const ctx = ctxOf(fake);
  const other = ctxOf(fakeOf(undefined));
  await refreshLimits(ctx, 1_000);
  noteLimit(ctx, { rateLimitType: 'five_hour', utilization: 0.7, resetsAt: 1_800_000_000 });
  expect(limitsOf(ctx)?.session?.remainingPercentage).toBe(30);
  expect(limitsOf(ctx)?.weekly?.remainingPercentage).toBe(90);
  // Each such session keeps its own: there is no login to share them by.
  expect(limitsOf(other)).toBeUndefined();
  expect(fake.noted).toEqual([]);
});

it('carries a login\'s windows on a turn, and draws them on the login', async () => {
  const logins = new OpenLogins();
  const shown: Bag[] = [];
  logins.opened(
    { id: 'work', adapter: 'claude-login', owner: 'host', config: { token: 'token-work' } },
    { show: (data) => { shown.push(data as Bag); }, clear: () => {} },
  );
  sdk.reset();
  sdk.usageAsked = 0;

  const chat: Bag[] = [];
  const session = createSession({
    uri: 'ahp-session:/limits',
    chatUri: 'ahp-chat:/limits',
    cwd: mkdtempSync(join(tmpdir(), 'ahpd-limits-')),
    emit: (channel, action) => { if (channel === 'chat') chat.push(action as Bag); },
    preset: { logins: ['work'] },
    logins: { open: logins, owner: () => 'host' },
  });
  // The handshake asked the account's own answer, which filled every window,
  // and the login drew it, as it draws a call.
  await until(() => shown.length >= 1);
  expect(sdk.usageAsked).toBe(1);
  // The two windows the account answered, beside the ones its plan names.
  expect((shown[0]?.['windows'] as Bag[]).slice(0, 2)).toEqual([
    { name: 'Session', left: 60, reset: '2026-11-04T12:00:00.000Z' },
    { name: 'Weekly', left: 90, reset: '2026-11-10T12:00:00.000Z' },
  ]);

  session.sendMessage('one', 'how much is left');
  await settle();
  // The event comes with the turn, as the CLI sends it with the first call.
  sdk.push(
    { type: 'rate_limit_event', rate_limit_info: { rateLimitType: 'five_hour', utilization: 0.3, resetsAt: 1_800_000_000 } },
    ...answered('one'),
  );
  await settle();

  // The turn says the window the event named, beside the windows answered.
  expect((lastUsage(chat)._meta as Bag).quotaSnapshots).toMatchObject({
    session: { remainingPercentage: 70, resetDate: new Date(1_800_000_000_000).toISOString() },
    weekly: { remainingPercentage: 90, resetDate: '2026-11-10T12:00:00.000Z' },
  });
  // The event moved the session window, so the login drew it again. The minute
  // had not passed, so the turn's end asked nothing.
  await until(() => shown.length >= 2);
  expect((shown[1]?.['windows'] as Bag[])[0]?.['left']).toBe(70);
  expect(sdk.usageAsked).toBe(1);
});
