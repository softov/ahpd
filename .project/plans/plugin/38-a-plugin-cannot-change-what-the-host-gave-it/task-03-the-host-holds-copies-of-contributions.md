---
title: The host holds copies of what a plugin contributes
status: todo
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

- Plugin A registers plugin B's trigger type after load: refused, and A's `fireTrigger` for it starts nothing.
- A plugin that deletes `writeOnly` from its kept `optionsSchema` throws, and `plugin list` still masks the secret.
- A plugin that renames its tool's `definition.name` after load throws or changes nothing on the wire.
- A plugin that changes `agent.provider` after load changes nothing in session metering.
- `npx vitest run` passes.

## Resume
