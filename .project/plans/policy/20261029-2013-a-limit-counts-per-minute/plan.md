---
title: A limit counts per minute
domain: policy
status: built
priority: medium
created: 2026-10-29
revalidated: 2026-10-29
refs:
  - git://817615bc:.project/briefs/a-proxy-key-names-what-it-charges.md - the brief this plan covers, part 3, the rpm and tpm half
  - git://3f4f6a02 - the commit of `main` the facts were checked at
  - "[code://packages/sdk/src/types/policies.ts#L65-L66](../../../../packages/sdk/src/types/policies.ts#L65-L66) - `Period`, which gets `minute`"
  - "[code://packages/sdk/src/access/policies.ts#L44-L52](../../../../packages/sdk/src/access/policies.ts#L44-L52) - `PERIODS`, which the policy scheme lists to a client"
  - "[code://packages/sdk/src/usage/periods.ts#L90-L112](../../../../packages/sdk/src/usage/periods.ts#L90-L112) - `periodOf`, where a period begins and resets"
  - "[code://packages/sdk/src/usage/usage.ts#L155-L370](../../../../packages/sdk/src/usage/usage.ts#L155-L370) - `fileUsage`, whose totals are kept per day"
  - "[code://packages/sdk/src/usage/charge.ts#L161-L200](../../../../packages/sdk/src/usage/charge.ts#L161-L200) - `limitsOf`, which reads a total for each limit"
  - "[code://packages/sdk/src/usage/charge.ts#L283-L363](../../../../packages/sdk/src/usage/charge.ts#L283-L363) - `chargeFor`, which answers the keys an allowed call is charged to"
  - "[code://packages/sdk/src/access/policy.ts#L130-L145](../../../../packages/sdk/src/access/policy.ts#L130-L145) - the scheme a policy form is drawn from, which lists `PERIODS`"
---

## Goal

A limit can be counted per minute: 60 calls a minute, or 100000 tokens a minute.
This is the rpm and tpm of other proxies, and it works on a policy row and on a key's limits.
The window is a fixed minute of the clock, and a sliding window is the idea `sliding-minute-window`.

## Reconnaissance

The files read and the patterns to reuse are the `refs` in the frontmatter, each with its note.

### Searches performed

- `rg -n "dayOf|charge\(" packages/sdk/src/usage/usage.ts` - the store adds each record to a total per pool and per day, so it cannot answer one minute.
- `rg -n "PERIODS" packages/sdk/src` - the policy scheme sends the list to a client, so a form gets `minute` with no client code.
- `rg -n "chargeFor\(" packages/sdk/src packages/server/src` - the proxy and the turn check are the two callers.

### Runtime path

```
policy row or key: { amount: 60, measure: calls, period: minute }
call -> chargeFor -> limitsOf: minute -> meter.sum(key, minute start) -> room?
     -> allowed: the caller's countCall adds 1 to key/calls, once per request or turn
call ends -> usage.record(entry) -> meter.add(key/tokens, n), meter.add(key/usd, cost)
```

### Gaps

- `Period` has no `minute`, and the usage store keeps nothing finer than a day.
- A call is counted at its record, after it ends, so a burst of calls that start together all pass a call limit.

## Answers

| What | Source | Task |
| --- | --- | --- |
| Limits per minute, for requests and for tokens | Softov, 2026-10-29: "we need a rpm tpm" | 01, 02 |
| `minute` is a new value of `period`, with every measure the kind takes | (defaulted: one limit form, not a second field) | 01 |
| The window is the current minute of the clock, not the last 60 seconds | (defaulted: the brief's open point; a sliding window is the idea `sliding-minute-window`) | 01 |
| The minute totals are in memory, and a restart clears them | (defaulted: a minute is lost at most) | 01 |
| `calls` and `turns` are counted when the call is allowed | (defaulted: a call counted at its end lets a burst through) | 02 |
| `tokens` and `usd` are counted when the record is kept | (defaulted: they are known only at the end of a call) | 01 |
| One request is one call: the proxy counts once, on the candidate it sends to, and a fallback is the same call | Softov, 2026-10-29: fix both before the PR | 02 |
| `policy://<id>/limits` and `usage://limits` answer a `minute` limit from the daemon's meter | Softov, 2026-10-29: fix both before the PR | 02 |

## Proposed architecture

- **Data flow** - `createMinuteMeter` keeps a sum per key for the current and the last minute. The usage store adds `tokens`, `usd` and `hours` at record. `chargeFor` reads a `minute` limit from the meter and counts nothing; the proxy and the turn check count `calls` and `turns` once each, through `countCall`.
- **Event flow** - none.
- **State flow** - the meter is in memory, one for each daemon, and the server gives the same one to the store and to every `chargeFor`.
- **Layer responsibilities** - sdk: `Period`, `periodOf`, the meter, the store and `chargeFor` · server: one meter, passed through · docs.
- **Source-of-truth files** - [`code://packages/sdk/src/usage/charge.ts`](../../../../packages/sdk/src/usage/charge.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - A minute is a period with a meter](task-01-a-minute-is-a-period-with-a-meter.md) | done | - |
| [02 - A minute limit is checked and counted](task-02-a-minute-limit-is-checked-and-counted.md) | done | 01 |

## Risks and tradeoffs

- A fixed window lets up to twice the amount through across the edge of two minutes.
- Tokens are counted at the end of a call, so a tokens limit lets the calls that are running finish over it.
- Two daemons that share one usage folder keep two meters.

## Resume state

- **Done so far:** every task. `minute` is a `Period`, `periodOf` cuts it in UTC, and `createMinuteMeter` keeps two buckets per key. `fileUsage` feeds it `usd`, `tokens` and `hours`, and an allowed `chargeFor` counts `calls` and `turns`. One meter in `run.ts` reaches the store, the host and the proxy.
- **Next action:** none. The plan is built, and `implemented.md` says what exists.
- **Open questions:** none.
- **Watch out for:** the plan `policy/20261029-2012-a-key-has-limits` also changes `chargeFor` and the policy checks. The key's limits take `minute` once both are merged.

## Final verification checklist

- [x] `pnpm typecheck` passes.
- [x] `pnpm test` passes, run as `pnpm exec vitest run --maxWorkers=3 --testTimeout=30000` after `pnpm -s schema`: 460 files and 7676 tests.
- [x] A row with `2 calls a minute` allows two proxy calls and refuses the third in the same minute.
- [x] The next minute allows a call again.
- [x] A policy form in a client offers `minute` with no client change.
