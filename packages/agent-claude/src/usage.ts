/**
 * A login's plan usage, read without a session.
 *
 * The CLI answers `/usage` without asking the model, and the SDK carries its
 * structured twin on the assistant message as `usage_report`. One short
 * `query()` on the login's token, with the profile scopes, reads it; the
 * connector then shows the plan before any chat runs on it. `usage_report`
 * is in the SDK since 0.3.273, and this host runs 0.3.301.
 */

import { tmpdir } from 'node:os';
import { query } from '@anthropic-ai/claude-agent-sdk';
import type { SDKUsageReport } from '@anthropic-ai/claude-agent-sdk';
import type { QuotaSnapshot, QuotaSnapshots } from '@ahpd/sdk';
import { BEFORE_TOKEN } from './logins.js';

/** How long one read may take before it is given up: a CLI start and one usage request. */
export const USAGE_READ_MS = 30_000;

/** What starts the CLI: the SDK's own `query`, or a test's. */
export type UsageQuery = (params: { prompt: string; options: Record<string, unknown> }) => AsyncIterable<unknown> & { close?: () => void };

/**
 * The usage report of one token, or nothing when the CLI gave none.
 *
 * The CLI runs on the token and the scopes alone: the daemon's keys and cloud
 * switches are taken out, as a session on a login takes them out, and no
 * settings file is read. It keeps no transcript, so no session is left behind.
 * A report is there only for a token whose profile answers, which the scopes
 * say. A CLI that fails, or takes longer than `USAGE_READ_MS`, gives nothing.
 */
export const usageOf = async (token: string, scopes: string, run: UsageQuery = query as unknown as UsageQuery): Promise<SDKUsageReport | undefined> => {
  const env: Record<string, string | undefined> = { ...process.env, CLAUDE_CODE_OAUTH_TOKEN: token, CLAUDE_CODE_OAUTH_SCOPES: scopes };
  for (const name of BEFORE_TOKEN) delete env[name];
  const abortController = new AbortController();
  const timer = setTimeout(() => { abortController.abort(); }, USAGE_READ_MS);
  const handle = run({
    prompt: '/usage',
    options: { maxTurns: 1, env, cwd: tmpdir(), settingSources: [], persistSession: false, abortController },
  });
  try {
    for await (const message of handle) {
      const held = message as { type?: unknown; usage_report?: SDKUsageReport };
      if (held.type === 'assistant' && held.usage_report !== undefined) return held.usage_report;
      if (held.type === 'result') return undefined;
    }
    return undefined;
  }
  catch {
    return undefined;
  }
  finally {
    clearTimeout(timer);
    handle.close?.();
  }
};

/** The key a usage row is kept under, as the usage request's windows are keyed. */
const keyOf = (row: { kind: string; group: string; scope?: { model?: { display_name: string } | null; surface?: { display_name: string } | null } | null }): string => {
  if (row.kind === 'session') return 'session';
  if (row.kind === 'weekly_all') return 'weekly';
  const scoped = row.scope?.model?.display_name ?? row.scope?.surface?.display_name;
  if (scoped !== undefined) return `${row.group}:${scoped.toLowerCase()}`;
  return `${row.group}:${row.kind}`;
};

/**
 * A usage report's rows as the plan's windows, the same snapshots the usage
 * request answers: what is left, and when it resets. Extra usage rides the
 * weekly window, as it does there. Nothing for a report with no rows.
 */
export const snapshotsOf = (report: SDKUsageReport): QuotaSnapshots | undefined => {
  const rows = report.rate_limits?.limits;
  if (rows === null || rows === undefined) return undefined;
  const out: QuotaSnapshots = {};
  for (const row of rows) {
    const resetAt = row.resets_at === null ? Number.NaN : Date.parse(row.resets_at);
    const snapshot: QuotaSnapshot = {
      ...(Number.isFinite(row.percent) ? { remainingPercentage: 100 - row.percent } : {}),
      ...(Number.isNaN(resetAt) ? {} : { resetDate: new Date(resetAt).toISOString() }),
    };
    out[keyOf(row)] = snapshot;
  }
  const extra = report.rate_limits?.extra_usage;
  if (extra?.is_enabled === true) {
    const key = out['weekly'] !== undefined ? 'weekly' : out['session'] !== undefined ? 'session' : 'weekly';
    out[key] = {
      ...out[key],
      overageAllowedWithExhaustedQuota: true,
      ...(extra.used_credits === null ? {} : { overage: extra.used_credits }),
      ...(extra.monthly_limit === null ? {} : { overageEntitlement: extra.monthly_limit }),
    };
  }
  return out;
};
