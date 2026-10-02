---
title: ACP reports what it has
status: done
depends: []
layer: "agent-acp"
refs:
  - "[code://packages/agent-acp/src/mapping.ts#L219-L227](../../../../packages/agent-acp/src/mapping.ts#L219-L227) - the dropped variant"
  - "[code://packages/agent-acp/src/session.ts#L737-L738](../../../../packages/agent-acp/src/session.ts#L737-L738) - the prompt response"
---

## Objective

A `usage_update` with a `cost` sends `chat/usage` with the turn's cost so far; the prompt response's `usage`, when present, sends the turn's tokens with it.

## Files

- `UPDATE: packages/agent-acp/src/mapping.ts:219-227` - map `usage_update` with a `cost` to `chat/usage`, cost minus the value at turn start.
- `UPDATE: packages/agent-acp/src/session.ts:737-738` - read `response.usage` into the final `chat/usage`, keeping the cost.

## Steps

1. Remember the session's cumulative cost when a turn starts.
2. Drop the "a usage report" mention from the comment listing what is not carried.

## Validation

- new `packages/agent-acp/test/agent-acp-usage.test.ts`: two `usage_update`s in a turn send the cost difference; a prompt response with `usage` sends tokens and cost; one without sends cost only.
- `pnpm -F @ahpd/agent-acp test`.

## Resume

- **Done 2026-10-01.** `mapping.ts` maps `usage_update` to `chat/usage`: a cost is the session's cumulative `amount` less the turn's `costAtStart`, in `_meta.cost` as `{ amount, currency }`, and an update with no cost sends nothing. `session.ts` seeds `costAtStart` from the last cost the session read when a turn opens, carries that forward when a turn ends, and reads `response.usage` into a final `chat/usage` before `finish`, keeping the cost the updates carried. A usage action is also held on the turn, so a mid-turn subscriber reads the same number the stream carries.
- **A third source file was needed.** The task named `mapping.ts` and `session.ts` only, but `mapUpdate` takes the state it reads from `AcpTurn`, so `types.ts` grew `costAtStart?: number` and `cost?: { amount, currency }`. Without them the mapping has nowhere to keep the baseline.
- **What the tests cover.** `agent-acp-usage.test.ts`: two `usage_update`s in a turn send the cost as it stands, before `chat/turnComplete`, with the turn holding it; a second turn counts from what the first left; a response carrying `usage` sends `inputTokens`, `outputTokens`, `cacheReadTokens` and `_meta.cacheWriteTokens`, `_meta.reasoningTokens`, `_meta.cost` together; a response with none sends the cost alone; a turn whose server reported neither sends no usage at all. The fixture's books start at $1.00 and its charges are quarters, so a first turn has a baseline of zero the tests can tell from a later turn's real one, and a difference is exact rather than a float artefact.
- **What the plan did not know.** A turn that opens before the bridge has seen any `usage_update` has no baseline, so the first turn of a session counts the whole cumulative cost the server names - which on a resumed session is whatever the conversation spent before this process attached. Counting from zero is what `claude` does for the same reason. `PromptResponse.usage.totalTokens` is dropped: it is the sum of counts already reported and the protocol's own arithmetic, not a measurement of its own. `thoughtTokens` rides `_meta.reasoningTokens`, following `cofold`'s spelling.
- **Left alone, and worth a look.** `transcript.ts` still rebuilds a turn with `usage: undefined`, and a replay has no `costAtStart`, so a transcript cannot report a cost without reporting the session's whole. Giving it one means keeping the baseline on `WatchedTurn`, which is outside this task.
- **Check.** `pnpm -F @ahpd/agent-acp test` 61 passed; `pnpm typecheck` clean. `tools/ahp.strict.schema.json` is generated and gitignored, and two `agent-acp-ports.test.ts` cases fail without `pnpm schema` having been run - unrelated to this task, but a fresh worktree needs it first.

**Review, 2026-10-01** - a cost reported before `session/prompt` goes out (on `session/new`, a `session/load` replay, or between turns) is now the turn's starting point and charged to no turn, tracked by `AcpTurn.prompted`. Before it, the first turn of a resumed session was charged everything the conversation had spent. The test fixture's `--books` flag reports a cost before answering `session/new`, and the new case fails without the fix.
