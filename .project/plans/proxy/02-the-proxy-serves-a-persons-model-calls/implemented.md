---
title: The proxy serves a person's chat completions and messages, streamed back unchanged - implemented
date: 2026-10-06
refs:
  - git://3e93f6a
  - "[code://packages/server/src/proxy/listener.ts](../../../../packages/server/src/proxy/listener.ts)"
  - "[code://packages/server/src/proxy/caller.ts](../../../../packages/server/src/proxy/caller.ts)"
  - "[code://packages/server/src/proxy/route.ts](../../../../packages/server/src/proxy/route.ts)"
  - "[code://packages/server/src/proxy/dialects.ts](../../../../packages/server/src/proxy/dialects.ts)"
---

With `http` on, the daemon answers `POST /v1/chat/completions` and `POST /v1/messages` beside `/api`, so a person's own tool calls a `<maker>/<name>` model with their ahpd token.
The call goes to the first provider entry that takes the caller's dialect, is allowed by policy and has its key, with that provider's id and key, and the answer streams back unchanged.
Every refusal is the dialect's own error body, `GET /v1/models` lists the names the caller may use, and each answered call is recorded with `source: 'proxy'`.

## What was built

- [`code://packages/server/src/proxy/listener.ts`](../../../../packages/server/src/proxy/listener.ts) - `proxyHandler` and `ProxyOptions`: the guard, the body limit, the forward, the timeouts, the fallback, the policy check and the record.
- From Softov's review (2026-10-06), in `listener.ts`: a provider that fails mid-answer errors the caller's stream (`streamed`); `ACCOUNT` and `ACCOUNT_LIMITS` keep organization, project and rate-limit headers out both ways; `connectionNamed` drops what a `Connection` header names; a header timeout is 504 with no fallback; `attempt` starts nothing once the caller has hung up.
- [`code://packages/server/src/proxy/caller.ts`](../../../../packages/server/src/proxy/caller.ts) - `callerOf`, `SessionCaller` and `ProxyCaller`; `whose` is asked after the deployment token and before `users.verify`.
- [`code://packages/server/src/proxy/route.ts`](../../../../packages/server/src/proxy/route.ts) - `route` and `upstreamUrl`.
- [`code://packages/server/src/proxy/dialects.ts`](../../../../packages/server/src/proxy/dialects.ts) - paths, error bodies, key headers, usage readers and the two list shapes.
- [`code://packages/server/src/proxy/providers.ts`](../../../../packages/server/src/proxy/providers.ts) - `proxy.sessionCalls`, `record` or `skip`, default `record`.
- [`code://packages/server/src/http.ts`](../../../../packages/server/src/http.ts) - the guards exported, and `/v1` 404 while the API is off.
- [`code://packages/server/src/commands/run.ts`](../../../../packages/server/src/commands/run.ts) - `/v1` in front of `/api` on the daemon's port or `http.port`.
- [`code://packages/sdk/src/users.ts`](../../../../packages/sdk/src/users.ts) - the `proxy` subject, and `proxy:read` and `proxy:write` on `member`.
- `docs/PROXY.md`, and `docs/DAEMON.md`, `docs/POLICY.md`, `docs/USERS.md`, `plans/proxy/00-proxy.md`.

## Verified

- `proxy-route.test.ts` (11), `proxy-listener.test.ts` (24, three of them over a real daemon), `proxy-forward.test.ts` (21), `proxy-policy-usage.test.ts` (13), the new `sessionCalls` case in `config-check.test.ts` and the proxy grants in `users.test.ts`, all passing.
- A marker key is asserted absent from refusals, answers, the proxy's log lines, the daemon's stdout and stderr and the usage record; the caller's token is asserted absent from the upstream request.
- The review's five fixes each have a test in `proxy-forward.test.ts` that fails without the fix: a provider that sends `content-length: 100` and drops the socket mid-body leaves the caller with `aborted`/`ECONNRESET`; account headers both ways with `retry-after` and `retry-after-ms` kept; `Connection: keep-alive, x-hop` keeps `x-hop` from the provider; a timed-out entry is answered 504 and the second entry gets no call; a caller who hangs up during the first attempt gets no second. `proxy-policy-usage.test.ts`'s cut-stream case now expects the caller's request to fail.
- 2026-10-06, after the review fixes: `pnpm exec tsc --noEmit` clean, `pnpm boundary` clean, `pnpm build` clean. `pnpm test`: 220 files, 3129 tests, 3120 passed and 9 failed, all nine in `packages/computer` (`computer-devcontainer`, `-needs`, `-parts-mount`, `-plugin`, `-state-seed`, `-uptime`) at the 5 s timeout with the machine's load average at 24; rerun alone, each file passes, two of them only with `--testTimeout=30000`. No proxy test failed.
- Task 08's by-hand calls through openrouter and LM Studio are not run; they are Softov's.

## Departures from the plan

- A root call is charged to `root:<hostname>`, the name the host's own root records use, rather than the host id the plan named, so both meters charge one pool.
- A body over 32 MiB is refused 413 `request_too_large`; the plan set no limit.
- `accept-encoding`, `expect` and every `x-ahp-*` header are also kept from the provider, and redirects are refused so a key never follows one.
- OpenAI's cached tokens are taken out of `input` and kept as `cache.read`, and cache tokens are priced at the input price until there are cache prices.
- `poolsOf` is copied from `meter.ts`, which does not export it.
- A refusal on `/v1/models` follows `anthropic-version`; a method other than `GET` there is 405.
- From Softov's review (2026-10-06): a header timeout no longer falls back, which the plan's fallback row had included; a provider failing mid-answer cuts the caller's connection instead of closing the stream; account and `Connection`-named headers are dropped, and a hang-up between attempts is checked. Each is a row in the plan's table.

## Left for later

- Limits and pools (policy/02), translation between dialects, cache prices, cache-affinity routing.
- Filling `whose`: container/05 p12 task 01.
- Paths beside the three, such as `/v1/messages/count_tokens`, are 404.
