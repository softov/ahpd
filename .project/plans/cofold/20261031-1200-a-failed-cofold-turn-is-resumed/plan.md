---
title: A failed cofold turn is resumed
domain: cofold
status: active
priority: medium
created: 2026-10-31
revalidated: 2026-10-31
requires:
  - plans/claude/20261031-1200-a-failed-claude-turn-is-resumed/plan.md
changes: []
creates: []
refs:
  - git://cb47945e - the commit of ahpd this plan was checked at, and the last one that holds the brief `.project/briefs/claude-cofold-and-acp-resume-a-failed-turn.md`
  - git://cb47945e:.project/briefs/claude-cofold-and-acp-resume-a-failed-turn.md - the brief this plan covers, with the Claude plan and the ACP idea
  - "[code://.project/plans/pi/20261031-0736-a-failed-pi-turn-is-resumed/plan.md](../../pi/20261031-0736-a-failed-pi-turn-is-resumed/plan.md) - the pi plan, the logic to copy"
  - "[code://packages/agent-cofold/src/mapping.ts#L159-L163](../../../../packages/agent-cofold/src/mapping.ts#L159-L163) - `failurePart`, with no `resumable`"
  - "[code://packages/agent-cofold/src/mapping.ts#L738-L746](../../../../packages/agent-cofold/src/mapping.ts#L738-L746) - a failed run ends the turn with `chat/error`"
  - "[code://packages/agent-cofold/src/runs.ts#L34-L47](../../../../packages/agent-cofold/src/runs.ts#L34-L47) - `cut`, a fork or a rewind through `store.sessions`"
  - "[code://packages/agent-cofold/src/runs.ts#L57-L75](../../../../packages/agent-cofold/src/runs.ts#L57-L75) - `settleTurn`, which does not put the error part on the turn"
  - "[code://packages/agent-cofold/src/runs.ts#L84-L87](../../../../packages/agent-cofold/src/runs.ts#L84-L87) - `rememberPoints`, the last message of each turn this process watched"
  - "[code://packages/agent-cofold/src/turns.ts#L104-L140](../../../../packages/agent-cofold/src/turns.ts#L104-L140) - `openTurn`, which emits `chat/turnStarted` and computes the values a run takes"
  - "[code://packages/agent-cofold/src/turns.ts#L188-L262](../../../../packages/agent-cofold/src/turns.ts#L188-L262) - `startTurn`, which builds the agent and launches `run()`"
  - "[code://packages/agent-cofold/src/turns.ts#L276-L290](../../../../packages/agent-cofold/src/turns.ts#L276-L290) - `refusal`, the ending of a turn that never ran, with the code `start_failed`"
  - "[code://docs/sdk/AHP.md#L278](../../../../docs/sdk/AHP.md#L278) - ahpd's support row for `chat/turnResume`"
  - npm://@cofold/agents@^0.4.0 - `store.sessions.truncate` keeps a message and drops what follows; `delete` drops the session; `run()` makes a session that is not there
---

## Goal

A cofold turn that failed on a model call can be resumed with `chat/turnResume`, as a pi or a Claude turn can.
The failed prompt and what the run wrote after it leave the store, and cofold runs the same input again.

## Reconnaissance

The files read and the patterns to reuse are the `refs` in the frontmatter, each with its note.

### Searches performed

- `rg -n "failurePart|chat/error" packages/agent-cofold/src` - one error part, sent on `chat/error` and not kept on the turn.
- `rg -n "truncate|fork|points" packages/agent-cofold/src` - the store's cut, and the points kept for it.
- `rg -n "truncate|sessions.create" /github/cofold/packages/agents/src` - `truncate` keeps `throughMessageId`; `run()` makes the session when it is not there.
- `rg -n "status === 'awaiting'|resume\(" /github/cofold/packages/agents/src/run` - cofold's own `resume` continues only a run that waits or runs, not a failed one.

