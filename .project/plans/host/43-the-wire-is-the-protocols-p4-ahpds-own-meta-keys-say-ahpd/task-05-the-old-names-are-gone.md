---
title: The old names are gone, from ahpd and from the wire test
status: done
depends: [task-01-the-commit-message-is-read-as-ahpd-commit.md, task-02-owner-sender-and-staging-are-ahpd-keys.md, task-03-claudes-model-and-skill-hint-are-ahpd-keys.md, task-04-usage-extensions-are-ahpd-keys.md]
layer: "sdk, docs"
refs:
  - "[code://packages/sdk/src/changes.ts#L1068-L1069](../../../../packages/sdk/src/changes.ts#L1068-L1069) - the `ahp.commit` fallback task 01 left"
  - "[code://packages/sdk/test/wire.test.ts](../../../../packages/sdk/test/wire.test.ts) - p1's `PENDING` list"
  - "file:///github/ahpapp/src/changeset-ops.ts - line 207, which must send `ahpd.commit` first"
---

## Objective

ahpd reads no `ahp.commit`, the wire test's `PENDING` list is empty and gone, and `docs/AHP.md` names only `ahpd.` keys for ahpd's extensions.

## Files

- `UPDATE: packages/sdk/src/changes.ts:1068-1069` - drop the `ahp.commit` fallback.
- `UPDATE: packages/sdk/test/commit.test.ts` - `ahp.commit` is ignored.
- `UPDATE: packages/sdk/test/wire.test.ts` - remove `PENDING`; a bare invented key fails the census.
- `UPDATE: docs/AHP.md` - one paragraph saying ahpd's own `_meta` keys are `ahpd.<name>` and the reference's are kept as the reference spells them.

## Steps

1. Remove the `ahp.commit` fallback; the ahpapp in use sends `ahpd.commit`.
2. The tool-call timing keys are [plugin/29 p5](../../plugin/29-a-tool-call-says-when-it-ran-p5-cofold-stamps-its-live-calls/plan.md)'s to rename. If p5 is not built yet, rename `startedAt`, `endedAt` and `durationMs` in [`code://packages/agent-cofold/src/transcript.ts`](../../../../packages/agent-cofold/src/transcript.ts) `callPartOf` to `ahpd.startedAt`, `ahpd.endedAt` and `ahpd.durationMs` here, with `packages/agent-cofold/test/agent-cofold-store.test.ts`; p5 then finds them prefixed. No client reads them, so nothing waits on a client.

## Validation

- `packages/sdk/test/wire.test.ts` passes with no `PENDING` list, and fails when any producer sends a bare invented key.
- `commit.test.ts`: a message under `ahp.commit` is not used.
- `pnpm test` passes.

## Resume

Implemented 2026-10-09, in the `build/agents/58308aec` worktree.

Step 1: `packages/sdk/src/changes.ts` takes a commit's message from `_meta['ahpd.commit']` alone. The `ahp.commit` fallback and the comment that explained it are gone, and the cases in `packages/sdk/test/commit.test.ts` that sent the old name send the new one. `packages/sdk/test/wire.test.ts` drops `PENDING` entirely, so a bare invented key is a stray at every place and not only where no task claims it.

Step 2 needed no work: `rg -n "ahpd\.startedAt|ahpd\.endedAt|ahpd\.durationMs" packages/*/src` finds the three constants in `packages/sdk/src/timing.ts`, and every plugin stamps a call through `callTimes` and `withCallTimes`, so plugin/29 built the prefixed names already. The bare names survive only as cofold's own transcript fields and as the test that refuses them on the wire.

`docs/AHP.md` states the convention once - this host's own `_meta` keys are `ahpd.<name>`, and a key the protocol or the reference client defines keeps its spelling - and the `commit` paragraph no longer says `ahp.commit` is read.

`pnpm install`, `node tools/schema.mjs` (508 definitions, 633 closed objects), `pnpm build`, `pnpm typecheck` and `pnpm boundary` are clean. `npx vitest run --maxWorkers=2 --testTimeout=10000` passes.
