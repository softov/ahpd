---
title: The facio backend offers every model the endpoint serves
domain: plugin
status: built
priority: medium
created: 2026-09-20
revalidated: 2026-09-20
requires:
  - plans/plugin/04-agent-cofold-extras/plan.md
changes: []
creates: []
decisions:
  - decisions/listed-models-are-provider-references.md
refs:
  - code://.project/plans/plugin/04-agent-cofold-extras/plan.md - the plan that made the harness configuration the default and left the list at one row
  - code://packages/agent-cofold/src/agent.ts - `connectionOf`, `listModels`, the catalogue cache and `probe`
  - code://packages/agent-cofold/src/session.ts - `models()`, the per-session list the host learns from
  - code://packages/agent-cofold/src/config.ts#L111-L115 - `splitModel`, the first-slash rule a listed id must satisfy
  - code://packages/agent-claude/src/probe.ts#L50-L120 - the backend that already offers every model its harness reports, per model options included
  - code://packages/sdk/src/host.ts#L1663-L1683 - the probe the root channel is built from, and the empty-model guard
  - code://packages/sdk/src/types/probe.ts#L4-L15 - `Offered.models`, what a picker draws
  - https://openrouter.ai/docs/api-reference/list-available-models - `GET /api/v1/models`, the catalogue and its `id`/`name`
---

## Goal

A facio session's model picker lists every model the configured endpoint serves, not one row.
The harness configuration's `model` stays what it was meant to be: the default a session starts on, offered first when the endpoint's list does not carry it, and the only row when the endpoint cannot be asked.
A person pointed at OpenRouter chooses among OpenRouter's models; a person on LM Studio chooses among what that server holds.

## Reconnaissance

The files read and the patterns to reuse are the `refs` above, each with its note.

### Searches performed

- `rg "models" packages/agent-cofold/src` - `probe` offers `options.model ?? harness.model` alone; `session.models()` reads the session's settings and offers the same single id; nothing else in the package knows a catalogue exists.
- `rg "learnModels|probe\(\)" packages/sdk/src/host.ts` - the root channel's model list is the probe's, and `learnModels` overwrites it from `session.models()` on a handshake the facio backend never fires.
- `rg "init.models" packages/agent-claude/src` - the reference backend offers what its harness reports, with a per-model `configSchema`; the shape to mirror.
- `rg "splitModel" packages/agent-cofold/src` - every model setting goes through the first-slash split, so a model id that itself contains slashes cannot be offered bare.

### Runtime path

```
host construction -> agent.probe() -> GET <baseUrl>/models -> Offered.models
  -> root/agentsChanged -> the client's picker
a chosen id -> session setting `model` or a turn's model -> modelOf -> splitModel -> the provider's endpoint, key and headers
```

### Gaps

- `probe` offers the configured model alone, so the picker has one row on an endpoint that publishes hundreds.
- `session.models()` answers the same single id, so a handshake-driven refresh would shrink a learned list rather than keep it.
- No test covers a catalogue: nothing stubs `GET /models` or asserts that an offered id resolves through `modelOf`.
- `Not found: a timeout or a fallback for a probe that hangs - searched "AbortSignal|timeout" in packages/agent-cofold/src; the fetch would be the package's first outbound catalogue call.`

## Decisions locked in

| # | Decision | Rationale / source |
| --- | --- | --- |
| 1 | [A listed model is selected by the reference the harness already writes](../../../decisions/listed-models-are-provider-references.md) | Softov, 2026-09-20: "the config facio was suppose to be the default model. not the only one" |

## Proposed architecture

- **Data flow** - one `GET <baseUrl>/models` per endpoint and key, cached for the life of the backend; `probe` awaits it for the configured connection, `session.models()` reads the cache for the session's connection and asks in the background when it is missing.
- **Event flow** - none of its own: the host already announces `root/agentsChanged` when the probe answers, and an empty model list is kept out of the root state.
- **State flow** - a catalogue is cached by `baseUrl` and key; a configured model that the list does not carry is prepended; an endpoint that answers nothing caches nothing, so it is asked again rather than remembered as empty.
- **Layer responsibilities** - `packages/agent-cofold`: `agent.ts` resolves a connection once and reads its catalogue, `session.ts` answers `models()` from the same cache · `packages/sdk`: unchanged · `docs/PLUGINS.md`: says the list is the endpoint's and the configured model is the default.
- **Source-of-truth files** - `code://packages/agent-cofold/src/agent.ts`, `code://packages/agent-cofold/src/session.ts`.

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - Offer the endpoint's models](task-01-offer-the-endpoints-models.md) | done | - |

## Risks and tradeoffs

- OpenRouter publishes hundreds of models, so the picker becomes long - that is what the endpoint serves and what the harness itself offers; the configured default stays first, and the list is the client's to search or filter.
- A catalogue call at startup is the package's first outbound request that is not a turn - it is fire-and-forget, timed out, and skipped entirely when an `adapter` is set, so a test or an embedder never reaches the network.
- An endpoint that does not answer must not look like an endpoint with no models - the configured model is offered alone and nothing is cached, so a later probe asks again.
- The prefix makes a listed id longer than the provider's own id, and a client that hand-writes a bare OpenRouter id still gets the provider refusal it gets today - the picker, not the person, is what produces these ids.

## Resume state

- **Done so far:** task 01, 2026-09-20.
- **Next action:** none; the plan is built and [implemented.md](implemented.md) records it.
- **Open questions:** none. A listed id carries the provider prefix (the decision), and the backend's own provider id is accepted for an endpoint no harness entry owns.
- **Watch out for:** the catalogue is read once per endpoint and key and cached, so a model added to the same endpoint after startup is not listed until the daemon restarts or the endpoint changes; `probe` skips the call entirely with an `adapter`, so an embedder's list is its own.

## Final verification checklist

- [x] `pnpm test` green with a stubbed `GET /models` listing several models, the configured default first, and the fallback when the endpoint refuses: 799 passed.
- [x] `pnpm typecheck` and `pnpm boundary` green.
- [x] Every offered id resolves through `modelOf` to the endpoint the catalogue came from.
- [x] `docs/PLUGINS.md` says the list is the endpoint's and the configured `model` is the default.
- [x] `plans/index.md` updated.
