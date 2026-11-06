---
title: A minute limit is checked and counted
status: done
depends: [task-01-a-minute-is-a-period-with-a-meter.md]
layer: "sdk, server, docs"
refs:
  - "[code://packages/sdk/src/usage/charge.ts](../../../../packages/sdk/src/usage/charge.ts) - `limitsOf` and `chargeFor`"
  - "[code://packages/server/src/proxy/listener.ts](../../../../packages/server/src/proxy/listener.ts) - `policyFor`, which passes the meter"
---

## Objective

A `minute` limit reads its total from the meter, and a row out of room in this minute refuses with `this minute`.
A call counts once, on the keys of the candidate it is sent to, before it is sent; a turn counts once.

## Files

- `UPDATE: packages/sdk/src/usage/charge.ts:47-60` - `ChargeOptions` gets `meter`.
- `UPDATE: packages/sdk/src/usage/charge.ts:161-200` - `limitsOf` reads a `minute` limit from the meter, and answers `used: 0` when there is no meter.
- `UPDATE: packages/sdk/src/usage/charge.ts:253-264` - `refusalOf` says `this minute` for a `minute` limit.
- `UPDATE: packages/sdk/src/usage/charge.ts:283-363` - `countCall` adds 1 to each `calls` and `turns` key it is given, once per piece of work.
- `UPDATE: packages/sdk/src/usage/usage.ts` - the usage provider takes the meter, so `usage://limits` answers a `minute` limit.
- `UPDATE: packages/sdk/src/access/policy.ts` - the policy scheme takes the meter, so `policy://<id>/limits` answers a `minute` limit.
- `UPDATE: packages/server/src/proxy/listener.ts:509-565` - `policyFor` passes the meter to `chargeFor`, and the request counts once, on the candidate it sends to.
- `UPDATE: packages/server/src/commands/run.ts:428` - the daemon makes one meter and gives it to the usage store, the proxy and the turn check.
- `UPDATE: packages/sdk/src/host/owners.ts:247` - the turn check passes the meter to `chargeFor`.
- `UPDATE: packages/sdk/test/charge.test.ts` - the minute limit.
- `UPDATE: packages/server/test/proxy-policy-usage.test.ts` - two calls a minute.
- `UPDATE: docs/sdk/POLICY.md` - "The row" and "How a limit is counted" name `minute`.
- `UPDATE: docs/server/PROXY.md` - "What a refusal means" names a minute limit.

## Steps

1. Add `meter` to `ChargeOptions` and to the options `limitsOf` takes.
2. In `limitsOf`, read `meter.sum(key, now)` for a `minute` limit, in place of the store's total.
3. Make `refusalOf` say `this minute` for a `minute` limit.
4. Add `countCall` beside `chargeFor`: it adds 1 to every `calls` and `turns` key the caller passes, once for that caller.
5. In `run.ts`, make one meter beside `fileUsage`, and pass it to the store and the proxy options.
6. Pass the same meter to the host options that reach the turn check in `owners.ts`.
7. Write the tests and the docs.

## Validation

- `charge.test.ts`: with `2 calls a minute`, two allowed walks fill it and the third is refused with `this minute`.
- `charge.test.ts`: the walk one minute later is allowed; a walk with no meter is allowed.
- `proxy-policy-usage.test.ts`: two proxy calls pass and the third in the same minute is 403.
- Run `pnpm typecheck` and `pnpm test`.

## Resume

- **Done so far:** `ChargeOptions` and `limitsOf` take a `meter`, and a `minute` limit reads `meter.sum(key, now)`, or 0 with no meter. `refusalOf` already said `this minute`, because it says `this <period>` for every period but `total`. The walk counts nothing: `countCall` adds 1 to each `calls` and `turns` key it is given, and the proxy calls it once per request, on the candidate it sends to, while the turn check calls it once per turn. `HostOptions` and the proxy's options take the meter, and `owners.ts` and `policyFor` pass it to the walk. The usage provider and the policy scheme take it too, so `usage://limits` and `policy://<id>/limits` answer the same figure. `run.ts` makes one meter and gives it to `fileUsage`, the host, the proxy and the two reads.
- **Next action:** none; the plan's final verification checklist is next.
- **Files:** `packages/sdk/src/usage/charge.ts`, `packages/sdk/src/usage/usage.ts`, `packages/sdk/src/access/policy.ts`, `packages/sdk/src/types/host.ts`, `packages/sdk/src/host/owners.ts`, `packages/server/src/proxy/listener.ts`, `packages/server/src/commands/run.ts`, `packages/sdk/test/charge.test.ts`, `packages/sdk/test/usage-scheme.test.ts`, `packages/sdk/test/policy-scheme.test.ts`, `packages/server/test/proxy-policy-usage.test.ts`, `docs/sdk/POLICY.md`, `docs/server/PROXY.md`, this task file and the plan.
- **Open questions:** none.
- **Departures:** `HostOptions` in `packages/sdk/src/types/host.ts` and `ProxyOptions` in `listener.ts` each take the meter, which the Files list did not name. `refusalOf` needed no edit. `UsageProviderOptions` and `PolicySchemeOptions` take the meter too, so the two reads are fixed rather than answering 0. Counting moved out of the walk, because the walk runs once per entry a name is served by.
- **Watch out for:** the meter is given to the store and to the walk, so a `tokens` minute limit reads the records the store keeps. A request counts on the keys of the first candidate it sends to, so a fallback to the next candidate is not a second call.

