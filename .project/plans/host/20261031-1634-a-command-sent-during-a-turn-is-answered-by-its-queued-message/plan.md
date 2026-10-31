---
title: A command sent as a turn while another runs is answered by the queued message it waits as
domain: host
status: built
priority: medium
created: 2026-10-31
revalidated: 2026-10-31
refs:
  - git://90e5eb5f - the commit of ahpd this plan was checked at
  - "[code://packages/sdk/src/host/chatactions.ts#L534-L539](../../../../packages/sdk/src/host/chatactions.ts#L534-L539) - a client's `chat/turnStarted` is owed under its turn id"
  - "[code://packages/sdk/src/host/lifecycle.ts#L1355-L1374](../../../../packages/sdk/src/host/lifecycle.ts#L1355-L1374) - a command goes past the running-turn refusal to queue behind the turn, and its sender and keys are held under the turn's id"
  - "[code://packages/agent-claude/src/session/turns.ts#L608-L630](../../../../packages/agent-claude/src/session/turns.ts#L608-L630) - Claude's `ran` holds the command as a queued message under the turn's id"
  - "[code://packages/agent-claude/src/session/turns.ts#L376-L390](../../../../packages/agent-claude/src/session/turns.ts#L376-L390) - and runs it as a queued message runs: a fresh turn id, the waiting row named"
  - "[code://packages/agent-acp/src/session/queue.ts#L206-L252](../../../../packages/agent-acp/src/session/queue.ts#L206-L252) - ACP's `startNext` and `ran`, the same two steps; cofold and pi hold it the same way"
  - "[code://packages/sdk/src/host/spawn.ts#L1240-L1264](../../../../packages/sdk/src/host/spawn.ts#L1240-L1264) - a queued message's sender, keys and command record move to the turn that takes it"
  - "[code://packages/sdk/src/host.ts#L751-L799](../../../../packages/sdk/src/host.ts#L751-L799) - `owed`, `answering`, `originOf` and `answeredBy`, which find a client's dispatch by the kind of the action that answers it"
  - "https://github.com/microsoft/agent-host-protocol/blob/v1.0.0/docs/guide/reconciliation.md#L23-L30 - a client holds its action until an envelope with its own origin, or a rejection, answers it, and applies the envelope's action"
  - "https://github.com/microsoft/vscode/blob/3a2421399905c0c044dade3048a797d1e9ba33d4/src/vs/platform/agentHost/common/state/agentSubscription.ts#L547-L563 - the reference client retires a pending action by its `clientSeq` and applies the envelope's own action, whatever its kind"
---

## Goal

A `!command` a client sends as a turn while another turn runs is answered at once by the queued message it waits as: that `chat/pendingMessageSet` carries the client's origin, so the client retires its pending turn and holds the queued message the host holds.

## Reconnaissance

The files read and the patterns to reuse are the `refs` in the frontmatter, each with its note.

### Searches performed

- `rg "queuedAs \?\? turnId" packages` - Claude, ACP, cofold and pi hold a command sent during a turn as a queued message under the turn's id, and the host keeps its sender and keys under the same id.
- `rg "runCommand\(crypto.randomUUID" packages` - Claude, ACP and cofold run the waiting command under a fresh turn id with the waiting row named, as any queued message runs.
- `rg "owe\(" packages/sdk/src` - a client's turn start is owed under `chat/turnStarted` and its id, and found only by an action of that kind.
- `rg "'t2'" packages/sdk/test/host-terminals.test.ts` - the queued command's case waits for a turn `t2` to end, and no turn of that id starts.

### Gaps

- The backend's `chat/pendingMessageSet` for the command goes out with no origin, and no turn of the client's id ever starts, so the client is never answered and holds its turn as pending: its optimistic state shows that turn running in place of the one that is.
- The queued command's case in `host-terminals.test.ts` waits the whole of `WAIT_MS` for a turn `t2` that never starts.

## Answers

| What | Source | Task |
| --- | --- | --- |
| A queued `chat/pendingMessageSet` answers the client's `chat/turnStarted` of its id, and the owed record is let go | the reconciliation guide and the reference client: an own envelope retires the pending action by its `clientSeq` and applies the envelope's action | 01 |
| The command runs as a queued message runs, with its sender moved to the turn that takes it | Claude's `startNext`, ACP's, and the host's move on `queuedMessageId` | 01 |

## Proposed architecture

- **Event flow** - a client's `chat/turnStarted` with a command arrives while a turn runs; the host owes it under its turn id; the backend holds the command as a queued message under that id and says `chat/pendingMessageSet`; the host finds the owed turn under the queued message's id and sends the message with the client's origin; the command runs as a queued message once the running turn ends.
- **Layer responsibilities** - the host: which client's dispatch a backend's action answers.
- **Source-of-truth files** - [`code://packages/sdk/src/host.ts`](../../../../packages/sdk/src/host.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - The queued message a command waits as answers its client](task-01-the-queued-message-answers-the-turn.md) | done | - |

## Risks and tradeoffs

- none.

## Resume state

- **Done so far:** planned and built 2026-10-31. See [implemented.md](implemented.md).
- **Next action:** none.
- **Open questions:** none.
- **Watch out for:** a client's own `chat/pendingMessageSet` of the same id is answered first, under its own kind.

## Final verification checklist

- [x] Each new case fails on `90e5eb5f` for the reason it names, and passes after the change.
- [x] The touched suites pass.
- [x] `pnpm run typecheck` and `pnpm run boundary` report no errors.
