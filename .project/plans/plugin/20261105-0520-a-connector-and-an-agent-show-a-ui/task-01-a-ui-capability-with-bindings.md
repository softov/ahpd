---
title: A ui capability with bindings
status: dropped
depends: []
layer: "sdk"
refs:
  - "[code://packages/sdk/src/types/connectors.ts#L27-L55](../../../../packages/sdk/src/types/connectors.ts#L27-L55) - `CapabilityType` and `Capability`, which gain the schema"
  - "[code://packages/sdk/src/types/agents.ts#L105-L151](../../../../packages/sdk/src/types/agents.ts#L105-L151) - `Engine`, which gains `capabilities`"
  - "[code://packages/sdk/src/types/plugin.ts#L820-L870](../../../../packages/sdk/src/types/plugin.ts#L820-L870) - `ViewComponent` and `PluginView`, the shape a schema takes"
  - "[code://packages/sdk/src/plugins/view.ts#L41-L140](../../../../packages/sdk/src/plugins/view.ts#L41-L140) - `literalOf` and `checkView`, which the schema check reuses"
  - "[code://packages/sdk/src/plugins/validate.ts#L801-L860](../../../../packages/sdk/src/plugins/validate.ts#L801-L860) - `checkAdapter`, which checks each capability"
  - "[code://packages/sdk/src/plugins/plugins.ts#L1927-L1945](../../../../packages/sdk/src/plugins/plugins.ts#L1927-L1945) - `registerAdapter` and `registerEngine`"
  - "[code://packages/sdk/src/agents/engines.ts#L26](../../../../packages/sdk/src/agents/engines.ts#L26) - the engine row, which sends the capabilities"
---

## Objective

An adapter and an engine declare a `ui` capability that carries a schema: A2UI components whose props may bind to paths of a data model.
The host checks the schema at registration, and sends it with the adapter row and the engine row.

## Files

- `UPDATE: packages/sdk/src/types/plugin.ts:820-870` - add `UiSchema`, `{ root, components }`, beside `PluginView`; a prop may be `{ path }`, and `children` may be `{ path, componentId }`.
- `UPDATE: packages/sdk/src/types/connectors.ts:27-55` - `Capability` gains `ui?: UiSchema`, on a `ui` capability only; the `ui` type is no longer reserved.
- `UPDATE: packages/sdk/src/types/agents.ts:105-151` - `Engine` gains `capabilities?: Capability[]`, the same type an adapter has.
- `UPDATE: packages/sdk/src/plugins/view.ts:41-140` - add `checkUi`, which runs the rules of `checkView` and lets a prop be `{ path }` and a list repeat one component over a path.
- `UPDATE: packages/sdk/src/plugins/validate.ts:801-860` - `checkAdapter` checks a `ui` capability's schema with `checkUi`, and refuses `ui` on another type; add the same capability check for an engine.
- `UPDATE: packages/sdk/src/plugins/plugins.ts:1937` - `registerEngine` runs the engine's capability check.
- `UPDATE: packages/sdk/src/agents/engines.ts` - the engine row sends `capabilities` whole, as the adapter row does.
- `UPDATE: packages/sdk/src/index.ts` - export `UiSchema` and `checkUi`.
- `UPDATE: packages/sdk/test/plugin-view.test.ts` - the schema cases.
- `UPDATE: packages/sdk/test/plugin-validate.test.ts` - the registration cases.
- `UPDATE: packages/sdk/test/engines-channel.test.ts` - the engine row sends its capabilities.

## Steps

1. Add `UiSchema` to `types/plugin.ts` with the same component shape as `PluginView`.
2. Write `UiSchema`'s doc: a prop is a literal or `{ path }`, and a list repeats `componentId` over the items at `path`.
3. Add `ui?: UiSchema` to `Capability`, and write that only a `ui` capability carries it.
4. Add `capabilities?: Capability[]` to `Engine`.
5. Write in its doc that the host reads only `ui` on an engine now.
6. Add `checkUi(schema, by, where)` to `view.ts`, which reuses the kinds, the limits, the references and the tree walk of `checkView`.
7. In `checkUi`, accept a prop that is `{ path: string }`, and refuse any other object with a `path`.
8. In `checkUi`, accept `children` as `{ path, componentId }` when `componentId` names a component, and walk that component as a child.
9. In `checkUi`, refuse an `action`, because Buttons that run actions wait for a later plan.
10. Leave `checkView` and `literalOf` as they are, so a plugin view stays literal.
11. In `checkAdapter`, check each `ui` capability's `ui` with `checkUi`, and refuse a `ui` member on a capability of another type.
12. Add the same capability check for an engine, and call it from `registerEngine`.
13. Send `capabilities` on the engine row.
14. Export the new type and the check.

## Validation

- `plugin-view.test.ts`: a schema with `{ path }` props passes.
- `plugin-view.test.ts`: a list over a path with a known `componentId` passes.
- `plugin-view.test.ts`: `checkUi` refuses an unknown `componentId`, a `path` with other members, an `action`, an unknown kind and a cycle.
- `plugin-view.test.ts`: `checkView` still refuses `{ path }`.
- `plugin-validate.test.ts`: an adapter and an engine with a good `ui` capability register.
- `plugin-validate.test.ts`: the check refuses a bad schema and names the adapter or engine and the capability.
- `plugin-validate.test.ts`: the check refuses `ui` on an `action` capability.
- `engines-channel.test.ts`: the engine row carries the engine's capabilities.
- `pnpm --filter @ahpd/sdk test` and `pnpm typecheck` pass.

## Resume

