---
title: A cofold session uses what published cofold already ships - listed models with their price, compaction, and a question for the person
domain: plugin
status: built
priority: high
created: 2026-10-06
revalidated: 2026-10-06
requires:
  - plans/plugin/05-endpoint-models/plan.md
  - plans/plugin/32-a-turns-usage-is-every-call-it-made-p3-cofold-counts-each-step/plan.md
changes: []
creates: []
decisions:
  - decisions/listed-models-are-provider-references.md
  - decisions/a-compacted-session-keeps-its-history-and-shows-a-notice.md
refs:
  - "[code://packages/agent-cofold/src/agent.ts#L292-L337](../../../../packages/agent-cofold/src/agent.ts#L292-L337) - `CATALOGUE_TIMEOUT_MS` and the hand-rolled `listModels`: a plain `GET /models`, 5 s, every failure an empty list, ids prefixed `<provider>/`"
  - "[code://packages/agent-cofold/src/agent.ts#L354-L377](../../../../packages/agent-cofold/src/agent.ts#L354-L377) - `modelOf`, which builds a new `openaiCompat()` for every turn with no pricing"
  - "[code://packages/agent-cofold/src/agent.ts#L500-L535](../../../../packages/agent-cofold/src/agent.ts#L500-L535) - `catalogues`, `catalogueOf` and `knownCatalogue`, the per-backend cache keyed by endpoint and key"
  - "[code://packages/agent-cofold/src/agent.ts#L609-L616](../../../../packages/agent-cofold/src/agent.ts#L609-L616) - `probe`, which offers the cached catalogue with the configured model first"
  - "[code://packages/agent-cofold/src/plugin.ts#L51-L89](../../../../packages/agent-cofold/src/plugin.ts#L51-L89) - `optionsSchema`, the plugin's options as the daemon checks them"
  - "[code://packages/agent-cofold/src/session.ts#L60-L68](../../../../packages/agent-cofold/src/session.ts#L60-L68) - the `catalogue` callback a session is handed, rows `{ id, name }`"
  - "[code://packages/agent-cofold/src/session.ts#L217-L221](../../../../packages/agent-cofold/src/session.ts#L217-L221) - `models()`, which answers those rows as they are"
  - "[code://packages/agent-cofold/src/turnagent.ts#L178-L222](../../../../packages/agent-cofold/src/turnagent.ts#L178-L222) - `agentOf`, the `createAgent` call: no `context`, no `limits`, no ask tool"
  - "[code://packages/agent-cofold/src/capabilities.ts#L76-L91](../../../../packages/agent-cofold/src/capabilities.ts#L76-L91) - `withoutTaken`: a tool the host offers keeps its name and the other contributor's is left out"
  - "[code://packages/agent-cofold/src/mapping.ts#L314-L358](../../../../packages/agent-cofold/src/mapping.ts#L314-L358) - `model.started`, the `model.completed` fallback that writes a non-streamed step's text, and `context.compacted`, which sends nothing"
  - "[code://packages/agent-cofold/src/mapping.ts#L486-L503](../../../../packages/agent-cofold/src/mapping.ts#L486-L503) - `input.requested` already becomes a `chatInput` entry"
  - "[code://packages/agent-cofold/src/mapping.ts#L617-L620](../../../../packages/agent-cofold/src/mapping.ts#L617-L620) - `run.finished` sends `outcome.cost` as `_meta.cost` when cofold has one"
  - "[code://packages/agent-cofold/src/pauses.ts#L247-L257](../../../../packages/agent-cofold/src/pauses.ts#L247-L257) - `answer`, which routes a client's answers to a paused run"
  - "[code://packages/agent-cofold/src/transcript.ts#L286-L311](../../../../packages/agent-cofold/src/transcript.ts#L286-L311) - a `summary` message becomes a system notification holding the whole summary text"
  - "[code://packages/agent-claude/src/session/query.ts#L332-L360](../../../../packages/agent-claude/src/session/query.ts#L332-L360) - the sibling: a live compaction is a `systemNotification` saying the tokens before and after, and the history stays"
  - "[code://packages/agent-pi/src/models.ts#L95-L109](../../../../packages/agent-pi/src/models.ts#L95-L109) - the sibling: an offered row carries `maxContextWindow` and `maxOutputTokens` when the model has them"
  - "[code://packages/agent-cofold/README.md#L58-L76](../../../../packages/agent-cofold/README.md#L58-L76) - the package's options table"
  - "[code://docs/PLUGINS.md#L616-L630](../../../../docs/PLUGINS.md#L616-L630) - the cofold options table in the plugin guide"
  - "[code://packages/agent-cofold/test/agent-cofold-models.test.ts](../../../../packages/agent-cofold/test/agent-cofold-models.test.ts) - the catalogue cases, which stub `globalThis.fetch`"
  - "[code://packages/agent-cofold/test/agent-cofold-usage.test.ts](../../../../packages/agent-cofold/test/agent-cofold-usage.test.ts) - the usage and cost cases"
  - "[code://packages/agent-cofold/test/agent-cofold-approval.test.ts#L159-L172](../../../../packages/agent-cofold/test/agent-cofold-approval.test.ts#L159-L172) - a host tool named `ask_user` that pauses for input, the clash case"
  - npm://@cofold/model-openai-compat@0.1.1 - `openaiCompatProvider(...)` with `listModels({ signal })` (retries 429, 5xx and network errors twice, throws `ModelError`, no timeout of its own) and `model({ id, features, params, pricing })`
  - npm://@cofold/agents@0.1.2 - `ModelInfo` (`contextTokens`, `maxOutputTokens`, `pricing`), `ContextOptions` (`maxTokens` default 32000, `autoCompactTokens` absent means never), `createAskUserTool()`, `Message.summarizes`, `context.compacted { messageId, estimatedTokens, afterTokens }`, `outcome.cost` only when the adapter has `pricing`
  - file:///github/cofold/packages/papo/src/agent.ts - `buildAgent`: `provider.model({ id, params })`, `context` with `autoCompactTokens` at 80% of `maxTokens`, `createAskUserTool()` first in `tools`
  - file:///github/cofold/.project/decisions/pricing-on-adapter.md - decision 108: the host passes the catalogue's pricing through `model({ id, pricing })`
