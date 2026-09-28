---
title: A session from disk is replayed into turns
status: done
depends: [task-01-agent-pi-loads-without-importing-pi.md]
layer: "agent-pi"
refs:
  - "[code://packages/agent-pi/src/agent.ts#L111-L114](../../../../packages/agent-pi/src/agent.ts#L111-L114) - `transcript`, which answers `undefined` for a session not watched"
  - "[code://packages/agent-pi/src/transcript.ts](../../../../packages/agent-pi/src/transcript.ts) - `turnsOf` and the comment this task replaces"
  - "[code://packages/agent-pi/src/mapping.ts#L88-L242](../../../../packages/agent-pi/src/mapping.ts#L88-L242) - `mapEvent`, the translation the replay feeds"
  - "[code://packages/agent-pi/src/session.ts#L170](../../../../packages/agent-pi/src/session.ts#L170) - `ends`, seeded from the replay on a resumed session"
  - "[code://packages/agent-pi/src/session.ts#L849](../../../../packages/agent-pi/src/session.ts#L849) - `endPoint`"
  - "[code://packages/agent-pi/src/catalog.ts#L51-L65](../../../../packages/agent-pi/src/catalog.ts#L51-L65) - `stateFile`, which finds a session's file"
  - "[code://packages/agent-pi/README.md#L66](../../../../packages/agent-pi/README.md#L66) - the catalogue paragraph that says a row from disk opens empty"
  - "[code://.project/decisions/a-failed-transcript-read-is-not-an-empty-session.md](../../../decisions/a-failed-transcript-read-is-not-an-empty-session.md) - what the host does with `undefined`"
  - npm://@earendil-works/pi-coding-agent@^0.87.1 - `SessionManager.findById`, `SessionManager.open(path)`, `getBranch()`, and the `SessionEntry` and message types in `dist/core/session-manager.d.ts`
---

## Objective

`Agent.transcript` answers the turns of a pi session this process did not watch, rebuilt from pi's file through `mapEvent`, each turn ending with the entry id it ended at, and a resumed session's `endPoint` answers for those turns.

## Files

- `CREATE: packages/agent-pi/src/replay.ts` - the entries on the current branch turned into pi's live events in pi's order, fed through `mapEvent` on a fresh `PiTurn` per user message, sealed as turns, each with its end entry id.
- `UPDATE: packages/agent-pi/src/agent.ts` - `transcript` answers the watched record when there is one, else the replay; a file pi cannot open answers `undefined`.
- `UPDATE: packages/agent-pi/src/session.ts` - a resumed session seeds `ends` from the replay.
- `UPDATE: packages/agent-pi/src/transcript.ts` - its header says what it now is.
- `UPDATE: packages/agent-pi/README.md` - the catalogue paragraph says a row from disk opens with its turns.
- `UPDATE: packages/agent-pi/test/` - the cases below.

## Steps

1. Apply decision [a-pi-session-from-disk-is-replayed-through-the-live-mapping](../../../decisions/a-pi-session-from-disk-is-replayed-through-the-live-mapping.md).
2. Read the branch with `SessionManager.findById` and `SessionManager.open(...).getBranch()`, through the loader from task 01.
3. A user message opens a turn; assistant text and thinking become `message_update` deltas; each tool call becomes `tool_execution_start`, a ready as the hook gives it, and `tool_execution_end` with its tool result; an assistant message with `stopReason: 'error'` ends its turn as `error` with its message; one with `stopReason: 'aborted'` ends it as `cancelled`; the turn is `complete` otherwise.
4. Entries with no turn meaning (the leading `system` message, `model_change`, `thinking_level_change`, `context_edit`, labels, session info) are skipped; a `model_change` sets the turn's `usage.model` if it applies.
5. Each rebuilt turn's end entry id is the id of the last entry that belongs to it, which is what `ends` holds for a watched turn.

## Validation

- A case over a real pi session file written in a temp directory with pi's own `SessionManager` (user, assistant with text and thinking, a tool call and its result, a second user turn, one assistant error): `transcript(id)` from a fresh agent answers two turns with the text, reasoning and tool call parts a live turn would have, states `complete` and `error`, and today answers `undefined`, so it fails first.
- A case: the same session resumed through `create`, and `endPoint(firstTurnId)` answers the entry id the first turn ended at.
- A case: a watched session still answers its live record.
- A case: an id with no file answers `undefined`.
- `pnpm typecheck`, `pnpm boundary`, `pnpm test` green.
- By hand, for Softov: restart the daemon, open a pi session from the list, and its conversation shows.

## Resume

Implemented 2026-09-28.
`packages/agent-pi/src/replay.ts` holds `replayEntries`, which turns the entries of one branch into `WatchedTurn`s and their end entry ids, and `replayed`, which finds the file with `SessionManager.findById` in each served directory and reads `SessionManager.open(file).getBranch()` through the loader.
A user message opens a turn whose id is the entry id; thinking and text are raised as `message_update` deltas; each tool call is raised as `tool_execution_start`, readied `not-needed` with `readyRow`, and ended by its `toolResult` as `tool_execution_end`; all through `mapEvent`.
`readyRow` and `usageOf` moved to `mapping.ts`, and the session's hook readies its row with the same `readyRow`.
A turn ends as its last assistant message did: `error` with the `chat/error` part carrying the error message, `complete` otherwise, so a retried error reads complete.
A turn's end entry id is its last message entry, its duration runs from the user message to that entry, and its usage is `usageOf` its last answer, with the model in force from `model_change` when the answer names none.
The leading system message, `model_change`, `thinking_level_change`, `context_edit`, labels, session info and custom entries add nothing to a turn.
`transcript` answers the watched record when there is one, else the replay, and `undefined` for an id with no file or a file pi cannot open.
`piSession` takes a fourth parameter, `replay`, and a resumed session seeds `ends` from it without replacing an end it watched.
`turnsOf` takes any record with `turns`, and its header, the catalogue's header and the README's truncation bullet and catalogue paragraph say turns from disk are rebuilt.
Two cases in `test/agent-pi.test.ts` write a session with pi's own `SessionManager` under a temporary `sessionDir`.
The transcript case failed first with `AssertionError: expected undefined to deeply equal [ …(2) ]`, and also checks the rebuilt parts equal a live turn driven through the fake in pi's order.
The resume case failed first with `AssertionError: expected undefined to be 'eb2a4e34' // Object.is equality`.
The watched and no-file cases read under a temporary `sessionDir`, and the test helper passes a replay that answers nothing, so no case reads `~/.pi`.
By hand, replaying this machine's pi sessions gave their turns, a tool call completed, and the timed-out-then-retried turn complete.
`pnpm typecheck` and `pnpm boundary` green, and `pnpm test`: 106 files, 1458 tests passed.
