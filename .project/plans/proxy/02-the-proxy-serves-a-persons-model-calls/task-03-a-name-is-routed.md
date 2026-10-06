---
title: A model name is routed to the first entry that can take the call
status: done
depends: []
layer: "server"
refs:
  - "[code://packages/server/src/proxy/providers.ts#L49-L111](../../../../packages/server/src/proxy/providers.ts#L49-L111) - `ModelEntry`, `ProxyConfiguration` and the built-ins"
  - "[code://packages/server/src/commands/proxy.ts#L83](../../../../packages/server/src/commands/proxy.ts#L83) - `keySet`, read the same way here"
---

## Objective

`route(proxy, name, dialect, allowed)` answers the provider, its entry, the upstream URL and the key, or a refusal: no such name, no entry in this dialect, or every candidate passed over for a missing key or a policy.

## Files

- `CREATE: packages/server/src/proxy/route.ts` - `route` and `upstreamUrl(endpoint, dialect)`.
- `CREATE: packages/server/test/proxy-route.test.ts`.

## Steps

1. The candidates are the name's entries in the file's order whose provider `accepts` the dialect, then those `allowed(entry)` holds (task 06 passes the policy; until then everything), then those whose `key` is absent (a provider with no key, such as LM Studio, is called with none) or whose variable is set.
2. The answer is the first candidate; the rest are kept in order for task 05's fallback.
3. A name nobody serves: 404, `model <name> is not served here`, in the dialect's body (`not_found_error`; `model_not_found` as OpenAI's `code`).
4. A name served only in the other dialect: 404 naming the dialect it is served in and the path to call instead.
5. Every candidate passed over for a key: 503 naming each provider and its variable, never a value.
6. `upstreamUrl` joins the endpoint and the dialect's path with exactly one slash, so `https://openrouter.ai/api/v1` gives `.../api/v1/chat/completions` and `https://api.anthropic.com` gives `.../v1/messages`.

## Validation

- Failing first: `proxy-route.test.ts` imports `route`, which does not exist.
- Softov's table as a fixture: `anthropic/claude-sonnet-5-5` in `openai-chat` goes to `openrouter` as `anthropic/claude-sonnet-5.5`, in `anthropic-messages` to `anthropic` as `claude-sonnet-5-5`; `local/default` goes to `local` with no key; `openai/gpt-5.5` in `anthropic-messages` is the other-dialect 404; `nobody/nothing` is the 404.
- With `ANTHROPIC_API_KEY` unset, `anthropic/claude-opus-5-5` in `anthropic-messages` is the 503 naming `anthropic` and `ANTHROPIC_API_KEY`; the marker value of a set key is in no refusal.
- `upstreamUrl` with and without a trailing slash.

## Resume

Implemented 2026-10-06.
`route` and `upstreamUrl` in `packages/server/src/proxy/route.ts`.
`allowed(entry)` answers the refusal sentence or nothing, and may be async; with every speaking entry refused it is 403 with the first sentence.
An empty key variable counts as set, as `proxy list` reads it.
Tests: `proxy-route.test.ts`, 11 cases.
