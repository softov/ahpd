---
title: A pi model named with its provider keeps that provider
domain: pi
status: planned
priority: high
created: 2026-11-11
revalidated: 2026-11-11
requires: []
changes: []
creates: []
refs:
  - git://af15608ab - the commit of ahpd this plan was checked at, and the last one that holds `problems/a-pi-record-model-runs-on-another-provider.md`
  - "[code://packages/agent-pi/src/models.ts#L91-L110](../../../../packages/agent-pi/src/models.ts#L91-L110) - `modelFor`, which matches a qualified id against other providers' bare ids"
  - "[code://packages/agent-pi/src/backend.ts#L680-L690](../../../../packages/agent-pi/src/backend.ts#L680-L690) - `setModel`, the one caller, with pi's runtime at hand"
  - "[code://packages/agent-pi/src/backend.ts#L717](../../../../packages/agent-pi/src/backend.ts#L717) - `modelRuntime.getProviders()`, every provider pi has, with a key or not"
  - "[code://packages/agent-pi/src/session.ts#L1074-L1076](../../../../packages/agent-pi/src/session.ts#L1074-L1076) - the configured model, set at the start with no log when pi refuses it"
  - "[code://packages/agent-pi/src/session.ts#L1300-L1310](../../../../packages/agent-pi/src/session.ts#L1300-L1310) - the log line a turn's refused model gets, the pattern for the start's"
  - "[code://packages/agent-pi/test/agent-pi.test.ts#L148-L161](../../../../packages/agent-pi/test/agent-pi.test.ts#L148-L161) - the `modelFor` case this plan extends"
  - "[code://packages/agent-pi/README.md#L84-L94](../../../../packages/agent-pi/README.md#L84-L94) - the record example, on a model pi 1.3.0 does not list"
  - "[code://.project/plans/pi/13-a-model-pi-cannot-find-fails-the-turn/plan.md](../13-a-model-pi-cannot-find-fails-the-turn/plan.md) - Softov's answer that a configured model pi cannot resolve falls back to pi's default"
---

## Goal

A pi agent whose model names a provider runs on that provider, or not at all.
On 2026-11-11 a record with `deepseek/deepseek-chat` and a DeepSeek key ran on OpenRouter.
pi 1.3.0 lists no `deepseek-chat`, and OpenRouter has a model of that bare id.
After this plan, the record falls back to pi's own default, as pi/13 decided, and the daemon's log says which model pi did not offer.

## Reconnaissance

The files read and the patterns to reuse are the `refs` in the frontmatter, each with its note.

### Searches performed

- `rg "modelFor" packages/agent-pi` - one caller in `backend.ts`, the fake in `test/fake-pi.ts`, and the case in `agent-pi.test.ts`.
- `rg "deepseek-chat" packages/agent-pi docs` - the README example only.
- Test daemon at `7cf919e4b`: `ahpc exec --agent pi-ds --json` gave `openrouter/deepseek/deepseek-chat`. The same record on `deepseek/deepseek-flash` ran on DeepSeek, and with a bad key gave a 401.

### Runtime path

```
record model -> piSession first open -> backend.setModel(options.model) -> modelFor(available, id) -> session.setModel -> the turn's request
```

### Gaps

- `modelFor` reads `deepseek/deepseek-chat` as bare when no exact id answers, though `deepseek` is one of pi's providers.
- The start's `setModel` drops a refusal with no log, so the fallback to pi's default is silent.

## Answers

| What | Source | Task |
| --- | --- | --- |
| An id whose first segment is one of pi's providers is qualified, and is never matched as another provider's bare id | `(defaulted: the rule modelFor's own comment states, "Guessing a provider for an ambiguous name would run the turn somewhere nobody asked for")` | 01 |
| The providers checked are every provider pi has, with a key or not | `(defaulted: a provider with no key is still the one the record names)` | 01 |
| A configured model pi cannot resolve falls back to pi's default | Softov, 2026-10-02, on pi/13: "The configured `model` option still falls back to pi's default when it cannot be resolved" | 01 |
| The fallback at the start is logged at `warn`, in the words of the turn's own refusal | [code://packages/agent-pi/src/session.ts#L1309](../../../../packages/agent-pi/src/session.ts#L1309) | 01 |
| The README example names `deepseek/deepseek-flash` | `(defaulted: pi 1.3.0 lists deepseek-flash and deepseek-v4-pro for deepseek)` | 01 |

## Proposed architecture

- **Data flow** - `setModel` reads the provider ids from `modelRuntime.getProviders()` and hands them to `modelFor`. `modelFor` returns `undefined` for a qualified id with no exact match.
- **Event flow** - unchanged.
- **State flow** - unchanged: a refused model leaves the session on the model it is on.
- **Layer responsibilities** - agent-pi only.
- **Source-of-truth files** - [`code://packages/agent-pi/src/models.ts`](../../../../packages/agent-pi/src/models.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - A qualified model keeps its provider](task-01-a-qualified-model-keeps-its-provider.md) | implemented | - |

## Risks and tradeoffs

- A record that ran by luck on another provider now runs on pi's default - the log line names the model, and the README example changes.
- OpenRouter's `qwen/qwen3-8b` written with no `openrouter/` still resolves when `qwen` is not a provider of pi - that is the bare rule as it stands.

## Resume state

- **Done so far:** task 01 implemented, 2026-11-11; see [implemented.md](implemented.md).
- **Next action:** Softov reviews the PR. The plan closes as `built` on his word.
- **Open questions:** none.
- **Watch out for:** `available` in `setModel` holds only the models with a key. The provider check needs `getProviders()`, not `available`.

## Final verification checklist

- [x] `modelFor(models, 'deepseek/deepseek-chat', undefined, providers)` is `undefined` when `deepseek` is a provider and OpenRouter has `deepseek/deepseek-chat`.
- [x] A configured model pi refuses logs one `warn` line naming it.
- [x] `pnpm typecheck` and the agent-pi suite pass.
