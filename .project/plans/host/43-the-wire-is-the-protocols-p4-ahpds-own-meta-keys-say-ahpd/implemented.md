---
title: Every _meta key ahpd invents is named ahpd.<name> - tasks 01-04 implemented
date: 2026-10-09
refs:
  - "[code://packages/sdk/src/changes.ts#L1078-L1086](../../../../packages/sdk/src/changes.ts#L1078-L1086) - the `commit` branch reads `ahpd.commit`, then `ahp.commit`"
  - "[code://packages/sdk/test/commit.test.ts](../../../../packages/sdk/test/commit.test.ts) - the three cases over the two key names"
  - "[code://docs/AHP.md#L679](../../../../docs/AHP.md#L679) - the key is `ahpd.commit`, and `ahp.commit` is read while a client sends it"
  - "[code://packages/sdk/test/wire.test.ts#L243-L273](../../../../packages/sdk/test/wire.test.ts#L243-L273) - `PREFIXED` already allows `ahpd.`, so the census is unchanged"
  - "file:///github/ahpapp/src/changeset-ops.ts - line 207, the only sender of `ahp.commit`, which task 05 waits on"
  - "[code://packages/sdk/src/host/facts.ts](../../../../packages/sdk/src/host/facts.ts) - `ahpd.owner`"
  - "[code://packages/sdk/src/host/spawn.ts](../../../../packages/sdk/src/host/spawn.ts) - `ahpd.sender`, stored and live"
  - "[code://packages/sdk/src/host/sessionmethods.ts](../../../../packages/sdk/src/host/sessionmethods.ts) - `hintOf` reads a skill's `ahpd.argumentHint`"
  - "[code://packages/sdk/src/meter.ts](../../../../packages/sdk/src/meter.ts) - reads and writes `ahpd.cost` and `ahpd.cacheWriteTokens`"
---

Task 01 of plan 43 p4. A `commit` invocation now takes its message from `_meta['ahpd.commit']`, and still from `_meta['ahp.commit']` while a client sends that name. The task needs no client, so it lands ahead of the three that do.

## What was built

- [`code://packages/sdk/src/changes.ts`](../../../../packages/sdk/src/changes.ts) - `invoke`'s `commit` branch takes `meta['ahpd.commit']`, falling back to `meta['ahp.commit']` only when the new key is absent, through one `sent` binding the two reads share. The comment beside it says what `ahp.commit` was and names task 05 as the task that drops the fallback. Nothing else in the branch changed, and no other `_meta` key was touched.
- [`code://packages/sdk/test/commit.test.ts`](../../../../packages/sdk/test/commit.test.ts) - `the key a commit message arrives under`, three cases on a real repository: the message under `ahpd.commit` is the commit's subject; the same message under `ahp.commit` still is; and with both sent, `ahpd.commit` wins.
- [`code://docs/AHP.md`](../../../../docs/AHP.md) - the `commit` paragraph names `_meta['ahpd.commit']` and says `ahp.commit` is read in its place while a client still sends it, and goes when none does.

## Verified

- `packages/sdk/test/commit.test.ts`: run against the old read, the two cases on the new name fail and no others - `takes the message from ahpd.commit` with `expected 'Changes from an agent session' to be 'Under my own name'`, and `lets ahpd.commit win when a client sends both` with `expected 'The old name' to be 'The new name'`, 2 failed and 24 passed. With the two reads in place the file is 26 passed, the five pre-existing cases that send `ahp.commit` included.
- `packages/sdk/test/wire.test.ts` passes untouched. It sends no commit, and `ahpd.commit` would be announced by the `ahpd.` prefix in `PREFIXED` even if it did, so the census and its `PENDING` list are unchanged by this task.
- `node tools/schema.mjs` prints 508 definitions and 633 closed objects. `pnpm build`, `pnpm typecheck` and `pnpm boundary` are clean, every package reporting "declared, none undeclared".
- `npx vitest run --maxWorkers=2 --testTimeout=10000` from the root: 254 files, 4419 tests pass. The run rewrote `packages/sdk/test/fixtures/wire.jsonl` with this box's endpoint, which was restored to HEAD afterwards, so the fixture is not in the diff.

## Departures from the plan

- None. The read site moved from the plan's line 1068 to 1078 with the file, and the doc line from 675 to 679, both as the plan warned.

## Left for later

- The `ahp.commit` fallback stands until task 05, which drops it once ahpapp sends `ahpd.commit`. ahpapp is the only sender (`file:///github/ahpapp/src/changeset-ops.ts`, line 207).
- Tasks 02, 03 and 04 wait on ahpapp and ahpc reading both names for their keys. Only `ahp.commit` travels client to host, so task 01 is the one of the five that needs no client release first.
- No commit was made, so this file carries no `git://` ref; the work is the working tree of `build/agents/d1ffbc3d`.

## Tasks 02, 03 and 04

Implemented 2026-10-09 in the `build/agents/6dac4670` worktree, not committed. Each task's step 1 was already met. Since host/05 (a66f582), ahpapp reads both names for `staged`, `unstaged`, `cacheWriteTokens` and `reasoningTokens`, and sends `ahpd.commit`. Since ahp/07 (a13ec65), ahpc reads both names for `model`. No client reads `owner` or `sender` yet.

### What was built