---

## Goal

A cofold session runs on what the published cofold packages already offer instead of ahpd's own copies.
The model list comes from cofold's provider, and the turn's model carries the price the list gave, so a turn says what it cost.
A long conversation compacts itself before it outgrows the model, at a point the operator may lower.
Every client still sees the whole conversation, with one notice where the compaction happened, live and after the session is reopened.
The model can ask the person a question, which reaches the client the way a host tool's question does.

## Reconnaissance

The files read and the patterns to reuse are the `refs` above, each with its note.

### Searches performed

- `rg -n "listModels|openaiCompat|modelOf" packages/agent-cofold/src` - one hand-rolled `listModels` (`agent.ts:308`), one `openaiCompat` call (`agent.ts:364`) reached per turn from `turnagent.ts:181`.
- `rg -n "context|limits|createAskUserTool" packages/agent-cofold/src/turnagent.ts` - `createAgent` gets neither `context` nor `limits` nor an ask tool.
- `rg -n "summarizes|summary" packages/agent-cofold/src` - only `transcript.ts:292` and `:298`, which keep a summary as a notification holding its whole text.
- `rg -n "compact" packages/agent-claude/src` - live `compact_boundary` is a notice (`session/query.ts:345`), the transcript skips the summary frame (`transcript.ts:324`).
- `rg -n "maxContextWindow" packages/*/src` - pi sets it on an offered row (`models.ts:104`); cofold does not.
- `rg -n "slice\(0, (60|200)\)" packages/agent-cofold/src` - the two titles, `agent.ts:110` and `turns.ts:50`; host 61 task 02 already owns the rule.
- `.project` searched for every `code://` path above: plugin 05 built the catalogue, plugin 32 p3 sends `_meta.cost`, host 57 task 02 and host 61 task 02 touch `titleOf`, host 62 p3 task 02 touches `turnagent.ts` 115-150 and 229-285.
- `rg -li "compact" .project/decisions` - no decision on keeping or hiding a compacted history, so [a-compacted-session-keeps-its-history-and-shows-a-notice](../../../decisions/a-compacted-session-keeps-its-history-and-shows-a-notice.md) is new.

### Runtime path

```
probe / models() -> catalogueOf -> provider.listModels({ signal }) -> ModelInfo[] (cached) -> rows { id: <provider>/<model>, name, maxContextWindow?, maxOutputTokens? }
a turn -> agentOf -> providerOf(connection).model({ id, params, pricing }) + context { maxTokens, autoCompactTokens } + ask tool -> run()
run() -> auto-compaction -> model.completed (summary, held) -> context.compacted -> compactionNotice -> systemNotification
run.finished -> outcome.cost -> chat/usage _meta.cost
transcript() -> turnsOf -> every message kept; a summary message -> the same compactionNotice
```

### Gaps

- The catalogue is fetched by hand, so the price and context size the endpoint publishes are thrown away.
- A provider is rebuilt every turn and given no price, so `outcome.cost` is never set and plugin 32 p3's `_meta.cost` never goes out for a real endpoint.
- No auto-compaction: a long session runs into cofold's 32000-token default budget and is never summarized.
- Once compaction runs, a live turn would show the summary step's reply as the model's answer, because `model.completed` writes a non-streamed step's text.
- A reopened session shows the whole summary text, which is written for the model, where the live turn showed nothing.
- The model cannot ask the person anything unless the host happens to offer an ask tool.

