---
title: References and owners are checked, and a plugin runs one automation
status: done
depends: [task-01-plugin-trigger-checked-on-save-and-fire.md]
layer: "sdk, server"
refs:
  - "[code://packages/sdk/src/types/plugin.ts#L1024](../../../../packages/sdk/src/types/plugin.ts#L1024) - `fireTrigger`, which carries no owner"
  - "[code://packages/sdk/src/host/automations.ts#L1002-L1007](../../../../packages/sdk/src/host/automations.ts#L1002-L1007) - `maySee`, the only owner check at a fire"
  - "[code://packages/sdk/src/host/automations.ts#L1384](../../../../packages/sdk/src/host/automations.ts#L1384) - `runAutomation`, the client command a plugin call can reuse"
  - "[code://packages/sdk/src/connectors/channel.ts](../../../../packages/sdk/src/connectors/channel.ts) - the connectors channel, where a put is checked"
  - "[code://packages/server/src/commands/run.ts#L685](../../../../packages/server/src/commands/run.ts#L685) - where the daemon builds the connectors channel and the automation store"
---

## Objective

A schema field can name a connector or an automation, and the host checks that the record exists and that the owners agree.
The owner rule is: both have the same owner, or the connector is the host's.
A plugin starts one automation by its id, and every fire carries the owner of the connector it came from.

## Files

- `UPDATE: packages/sdk/src/types/plugin.ts` - `runAutomation(id, data, owner)` on `PluginHost`, and an `owner` argument on `fireTrigger`.
- `UPDATE: packages/sdk/src/plugins/plugins.ts` - the two calls in `pluginHost`.
- `UPDATE: packages/sdk/src/host/automations.ts` - the owner rule at a fire and at a run.
- `UPDATE: packages/sdk/src/automations/automations.ts` - an `x-ahpd-connector` field is checked on save.
- `UPDATE: packages/sdk/src/connectors/channel.ts` - an `x-ahpd-automation` field is checked on put.
- `UPDATE: packages/server/src/commands/run.ts` - give each check the lookup it needs.
- `CREATE: packages/sdk/test/references.test.ts` - the cases below.

## Steps

1. Read `x-ahpd-connector: { adapter }` on a trigger config field as the id of a connector of that adapter.
2. Refuse a save whose field names no connector of that adapter, with the id named.
3. Refuse a save whose connector fails the owner rule against the automation's owner.
4. Read `x-ahpd-automation: true` on an adapter config field as the id of an automation.
5. Refuse a connector put whose field names no automation, or an automation that fails the owner rule.
6. Treat the automation owner `root:<host>` as the host when the owner rule compares.
7. Add `runAutomation(id, data, owner)` to `PluginHost`, which starts one run with `data` on its origin.
8. Refuse that run when the automation is off or fails the owner rule, and write a problem line.
9. Add the `owner` argument to `fireTrigger`, and run only the automations that pass the owner rule.
10. Keep the `maySee` check at both calls.
11. Give the store and the channel their lookups in `run.ts`.
12. Run the SDK and server tests, and set this task and the plan row to `implemented`.

## Validation

- `references.test.ts`: the host refuses to save an automation of `user:bob` whose trigger names a connector of `user:alice`.
- `references.test.ts`: the same automation saves when the connector is the host's.
- `references.test.ts`: the host refuses a put of a `user:alice` connector that names an automation of `user:bob`.
- `references.test.ts`: a fire with owner `user:alice` does not run an automation of `user:bob`.
- `references.test.ts`: `runAutomation` starts one run whose origin holds `data`, and only that automation runs.
- `pnpm -s build`, `pnpm -s typecheck` and `pnpm -s boundary` pass.

## Resume

- **Done so far:** `types/connectors.ts` has `ConnectorRef { id, adapter, owner? }`. `types/plugin.ts` gives `PluginTriggers.deliver` and `PluginHost.fireTrigger` an optional `owner`, adds `PluginTriggers.run` and `PluginHost.runAutomation(id, data, owner)`, and `plugins/plugins.ts` forwards both to the host. `automations/automations.ts` has `AutomationsOptions.connectors`, exported `sameOwnerOrHost` (a `host` connector matches anyone, `root:<host>` is treated as the host), and `checkReferences`, which reads `x-ahpd-connector: { adapter }` off each field of a trigger type's `configSchema`, refuses an id this host does not serve as that adapter, and refuses one whose owner fails the rule; `create` and `update` call it, `update` against the automation's stored owner. `host/automations.ts` skips a fire's automations the connector owner fails, and `runOne` resolves the named resource, applies the owner, off and `maySee` rules with one problem line each, then starts a run with origin `{ kind: 'trigger', triggerId, event: data }`; a missing automation is logged rather than started. `connectors/channel.ts` keeps a `known` map filled by every read of the collection and by put and remove, exposed as `refs()`, and `checkAutomationLinks` refuses a put whose `x-ahpd-automation` field names no automation or one the connector's owner may not start. `server/src/scheduled.ts` forwards `store` and checks references in its client-facing create and update only. `server/src/commands/run.ts` builds one automation store (memory or daemon) with the plugin types getter and `connectorLists.refs()`, keeps it in `automationsStore` for the connectors channel lookup, and fills `pluginTypes` after the fold. `references.test.ts` has the five cases: another person's connector refused at save, the host's accepted, a connector naming another person's automation refused through the host's put, a fire owned by alice not waking bob's automation, and `runAutomation` starting one run of the named automation only, with its data on the origin.
- **Next action:** task 03.
- **Open questions:** none.
- **Departures:** the reference check is synchronous, so the connectors channel keeps a snapshot (`refs()`) rather than the store awaiting the collection; the snapshot is filled by `stored()` on every listing and by this channel's own put and remove, and `run.ts` calls `openAll()` before serving clients. A definition restored from a file is not checked: `scheduledAutomations` checks references in its client-facing wrapper and its initial restore and reload call the inner store directly, because a connector may be loaded after the file is read. `runAutomation`'s `triggerId` is the first event trigger's id, and empty when the automation has no event trigger. This task could not be committed: `git add`, `git commit` and the wire fixture restore are denied by the running permission mode, and `packages/sdk/test/fixtures/wire.jsonl` is modified again by the suite.
- **Watch out for:** a connector owner is `host`, `team:<id>` or `user:<id>`, and an automation owner can also be `project:<id>` or `root:<host>`.
  A `project:` owner matches only the host's connectors.
