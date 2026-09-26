---
title: A pi turn can be truncated, one that failed at the provider says so, and the configured model is used
domain: pi
status: planned
priority: high
created: 2026-09-26
revalidated: 2026-09-26
requires: []
changes: []
creates: []
decisions: []
refs:
  - "[code://packages/sdk/src/host.ts#L8685-L8690](../../../../packages/sdk/src/host.ts#L8685-L8690) - the host refuses `chat/truncated` when the session answers no `endPoint`"
  - "[code://packages/sdk/src/types/session.ts#L243-L256](../../../../packages/sdk/src/types/session.ts#L243-L256) - `endPoint`: the last entry a turn left behind, only for a turn this process watched"
  - "[code://packages/agent-pi/src/session.ts#L268-L269](../../../../packages/agent-pi/src/session.ts#L268-L269) - `rewindAt` is applied through `backend.rewind` when pi opens"
  - "[code://packages/agent-pi/src/backend.ts#L161-L164](../../../../packages/agent-pi/src/backend.ts#L161-L164) - `rewind` is `navigateTree`, already there"
  - "[code://packages/agent-pi/src/session.ts#L227-L231](../../../../packages/agent-pi/src/session.ts#L227-L231) - `agent_settled` finishes every turn as `complete`"
  - "[code://packages/agent-pi/src/session.ts#L316-L330](../../../../packages/agent-pi/src/session.ts#L316-L330) - only a thrown `prompt` becomes `chat/error`"
  - "[code://packages/agent-pi/README.md#L49](../../../../packages/agent-pi/README.md#L49) - the README says truncation works"
  - "[code://packages/agent-claude/src/session.ts#L2022-L2031](../../../../packages/agent-claude/src/session.ts#L2022-L2031) - the sibling's `ends` map, the shape to copy"
  - "[code://packages/agent-claude/src/session.ts#L2705-L2706](../../../../packages/agent-claude/src/session.ts#L2705-L2706) - the sibling answers `forkPoint` and `endPoint` from its maps"
  - "[code://packages/agent-cofold/src/session.ts#L533-L541](../../../../packages/agent-cofold/src/session.ts#L533-L541) - the other sibling records its points before the client is told the turn ended"
  - "[code://test/agent-cofold-fork.test.ts#L262-L275](../../../../test/agent-cofold-fork.test.ts#L262-L275) - a truncation driven through the host, the test shape to copy"
  - npm://@earendil-works/pi-coding-agent@^0.87.1 - `SessionManager.getLeafId()` in `dist/core/session-manager.d.ts`; `navigateTree` in `dist/core/agent-session.d.ts`
  - "[code://packages/agent-pi/src/types.ts#L23-L28](../../../../packages/agent-pi/src/types.ts#L23-L28) - `PiOptions.model`, which nothing reads"
  - npm://@earendil-works/pi-ai@^0.87.1 - `AssistantMessage.stopReason` (`'error'` among its values) and `errorMessage`, in `dist/types.d.ts`
---

## Goal

A client can truncate a pi chat after a turn, which the README already promises and the host refuses today.
A turn whose model call failed at the provider ends as an error with the provider's message, instead of a finished turn with no answer.
The `model` option a configuration names is the model a new session runs on.

## Reconnaissance

The files read and the patterns to reuse are the `refs` above, each with its note.

### Searches performed

- `rg -n "endPoint|forkPoint" packages/agent-pi` - nothing; the session answers neither.
- `rg -n "stopReason" packages/agent-pi` - nothing; no event's message is inspected for an error.
- `grep -n "stopReason === \"error\"" dist/core/agent-session.js` in pi 0.87.1 - pi retries a turn whose assistant message ended in `error`, so an error `message_end` can be followed by a retry that succeeds.

### Runtime path

```
client chat/truncated -> host.ts:8685 session.endPoint(turnId) -> [new] leaf recorded at agent_settled
  -> host restarts the session with resume + rewindAt -> opened() -> backend.rewind -> navigateTree

pi message_end (assistant, stopReason 'error') -> [new] remembered as the turn's last answer
  -> agent_settled -> finish('error', errorMessage) -> chat/error
```

### Gaps

- `endPoint` is not implemented, so the rewind path is dead code.
- The last assistant message of a turn is not kept, so how it ended is not known at the settle.

## Decisions locked in

| What | Source | Task |
| --- | --- | --- |
| `endPoint(turnId)` answers the `sessionManager.getLeafId()` recorded at `agent_settled` | Softov, 2026-09-26: "record `sessionManager.getLeafId()` at `agent_settled` and answer `endPoint(turnId)` from it" | 01 |
| An assistant `message_end` with `stopReason: 'error'` becomes `chat/error` and the turn ends as `error` | Softov, 2026-09-26: "an assistant `message_end` with `stopReason: 'error'` becomes `chat/error` and the turn ends as `error`" | 02 |
| `PiOptions.model`, parsed and never read today, becomes the default model of a new session; a turn's own choice still wins | Softov, 2026-09-26, answering whether the unread `model` option should be wired or removed: "add a task in pi plan 01 that makes it the default model" | 03 |
| The error is judged on the last assistant message at `agent_settled`, not on each `message_end`, so a turn pi retried and then answered is not failed | the settle rule this backend already keeps, [`code://packages/agent-pi/src/session.ts#L217-L231`](../../../../packages/agent-pi/src/session.ts#L217-L231) | 02 |

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - A turn names where it ended](task-01-a-turn-names-where-it-ended.md) | todo | - |
| [02 - A provider error fails the turn](task-02-a-provider-error-fails-the-turn.md) | todo | - |
| [03 - The configured model is the default](task-03-the-configured-model-is-the-default.md) | todo | - |

## Risks and tradeoffs

- The rewind is applied when pi opens, and pi opens on the first turn after the restart; a daemon restart in between resumes the untruncated leaf. Not changed here; watch for it in task 01's host test.
- `navigateTree` can be cancelled by a pi extension's `session_before_tree` handler, and `rewind` answers `false` then; today nothing reads that answer. Task 01 surfaces it as a turn error rather than dropping it.

## Resume state

- **Done so far:** nothing.
- **Next action:** [task-01-a-turn-names-where-it-ended.md](task-01-a-turn-names-where-it-ended.md).
- **Open questions:** none.
- **Watch out for:** a turn cancelled by the client ends with `stopReason: 'aborted'`, not `'error'`; it stays `cancelled`.

## Final verification checklist

- [ ] A `chat/truncated` through the host is accepted for a pi turn this process watched, and pi's leaf moves.
- [ ] A turn whose last assistant message ended in `error` emits `chat/error` with the provider's message and is `error` in the transcript.
- [ ] A turn pi retried and then answered is `complete`.
- [ ] A new session with `model` configured runs on it; a resumed one keeps its own.
- [ ] `pnpm test`, `pnpm typecheck`, `pnpm boundary` green.
- [ ] `plans/index.md` updated.
