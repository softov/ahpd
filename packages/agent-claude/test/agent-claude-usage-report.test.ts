import { expect, it } from 'vitest';
import type { SDKUsageReport } from '@anthropic-ai/claude-agent-sdk';
import { snapshotsOf, usageOf, type UsageQuery } from '../src/usage.js';

/*
 * A login's usage read without a session: one `/usage` query on the login's
 * token, whose assistant message carries the structured report, and the
 * report's rows as the plan's windows.
 */

/** A report as the CLI 2.1.301 that SDK 0.3.301 runs sends it. */
const REPORT: SDKUsageReport = {
  session: { total_cost_usd: 0, total_api_duration_ms: 0, total_duration_ms: 0, total_lines_added: 0, total_lines_removed: 0, model_usage: {} },
  rate_limits: {
    limits: [
      { kind: 'session', group: 'session', percent: 23, resets_at: '2026-11-06T09:10:00Z', severity: 'normal', is_active: true },
      { kind: 'weekly_all', group: 'weekly', percent: 11, resets_at: '2026-11-12T08:00:00Z', severity: 'normal', is_active: false },
      { kind: 'weekly_scoped', group: 'weekly', percent: 0, resets_at: '2026-11-12T08:00:00Z', scope: { model: { display_name: 'Fable' } }, severity: 'normal', is_active: false },
    ],
    extra_usage: { is_enabled: true, monthly_limit: 5000, used_credits: 1250, utilization: 25 },
  },
} as SDKUsageReport;

/** A `query` that answers these messages, and keeps what it was started with. */
const fakeQuery = (messages: unknown[]) => {
  const started: { prompt: string; options: Record<string, unknown> }[] = [];
  let closed = 0;
  const run: UsageQuery = (params) => {
    started.push(params);
    return Object.assign((async function* () { for (const one of messages) yield one; })(), { close: () => { closed += 1; } });
  };
  return { run, started, closed: () => closed };
};

it('reads the report of the /usage message, on the token and its scopes alone, and keeps no session', async () => {
  const before = process.env['ANTHROPIC_API_KEY'];
  process.env['ANTHROPIC_API_KEY'] = 'sk-daemon';
  try {
    const fake = fakeQuery([{ type: 'system' }, { type: 'assistant', usage_report: REPORT }, { type: 'result' }]);
    expect(await usageOf('token-work', 'user:profile user:inference', fake.run)).toEqual(REPORT);
    const options = fake.started[0]?.options ?? {};
    expect(fake.started[0]?.prompt).toBe('/usage');
    expect(options).toMatchObject({ maxTurns: 1, settingSources: [], persistSession: false });
    const env = options['env'] as Record<string, unknown>;
    expect(env['CLAUDE_CODE_OAUTH_TOKEN']).toBe('token-work');
    expect(env['CLAUDE_CODE_OAUTH_SCOPES']).toBe('user:profile user:inference');
    expect(env).not.toHaveProperty('ANTHROPIC_API_KEY');
    expect(fake.closed()).toBe(1);
  }
  finally {
    if (before === undefined) delete process.env['ANTHROPIC_API_KEY'];
    else process.env['ANTHROPIC_API_KEY'] = before;
  }
});

it('gives nothing for a result with no report, and for a CLI that fails', async () => {
  expect(await usageOf('token-work', 'user:profile user:inference', fakeQuery([{ type: 'assistant' }, { type: 'result' }]).run)).toBeUndefined();
  const failing: UsageQuery = () => Object.assign((async function* () { throw new Error('no CLI'); })(), { close: () => {} });
  expect(await usageOf('token-work', 'user:profile user:inference', failing)).toBeUndefined();
});

it('maps the rows to the plan windows, with extra usage on the weekly one', () => {
  expect(snapshotsOf(REPORT)).toEqual({
    session: { remainingPercentage: 77, resetDate: '2026-11-06T09:10:00.000Z' },
    weekly: { remainingPercentage: 89, resetDate: '2026-11-12T08:00:00.000Z', overageAllowedWithExhaustedQuota: true, overage: 1250, overageEntitlement: 5000 },
    'weekly:fable': { remainingPercentage: 100, resetDate: '2026-11-12T08:00:00.000Z' },
  });
  expect(snapshotsOf({ ...REPORT, rate_limits: null })).toBeUndefined();
});
