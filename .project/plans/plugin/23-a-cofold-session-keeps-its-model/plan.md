---
title: A cofold session reopens on the model its turns ran on
domain: plugin
status: active
priority: high
created: 2026-09-27
revalidated: 2026-09-27
requires:
  - plans/plugin/14-cofold-runs-its-own-tools/plan.md
changes: []
creates: []
decisions:
  - decisions/a-cofold-turns-model-is-kept-in-cofolds-store.md
  - decisions/a-cofold-run-is-told-the-model-reference-it-runs-on.md
  - decisions/a-cofold-turn-with-no-model-fails-and-says-where-to-name-one.md
  - decisions/listed-models-are-provider-references.md
refs:
  - "[code://packages/agent-cofold/src/session.ts#L719-L778](../../../../packages/agent-cofold/src/session.ts#L719-L778) - `openTurn`: the model is chosen, and set on a non-protocol `Turn.model` rather than `message.model`"
  - "[code://packages/agent-cofold/src/transcript.ts#L236-L244](../../../../packages/agent-cofold/src/transcript.ts#L236-L244) - a rebuilt turn's `message`, with no `model`"
  - "[code://packages/agent-cofold/src/agent.ts#L233-L269](../../../../packages/agent-cofold/src/agent.ts#L233-L269) - `connectionOf`, which resolves the model reference (`settings.model`, else `options.model`, else the harness file's `model`) and fails a turn when none is named"
  - "[code://packages/agent-claude/src/session.ts#L2098-L2109](../../../../packages/agent-claude/src/session.ts#L2098-L2109) - the sibling: a live turn's `message.model`"
  - "[code://packages/agent-cofold/test/agent-cofold-turn.test.ts#L407-L434](../../../../packages/agent-cofold/test/agent-cofold-turn.test.ts#L407-L434) - the turn that fails without a model"
  - file:///github/cofold/packages/agents/src/types/store.ts - `RunRecord`, which gains the model
  - file:///github/cofold/packages/agents/src/types/model.ts - `ModelAdapter.id` and `modelId`, what a run knows of its model
  - file:///github/externals/agent-host-protocol/types/channels-chat/state.ts - `Message.model`: "For historic user/agent messages this records the model actually used"
---

## Goal

A cofold session shows and runs on the model its turns ran on, live, after a reconnect and after the daemon restarts.
"Default" is then reached only when nothing names a model, and that turn says what to add, as decided.

## Reconnaissance

The files read and the patterns to reuse are the `refs` above, each with its note.

### Searches performed

- `rg -n "model" packages/agent-cofold/src/session.ts packages/agent-cofold/src/transcript.ts` - the model is set on `Turn.model` and `usage.model`, never on `message.model`, live or rebuilt.
- `rg -n "model" /github/cofold/packages/agents/src/types/store.ts` - no record holds a model id.
- VS Code's `stateToProgressAdapter.ts` (`turnsToHistory`) - a past request's model is `turn.message.model?.id ?? turn.usage?.model`, and `agentHostSessionHandler.ts` (`lastTurnModelSelection`) defaults a reopened chat to its last turn's `message.model`; with neither, nothing is sent.
- claude's rebuilt turns carry `usage.model` from its own session file, which is why a claude session reopens on its model after a restart (checked by Softov, 2026-09-27, with one session each on `claude-sonnet-5`, `claude-haiku-4-5-20251001` and `claude-opus-5`).

### Runtime path

```
client chat/turnStarted (message.model) -> host session.begin -> cofold openTurn -> run() -> RunRecord
restart -> list() -> transcript() -> turns (message.model) -> VS Code's model picker
```

### Gaps

- A live cofold turn carries its model on `Turn.model`, which the protocol does not have.
- `RunRecord` holds no model, so a rebuilt turn has neither `message.model` nor `usage.model`.
- No case reopens a cofold session and reads its model.

## Decisions locked in

| Decision | Tasks |
| --- | --- |
| [The model a cofold turn ran on is kept in cofold's own store, and the transcript reads it back](../../../decisions/a-cofold-turns-model-is-kept-in-cofolds-store.md) | 01, 03 |
| [A cofold run is told the model reference it runs on, and cofold stores it as given](../../../decisions/a-cofold-run-is-told-the-model-reference-it-runs-on.md) | 01, 03 |
| [A cofold turn with no model configured fails and says to add "model" to the cofold configuration file](../../../decisions/a-cofold-turn-with-no-model-fails-and-says-where-to-name-one.md) | 04 |
| [A listed model is selected by the reference the harness already writes](../../../decisions/listed-models-are-provider-references.md) | 01, 02, 03 |

| What | Source | Task |
| --- | --- | --- |
| A live turn puts its model on `message.model`, as claude's does. | the protocol's `Message.model`, and the sibling | 02 |
| The no-model failure stays, and is checked to reach the person in VS Code. | Softov, 2026-09-27, asked whether to keep that decision: "Keep it, check it shows". | 04 |
| The fix is a plugin plan of its own. | Softov, 2026-09-27, asked where the cofold model fix goes: "New plan plugin/23". | - |

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - cofold records the model each run used, released by Softov](task-01-cofold-records-the-model-a-run-used.md) | implemented | - |
| [02 - A live cofold turn carries its model on the message](task-02-a-live-turn-carries-its-model.md) | implemented | - |
| [03 - A rebuilt cofold turn carries the model it ran on](task-03-a-rebuilt-turn-carries-its-model.md) | implemented | 01, 02 |
| [04 - A turn with no model reaches the person as the sentence that says what to add](task-04-no-model-reaches-the-person.md) | implemented | - |

## Risks and tradeoffs

- Task 01 is a cofold release; task 03 waits for it, and tasks 02 and 04 do not.
- A run recorded before the release has no model, so an old session still reopens on "default" until its next turn.

## Resume state

- **Done so far:** tasks 01, 02, 03 and 04 are implemented and wait for Softov's review; task 01 is released as `@cofold/agents` `0.1.2`, which agent-cofold now depends on.
- **Next action:** Softov reviews tasks 01 to 04 and checks by hand that a cofold session reopens in VS Code on its model after a daemon restart.
- **Open questions:** none.
- **Watch out for:** the reference a client picks is `<provider>/<model>`, while `ModelAdapter.modelId` has no provider, so the reference reaches the record as a run option and never from the adapter.
  A cofold release goes only through its `release.yml` from a `release-*` tag.

## Final verification checklist

- [ ] After a daemon restart, a cofold session reopens in VS Code on the model its last turn ran on, and its next turn runs on it.
- [ ] With no model configured and none sent, the turn's sentence shows in VS Code.
- [ ] `pnpm typecheck` and `pnpm test` green in ahpd; cofold's suite green before its release.
- [ ] `plans/index.md` updated.