### Runtime path

```
chat/turnResume -> host check (Claude plan) -> cofold session resume -> chat/turnResume echoed
  -> store.sessions.truncate(through the turn before) or store.sessions.delete
  -> run({ input, messageId: turnId }) -> apply() -> mapping -> run.finished -> settleTurn
```

### Gaps

- The session has no `resume`, so the host refuses `chat/turnResume`.
- The error part has no `resumable`, and the turn in the snapshot has no error part.
- `startTurn` opens the turn on the wire and launches the run in one call, so a resumed turn cannot launch without a second `chat/turnStarted`.

## Answers

| What | Source | Task |
| --- | --- | --- |
| One plan per agent, each copying the pi logic | Softov, 2026-10-31: "one plan per agent... pi first.. brief for claude, cofold and acp copying logic" | - |
| A resume truncates the store through the end of the turn before, and runs the same input under the same message id | (defaulted: cofold's `resume` does not continue a failed run, and `truncate` is the cut a rewind already makes) | 02 |
| A conversation's first turn is resumed by deleting the session; `run()` makes it again | (defaulted: the Claude plan starts such a turn over too) | 02 |
| A failed run is resumable unless it never ran (`start_failed`) and when the turn before has a point, or there is no turn before | (defaulted: the same rule as Claude's `cutOf`) | 01 |
| A turn read back after a restart is not resumable | (defaulted: `points` holds only the turns this process watched) | - |
| The error part goes on the turn as well as on `chat/error` | the pi plan, task 01 | 01 |
| This plan comes after the Claude plan, which adds the host's check | (defaulted: the host's check is in the Claude plan) | - |

## Proposed architecture

- **Data flow** - `resume` cuts the store, then launches `run()` with the turn's text or parts, under the turn's id.
- **Event flow** - `chat/turnResume` goes out first. The run's events then go through `apply` as a live run's do, up to `chat/turnComplete`, `chat/turnCancelled` or `chat/error`.
- **State flow** - the turn moves from `turns` back to `active`, with its message and parts, and a new mapping opens on those parts.
- **Layer responsibilities** - `mapping.ts` marks the part, and `runs.ts` keeps it on the turn. `turns.ts` splits the launch from the opening, and `session.ts` serves `resume`. docs: `AHP.md` and the README.
- **Source-of-truth files** - [`code://packages/agent-cofold/src/turns.ts`](../../../../packages/agent-cofold/src/turns.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - A failed run is resumable](task-01-a-failed-run-is-resumable.md) | implemented | - |
| [02 - The cofold session resumes the turn](task-02-the-cofold-session-resumes-the-turn.md) | implemented | 01 |

## Risks and tradeoffs

- The tool calls the failed turn ran run again, because the cut drops them with the prompt.
- `delete` drops everything the store holds for the session. A first turn holds nothing else, but the task checks it in the store test.
- A truncate is refused while a run holds the writer claim. `resume` answers `false` while a turn runs, so no run holds it.

## Resume state

- **Done so far:** built 2026-10-31. Both tasks are `implemented`, and [implemented.md](implemented.md) says what was built.
- **Next action:** Softov reviews the branch. The hand check of task 02 waits: a test ahpd, a bad cofold key, and a resume from VS Code.
- **Open questions:** none.
- **Watch out for:** `mapTurn` numbers a turn's parts by its step. A mapping on a reopened turn starts after the parts the turn kept, or a delta would append to the failed run's text.

## Final verification checklist

- [ ] A cofold turn that fails on a model call shows a resume in VS Code.
- [ ] The resume runs the input again, and the store holds the prompt once.
- [ ] A resume of a conversation's first turn works, and the session keeps its workspace.
- [ ] A turn refused before it ran shows no resume.
- [ ] A resume that fails again adds one more error part, and the turn can be resumed again.
- [ ] `pnpm typecheck` and the agent-cofold suite pass, and Windows CI is green.
