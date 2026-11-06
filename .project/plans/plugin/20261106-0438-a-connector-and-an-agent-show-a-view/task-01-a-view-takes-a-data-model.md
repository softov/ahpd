---
title: A view takes a data model
status: implemented
depends: []
layer: "sdk"
refs:
  - "[code://packages/sdk/src/types/plugin.ts#L810-L866](../../../../packages/sdk/src/types/plugin.ts#L810-L866) - `ViewComponent` and `PluginView`, which gain the bindings and the data model"
  - "[code://packages/sdk/src/plugins/view.ts#L41-L187](../../../../packages/sdk/src/plugins/view.ts#L41-L187) - `literalOf`, which refuses `{ path }`, and `checkView`"
  - "[code://packages/server/src/pluginschannel.ts#L96-L130](../../../../packages/server/src/pluginschannel.ts#L96-L130) - `shownIn`, which translates a literal `text` or `label`"
  - git://48639b22 - #248's `checkUi`, whose binding rules move into `checkView`
---

## Objective

A view, on any surface, may carry a `dataModel`, and its props may bind to `{ path }` in it.
`checkView` is the one check, and #248's `checkUi` and `UiSchema` are gone.

## Files

- `UPDATE: packages/sdk/src/types/plugin.ts` - `PluginView` gains `dataModel`; a prop may be `{ path }` and `children` may be `{ path, componentId }`; `UiComponent` and `UiSchema` go.
- `UPDATE: packages/sdk/src/plugins/view.ts` - `checkView` takes the binding rules of `checkUi` and checks the data model; `checkUi` goes.
- `UPDATE: packages/sdk/src/index.ts` - the exports of `UiSchema` and `checkUi` go.
- `UPDATE: packages/sdk/src/plugins/validate.ts` - nothing calls `checkUi` now.
- `UPDATE: packages/server/src/pluginschannel.ts:96-130` - a bound `text` or `label` is sent as it is, and only a literal is translated.
- `UPDATE: packages/sdk/test/plugin-view.test.ts` - the binding cases of `checkUi` move to `checkView`, with the data model cases.
- `UPDATE: packages/server/test/plugins-channel.test.ts` - a bound text is not translated.

## Steps

1. Add `dataModel?: Record<string, unknown>` to `PluginView`.
2. Write in its doc that a `{ path }` prop reads its value from `dataModel`.
3. Let a prop of `ViewComponent` be a literal or `{ path }`.
4. Let `children` be a list of ids or `{ path, componentId }`.
5. Remove `UiComponent` and `UiSchema`.
6. Move the binding rules of `checkUi` into `checkView`.
7. Keep the Button rule of `checkView`: its event names a method that the same plugin registered.
8. Check that `dataModel` is a JSON object.
9. Count `dataModel` in the 64 KiB of the view.
10. Remove `checkUi`, its export, and `literalOf` when nothing calls it.
11. Make `shownIn` send a bound `text` or `label` as it is.

## Validation

- `plugin-view.test.ts`: a view with `{ path }` props and a data model passes.
- `plugin-view.test.ts`: a list that repeats a known `componentId` over a path passes.
- `plugin-view.test.ts`: `checkView` refuses an unknown `componentId`, a binding with another member, an unknown kind and a cycle.
- `plugin-view.test.ts`: `checkView` refuses a data model that is not an object, and a view with its data over 64 KiB.
- `plugin-view.test.ts`: a Button whose event names a registered method passes in a view with bindings.
- `plugins-channel.test.ts`: the row has a literal text in the reader's locale, and a bound text as the plugin wrote it.
- `pnpm typecheck` passes.
- `pnpm exec vitest run packages/sdk/` and `pnpm exec vitest run packages/server/` pass, one at a time.

## Resume

Done. `PluginView` has `dataModel`, and a prop may be `{ path }`.
`children` may be `{ path, componentId }`, and a Link's `href` may be a `{ path }`.
`checkView` holds the binding rules of `checkUi`, checks that `dataModel` is an object, and counts it in the 64 KiB.
`checkUi`, `literalOf`, `UiComponent` and `UiSchema` are removed.
`VIEW_SURFACES` in `view.ts` lists the surfaces, `main` now, for every check of a surface.

Verified: `plugin-view.test.ts` passes 30 tests, and `plugins-channel.test.ts` passes 48.

Found: `shownIn` already translates only a string `text` or `label`, so it needed no change, and the test proves it.
