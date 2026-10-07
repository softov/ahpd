---
title: A plugin can register what runs when the host closes
status: todo
depends: []
layer: "sdk"
refs:
  - "[code://packages/sdk/src/types/plugin.ts#L176](../../../../packages/sdk/src/types/plugin.ts#L176) - `PluginHost` gets `registerClose`"
  - "[code://packages/sdk/src/types/plugin.ts#L417](../../../../packages/sdk/src/types/plugin.ts#L417) - `Contribution` gets `closers`"
  - "[code://packages/sdk/src/plugins.ts#L548-L571](../../../../packages/sdk/src/plugins.ts#L548-L571) - the `register*` functions to copy"
  - "[code://packages/sdk/src/plugins.ts#L166](../../../../packages/sdk/src/plugins.ts#L166) - `foldHostOptions` collects the closers"
  - "[code://packages/sdk/src/host.ts#L857-L890](../../../../packages/sdk/src/host.ts#L857-L890) - `close` calls them"
---

## Objective

A plugin calls `host.registerClose(fn)` in `apply`.
`host.close()` calls every registered `fn` once, after the chats close and before the stores close.

## Files

- `UPDATE: packages/sdk/src/types/plugin.ts:176` - `registerClose(close: () => void | Promise<void>): void` on `PluginHost`, with a doc comment.
- `UPDATE: packages/sdk/src/types/plugin.ts:417` - `closers: (() => void | Promise<void>)[]` on `Contribution`.
- `UPDATE: packages/sdk/src/plugins.ts:548-571` - `registerClose` checks that it got a function and pushes it onto `contribution.closers`; the empty contribution starts with `closers: []`.
- `UPDATE: packages/sdk/src/plugins.ts:166` - `foldHostOptions` collects every contribution's closers, in load order, into `HostOptions.closers` as `{ by, close }`.
- `UPDATE: packages/sdk/src/types/host.ts` - `closers?: { by: string; close: () => void | Promise<void> }[]` on `HostOptions`, with a doc comment.
- `UPDATE: packages/sdk/src/host.ts:857-890` - after the chats close and before `the automation store`, run each closer as ``await step(`the plugin ${by}`, close)``.

## Steps

1. Add the types in `types/plugin.ts` and `types/host.ts`.
2. Add `registerClose` in `plugins.ts`. Refuse a value that is not a function, with the same `miss(...)` sentence form as the other `register*` functions.
3. Fold the closers in `foldHostOptions`.
4. Call them in `close`, one `step` each, in load order.
5. Add `registerClose` to every test double of `PluginHost` that typecheck finds.

## Validation

- `packages/sdk/test/plugins-close.test.ts` (new): a plugin registers two closers, and `HostOptions.closers` holds both with its name.
- The same file: `registerClose` refuses a value that is not a function.
- `packages/sdk/test/host-close.test.ts` (new): `close()` calls a closer once, after a chat's `close` and before `automations.close`.
- The same file: the host logs a closer that throws, and runs the next closer.
- The same file: a second `close()` does not call a closer again.
- `pnpm typecheck` from the root passes.

## Resume
