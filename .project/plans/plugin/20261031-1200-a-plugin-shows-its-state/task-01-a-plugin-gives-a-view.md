---
title: A plugin gives a view
status: implemented
depends: []
layer: sdk
refs:
  - "[code://packages/sdk/src/types/plugin.ts#L799-L851](../../../../packages/sdk/src/types/plugin.ts#L799-L851) - `Alert`, `alert` and `clearAlert`"
  - "[code://packages/sdk/src/plugins/plugins.ts#L895-L907](../../../../packages/sdk/src/plugins/plugins.ts#L895-L907) - the loader options `alert` and `clearAlert`"
  - "[code://packages/sdk/src/plugins/plugins.ts#L1184-L1185](../../../../packages/sdk/src/plugins/plugins.ts#L1184-L1185) - the plugin host passes them on"
  - "[code://packages/sdk/src/plugins/plugins.ts#L1488-L1496](../../../../packages/sdk/src/plugins/plugins.ts#L1488-L1496) - `registerMethod` and `contribution.methods`"
  - "[code://packages/sdk/src/host/canvases.ts#L144-L155](../../../../packages/sdk/src/host/canvases.ts#L144-L155) - the URL check to share"
  - npm://@softov/scena@^0.5.16 - `A2uiCreateSurface` in `core/converters/a2ui-v0.10.ts`, the shape of a view
---

## Objective

`PluginHost` gets `showView(view, surface)` and `clearView(surface)`, with `main` as the default surface.
The sdk checks a view before it goes to the loader's sink, and refuses one that a client cannot draw.
A view has the shape of scena's `A2uiCreateSurface`, so a later plan adds bindings with no change of shape.

## Files

- `UPDATE: packages/sdk/src/types/plugin.ts:799-851` - add `PluginView`, `ViewComponent`, `ViewSurface`, `showView` and `clearView`, with their docs.
- `CREATE: packages/sdk/src/plugins/view.ts` - `checkView(view, surface, by, methods)` and `literalOf(value)`, which throw an error that names the rule.
- `CREATE: packages/sdk/src/weburl.ts` - `isWebUrl(text)`, the check of an absolute http(s) URL with a host.
- `UPDATE: packages/sdk/src/host/canvases.ts:144-155` - use `isWebUrl`.
- `UPDATE: packages/sdk/src/plugins/plugins.ts:895-907` - add the loader options `showView` and `clearView`.
- `UPDATE: packages/sdk/src/plugins/plugins.ts:1184-1185` - check the view, then pass it to `options.showView`.
- `UPDATE: packages/sdk/src/index.ts` - export `PluginView`, `ViewComponent` and `ViewSurface`.
- `CREATE: packages/sdk/test/plugin-view.test.ts` - the cases of this task.
- `UPDATE: docs/plugins/PLUGINS.md:874` - add a section on `showView` and `clearView` after `alert`.

## Steps

1. Add `PluginView` as `{ root: string; components: Record<string, ViewComponent> }`, the shape of `A2uiCreateSurface` without `dataModel`.
2. Add `ViewComponent` as `{ id, component, child?, children?, action?, [prop]: unknown }`.
3. Add `ViewSurface` as the type of a surface name, with the one value `main`.
4. Add `showView(view, surface)` and `clearView(surface)` to `PluginHost`, next to `clearAlert`, with `surface` default `main`.
5. Move the URL check of `canvases.ts` into `isWebUrl`, and call it there.
6. In `checkView`, refuse a surface that is not `main`.
7. Refuse a component name that is not in the set of the plan's *Answers*.
8. Refuse a key that is not the component's `id`, and a `root` that is not a key.
9. Refuse a `child` or a `children` entry that names no component.
10. Refuse a component that two parents name, and a cycle from `root`.
11. Refuse more than 200 components, or more than 64 KiB of JSON.
12. Read each prop other than `id`, `component`, `child`, `children` and `action` through `literalOf`.
13. In `literalOf`, refuse an object with a `path` key, and say that bindings come in a later plan.
14. Refuse a Link whose `href` fails `isWebUrl`.
15. Refuse an `action` that is not `{ event: { name, context? } }`.
16. Refuse an event `name` that is not in the plugin's `contribution.methods`.
17. Refuse a `context` that is not a plain JSON object.
18. In the plugin host, call `checkView` with the surface and the plugin's methods, then `options.showView`.
19. Pass `clearView` and its surface to `options.clearView`.
20. Add a test for each refusal of steps 6 to 17.
21. Add a test that a good view and a clear reach the loader's sinks with the surface `main`.
22. Add a test that a call with no surface uses `main`.
23. Add a test that a canvas with a bad URL is still refused.
24. Document the calls, the surface, the components, the limits and the Button in `PLUGINS.md`.

## Validation

- `pnpm vitest run packages/sdk/test/plugin-view.test.ts` passes.
- `pnpm vitest run packages/sdk/test` passes, with the canvas tests.
- `pnpm typecheck` is clean.

## Resume

Built on 2026-10-31, and not committed: `git add` is refused in this session, and `git commit` cannot name a file that git does not track yet.
The sdk has `showView` and `clearView` on `PluginHost`, and the loader's options `showView` and `clearView`.
`checkView` and `literalOf` are in `packages/sdk/src/plugins/view.ts`, and `isWebUrl` is in `packages/sdk/src/weburl.ts`.
`packages/sdk/test/plugin-view.test.ts` holds 19 cases, and the sdk suite passes.
`docs/plugins/PLUGINS.md` says what a view is, after the section on `alert`.
Files to commit: `packages/sdk/src/types/plugin.ts`, `packages/sdk/src/plugins/view.ts`, `packages/sdk/src/weburl.ts`, `packages/sdk/src/host/canvases.ts`, `packages/sdk/src/plugins/plugins.ts`, `packages/sdk/src/index.ts`, `packages/sdk/test/plugin-view.test.ts` and `docs/plugins/PLUGINS.md`.