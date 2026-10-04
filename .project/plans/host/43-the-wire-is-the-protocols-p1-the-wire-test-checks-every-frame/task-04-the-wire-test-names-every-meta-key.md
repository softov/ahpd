---
title: The wire test names every _meta key ahpd writes
status: todo
depends: [task-03-the-wire-test-records-a-whole-host.md]
layer: "tools"
refs:
  - "[code://tools/wire.mjs](../../../../tools/wire.mjs) - where the census function lives, beside the checker"
  - "[code://docs/AHP.md#L83](../../../../docs/AHP.md#L83) - `_meta.command` and `_meta.isSkill` on a completion item, the reference client's"
  - "[code://docs/AHP.md#L220](../../../../docs/AHP.md#L220) - `toolKind`, `subagentDescription`, `subagentAgentName`, `subagentChatUri`, the reference's"
  - "[code://docs/AHP.md#L556-L562](../../../../docs/AHP.md#L556-L562) - `command`, `description`, `argumentHint` on a completion item's attachment"
  - "[code://docs/AHP.md#L635](../../../../docs/AHP.md#L635) - `githubData`, `workingDirectoryKeys`, `github`, `git`"
  - "[code://UPSTREAM.md#L71](../../../../UPSTREAM.md#L71) - `_meta.kind: 'responseRoundEnded'`, the reference's"
---

## Objective

Every `_meta` key in the recorded traffic is `ahpd.`-prefixed, or is one of the reference's keys at the place the reference reads it, or is on a pending-rename list that p4 empties.

## Files

- `UPDATE: tools/wire.mjs` - `metaKeys(frame)` answers each `_meta` key with the path it was found at.
- `UPDATE: packages/sdk/test/wire.test.ts` - `REFERENCE` (key and path pattern, each with the `docs/AHP.md` or `UPSTREAM.md` line it comes from) and `PENDING` (today's unprefixed keys, each naming its p4 task); the traffic grows a skill with an argument hint and a result with cache writes and a cost.

## Steps

1. Walk a frame and collect `{ key, at }` for every `_meta` object, with array indices folded as the checker folds them.
2. Allow a key that starts with `ahpd.`, `vscode.`, `anthropic/` or `agentHost/`, and the reference keys by path, so `argumentHint` passes on a completion item and not on a skill. `ahpd.grants` is one of the `ahpd.`-prefixed keys this allows and needs no entry of its own.
3. `PENDING` holds what the traffic shows today, at least `owner`, `sender`, `model`, `argumentHint` on a skill, `cacheWriteTokens`, `cost`; the test fails on a key in neither list and on a `PENDING` entry that no longer occurs.
4. Export `metaKeys` so the backend usage tests and the changeset tests run the same census over what they emit.

## Validation

- `pnpm exec vitest run packages/sdk/test/wire.test.ts` passes, fails when an action gains `_meta: { invented: 1 }`, and fails when a `PENDING` entry is no longer sent.
- `pnpm test` passes.

## Resume
