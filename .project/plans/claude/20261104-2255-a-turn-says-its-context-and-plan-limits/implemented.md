---
title: A turn says its context and its plan limits - implemented
date: 2026-11-04
refs:
  - git://fb528ee0
  - "[code://packages/agent-claude/src/session/contextusage.ts](../../../../packages/agent-claude/src/session/contextusage.ts)"
  - "[code://packages/agent-claude/src/session/limits.ts](../../../../packages/agent-claude/src/session/limits.ts)"
  - "[code://packages/sdk/src/connectors/channel.ts](../../../../packages/sdk/src/connectors/channel.ts)"
---

A Claude session now says what fills its context window and how much of its login's plan limits is used. A turn's usage carries `contextAttribution`, `ahpd.context` and `quotaSnapshots` in `_meta`. A connector's health keeps the same plan limits, so a client draws both without asking anything else.

## What was built

- [`code://packages/agent-claude/src/session/parts.ts`](../../../../packages/agent-claude/src/session/parts.ts) - a model's `contextWindow` and `maxOutputTokens` are learned from each result's `modelUsage`, kept by model and canonical name, and announced to the probe.
- [`code://packages/agent-claude/src/session/contextusage.ts`](../../../../packages/agent-claude/src/session/contextusage.ts) - the context breakdown and `ahpd.context`, which holds the used space, the window, the limit, the free space, the buffer and the deferred tools.
- [`code://packages/agent-claude/src/session/limits.ts`](../../../../packages/agent-claude/src/session/limits.ts) - the plan limits of each login, keyed by connector id and token, one window per event, and the one usage request.
- [`code://packages/sdk/src/types/connectors.ts`](../../../../packages/sdk/src/types/connectors.ts) - `QuotaSnapshot` and `QuotaSnapshots`, and `ConnectorHealth.quotaSnapshots`.
- [`code://packages/sdk/src/connectors/channel.ts`](../../../../packages/sdk/src/connectors/channel.ts) - `note` takes an optional `quotaSnapshots`, refuses one that is not a map of snapshots, and keeps a good one in the health.
- [`code://packages/agent-claude/src/logins.ts`](../../../../packages/agent-claude/src/logins.ts) and [`code://packages/agent-claude/src/plugin.ts`](../../../../packages/agent-claude/src/plugin.ts) - `OpenLogins.noted` checks the token as `called` does, and the plugin sends the limits with `x-ahpd/connectors/note`.

## Verified

- `pnpm build`, `pnpm exec tsc -p tsconfig.json --noEmit` and `pnpm boundary` pass.
- The sdk suite passes: 226 files, 4229 tests, 4 skipped.
- The agent-claude suite passes: 59 files, 566 tests.
- `agent-claude-context.test.ts` covers both spellings of the breakdown and a model learning its limit from a result. A turn's usage carries `contextAttribution` and `ahpd.context`, and a failed or late answer leaves both out.
- `agent-claude-limits.test.ts` covers the map of a usage answer, the overage fields and one window of an event. It also covers the minute between requests and an account with no plan. Its turn case shows the event's window on the turn's `quotaSnapshots`. The answer's windows are noted to the host after the turn, and the next turn carries both.
- `connectors-channel.test.ts` covers a note with `quotaSnapshots` kept in the health, and one whose shape is refused.
- No run showed a model row carrying `maxContextWindow` after a turn. The learning and the row fill are tested apart, and the row itself was not read end to end.

## Departures from the plan

- task 01 - the plan named `session/context.ts`, which already exists as the session context, so the map is `session/contextusage.ts`.
- task 01 - the control answer spells its fields in camelCase, so the map reads both that and `SDKContextUsage`'s snake_case.
- task 01 - `resolvedModel` did not reach `Offered.models`, so the sdk type and `probe.ts` now carry it.
- task 02 - the SDK spells the option `skipBehaviors`, not the `skip_behaviors` the *Answers* table names, so the call sends `skipBehaviors: true`.
- task 02 - an answer's `extra_usage` names no window, so its overage fields ride the weekly snapshot. An answer with no week puts them on the session snapshot.
- task 02 - `seven_day_overage_included` keeps a window of its own, `weekly:overage_included`, and each `model_scoped` window is keyed `weekly:<lowercased display name>`.
- task 01, in review - an MCP tool with `isLoaded: false` is deferred and fills nothing, so it is no entry. Without this the entries could add up to more than the total.
- task 02, in review - a session on the CLI's own sign-in has no login, and it got no limits. It now keeps its own, and only a login's limits reach the connector's health.
- task 02, in review - a note with `quotaSnapshots` and no `ok` records no call. The plugin sent `ok: true`, which wrote a call that never happened into the health.
- task 02, in review - a `rate_limit_event` gives `utilization` as a fraction, and the usage request as a percentage. A live turn read 99% left of a week that was 94% used, so an event's figure is now scaled by 100.
- task 02, in review - every `resetDate` is written in one ISO form, because the usage request answers with `+00:00` times.
- Checked live on an isolated daemon, on 2026-11-04: a turn carries `contextAttribution`, `ahpd.context` with a window of 600,000 and a limit of 1,000,000, and `quotaSnapshots`. Two short turns gave the same context total, so the summary's total may lag a turn; a longer conversation was not checked.

## Left for later

- The plan limits of Codex and Copilot - see [deferred.md](deferred.md).
