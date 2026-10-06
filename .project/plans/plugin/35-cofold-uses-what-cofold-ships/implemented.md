---
title: A cofold session uses what published cofold already ships - listed models with their price, compaction, and a question for the person - implemented
date: 2026-10-06
refs:
  - "[code://packages/agent-cofold/src/agent.ts](../../../../packages/agent-cofold/src/agent.ts) - one provider and one catalogue per endpoint and key, `rowOf`, `Held`, and `modelOf` built through both"
  - "[code://packages/agent-cofold/src/turnagent.ts](../../../../packages/agent-cofold/src/turnagent.ts) - the turn's `context` and cofold's own ask tool"
  - "[code://packages/agent-cofold/src/mapping.ts](../../../../packages/agent-cofold/src/mapping.ts) - `compactionNotice` and the live `context.compacted` notice"
  - "[code://packages/agent-cofold/src/transcript.ts](../../../../packages/agent-cofold/src/transcript.ts) - the same notice read back from the run log"
---

A cofold session now runs on what the published cofold packages ship rather than on ahpd's own copies of the same things: the catalogue is cofold's provider, a turn's model is built through that provider with the price the list published, a long history folds itself at a point the operator may lower, and the model can ask the person a question.

## What was built

- [`code://packages/agent-cofold/src/agent.ts`](../../../../packages/agent-cofold/src/agent.ts) - the hand-rolled `listModels` goes; `providers` holds one `openaiCompatProvider` per endpoint and key, the catalogue holds the whole `ModelInfo[]` and is read through that provider, `rowOf` is what leaves the package (`id`, `name`, and `maxContextWindow`/`maxOutputTokens` only when the list published a positive number), `Held` carries `providerOf` and `infoOf` to a session, and `modelOf` takes a `held` and answers `provider.model({ id, pricing, params, features })` with the listed price.
- [`code://packages/agent-cofold/src/turnagent.ts`](../../../../packages/agent-cofold/src/turnagent.ts) - `AUTO_COMPACT_AT` (0.8) and `DEFAULT_CONTEXT_TOKENS` (32000); `windowOf` reads the model in force from the catalogue; every agent is built with `context: { maxTokens, autoCompactTokens }` at the option, capped at 80% of the window, and with `createAskUserTool()` first unless a host or client tool already answers to `ask_user`.
- [`code://packages/agent-cofold/src/mapping.ts`](../../../../packages/agent-cofold/src/mapping.ts) - `compactionNotice(before, after)`; `context.compacted` becomes one `chat/responsePart` of kind `systemNotification`; a non-streamed step's text is held for one event so the compaction step's summary is never shown as the model's answer.
- [`code://packages/agent-cofold/src/transcript.ts`](../../../../packages/agent-cofold/src/transcript.ts) - the run log's `context.compacted` is read beside the messages, and a `summary` message becomes the same notice the live turn sent, with the same numbers.
- [`code://packages/agent-cofold/src/context.ts`](../../../../packages/agent-cofold/src/context.ts), [`code://packages/agent-cofold/src/session.ts`](../../../../packages/agent-cofold/src/session.ts) - `SessionContext.held`, the backend's `Held` handed to `cofoldSession`.
- [`code://packages/agent-cofold/src/plugin.ts`](../../../../packages/agent-cofold/src/plugin.ts), [`code://packages/agent-cofold/README.md`](../../../../packages/agent-cofold/README.md), [`code://docs/PLUGINS.md`](../../../../docs/PLUGINS.md) - the `autoCompactTokens` option in the schema and both options tables.

## Verified

- `agent-cofold-models.test.ts` (11 tests) - "offers the limits the endpoint published, and neither its price nor its features" asserts the row exactly, so a `pricing` or `features` key would fail it; "offers the configured model alone when the endpoint never answers" hangs the endpoint and waits out the 5 s limit.
- `agent-cofold-usage.test.ts` (7 tests) - "prices a real endpoint's turn from the price its catalogue published", "sends no cost for a listed model the endpoint published no price for", "holds one provider for an endpoint and key, so a later turn keeps its transport".
- `agent-cofold-compact.test.ts` (new, 8 tests) - the point is 80% of the listed window (8000 of 10000), a configured 5000 stands, a configured 9000 is capped to 8000, no catalogue gives 25600; "summarizes a history past the point, and leaves it in the conversation" and "says a compaction as one notice rather than as the model's answer" read the numbers off cofold's own `context.compacted` event and check the transcript tells the same sentence; "runs no summary step for a session that stays under the point".
- `agent-cofold-approval.test.ts` (14 tests) - "raises a chatInput entry for cofold's own ask tool and answers it back", "declines cofold's own ask tool as a denial the model reads", "leaves cofold's ask tool out when a host tool already answers to that name".
- `agent-cofold-store.test.ts` (26 tests) - "reads a compacted session's summary as the notice the live turn sent", "says a compaction happened when the store kept no numbers for it", "reads a session with no summary as the conversation it was".
- `agent-cofold-plugin.test.ts` - "refuses an autoCompactTokens the loader's options check rejects".
- `pnpm exec tsc --noEmit` clean, `pnpm boundary` reports no undeclared dependency in any of the eight packages, `pnpm test` passes with 217 files and 3079 tests, `pnpm build` compiles all eight packages.

## Departures from the plan

- The plan's file list names no SDK change, but `rowOf`'s return has to be declared: [`code://packages/sdk/src/types/probe.ts`](../../../../packages/sdk/src/types/probe.ts) `Offered['models']` and [`code://packages/sdk/src/types/session.ts`](../../../../packages/sdk/src/types/session.ts) `Session.models()` each gained optional `maxContextWindow` and `maxOutputTokens`, as pi's rows already carry them.
- Task 01's "answers a session with the same catalogue, and its own model until then" needed an `await untilAsync(...)` before its `refused.calls()` assertion, where the hand-rolled `listModels` had fetched inside the call: cofold's provider reads its headers a microtask later.
- `turnagent.ts`'s `agentOf` became a block body holding the taken-name set, the window and the cap, and `mapping.ts`'s switch moved into a `translate` that `actions` leads with what the previous step held; both are restructurings the plan's steps imply and neither changes a signature the package exports.
- `agent-cofold-tools.test.ts` changed with task 05, which the plan's file list does not name: the default set is now the four capabilities' nine tools plus `ask_user`, and the search case's "full ten" is eleven.
- The task files' *Resume* sections were left empty; they had no content before this build either.

## Left for later

- The listed `features` are still not passed to `.model()`, as [deferred.md](deferred.md) says.
- The tasks stay `implemented` until Softov reviews them.
