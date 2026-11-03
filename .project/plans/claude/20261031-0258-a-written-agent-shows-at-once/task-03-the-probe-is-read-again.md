---
title: The probe is read again
status: done
depends:
  - task-01-the-claude-folders-are-watched.md
layer: sdk
refs:
  - "[code://packages/sdk/src/host.ts#L1306-L1343](../../../../packages/sdk/src/host.ts#L1306-L1343) - `probeAgent`, which keeps the root's commands and customizations"
  - "[code://packages/sdk/src/host.ts#L1507-L1535](../../../../packages/sdk/src/host.ts#L1507-L1535) - a live fold, which drops a backend and probes a new one"
  - "[code://packages/sdk/src/types/agent.ts#L757-L765](../../../../packages/sdk/src/types/agent.ts#L757-L765) - `probe?()`, the method beside which the new one goes"
  - "[code://packages/agent-claude/src/claude.ts#L514-L519](../../../../packages/agent-claude/src/claude.ts#L514-L519) - the Claude backend's `probe`"
  - "[code://docs/sdk/AGENT.md#L83](../../../../docs/sdk/AGENT.md#L83) - the backend methods table"
---

## Objective

A backend can tell the host that its probe answer is old, and the host then asks the probe again.
The Claude backend tells the host after a change in the personal Claude folder.

## Files

- `UPDATE: packages/sdk/src/types/agent.ts:757-765` - add `probeChanged?(onChange)`, which returns a function that stops the calls.
- `UPDATE: packages/sdk/src/host.ts:1306-1343` - after the first probe, call `probeChanged`, and run `probeAgent` again on each call.
- `UPDATE: packages/agent-claude/src/claude.ts:514-519` - add `probeChanged`, with `watchFolders` on the personal scope.
- `UPDATE: packages/sdk/test/host-snapshots.test.ts` - add the test of a second probe.
- `UPDATE: docs/sdk/AGENT.md:83` - add the row of `probeChanged`.
- `UPDATE: packages/agent-claude/README.md` - say that a file written into a Claude folder shows without a restart.

## Steps

1. Add `probeChanged?(onChange: () => void): () => void` to `Agent`, after `probe`.
2. In `probeAgent`, call `agent.probeChanged` once, after the first answer.
3. On each call, run `probe` again, and keep only the answer of the last run.
4. Stop the calls when the host closes, and when a live fold removes the backend.
5. In `claude.ts`, call `watchFolders` with the personal scope and no working directory.
6. Add a test with a fake backend whose second answer has one more command, and expect a second `root/agentsChanged`.
7. Add the `probeChanged` row to the table in `AGENT.md`, marked optional.
8. Add one sentence to the agent-claude README, after the section of the skills plan.

## Validation

- `packages/sdk/test/host-snapshots.test.ts` passes, with the new test.
- `pnpm typecheck` is clean, and `pnpm --filter @ahpd/sdk test` passes.
- Restore `packages/sdk/test/fixtures/wire.jsonl` after the test run.
- By hand, with a test ahpd under XDG directories: a new personal agent shows in a new session's `/agent` picker.

## Resume

