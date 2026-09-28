---
title: A pi turn reports what it used
domain: pi
status: active
priority: medium
created: 2026-09-26
revalidated: 2026-09-26
requires:
  - plans/pi/01-a-turn-ends-as-it-ended/plan.md
changes: []
creates: []
decisions: []
refs:
  - "[code://packages/agent-pi/src/transcript.ts#L45](../../../../packages/agent-pi/src/transcript.ts#L45) - every transcript turn carries `usage: undefined`"
  - "[code://packages/agent-pi/src/types.ts#L79-L86](../../../../packages/agent-pi/src/types.ts#L79-L86) - `WatchedTurn`, which has no usage"
  - "[code://packages/agent-pi/src/models.ts#L61-L84](../../../../packages/agent-pi/src/models.ts#L61-L84) - `offered`, which says nothing of the model's context window"
  - "[code://packages/agent-claude/src/session.ts#L2513-L2523](../../../../packages/agent-claude/src/session.ts#L2513-L2523) - the sibling emits `chat/usage` before `chat/turnComplete` and keeps it on the turn"
  - "[code://packages/agent-cofold/src/mapping.ts#L109-L126](../../../../packages/agent-cofold/src/mapping.ts#L109-L126) - `usageOf`: the protocol's fields, and what the protocol has no field for in `_meta`"
  - npm://@earendil-works/pi-ai@^0.87.1 - `AssistantMessage.usage` (`input`, `output`, `cacheRead`, `cacheWrite`) and `Model.contextWindow`, `maxTokens`, in `dist/types.d.ts`
  - npm://@microsoft/agent-host-protocol@^0.9.0 - `UsageInfo` (`inputTokens`, `outputTokens`, `cacheReadTokens`, `model`, `_meta`) in `dist/types/common/state.d.ts`; `SessionModelInfo.maxContextWindow` and `maxOutputTokens` in `dist/types/channels-root/state.d.ts`
---

## Goal

A finished pi turn says how many tokens it used and on which model, live and in the transcript, and a client can size that against the model's context window.

## Reconnaissance

The files read and the patterns to reuse are the `refs` above, each with its note.

### Searches performed

- `rg -n "usage" packages/agent-pi/src` - only `usage: undefined` in `transcript.ts`.
- `rg -n "contextWindow|maxContextWindow" packages/*/src` - no backend sets `maxContextWindow` on a model yet.

### Runtime path

```
pi message_end (assistant) -> remembered by plan 01 task 02 -> agent_settled
  -> [new] chat/usage { inputTokens, outputTokens, cacheReadTokens, model, _meta.cacheWriteTokens } -> finish()
  -> WatchedTurn.usage -> transcript

pi model list -> models.ts offered() -> [new] maxContextWindow, maxOutputTokens -> session/modelsChanged
```

### Gaps

- No usage is read or sent.
- The protocol's `UsageInfo` has no context-window field; the window belongs on the model, as `SessionModelInfo.maxContextWindow`.

## Decisions locked in

| What | Source | Task |
| --- | --- | --- |
| `chat/usage` from the last assistant message's usage, at `agent_settled`, stored on the turn | Softov, 2026-09-26: "Emit `chat/usage` from the last assistant message's usage at `agent_settled` ... and store it on the turn instead of `usage: undefined`" | 01 |
| The context window reaches a client as `maxContextWindow` on the offered model, from pi's `Model.contextWindow`, with `maxOutputTokens` from `maxTokens` | Softov, 2026-09-26: "with the context window from the model"; the protocol's field for it is `SessionModelInfo.maxContextWindow` | 02 |
| The protocol's fields where it has them, and `cacheWriteTokens` in `_meta`, as `@ahpd/agent-cofold` does | [`code://packages/agent-cofold/src/mapping.ts#L109-L126`](../../../../packages/agent-cofold/src/mapping.ts#L109-L126) | 01 |
| `chat/usage` goes out before the turn's ending action | [`code://packages/agent-claude/src/session.ts#L2516-L2518`](../../../../packages/agent-claude/src/session.ts#L2516-L2518) | 01 |
| An error with no tokens sends no usage. | Softov, 2026-09-27, asked which review findings in the pi batch become fix tasks: "Zero usage on an error"; seen live on 2026-09-27 | 03 |
| A live pi turn carries `message.model`, in this batch. | Softov, 2026-09-27, asked whether pi's missing `message.model` becomes pi work: "A task in this batch". | 04 |

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - A turn sends its usage](task-01-a-turn-sends-its-usage.md) | implemented | - |
| [02 - A model says its context window](task-02-a-model-says-its-context-window.md) | implemented | - |
| [03 - A turn that failed before any token sends no usage](task-03-an-error-with-no-tokens-sends-no-usage.md) | implemented | 01 |
| [04 - A live pi turn carries its model on the message](task-04-a-live-turn-carries-its-model.md) | implemented | 01 |

## Risks and tradeoffs

- The last assistant message's input tokens are the context the last call sent, not the turn's total; its output tokens are that call's only. That is what sizing the context needs, and it undercounts spend on a turn with several tool rounds. Recorded, not changed, since the brief chose the last message.
- A turn with no assistant message (a `!command`, a turn that failed before pi answered) sends no usage, rather than zeros.

## Resume state

- **Done so far:** tasks 01 to 04 are `implemented`: `chat/usage` from the last assistant message, the context window and output limit on each offered model, no usage for an error that used no tokens, and the model on a live turn's message.
- **Next action:** none; all four tasks are implemented and awaiting review; tasks 01 and 02 were reviewed on 2026-09-27.
- **Open questions:** none.
- **Watch out for:** `model` in `UsageInfo` is the wire id this backend offers, `provider/modelId`, taken from the message's `provider` and `model`, not pi's bare id.

## Final verification checklist

- [ ] A settled turn emits `chat/usage` before `chat/turnComplete`, and the transcript turn carries it.
- [ ] `session/modelsChanged` rows carry `maxContextWindow`.
- [ ] `pnpm test`, `pnpm typecheck`, `pnpm wire` green.
- [ ] `plans/index.md` updated.
