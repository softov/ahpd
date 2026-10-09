---
title: A session's owner, a turn's sender and a file's staging are sent as ahpd keys
status: done
depends: []
layer: "sdk"
refs:
  - "[code://packages/sdk/src/host/facts.ts#L160-L161](../../../../packages/sdk/src/host/facts.ts#L160-L161) - `owner` on a session with no directory"
  - "[code://packages/sdk/src/host/facts.ts#L174-L179](../../../../packages/sdk/src/host/facts.ts#L174-L179) - `owner` beside the git facts"
  - "[code://packages/sdk/src/host/spawn.ts#L136-L141](../../../../packages/sdk/src/host/spawn.ts#L136-L141) - `sender` on a stored turn's message"
  - "[code://packages/sdk/src/host/spawn.ts#L472-L476](../../../../packages/sdk/src/host/spawn.ts#L472-L476) - `sender` on `chat/turnStarted`"
  - "[code://packages/sdk/src/changes.ts#L634](../../../../packages/sdk/src/changes.ts#L634) - `staged` and `unstaged` on a file"
  - "[code://packages/sdk/src/changes.ts#L108](../../../../packages/sdk/src/changes.ts#L108) - read back for the watch's comparison"
  - "[code://packages/sdk/src/changes.ts#L244](../../../../packages/sdk/src/changes.ts#L244) - counted for the commit"
  - "file:///github/ahpapp/src/changes.ts - lines 122-123, the staging reader"
---

## Objective

A session summary and state carry `_meta['ahpd.owner']`, a live `chat/turnStarted` and a stored turn's message carry `_meta['ahpd.sender']`, and a changeset file carries `_meta['ahpd.staged']` and `_meta['ahpd.unstaged']`; none carries the bare name.

## Files

- `UPDATE: packages/sdk/src/host/facts.ts:161, 179` and `packages/sdk/src/host/spawn.ts:140, 474` - the new keys; the plugin event fields at `spawn.ts:515` and `spawn.ts:525` are not `_meta` and stay.
- `UPDATE: packages/sdk/src/changes.ts:634, 108, 244` - write and read the new keys.
- `UPDATE: packages/sdk/test/*.test.ts` - the `host-*.test.ts` area files, `sessions.test.ts`, `plugin-events-fire.test.ts`, `commit.test.ts` and any other that reads the old keys (`rg -n "_meta\??\.(owner|sender|staged|unstaged)" packages/sdk/test`).
- `UPDATE: packages/sdk/test/wire.test.ts` - `owner` and `sender` leave `PENDING`.
- `UPDATE: docs/AHP.md:217, 246, 349, 633, 661` - the new names.

## Steps

1. Confirm ahpapp's release reads `ahpd.staged` and `ahpd.unstaged` beside the old names, and that ahpapp `chat/02` reads `ahpd.owner` and `ahpd.sender`; do not merge before.
2. Rename at each producer and at the two readers in `changes.ts`.

## Validation

- `packages/sdk/test/wire.test.ts` passes with `owner` and `sender` gone from `PENDING`; its host has a users directory and `ana` signed in, so both are sent.
- A changeset test runs p1's `metaKeys` census over a changeset with a staged and an unstaged file and finds only `ahpd.staged` and `ahpd.unstaged`; `commit.test.ts` still commits the index when anything is staged.
- `pnpm test` passes.

## Resume

Implemented 2026-10-09, in the `build/agents/6dac4670` worktree.
Step 1 was already met: ahpapp reads both names for staging since host/05 (a66f582). No client reads `owner` or `sender` yet (ahpapp `chat/02` is todo), so nothing goes blank.
`packages/sdk/src/host/facts.ts` sends `ahpd.owner` on the summary and the state. `packages/sdk/src/host/spawn.ts` sends `ahpd.sender` on a stored turn's message and on a live `chat/turnStarted`; the plugin event's own `sender` field is not `_meta` and stays. `packages/sdk/src/changes.ts` writes `ahpd.staged` and `ahpd.unstaged`, and its two readers read the new names.
Tests: `commit.test.ts`, `sessions.test.ts`, `plugin-events-fire.test.ts`. Docs: `docs/AHP.md`, `docs/LIBRARY.md`.