## Decisions locked in

| Decision | Tasks |
| --- | --- |
| [A listed model is selected by the reference the harness already writes](../../../decisions/listed-models-are-provider-references.md) | 01, 02 |
| [A compacted session keeps its history and shows a notice](../../../decisions/a-compacted-session-keeps-its-history-and-shows-a-notice.md) | 04, 06 |

| What | Source | Task |
| --- | --- | --- |
| ahpd adopts now what published cofold already has: provider `listModels` with pricing passed to `.model()`, auto-compaction limits, `createAskUserTool`, compaction summaries in the transcript | Softov, 2026-10-06, asked "When should ahpd adopt what cofold already has (provider listModels with pricing passed to .model(), auto-compaction limits, createAskUserTool, compaction summaries in the transcript)?": "Plan it now, build now" | 01-06 |
| An endpoint that cannot be asked, by failure, a wrong shape or the 5 s limit, still answers the configured model alone | the decision above, "When the endpoint cannot be asked, the offered list is the configured model alone"; [plugin 05](../05-endpoint-models/plan.md) risks: "timed out" | 01 |
| An offered row carries `maxContextWindow` and `maxOutputTokens` when the list has them | the sibling, [`code://packages/agent-pi/src/models.ts#L95-L109`](../../../../packages/agent-pi/src/models.ts#L95-L109), and the protocol's `SessionModelInfo` | 01 |
| One provider per endpoint and key, held by the backend; a turn's model is `provider.model({ id, params, pricing })` with the listed price | cofold decision 108, `pricing-on-adapter`; papo's `buildAgent` | 02 |
| Compaction fires at a plugin option, `autoCompactTokens`, capped at 80% of the model's listed `contextTokens` (32000 when the list gives none); unset, it fires at that 80% | Softov, 2026-10-06, asked "where should a cofold session's auto-compaction numbers come from?" with the options "From the model list (listed contextTokens else 32000, compact at 80%, no plugin option)", "A plugin option" and "papo's fixed numbers": "A plugin option < than the models 80%" | 03 |
| A compacted session keeps every message for every client and shows one notice where the compaction happened, worded as the Claude backend's and the same live and in the transcript; the summary is never shown as the model's answer | Softov, 2026-10-06, asked "once a cofold session compacts, should its transcript hide the messages the summary covers?": "Keep history, show a notice"; the sibling, [`code://packages/agent-claude/src/session/query.ts#L345-L358`](../../../../packages/agent-claude/src/session/query.ts#L345-L358) | 04, 06 |
| The ask tool is added unless an offered tool already has its name, which then keeps it | [`code://packages/agent-cofold/src/capabilities.ts#L76-L91`](../../../../packages/agent-cofold/src/capabilities.ts#L76-L91), the rule `withoutTaken` already applies | 05 |
| A session's title is the first non-blank line cut at 80, in the catalogue row as well as on the first turn | Softov, 2026-10-05, in [host 61](../../host/61-agents-share-their-session-kit-presets-and-input-checks/plan.md): "First line, up to 80"; amended into its [task 02](../../host/61-agents-share-their-session-kit-presets-and-input-checks/task-02-every-backend-titles-a-session-from-the-first-line.md), not built here | - |

## Proposed architecture

- **Data flow** - `cofoldAgent` holds one `ModelProvider` per endpoint and key and one `ModelInfo[]` per endpoint and key; rows, the turn's model and the turn's context budget all read from those two maps.
- **Event flow** - unchanged but for `context.compacted`, which now sends one `chat/responsePart` of kind `systemNotification`, and the `model.completed` fallback, which waits one event before it writes.
- **State flow** - the catalogue cache holds `ModelInfo` with the id already written as the reference; only `{ id, name, maxContextWindow?, maxOutputTokens? }` leaves the package.
- **Layer responsibilities** - `agent.ts`: providers, catalogue, `modelOf`, the `autoCompactTokens` option · `plugin.ts`: its schema · `turnagent.ts`: `context`, the ask tool · `mapping.ts`: `compactionNotice` and the live notice · `transcript.ts`: the same notice from the store.
- **Source-of-truth files** - [`code://packages/agent-cofold/src/agent.ts`](../../../../packages/agent-cofold/src/agent.ts), [`code://packages/agent-cofold/src/turnagent.ts`](../../../../packages/agent-cofold/src/turnagent.ts), [`code://packages/agent-cofold/src/mapping.ts`](../../../../packages/agent-cofold/src/mapping.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - The catalogue is read through cofold's provider](task-01-the-catalogue-is-read-through-cofolds-provider.md) | done | - |
| [02 - A turn runs on the provider's model, with the listed price](task-02-a-turn-runs-on-the-providers-model-with-its-price.md) | done | 01 |
| [03 - A long session compacts itself before it fills the model](task-03-a-long-session-compacts-itself.md) | done | 02 |
| [04 - A live compaction reads as a notice, not as the model's answer](task-04-a-live-compaction-reads-as-a-notice.md) | done | 03 |
| [05 - The model can ask the person a question](task-05-the-model-can-ask-the-person.md) | done | - |
| [06 - A reopened session keeps its history and shows the same notice](task-06-a-reopened-session-keeps-its-history.md) | done | 04 |

## Risks and tradeoffs

- `listModels` has no timeout of its own and retries a 5xx twice with backoff, so the 5 s limit is one `AbortSignal.timeout(5000)` over the whole call, and a test that answers 500 now takes about 1.5 s.
- The price and the context size are read from the cache without waiting, so a turn that starts before the endpoint has answered runs unpriced and on the 32000-based cap; `probe` fills the cache at startup, so this is the first seconds only.
- The listed `features` are not passed to `.model()`: a model listed without `tools` would refuse every turn that offers tools, which is a behaviour change nobody asked for; reasoning stays forced on only when an effort is chosen, as plugin 06 built it.
- `openaiCompatProvider` captures `fetch` when it is built, so a test that swaps `globalThis.fetch` after a provider exists talks to the old one; providers are built lazily, on the first catalogue read or turn.
- A reopened session shows turns the model no longer sees; the notice is what marks the line, as the decision says.
- host 62 p3 task 02 rewrites `turnagent.ts` 115-150 and 229-285 and this plan touches `agentOf` at 178-222; whichever lands second rebases, and neither changes the other's lines.
- host 57 task 02 and host 61 task 02 both touch `agent.ts` `titleOf` and `list`; this plan does not.

## Resume state

- **Done so far:** all six tasks. `agent.ts` holds one `ModelProvider` per endpoint and key and the whole `ModelInfo[]` per endpoint and key, `rowOf` is what leaves the package, and `modelOf` takes a `held` and builds the turn's model through the provider with the listed price; `turnagent.ts` gives every agent a `context` capped at 80% of the window and cofold's own `ask_user` tool unless a host tool holds that name; `mapping.ts` sends one `systemNotification` per `context.compacted` and holds a non-streamed step's text one event; `transcript.ts` reads the same notice from the run log.
- **Next action:** none - the plan is built, reviewed and merged 2026-10-06.
- **Open questions:** none.
- **Watch out for:** the cache must keep `ModelInfo` but `models()` and `probe` must send only protocol fields, because the root state is checked against the strict schema; the listed id is the endpoint's bare id and the row's is `<provider>/<id>` per the decision; the auto-compaction summary step is a `complete()` call, never streamed, so its text arrives only on `model.completed`; the live and transcript notices must come from one function, or they drift.

## Final verification checklist

- [x] A turn on a priced listed model ends with `chat/usage` carrying `_meta.cost` - `agent-cofold-usage.test.ts`, "prices a real endpoint's turn from the price its catalogue published"; a listed model with no price ends with none, "sends no cost for a listed model the endpoint published no price for".
- [x] An endpoint that refuses, answers garbage or hangs past 5 s still offers the configured model alone - `agent-cofold-models.test.ts`, the existing refusal and wrong-shape cases, and "offers the configured model alone when the endpoint never answers".
- [x] A session over the compaction point compacts; live it shows one notice and no summary text; reopened it shows every earlier turn and the same notice in the same place - `agent-cofold-compact.test.ts`, "says a compaction as one notice rather than as the model's answer" and "summarizes a history past the point, and leaves it in the conversation"; `agent-cofold-store.test.ts`, "reads a compacted session's summary as the notice the live turn sent".
- [x] `autoCompactTokens` is in `optionsSchema`, the README options table and `docs/PLUGINS.md`, and a value above the cap is capped - `agent-cofold-compact.test.ts`, "caps a configured point at 80% of the window" and "holds a session with no catalogue at cofold's own default, capped"; `agent-cofold-plugin.test.ts`, "refuses an autoCompactTokens the loader's options check rejects".
- [x] A model's `ask_user` call raises a `chatInput` entry and the person's answer reaches the run; a host tool named `ask_user` still wins the name - `agent-cofold-approval.test.ts`, "raises a chatInput entry for cofold's own ask tool and answers it back" and "leaves cofold's ask tool out when a host tool already answers to that name".
- [x] `pnpm exec tsc --noEmit`, `pnpm boundary`, `pnpm test`, `pnpm build` pass - 217 files, 3079 tests.
- [x] `plans/index.md` updated.
