---
title: A turn leaves a checkpoint
status: done
depends: []
layer: sdk
refs:
  - "[code://packages/sdk/src/sessions/changes.ts#L61](../../../../packages/sdk/src/sessions/changes.ts#L61) - `git`, the one runner of git in the source"
  - "[code://packages/sdk/src/host/spawn.ts#L999-L1004](../../../../packages/sdk/src/host/spawn.ts#L999-L1004) - where a turn end reads the folder again"
  - "file:///github/externals/vscode/src/vs/platform/agentHost/common/agentHostCheckpointService.ts#L17-L68 - the refs, the baseline at `turn/0`, and the capture at a turn start"
---

## Objective

A session in a git folder has a baseline commit at `refs/agents/<sid>/checkpoints/turn/0`, and one commit per finished turn at `turn/<N>`.
Neither commit moves the person's branch, index or working tree.

## Files

- `CREATE: packages/sdk/src/sessions/checkpoints.ts` - `captureBaseline`, `captureTurn`, `baselineOf`, `latestOf` and `removeAll`.
- `UPDATE: packages/sdk/src/types/changes.ts:321-345` - `ChangesetSource` gets `checkpoint?(dir, session, turn)`.
- `UPDATE: packages/sdk/src/sessions/changes.ts` - `checkpoint` calls `checkpoints.ts`.
- `UPDATE: packages/sdk/src/host/spawn.ts:999-1004` - the turn end calls `checkpoint` before `refreshFacts`.
- `CREATE: packages/sdk/test/checkpoints.test.ts` - the cases in Validation, in a temporary repository.

## Steps

1. Write the tests first.
2. Write the tree with `GIT_INDEX_FILE` set to a temporary file, `git add -A`, `git write-tree` and `git commit-tree`.
3. Write the ref with `git update-ref`, and never call `git commit` or `git checkout`.
4. Capture `turn/0` before the first turn of a session, and skip it when the ref exists.
5. Capture `turn/<N>` after each turn ends.
6. Do nothing in a folder that is not a git repository.
7. Remove the refs of a session when the host removes the session.
8. Set this task and the plan row to `implemented`.

## Validation

- A test: after two turns, `turn/0`, `turn/1` and `turn/2` exist, and `HEAD`, the index and `git status` are as before.
- A test: a file that a shell command wrote is in the turn's tree.
- A test: a folder with no git gets no ref and no failure.
- A test: removing the session removes its refs.
- `pnpm -s build`, `pnpm -s typecheck` and the sdk vitest suite pass.

## Resume

- **Done so far:** Built 2026-10-16.
  `packages/sdk/src/sessions/checkpoints.ts` writes the baseline under `turn/0` and one commit per finished turn.
  It uses `GIT_INDEX_FILE`, so the branch, index and working tree do not move.
  Captures run one at a time per session.
  `ChangesetSource` has `checkpoint` and `removeCheckpoints`, and `changes.ts` answers both.
  `spawn.ts` captures at the session start and at each turn end, before it reads the folder again.
  `lifecycle.ts` removes the refs in `removeSession`.
  5 tests are in `test/checkpoints.test.ts`.
  `build`, `typecheck`, `boundary`, `node tools/schema.mjs` and `git diff --quiet tools/` pass.
  The sdk suite passes with 2984 tests.
- **Next action:** [task-02-session-changes-come-from-checkpoints.md](task-02-session-changes-come-from-checkpoints.md).
- **Open questions:** none.
- **Watch out for:** The Files list names a site for the turn end only, so two sites were chosen.
  The baseline is captured in `spawn.ts` at `keepFolder`.
  The removal is `removeCheckpoints?(dir, session)` on the port, called from `removeSession`.
  Restore `packages/sdk/test/fixtures/wire.jsonl` with `git checkout -- packages/sdk/test/fixtures/wire.jsonl`; the suite dirties it.
