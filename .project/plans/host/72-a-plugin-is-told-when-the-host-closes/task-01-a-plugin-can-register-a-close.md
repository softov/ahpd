---
title: A plugin can register what runs when the host closes
status: done
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

- `PluginHost.registerClose(close)` sits after `registerRoute` and before `on`. A second call is kept rather than refused, because a plugin with two things to stop is the ordinary case.
- `Contribution.closers` is required, the way `events` is, so every hand-built contribution names it. Nine contribution literals in `plugin-host.test.ts` and one helper in `plugin-fold.test.ts` gained `closers: []`.
- The check is inline in `plugins.ts` beside the recording, the way `registerSessionConfig`'s check is, because `miss` is already imported there. It answers `plugin <name>: registerClose needs close to be a function`.
- `foldHostOptions` keeps the base's own closers first and then appends each plugin's in load order, as `{ by, close }`. The key stays absent when nothing registered one.
- `close` runs them after the wait on the sessions and terminals, and before the automation store, one `step` each. A failure is logged as `closing the plugin <name> failed: <reason>`.
- Tests: `packages/sdk/test/plugins-close.test.ts` is new. It folds two closers from one plugin, in order, each with the plugin's name. It keeps a base's own first, leaves the key absent when none registered, and refuses a value that is not a function.
- Tests: `packages/sdk/test/host-close.test.ts` already existed, so the three cases went into its `Host.close` group. They check the order `chat, alpha, beta, automations, sessions`, a closer that throws logged while the next still runs, and a second `close()` that calls none again.
- `pnpm typecheck` from the root passes.
