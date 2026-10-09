---
title: The host holds copies of what a plugin contributes
status: done
depends: [task-01-a-principal-cannot-be-changed.md]
layer: "sdk, server"
refs:
  - "[code://packages/sdk/src/plugins.ts#L176-L402](../../../../packages/sdk/src/plugins.ts#L176-L402) - `foldHostOptions`"
  - "[code://packages/sdk/src/plugins.ts#L660-L680](../../../../packages/sdk/src/plugins.ts#L660-L680) - `registerTriggerType` and `fireTrigger`"
  - "[code://packages/sdk/src/host/automations.ts#L912-L918](../../../../packages/sdk/src/host/automations.ts#L912-L918) - `fired`"
  - "[code://packages/server/src/plugins.ts#L957](../../../../packages/server/src/plugins.ts#L957) - `optionsSchema` kept live"
---

## Objective

What a plugin registers is copied when it registers or at the fold, and a later write by the plugin changes nothing the host reads.
A plugin cannot register after `apply` returns, and cannot fire a trigger type that is not its own.

## Files

- `UPDATE: packages/sdk/src/plugins.ts` - the fold builds the host's own trigger table (type, definition copy, owner, `deliver`) instead of keeping `PluginTriggers`; tool definitions, session-config schemas and trigger definitions are `frozenCopy`; each agent's `provider` is read once and the host uses that string.
- `UPDATE: packages/sdk/src/plugins.ts` - every `register*` after `apply` returns throws a plugin error, the same words for each.
- `UPDATE: packages/sdk/src/host/automations.ts:912-918` - `fired(by, type, ...)` drops a type whose owner is not `by`, with a problem line.
- `UPDATE: packages/server/src/plugins.ts:957` - `schemas.set` stores `frozenCopy(optionsSchema)`.
- `UPDATE: packages/sdk/test/plugin-boundary.test.ts` - the cases below.

## Steps

1. Write the tests below; they fail.
2. Move the host's writes (`deliver`) to its own table, then copy at each site.
3. Refuse late registration; check the owner in `fired`.
4. Run the full suite.

## Validation

- Plugin A registers plugin B's trigger type after load: refused, and A's `fireTrigger` for it throws rather than starting nothing.
- A plugin that deletes `writeOnly` from its kept `optionsSchema` throws, and `plugin list` still masks the secret.
- A plugin that renames its tool's `definition.name` after load throws or changes nothing on the wire.
- A plugin that changes `agent.provider` after load changes nothing in session metering.
- `npx vitest run` passes.

## Resume

Implemented 2026-10-08. `pluginHost` answers a `HostRecording` with `seal()`, and `packages/server/src/plugins.ts`'s `loadOne` calls it the moment `apply` settles: every `register*` after that throws one sentence, which is the same mistake in each. The fold stops keeping the plugin's own objects. Agents go through a new `keptAgent` (a frozen descriptor copy with `provider` read once off the plugin's agent), tools through `keptTool` (a frozen copy of the definition, and of `effects` where there is one, because `run` is a function and cannot be copied), session-config schemas and trigger definitions through `frozenCopy`.

The trigger table is the host's own. For each contribution the fold builds a `PluginTriggers` entry holding a frozen copy of every definition that plugin kept, points `contribution.triggers` at it, and `deliver` is set on that entry by `automations.ts` and never on the plugin's object - `registerTriggerType` and `fireTrigger` read `contribution.triggers` at call time, so a fire goes through the host's record of the plugin. A plugin that lost every name is pointed at an empty entry of the host's own, so a fire of the name it lost throws rather than going nowhere in silence (see the review round below, which is where that was fixed). `packages/server/src/plugins.ts`'s `schemas` now holds `frozenCopy(optionsSchema)` rather than the module's object.

Tests: five new cases in `packages/sdk/test/plugin-boundary.test.ts` (a late registration of each kind is refused; a type lost to another plugin starts no run while the holder's fire still starts one; a tool definition renamed after registration; an agent's `provider` renamed after registration; a session-config schema rewritten after registration). Server side, `packages/server/test/fixtures/plugin-after/index.ts` is new - it keeps the host it was handed on `globalThis` and exports an `optionsSchema` with a `writeOnly` key - with a case in `plugin-load.test.ts` for the seal and one in `server-root-config.test.ts` for the copy (a plugin that deletes `writeOnly` from the schema it exports changes nothing a served answer says, and the host's copy is frozen).

The owner check in `automations.ts`'s `fired` moved into `pluginType(type)`, which now answers the holder and the definition together; the pre-existing `watchFor` call site reads `.definition` off it.

Verified: `npx vitest run packages/sdk/test/plugin-boundary.test.ts packages/server/test/plugin-load.test.ts packages/server/test/server-root-config.test.ts` - 18, 17 and 45 passed. The plugin and trigger suites (13 files) - 160 passed.

**Review round, 2026-10-08.** Two findings, both in this task's sites.

`keptAgent` copied the agent's own property descriptors into a frozen object, which is what a backend written as a class is not: `schema`, `defaults` and `create` are on the prototype, so the fold's own `agent.schema()` call threw `TypeError: agent.schema is not a function` on the first class-based agent it met - and a method that keeps state in `this` would have thrown too, against a frozen copy. It is now `Object.create(agent, { provider: { value: agent.provider, enumerable: true } })`: a view whose one own property is the pinned `provider`, which is non-writable and non-configurable, so the plugin's later rename and a rename of the copy both change nothing the host reads. The copy is deliberately not frozen - freezing the view freezes shadows of the plugin's own fields and would refuse a backend that writes to `this`. `kept the provider a plugin registered its agent under` gained the note that the copy is unfrozen, and `keeps the methods of an agent written as a class` is new: a class backend folded through `pluginHost` still answers `schema`, `defaults` and `create`, its `noted()` method increments `this.tally` twice, and both directions of the rename are refused.

The second: a plugin whose every trigger type lost to another hit the `Object.keys(kept).length === 0` `continue` before `contribution.triggers` was replaced, so it still held the record it registered in, `fireTrigger` found the name, and the fire went nowhere in silence - where this host's answer, to this plugin, is that it holds no such type. That branch now points the contribution at an empty entry of the host's own (`types: Object.freeze({})`) without pushing it into `pluginTriggers`, which stays the host's list of the types it will arbitrate. `refuses a type another plugin already has, and a fire of it is refused too` is the case, and it failed before the fix (the loser's fire returned in silence); it also still asserts the holder's fire starts a run.
