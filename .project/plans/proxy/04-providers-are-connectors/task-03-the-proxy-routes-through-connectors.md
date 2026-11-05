---
title: The proxy routes through connectors
status: done
depends: [task-01-an-adapter-can-serve-models.md, task-02-the-host-ships-four-provider-adapters.md]
layer: "server"
refs:
  - "[code://packages/server/src/proxy/route.ts#L61-L107](../../../../packages/server/src/proxy/route.ts#L61-L107) - `route`, which reads keys from the environment today"
  - "[code://packages/server/src/proxy/providers.ts#L97-L225](../../../../packages/server/src/proxy/providers.ts#L97-L225) - the built-ins, the configuration and `proxyProblems`"
  - "[code://packages/server/src/proxy/listener.ts#L43-L86](../../../../packages/server/src/proxy/listener.ts#L43-L86) - `ProxyOptions`, which loses `env` and gets `providers` and `note`"
  - "[code://packages/server/src/proxy/listener.ts#L540](../../../../packages/server/src/proxy/listener.ts#L540) - the route call for a model call"
  - "[code://packages/server/src/proxy/listener.ts#L692](../../../../packages/server/src/proxy/listener.ts#L692) - the route call for the models list"
  - "[code://packages/server/src/proxy/listener.ts#L731-L760](../../../../packages/server/src/proxy/listener.ts#L731-L760) - the `ModelUse` a proxy call writes"
  - "[code://packages/server/src/commands/options.ts#L928](../../../../packages/server/src/commands/options.ts#L928) - where the file's `modelProxy` is checked"
  - "[code://packages/server/src/commands/run.ts#L556-L570](../../../../packages/server/src/commands/run.ts#L556-L570) - where the proxy is built"
  - "[code://packages/server/src/commands/proxy.ts](../../../../packages/server/src/commands/proxy.ts) - `ahpd proxy list`"
  - "[code://packages/sdk/src/types/usage.ts#L67-L78](../../../../packages/sdk/src/types/usage.ts#L67-L78) - `ModelCall`, which gets `connector`"
---

## Objective

The proxy finds each provider among the open connectors, with the caller's own first.
The file no longer holds providers, and a file that does is refused.
Each attempt reports its outcome to the connector, and each usage record names the connector that paid.

## Files

- `UPDATE: packages/server/src/proxy/providers.ts` - remove `ProxyProvider`, `ProviderKey`, `BUILT_IN_PROVIDERS`, `providers` and `providerSchema`, and refuse `providers` in `proxyProblems`.
- `UPDATE: packages/server/src/proxy/route.ts` - take the open provider connectors and the caller in place of the environment.
- `UPDATE: packages/server/src/proxy/listener.ts` - `providers()` and `note()` on `ProxyOptions` in place of `env`, `note` on each attempt, and `connector` on `ModelUse`.
- `UPDATE: packages/server/src/commands/run.ts:556-570` - hand the proxy `connectorLists.providers` and `connectorLists.note`.
- `UPDATE: packages/server/src/commands/proxy.ts` - list the model names only.
- `UPDATE: packages/sdk/src/types/usage.ts:67-78` - add `connector?: string` to `ModelCall`.
- `UPDATE: packages/server/test/proxy-route.test.ts` - routing over fake provider connectors.
- `UPDATE: packages/server/test/proxy-forward.test.ts` - the forwards, with a provider connector in place of a built-in.
- `UPDATE: packages/server/test/proxy-policy-usage.test.ts` - the usage record carries `connector`.
- `UPDATE: packages/server/test/config-check.test.ts` - a file with `modelProxy.providers` is refused.

## Steps

1. Refuse `modelProxy.providers` in `proxyProblems`, with: "modelProxy.providers is no longer read: add each provider as a connector, see docs/server/PROXY.md".
2. Remove the rule that an entry's provider exists, and the built-ins with it.
3. Give `route` the open provider connectors and the caller, and remove `env` from `RouteOptions`.
4. Match an entry's `provider` against connector ids first.
5. Use that one connector when it matches and the caller may read it.
6. Match it against adapter names otherwise, and take the caller's own connectors, then the scope team's, then the host's.
7. Order each tier by connector id, and keep every match after the first as a fallback.
8. Keep only connectors whose `provider` accepts the caller's dialect.
9. Answer 503 when no connector remains, and name the entry's provider in the message.
10. Carry the connector id on each `Candidate`, and its `ModelProvider` key and endpoint.
11. Call `note(id, outcome)` after each attempt: `ok` for 2xx, and a failure with the status or the error otherwise.
12. Write `connector` on the `ModelUse` beside `provider`.
13. Remove `env` from `ProxyOptions`, and add `providers()` and `note()`.
14. Hand the proxy the channel's `providers` and `note` in `run.ts`.
15. Print the model names only in `ahpd proxy list`, and remove its providers part and its JSON field.
16. Rewrite the proxy tests to use fake provider connectors, and add cases for each step above.

## Validation

- The tests pass, and the gate passes: `pnpm -s typecheck && pnpm -s build && pnpm -s boundary && pnpm -s test`.
- `rg -n "OPENROUTER_API_KEY|ANTHROPIC_API_KEY|OPENAI_API_KEY|BUILT_IN_PROVIDERS" packages/server/src` finds nothing.
- A person's own connector answers before the host's for the same entry, in a test.
- A team connector answers only under that team's scope, in a test.

## Resume

- **Done so far:** `providers.ts` holds the names and `sessionCalls` only, and refuses a file that writes `providers`. `route` takes the open `ProviderConnector`s and the caller. It matches an entry's `provider` by connector id first, and by adapter name otherwise. It orders the caller's own, then the scope team's, then the host's, by id, with each later one a fallback. A `Candidate` carries the connector id, the adapter, the entry, the URL and the key. The listener has `providers()` and `note()` in place of `env`, notes each sent attempt, and writes `provider` and `connector` on the `ModelUse`. `run.ts` hands the proxy `connectorLists.providers` and `connectorLists.note`. `ahpd proxy list` prints the model names only. `ModelCall` has `connector`.
- **Next action:** none for this task.
- **Open questions:** none.
- **Watch out for:** the tests changed in `proxy-route.test.ts`, `proxy-forward.test.ts`, `proxy-policy-usage.test.ts`, `config-check.test.ts`, `proxy-listener.test.ts`, `proxy-list.test.ts`, `proxy-usage-captures.test.ts` and `fixtures/proxy-harness.ts`, which is more than this task's Files list. The `commands/options.ts` schema description also changed, beside the check.
