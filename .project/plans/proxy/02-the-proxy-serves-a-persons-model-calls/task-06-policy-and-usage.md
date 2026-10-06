---
title: A policy decides the model, and the call is recorded
status: done
depends: [task-02-a-caller-is-somebody.md, task-04-the-call-streams-through.md]
layer: "server"
refs:
  - "[code://packages/sdk/src/decide.ts#L157-L200](../../../../packages/sdk/src/decide.ts#L157-L200) - `decide` with kind `model` and `{ model, proxy }`"
  - "[code://packages/sdk/src/host/owners.ts#L138](../../../../packages/sdk/src/host/owners.ts#L138) - the host's call, and how a store that throws refuses"
  - "[code://packages/sdk/src/types/usage.ts#L59-L77](../../../../packages/sdk/src/types/usage.ts#L59-L77) - `ModelCall`, `ModelUse`"
  - "[code://packages/sdk/src/meter.ts#L167-L224](../../../../packages/sdk/src/meter.ts#L167-L224) - `poolsOf` and the agent meter's record"
  - "[code://packages/server/src/commands/run.ts#L294-L312](../../../../packages/server/src/commands/run.ts#L294-L312) - the policies store and `policiesCheck`"
---

## Objective

With `policies.check` on, a person's call goes only through an entry a `model` policy allows, and is refused 403 naming the row otherwise; every answered call writes one `ModelUse` with `source: 'proxy'` charged to the caller's pools; a session's call is checked and recorded the same way unless `proxy.sessionCalls` is `skip`.

## Files

- `UPDATE: packages/server/src/proxy/listener.ts` - `allowed(entry)` for `route`, and the record when the stream ends.
- `UPDATE: packages/server/src/proxy/dialects.ts` - per dialect, a reader of the usage in a JSON answer and in an SSE stream: `usage.prompt_tokens`/`completion_tokens` (and `prompt_tokens_details.cached_tokens`) for `openai-chat`; `message_start.message.usage` input and cache fields and the last `message_delta.usage.output_tokens` for `anthropic-messages`.
- `UPDATE: packages/server/src/proxy/providers.ts:59-73` - `ProxySetting.sessionCalls?: 'record' | 'skip'` and `ProxyConfiguration.sessionCalls` (default `record`), in `proxySchema` as an enum, so `checkConfig` refuses another value.
- `UPDATE: packages/server/src/commands/run.ts` - the policies store, the switch, the usage port (`metered`, read per call) and `hostId()` passed to `proxyHandler`.
- `CREATE: packages/server/test/proxy-policy-usage.test.ts`.

## Steps

1. A person, checks on: `allowed(entry)` is `decide(policies, principal, scope, 'model', { model: name, proxy: entry.provider })`; none allowed is 403 with the first refusal's sentence in the dialect's body; a store that throws refuses, as the host does.
2. Root and a host with no users directory are not checked. A session caller, with `sessionCalls` at `record`, is checked the same way with the principal and scope `whose` answered (no principal: not checked, as on a host with no directory); at `skip` it is neither checked nor recorded.
3. The answer's body is teed; one branch is the response, the other is read by the dialect's usage reader and dropped as it is read, never held whole.
4. When the stream ends, is aborted or fails, one record: `at` (the call's start), `kind: 'model'`, `source: 'proxy'`, `owner` (`user:<id>`, or `root:<host id>`), `team`, `project`, `model: { name, provider, input, output, cache }` from what was read, `cost` from the entry's `price` (`from: 'price'`, `usd`) when it has one and tokens were read, and `pools` as `poolsOf` builds them. A session caller's record also carries `session`, and `chat` and `turn` when `whose` answered them, so it can be matched with the session meter's record of the same turn. A store that fails is a log line, never the caller's error.

## Validation

- Failing first: a `deny` row on `model:openai/*` lets the call through.
- A row allowing only `proxy:local` lets `local/default` through and refuses `openai/gpt-5.5`, which only `openrouter` serves; a deny names its row; no candidate says `no policy allows`; root is not checked; checks off refuses nothing.
- A JSON answer and an SSE answer from the fake, each with usage, write one record with the tokens and the price cost; an OpenAI stream with no usage writes one with no tokens; an aborted stream writes one with what was read.
- `proxy.sessionCalls` at `record` (and absent): a fake `whose` caller is refused by a deny row, and an allowed call writes one record carrying its `session`, `chat` and `turn`. At `skip`: the deny row lets it through and no record is written. `config-check.test.ts`: another value is refused by name.
- The record's pools are the person's, team's and project's; the marker key is not in the record.

## Resume

Implemented 2026-10-06.
`policyFor`, `chargedAs` and `record` in `listener.ts`; the usage readers in `dialects.ts`; `proxy.sessionCalls` in `providers.ts` and the option description.
The record's owner for root is `root:<hostname>`, the same name the host's own root records use, not the host id.
OpenAI's cached tokens are taken out of `input` and kept as `cache.read`, and cache tokens are charged at the input price until there are cache prices.
`poolsOf` is copied into `listener.ts` from `meter.ts`, which does not export it.
Tests: `proxy-policy-usage.test.ts`, 13 cases; `config-check.test.ts` for `sessionCalls`.
