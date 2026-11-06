---
title: Every schema a client draws names every value
domain: host
status: built
priority: high
created: 2026-10-26
revalidated: 2026-10-26
refs:
  - "[code://packages/sdk/src/plugins/validate.ts#L88](../../../../packages/sdk/src/plugins/validate.ts#L88) - `checkAgent`, which takes an agent's `schema()`"
  - "[code://packages/sdk/src/plugins/validate.ts#L549](../../../../packages/sdk/src/plugins/validate.ts#L549) - `checkTriggerType`, which takes a `configSchema`"
  - "[code://packages/sdk/src/plugins/validate.ts#L609](../../../../packages/sdk/src/plugins/validate.ts#L609) - `checkAdapter`, which takes an adapter's `schema` and each capability's `input`"
  - "[code://packages/sdk/src/plugins/validate.ts#L664](../../../../packages/sdk/src/plugins/validate.ts#L664) - `checkEngine`, which takes an engine's `schema`"
  - "[code://packages/sdk/src/plugins/plugins.ts#L1347](../../../../packages/sdk/src/plugins/plugins.ts#L1347) - `registerSessionConfig`, which takes a session config property"
  - "[code://packages/server/src/plugins.ts#L1987](../../../../packages/server/src/plugins.ts#L1987) - where the host keeps a manifest's `optionsSchema`"
  - "[code://packages/sdk/src/host/sessionmethods.ts#L1500](../../../../packages/sdk/src/host/sessionmethods.ts#L1500) - where each backend's session config schema reaches a client"
  - "[code://packages/server/src/commands/options.ts#L753](../../../../packages/server/src/commands/options.ts#L753) - `configSchema`, the host's own config"
  - "file:///github/scena/PENDING.md - the scena half: a map editor, and JSON text for a value it cannot draw"
---

## Goal

A client draws a form from each schema the host sends: plugin options, engine records, connectors, action inputs, triggers and session config.
Today many of these schemas have an object with no properties, an array with no items, or a field with no type.
scena then draws "No parameters defined." or `[object Object]`, and an edit can destroy the value.
This plan adds one check that every entry point runs, fixes every first-party schema, and adds a test that walks them all.
A third-party plugin with a gap gets a problem line that names the plugin and the path.

## Reconnaissance

The files read and the patterns to reuse are the `refs` above, each with its note.

### Searches performed

- A walk of each first-party plugin's `optionsSchema`, and of what its `apply` registers with a stub host, on 2026-10-26.
- A walk of the host's `configSchema`, `mcpServerSchema` and `proxySchema`, on the same day.
- cofold 0.3.0 types `additionalProperties` as a boolean, but `check` accepts a schema there and copies each value without a check.

### Runtime path

```
plugin registers a schema -> host check -> host keeps it -> channel row or resolveSessionConfig -> client draws the form -> edit -> host checks the value
```

### Gaps

The walk found these, and the tasks fix each one.

| Where | Path | Gap |
| --- | --- | --- |
| agent-claude engine | `env`, `extraArgs` | object with no properties and no value schema |
| agent-claude engine | `models` | array with no items, and its entries mix three shapes |
| agent-acp engine | `machine.env{*}`, `machine.copy`, `machine.part`, `machine.state`, `machine.seed` | no type |
| agent-cofold options and engine | `adapter`, `policy` | an object that holds functions, which JSON cannot carry |
| computer options | each field of `profiles{*}` | no type |
| activepieces action inputs | 226 fields in 14 pieces | ARRAY with no items; OBJECT, JSON and DYNAMIC with no properties |
| host config | `shellEnv`, `modelProxy.models`, `mcpServers` | object with no properties and no value schema |
| host proxy | `models` | object with no properties and no value schema |

agent-pi, bot, push, tasks, tunnel-devtunnel and webhook have no gap.
A backend makes its session config schema at run time.
Only the check in task 01 and the test in task 05 can walk it.

## Answers

