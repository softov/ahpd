---
title: A fork copies the conversation through the chosen turn
domain: host
status: built
priority: medium
created: 2026-09-26
revalidated: 2026-09-26
requires: []
changes: []
creates: []
decisions: []
refs:
  - "[code://packages/sdk/src/types/session.ts#L230-L256](../../../../packages/sdk/src/types/session.ts#L230-L256) - `forkPoint` names the prompt a turn began with, and `endPoint` says a fork re-asks the turn"
  - "[code://packages/sdk/src/host.ts#L6952-L6961](../../../../packages/sdk/src/host.ts#L6952-L6961) - the host's fork: it already seeds the turns through the chosen one, and its comment calls the point a prompt"
  - "[code://packages/agent-claude/src/claude.ts#L363](../../../../packages/agent-claude/src/claude.ts#L363) - Claude declares `chats.fork`"
  - "[code://packages/agent-claude/src/session.ts#L2019-L2031](../../../../packages/agent-claude/src/session.ts#L2019-L2031) - `cuts` (the prompt) and `ends` (the turn's last entry)"
  - "[code://packages/agent-claude/src/session.ts#L2705-L2706](../../../../packages/agent-claude/src/session.ts#L2705-L2706) - `forkPoint` answers from `cuts`"
  - "[code://packages/agent-claude/src/session.ts#L1969-L1970](../../../../packages/agent-claude/src/session.ts#L1969-L1970) - a fork is `forkSession` with `resumeSessionAt` the point"
  - "[code://packages/agent-cofold/src/agent.ts#L528](../../../../packages/agent-cofold/src/agent.ts#L528) - cofold declares `chats.fork`"
  - "[code://packages/agent-cofold/src/session.ts#L1167-L1168](../../../../packages/agent-cofold/src/session.ts#L1167-L1168) - `forkPoint` answers the turn's input message, `endPoint` its last"
  - "[code://packages/agent-cofold/src/session.ts#L213-L220](../../../../packages/agent-cofold/src/session.ts#L213-L220) - a fork copies `throughMessageId: forkAt`"
  - "[code://test/host.test.ts#L5459-L5480](../../../../test/host.test.ts#L5459-L5480) - the host fork test, which expects the prompt's id as the cut"
  - "[code://test/agent-cofold-fork.test.ts#L144-L160](../../../../test/agent-cofold-fork.test.ts#L144-L160) - the cofold fork test, which expects the chosen turn's question and not its answer"
  - "[code://docs/AHP.md#L77](../../../../docs/AHP.md#L77) - the `createChat` row, which already says the turns are carried through"
  - "npm://@microsoft/agent-host-protocol@^0.9.0 - `ForkChatSource.turnId` in `dist/types/channels-chat/commands.d.ts` says \"Content through this turn is copied into the new chat's visible `turns`\""
---

## Goal

A fork continues the conversation with the chosen turn whole, its answer included, as the AHP spec says, on every backend that forks.
Today the host shows the chosen turn in the new chat while the backend's copy stops at that turn's prompt, so the model has not seen the answer the person can see.

## Reconnaissance

The files read and the patterns to reuse are the `refs` above, each with its note.

### Searches performed

- `rg -n "chats:|forkPoint|forkAt" packages/*/src` - Claude and cofold implement a fork today; ACP does not yet, and pi does not.
- `rg -n "forkPoint|forkAt" test/*.ts` - `test/host.test.ts` for Claude through the host, `test/agent-cofold-fork.test.ts` for cofold.
- `rg -n -i "fork" docs/*.md packages/*/README.md` - `docs/AHP.md:77` already says the turns are carried through; nothing says a fork re-asks.

### Runtime path

```
client createChat source.kind 'fork' -> host.ts:6957 forkPoint(turnId) -> [changed] the turn's last entry
  -> create(start with resume, forkAt, seed through the turn) -> backend copies through forkAt
```

### Gaps

- The contract's comment says a fork re-asks the turn.
- Both backends that fork answer `forkPoint` with the prompt.

## Decisions locked in

| What | Source | Task |
| --- | --- | --- |
| A fork copies the conversation through the chosen turn, answer included, on every backend | Softov, 2026-09-26, answering whether ahpd's contract should follow the AHP spec on fork: "Fork follows the AHP spec: a fork copies history through the chosen turn" | 01, 02, 03 |
| `forkPoint` stays and now names the last entry the turn left behind; the host's fork path is unchanged. A backend may fork without truncating, which is why the host does not reuse `endPoint` | Softov, 2026-09-26, answering whether `forkPoint` stays or the host forks at `endPoint`: "`forkPoint` stays and names the turn's last entry" | 01 |
| Each backend that forks today moves in this plan | Softov, 2026-09-26: "Add tasks for each backend that implements fork today" | 02, 03 |

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - The contract says a fork copies through the turn](task-01-the-contract-says-a-fork-copies-through-the-turn.md) | done | - |
| [02 - Claude forks through the turn](task-02-claude-forks-through-the-turn.md) | done | 01 |
| [03 - cofold forks through the turn](task-03-cofold-forks-through-the-turn.md) | done | 01 |

## Risks and tradeoffs

- The ACP bridge's fork is being planned in `plugin/18` at the same time; it forks the server's whole session at its last turn, which already copies through the turn. Its `forkPoint` must name the turn's end under this contract.
- pi's fork, [pi 05](../../pi/05-a-chat-forks-from-a-turn/plan.md), waits for this plan and is written to it.
- A fork at a turn that failed or was cancelled copies what that turn left, partial answer included; that is what the spec's "through this turn" reads as.

## Resume state

- **Done so far:** built 2026-10-02, see [implemented.md](implemented.md).

## Final verification checklist

- [x] The `Session` contract and the host's comment say a fork copies through the turn.
- [x] A Claude fork resumes at the turn's last entry, and a cofold fork copies through the turn's last message.
- [x] `pnpm test`, `pnpm typecheck`, `pnpm boundary` green.
- [x] `plans/index.md` updated.
