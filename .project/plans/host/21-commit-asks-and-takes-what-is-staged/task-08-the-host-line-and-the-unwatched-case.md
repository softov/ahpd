---
title: The host's turn_end line is two lines again, and the unwatched case counts tool calls
status: done
depends: [task-04-staging-elsewhere-reaches-the-changeset.md]
layer: "sdk"
refs:
  - "[code://packages/sdk/src/host.ts#L3114](../../../../packages/sdk/src/host.ts#L3114) - `turn:` and `status:` on their own lines"
  - "[code://packages/sdk/test/changes-refresh.test.ts#L205](../../../../packages/sdk/test/changes-refresh.test.ts#L205) - the unwatched case, which drives ten tool calls and ten writes"
---

## Objective

`host.ts` has no line the edit joined, and the unwatched case proves what task 04's Validation says: ten tool calls with nobody watching run no `git status`.

## Files

- `UPDATE: packages/sdk/src/host.ts:3114` - `turn:` and `status:` on their own lines, as before the edit.
- `UPDATE: packages/sdk/test/changes-refresh.test.ts:205` - the case below.

## Steps

1. Split the line.
2. In the unwatched case, emit ten `chat/toolCallComplete` through the backend's `emit`, as the tool-call case does, and keep the ten writes as a second case or in the same one.

## Validation

- The unwatched case with the `watchedIn` check removed from `refreshWatched` fails on the tool calls; restored, it passes.
- `git diff packages/sdk/src/host.ts` around the `turn_end` fire shows only the added trigger lines.
- `node_modules/.bin/vitest run packages/sdk/test/changes-refresh.test.ts` green.

## Resume

Implemented 2026-09-27. The `turn_end` fire in `host.ts` has `turn:` and `status:` on their own lines, so `git diff` around it shows only the tool-call trigger lines task 04 added. The unwatched case now emits ten `chat/toolCallComplete` through the backend's `emit`, each after a file write, before its ten `resourceWrite` calls, and asserts `calls.refresh` is 0 after each group.

Removing the `watchedIn` check from `refreshWatched` made the tool-call half fail with `expected 1 to be +0`; restored, the case passes. `changes-refresh.test.ts` has 13 cases green.