| What | Source | Task |
| --- | --- | --- |
| Every place where config enters the host checks its schema, not only the engines | Softov, 2026-10-26: "all places that handles config. in fact need that check" | 01 |
| A schema gap is an object with neither `properties` nor `additionalProperties`, an array with no `items`, or a field with keywords and no `type`, `enum`, `const` or union | Softov, 2026-10-26: "We also need a task to resolve that" | 01 |
| An empty schema `{}` is a value of any JSON shape, and is not a gap | (defaulted: JSON Schema reads `{}` as any value, and scena draws it as JSON text) | 01 |
| A gap is a problem line that names the plugin and the path, and the load continues | (defaulted: an unknown icon mark is a problem line too, and refusing would stop a third-party plugin that works) | 01 |
| A Claude record lists models as `models: [{ id, name? }]` and fetches as `modelSources: [{ fetch, match?, key? }]`, each list one shape | Softov, 2026-10-26: "Two lists" | 02 |
| A stored record with the mixed `models` list is rewritten into the two lists once at start | Softov, 2026-10-26: "Rewrite at start" | 02 |
| cofold's `adapter` and `policy` leave both cofold schemas, and stay options for an embedder | (defaulted: each holds functions, which no form and no JSON file can carry) | 03 |
| An activepieces ARRAY prop has the item schema of its own props, or `{ type: 'string' }` when it has none | (defaulted: Activepieces lists a string when an ARRAY prop has no props) | 03 |
| An activepieces OBJECT or DYNAMIC prop takes `additionalProperties: {}`, and a JSON prop is `{}` | (defaulted: the piece gives no shape for these values) | 03 |
| The host's own maps get `additionalProperties` through a local type in ahpd, and the host checks each value | (defaulted: solved in ahpd, with no cofold release) | 04 |
| A `writeOnly` value at any depth, in a list entry or a map value, moves to the vault. An empty list key keeps its secret only while its entry is unchanged. A host agent may name a `host:` secret | Softov, 2026-10-27: "Vault every writeOnly field" | 02 |

## Proposed architecture

- **Data flow** - one function in the sdk, `schemaGaps(schema)`, returns the path and the gap of each one it finds.
- **Event flow** - each entry point calls it when the plugin registers the schema. `resolveSessionConfig` calls it once for each backend.
- **Layer responsibilities** - sdk: the function and the calls. Each plugin package: its own schema. server: the host's own config.
- **Source-of-truth files** - [`code://packages/sdk/src/plugins/validate.ts`](../../../../packages/sdk/src/plugins/validate.ts).

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - Every schema entry point checks for gaps](task-01-every-schema-entry-point-checks.md) | done | - |
| [02 - Claude lists models and model sources apart](task-02-claude-lists-models-and-sources.md) | done | 01 |
| [03 - The first-party plugin schemas have no gap](task-03-plugin-schemas-have-no-gap.md) | done | 01 |
| [04 - The host config names its maps](task-04-the-host-config-names-its-maps.md) | done | 01 |
| [05 - A test walks every first-party schema](task-05-a-test-walks-every-schema.md) | done | 01, 02, 03, 04 |

## Risks and tradeoffs

- The `env` and `extraArgs` fixes do not change the screen until scena draws `additionalProperties`. That is in scena's PENDING.md.
- cofold does not check a map value, so task 04 must keep the host's own check of each value.
- `mcpServers` checks each entry on its own on purpose, so one bad server does not stop a start. A map schema must not change that.

## Resume state

- **Done so far:** tasks 01 to 05 implemented on 2026-10-27. `schemaGaps` and `gapLine` are in the sdk, and every entry point walks what it is given. The first-party schemas and the host's maps name every value. `packages/server/test/schema-gaps.test.ts` walks all of them. After the review, a `writeOnly` value at any depth moves to the vault.
- **Next action:** none. The plan is built, and `implemented.md` says what exists.
- **Open questions:** none.
- **Watch out for:** a gap in a third-party plugin is a warning line only. Never refuse its load for a gap.

## Final verification checklist

- [x] The test of task 05 passes, and fails when one fix is removed.
- [ ] By hand: ahpw draws each field of a Claude record, a computer profile and an activepieces action.
- [x] `plans/index.md` updated.
