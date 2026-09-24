---
title: A plugin contributes a session key
status: done
depends: []
layer: packages/sdk
refs:
  - "[code://packages/sdk/src/types/plugin.ts#L101-L140](../../../../packages/sdk/src/types/plugin.ts#L101-L140) - the `register*` methods, where this one goes"
  - "[code://packages/sdk/src/plugins.ts#L200-L260](../../../../packages/sdk/src/plugins.ts#L200-L260) - the per-plugin registration checks a new one follows"
  - "[code://packages/sdk/src/types/agent.ts#L151-L152](../../../../packages/sdk/src/types/agent.ts#L151-L152) - `Agent.schema()`, the schema this merges with"
  - "[code://packages/sdk/src/host.ts#L3051-L3072](../../../../packages/sdk/src/host.ts#L3051-L3072) - `published`, which every published schema passes through"
  - "[code://packages/sdk/src/host.ts#L2486](../../../../packages/sdk/src/host.ts#L2486) - `Start.settings`, the resolved config a backend receives"
  - "[code://packages/sdk/src/host.ts#L3014-L3020](../../../../packages/sdk/src/host.ts#L3014-L3020) - `settle`, where a new session's half is resolved"
  - "[code://test/plugin-host.test.ts](../../../../test/plugin-host.test.ts) - the fold and registration cases"
---

## Objective

`PluginHost` has `registerSessionConfig(key, schema)`, the host merges every registered key into the session schema it publishes and into the resolved values a backend receives in `Start.settings`, and a key a backend already declares is refused at the plugin boundary.

## Files

- `UPDATE: packages/sdk/src/types/plugin.ts` - `registerSessionConfig(key, schema)` with the contract in prose.
- `UPDATE: packages/sdk/src/plugins.ts` - the contribution list, the per-plugin duplicate check, and the cross-plugin duplicate check the way a scheme is checked.
- `UPDATE: packages/sdk/src/types/host.ts` - `HostOptions.sessionConfig?: Record<string, Record<string, unknown>>` or the shape the fold needs, so `createHost` can merge it.
- `UPDATE: packages/sdk/src/host.ts` - merge the contributed properties into the schema `published` returns, and into the defaults a session resolves, without the plugin learning how a session is stored.
- `UPDATE: test/plugin-host.test.ts` - registration, duplicate, and the collision with a backend's own key.
- `UPDATE: docs/PLUGINS.md` - the new registration in the list.

## Steps

1. Add the method and record a contribution per plugin, refusing a key the same plugin already registered.
2. Refuse a key across plugins with the same message shape a duplicate scheme uses, naming both.
3. Merge the contributed properties into the schema a session publishes, beside the backend's own, and leave the backend's own field untouched.
4. Merge the same keys into the values a new session resolves, so a client's choice arrives in `Start.settings` with the backend's defaults under it.
5. Refuse a contributed key the backend's own schema already declares, at the plugin boundary, naming both.

## Validation

- `test/plugin-host.test.ts` - a plugin registers a key and it is on the published schema; two plugins cannot register one; a key the backend declares is refused; the value a client sets arrives in `Start.settings`.
- `pnpm test`, `pnpm typecheck` and `pnpm boundary` green.
- `docs/PLUGINS.md` lists the registration.

## Resume

Not started.
`scope` and `sessionMutable` are the host's own fields on a schema property and are stripped by `published`; a contributed property gets the same treatment.
