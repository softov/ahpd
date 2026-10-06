---
title: The sdk builds every file URI with uriOf
status: todo
depends: [task-01-localpath-keeps-a-hash-and-a-question-mark.md]
layer: "sdk"
refs:
  - "[code://packages/sdk/src/fileuri.ts#L79](../../../../packages/sdk/src/fileuri.ts#L79) - `uriOf`"
  - "[code://packages/sdk/src/index.ts#L37](../../../../packages/sdk/src/index.ts#L37) - the exports"
  - "[code://packages/sdk/src/host/sessionmethods.ts#L907](../../../../packages/sdk/src/host/sessionmethods.ts#L907) - `localPath(asked ?? \`file://${dir}\`)`"
  - "[code://packages/sdk/src/terminals.ts#L250](../../../../packages/sdk/src/terminals.ts#L250) - a terminal's `cwd`"
  - "[code://packages/sdk/src/changes.ts#L498](../../../../packages/sdk/src/changes.ts#L498) - one of five changeset builders"
---

## Objective

Every `file:` URI the sdk sends is `uriOf(path)`, and the sdk exports `localPath` and `uriOf` for the agents.

## Files

- `UPDATE: packages/sdk/src/terminals.ts:250`, `packages/sdk/src/changes.ts:498,613,673,948`, `packages/sdk/src/nested.ts:336`, `packages/sdk/src/debuglogs.ts:92,98`, `packages/sdk/src/host/vscodemethods.ts:166,287`, `packages/sdk/src/host/lifecycle.ts:517`, `packages/sdk/src/host/handshake.ts:201`, `packages/sdk/src/host/facts.ts:72,172`, `packages/sdk/src/host/spawn.ts:766`, `packages/sdk/src/host/snapshots.ts:385` - `uriOf(...)`; today each is `` `file://${path}` ``, so a space is sent raw and a `#` cuts the path when it is read back.
- `UPDATE: packages/sdk/src/host/sessionmethods.ts:907` - the fallback is the directory itself, not a URI built to be read straight back.
- `UPDATE: packages/sdk/src/changes.ts:948` - the key deleted is built the way the key stored was.
- `UPDATE: packages/sdk/src/index.ts:37` - export `localPath` and `uriOf`.
- `UPDATE: packages/sdk/test/host-terminals.test.ts`, `packages/sdk/test/changes-uris.test.ts` - the cases below.

## Steps

1. Failing cases first: a terminal created in `<tmp>/C#/app` reports `cwd` `uriOf('<tmp>/C#/app')`; a session created in `<tmp>/C#/app` with no working directory given has its changeset's directory read as `<tmp>/C#/app` (today `<tmp>/C`).
2. Replace each builder one for one.
3. `rg -n '\`file://\$\{' packages/sdk/src` finds nothing.

## Validation

- The cases in step 1 fail on `e1c4ccc` and pass after.
- `pnpm exec vitest run packages/sdk`.

## Resume