- Task 02: `packages/sdk/src/host/facts.ts` sends `ahpd.owner` on the summary and the state. `packages/sdk/src/host/spawn.ts` sends `ahpd.sender` on a stored turn (`withSender`) and on a live `chat/turnStarted`. The plugin event's own `sender` field is not `_meta` and stays. `packages/sdk/src/changes.ts` writes `ahpd.staged` and `ahpd.unstaged`, and `treeSignature` and `commitConfirmation` read the new names.
- Task 03: `packages/agent-claude/src/session.ts` sends `ahpd.model` on the state. `packages/agent-claude/src/session/customizations.ts` sends a skill's hint as `ahpd.argumentHint`. `packages/sdk/src/host/sessionmethods.ts` gains `hintOf`, which reads a prompt's `argumentHint` and then a skill's `_meta['ahpd.argumentHint']`. The completion item still sends the bare `argumentHint`.
- Task 04: `cacheWriteTokens`, `reasoningTokens`, `cost` and `context` are `ahpd.*` in agent-claude (`session/parts.ts`, `session/query.ts`), agent-acp (`mapping.ts`, `session/turn.ts`), agent-pi (`mapping.ts`) and agent-cofold (`mapping.ts`, `transcript.ts`), live and restored. The readers moved in the same change. These are `packages/sdk/src/meter.ts` (`costOf`, `usedBy`, and `addition`, whose output it reads back), pi's `addUsage` running sum, and acp's `context` read-back in `session/turn.ts`. No numeric `_meta.cost` is sent.
- `packages/sdk/test/wire.test.ts`: `PENDING` is empty. `REFERENCE` is unchanged.
- `docs/AHP.md` names every new key: sender, owner, staging, the `chat/usage` row with the four usage keys, the skill hint and the Claude model. `docs/LIBRARY.md` names owner and sender.

### Verified

- Tests moved to the new names: `commit.test.ts`, `sessions.test.ts`, `plugin-events-fire.test.ts`, `host-sessionconfig.test.ts`, `agent-claude-restored-model.test.ts`, and the usage tests of the four backends and the meter. The acp, pi and cofold usage tests now assert their census of `ahpd.` keys through `metaKeys`, as the claude one does.
- `gives a live session's skill its argument hint as ghost text` in `host-harness.test.ts` is new. Without `hintOf` it fails with `'/writing'` for `'/writing '`.
- `rg` over `packages/*/src`, `packages/*/test` and `docs` finds no producer or internal reader of the old bare keys.
- `node tools/schema.mjs` prints 508 definitions and 633 closed objects. `pnpm build`, `pnpm typecheck` and `pnpm boundary` are clean.
- `npx vitest run --maxWorkers=2 --testTimeout=10000` from the root: 255 files, 4463 tests pass, after a first run failed on the `REFERENCE` entry described below. The run rewrote `packages/sdk/test/fixtures/wire.jsonl`, which was restored to HEAD afterwards.

### Departures from the plan

- The live slash menu never read a skill's hint before: `own` read only `entry.argumentHint`, which only a prompt carries. `hintOf` is a new read, not a moved one.
- The plan says `REFERENCE` allows a completion item's `argumentHint`, but it does not. It is not added, because the census requires each `REFERENCE` entry in the traffic, and the wire test sends no completion with a hint. The first full run failed on exactly that entry.
- `docs/AHP.md` did not describe the usage keys, the model or the skill hint. They are added. `docs/LIBRARY.md`, not in the plan, also named owner and sender.
- The timing keys were already `ahpd.` (plugin/29 is built), so nothing changed for them.

### Left for later

- cofold's restored usage has no test with cache or reasoning tokens.

## Task 05

Merged 2026-10-09. It needed no client release: ahpapp has no releases, and the only one in use is the Expo dev server on `main`, which sends `ahpd.commit` (Softov, 2026-10-09).

### What was built

- [`code://packages/sdk/src/changes.ts`](../../../../packages/sdk/src/changes.ts) - `invoke`'s `commit` branch reads `_meta['ahpd.commit']` alone. The `ahp.commit` fallback and the comment that carried its history are gone.
- [`code://packages/sdk/test/commit.test.ts`](../../../../packages/sdk/test/commit.test.ts) - the four cases that sent `ahp.commit` send `ahpd.commit`, and `the key a commit message arrives under` changes: a message under the old name is ignored, so the commit keeps `Changes from an agent session`, and the both-names case reads `ahpd.commit`.
- [`code://packages/sdk/test/wire.test.ts`](../../../../packages/sdk/test/wire.test.ts) - `PENDING` is removed, so `announced` is `PREFIXED` or `REFERENCE` and the both-ways check is `REFERENCE` alone. A bare invented key is a stray at every place, not only where no task claimed it.
- [`code://docs/AHP.md`](../../../../docs/AHP.md) - the `commit` paragraph no longer says `ahp.commit` is read, and the introduction states the convention once: this host's own `_meta` keys are `ahpd.<name>`, and a key the protocol or the reference client defines keeps its spelling.

### Verified

- Step 2 needed no work: `rg -n "ahpd\.startedAt|ahpd\.endedAt|ahpd\.durationMs" packages/*/src` finds the three constants in `packages/sdk/src/timing.ts`, which `callTimes` and `withCallTimes` write and every plugin goes through, live and restored (plugin/29). The bare names survive only as cofold's own transcript fields and as the test that refuses them on the wire.
- `node tools/schema.mjs` prints 508 definitions and 633 closed objects. `pnpm build`, `pnpm typecheck` and `pnpm boundary` are clean.
- `npx vitest run --maxWorkers=2 --testTimeout=10000` from the root: 260 files, 4550 tests pass in the build worktree, and 261 files, 4580 tests in the review worktree.

### Departures from the plan

- None. The read site is one line shorter than the plan's line 1068 because the fallback's comment went with it.
- `docs/AHP.md` gained the convention paragraph in the introduction, beside the sentence about what was read off the source, rather than inside a section about one key.
