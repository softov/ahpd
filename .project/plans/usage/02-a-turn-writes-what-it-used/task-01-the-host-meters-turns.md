---
title: The host meters turns
status: done
depends: []
layer: "sdk"
refs:
  - "[code://packages/sdk/src/host.ts#L3585-L3660](../../../../packages/sdk/src/host.ts#L3585-L3660) - the per-action loop to hook into"
  - "[code://packages/sdk/src/types/usage.ts](../../../../packages/sdk/src/types/usage.ts) - the record to write"
---

## Objective

In the host's dispatch loop, keep each running turn's last `chat/usage` (by chat and turn id), and when the turn ends (`chat/turnComplete`, `chat/turnCancelled`, or `chat/error` ending it) write one `ModelUse` through `options.usage.record`, then forget the turn.

The record:

- `at`: when the turn started; `source: 'agent'`; `kind: 'model'`.
- `owner`: the turn's sender (`senderOf`), else the session's owner; read before `senders.delete`.
- `team`, `project`: the session's `charged` scope, when it has one.
- `session`, `chat`, `turn`, `agent` (the session's provider), `computer` (the session's `computer://` id, when it runs in one).
- `model`: `name` from `usage.model` (else the turn message's model id), `input`, `output`, `cache.read` from `cacheReadTokens`, `cache.write` from `_meta.cacheWriteTokens`.
- `cost`: from `_meta.cost`, `{ amount, currency, from: 'harness' }`; read each harness's spelling (Claude's, cofold's `{ amount, currency }`, ACP's) and normalise the currency to lowercase `usd`.
- `pools`: the owner, `team:<team>`, `project:<team>:<project>`, each only when present.

A turn with no report writes nothing.
Find out whether a worker (subagent) chat reports usage that its parent turn's report already includes (Claude says its turn sum includes subagents); count each token once, and if harnesses differ, stop and ask.
A failing `record` is logged with the session uri and swallowed.

## Files

- `UPDATE: packages/sdk/src/host.ts` - the meter, or `CREATE: packages/sdk/src/meter.ts` for the record building if it reads better apart.
- `UPDATE: .project/plans/usage/00-usage.md` - the runtime path.

## Validation

- `packages/sdk/test/usage-meter.test.ts` with a fake backend and an in-memory `Usage`: complete, cancelled and failed turns; a turn with no report; owner from sender versus session; scope and pools present and absent (no users, no teams); a cost in each harness's spelling; a failing store does not break the turn; a worker chat not double counted.

## Resume
