---
title: A plugin declares a schema for its options, and the loader checks it
domain: plugin
status: built
priority: medium
created: 2026-09-28
revalidated: 2026-09-28
requires:
  - plans/daemon/08-the-config-file-is-checked-in-one-place/plan.md
refs:
  - "[code://packages/sdk/src/types/plugin.ts#L210-L230](../../../../packages/sdk/src/types/plugin.ts#L210-L230) - `Plugin`: `name`, `title`, `defaults`, `apply`, and no schema"
  - "[code://packages/server/src/plugins.ts#L408-L434](../../../../packages/server/src/plugins.ts#L408-L434) - the loader merges `defaults` under the named options and calls `apply` with them unchecked"
  - "[code://packages/agent-acp/src/plugin.ts#L30-L93](../../../../packages/agent-acp/src/plugin.ts#L30-L93) - `optionsOf`: hand checks that drop a mistyped key and throw for a missing `command`"
  - "[code://packages/agent-pi/src/plugin.ts](../../../../packages/agent-pi/src/plugin.ts) - its own `optionsOf`"
  - "[code://packages/agent-cofold/src/plugin.ts](../../../../packages/agent-cofold/src/plugin.ts) - its own `optionsOf`"
  - "[code://packages/agent-claude/src/plugin.ts](../../../../packages/agent-claude/src/plugin.ts) - its own `optionsOf`"
  - "[code://.project/decisions/plugin-contract-lives-in-the-sdk.md](../../../decisions/plugin-contract-lives-in-the-sdk.md) - the contract is the SDK's, and the SDK imports no `@cofold/*`"
  - npm://@cofold/commands@^0.2.2 - `check`, which the server already uses
---

## Goal

A plugin exports a JSON Schema for its options beside its `defaults`, and the daemon checks the configured options against it before `apply` runs.
A plugin whose options fail is reported with its name, the key and what was expected, and the daemon starts without it.
The hand-written option parsing in each plugin goes.

## Reconnaissance

The files read are the `refs` above.

### Searches performed

- `rg -l "optionsOf" packages/*/src` - agent-acp, agent-claude, agent-cofold and agent-pi each parse their options by hand; computer and tunnel-devtunnel read them inline.

### Runtime path

```
config plugins[i].options -> loader merges defaults -> apply(host, values) -> the plugin's optionsOf drops or throws
```

### Gaps

- A mistyped option is dropped silently by most plugins, and a missing required one throws from `apply` with each plugin's own sentence.

## Decisions locked in

No decision records of its own; the choices below are scope.

| What | Source | Task |
| --- | --- | --- |
| Options that fail the plugin's schema report and skip that plugin, like every other plugin failure | Softov, 2026-09-28, asked "When a plugin declares a schema for its options and the configured options fail it:": "Report and skip it" | 01 |
| The schema is a plain JSON Schema object exported as `optionsSchema`, typed in the SDK without importing `@cofold/*` | [decision plugin-contract-lives-in-the-sdk](../../../decisions/plugin-contract-lives-in-the-sdk.md); (defaulted: the export name) | 01 |
| An unknown option key warns, as an unknown daemon key does | [decision an-unknown-config-key-warns-and-starts](../../../decisions/an-unknown-config-key-warns-and-starts.md) | 01 |

## Proposed architecture

- **Data flow** - the loader reads `optionsSchema` from the module, checks the merged values with `check(values, schema, 'plugins.<name>.options')`, and calls `apply` only when they pass.
- **Layer responsibilities** - sdk: the `optionsSchema` member of `Plugin`. server: the check. Each plugin: its schema, and `apply` reading typed values.
- **Source-of-truth files** - [`code://packages/sdk/src/types/plugin.ts`](../../../../packages/sdk/src/types/plugin.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - The loader checks a declared options schema](task-01-the-loader-checks-the-schema.md) | done | - |
| [02 - Each shipped plugin declares its schema](task-02-each-plugin-declares-its-schema.md) | done | 01 |

## Risks and tradeoffs

- A plugin without `optionsSchema` keeps working unchecked, so third-party plugins are not broken.

## Resume state

- **Done so far:** tasks 01 and 02 done 2026-09-28 (`c3c23d6`), checked by Softov; see [implemented.md](implemented.md).
- **Next action:** none.
- **Open questions:** none.
- **Watch out for:** `ahpd plugin list` imports nothing, so it cannot check options; only a load does.

## Final verification checklist

- [x] `{ "name": "@ahpd/agent-acp", "options": { "command": 3 } }` is reported naming the plugin and `command`, and the daemon starts with its other backends.
- [x] `docs/PLUGINS.md` documents `optionsSchema`.
- [x] `pnpm typecheck`, `pnpm boundary` and the full `pnpm test` clean.
- [x] `plans/index.md` updated.
