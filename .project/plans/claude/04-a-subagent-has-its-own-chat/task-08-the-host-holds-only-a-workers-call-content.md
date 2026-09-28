---
title: The host holds a call's content only while a worker needs it
status: implemented
depends: []
layer: "sdk"
refs:
  - "[code://packages/sdk/src/host.ts#L838-L846](../../../../packages/sdk/src/host.ts#L838-L846) - `turnsOf` and `callContent`, the side index"
  - "[code://packages/sdk/src/host.ts#L1826-L1848](../../../../packages/sdk/src/host.ts#L1826-L1848) - `dispatch`, which writes `callContent` for every tool call of every session"
  - "[code://packages/sdk/src/host.ts#L3728-L3738](../../../../packages/sdk/src/host.ts#L3728-L3738) - session disposal, which deletes only the worker keys"
---

## Objective

The host's `callContent` index holds the content of spawning calls only, and forgets each one when its worker chat or its session goes, so a long-running daemon does not keep every tool output it ever relayed.

## Files

- `CREATE: packages/sdk/src/calllinks.ts` - `createCallLinks()`, the index that today is inline in `host.ts`, with a `size` getter a test reads.
- `UPDATE: packages/sdk/src/host.ts:838-846` - `turnsOf` and `callContent` move into the index.
- `UPDATE: packages/sdk/src/host.ts:1841-1848` - today every `chat/toolCallContentChanged` and every `chat/toolCallComplete` with content is kept, for any call.
- `UPDATE: packages/sdk/src/host.ts:2880-2887` - `openSubagent` reads and writes the index.
- `UPDATE: packages/sdk/src/host.ts:3728-3738` - disposal clears the session's keys, lead chat included.
- `CREATE: test/calllinks.test.ts`.

## Steps

1. Move `turnsOf`, `callContent` and `aboutCall` into `createCallLinks()` in `calllinks.ts` unchanged, and have `host.ts` use it; the existing tests stay green.
2. In `dispatch`, remember a call as a spawning call when its `chat/toolCallStart` or `chat/toolCallReady` carries `_meta.toolKind: 'subagent'` (what `kinds.ts` sets for `Task` and `Agent`), and keep content only for remembered calls.
3. Drop a call's entry when its worker chat is removed or its session is disposed, and drop the lead chat's `turnsOf` entry on disposal.
4. Comments on the index say what it holds and for which calls, nothing about how it came to be.

## Validation

- `test/calllinks.test.ts`: record 100 completions with a 1 MB text result for ordinary calls and one start with `_meta.toolKind: 'subagent'`, expect `size` 1; forget the worker, expect 0. Against the rule in the tree today (step 1 alone) it holds 101 and fails.
- `test/subagent-chat.test.ts` stays green: the fake's `toolCallStart` for `toolu_task` must now carry `_meta: { toolKind: 'subagent' }`, as the Claude backend's does, or the link has nothing to append to.
- `pnpm typecheck`, `pnpm boundary` green.

## Resume

Built `packages/sdk/src/calllinks.ts`, `createCallLinks()`, which holds each chat's open turn and the content of spawning calls only, recognised by `_meta.toolKind: 'subagent'` on their start or ready action or by a link written onto them.
`host.ts` feeds it from `dispatch` and forgets a chat's entries when the session is disposed, lead chat included, and when a secondary chat is closed with `removeChat`.
`packages/sdk/test/calllinks.test.ts` failed first against the moved rule (100 held instead of 1) and passes now; the fake in `packages/sdk/test/subagent-chat.test.ts` carries `_meta: { toolKind: 'subagent' }` on `toolu_task`.
Gates: `pnpm typecheck` and `pnpm boundary` clean, `pnpm test` 107 files and 1506 tests passed.
