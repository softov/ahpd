---
title: A disabled plugin describes itself
domain: plugin
status: built
priority: medium
created: 2026-10-25
revalidated: 2026-10-25
requires:
  - plans/plugin/64-an-admin-installs-a-plugin-from-the-ui/plan.md
refs:
  - "[code://packages/sdk/src/types/plugin.ts#L604-L626](../../../../packages/sdk/src/types/plugin.ts#L604-L626) - `PluginSpec`, where `name` is the module specifier"
  - "[code://packages/sdk/src/types/plugin.ts#L1258-L1290](../../../../packages/sdk/src/types/plugin.ts#L1258-L1290) - the `Plugin` interface, with the `manifest` and `optionsSchema` exports"
  - "[code://packages/server/src/config.ts#L767](../../../../packages/server/src/config.ts#L767) - `asSpec`, which reads one entry of the `plugins` list"
  - "[code://packages/server/src/install.ts#L414-L435](../../../../packages/server/src/install.ts#L414-L435) - `editEntry`, which every entry change goes through"
  - "[code://packages/server/src/plugins.ts#L60-L103](../../../../packages/server/src/plugins.ts#L60-L103) - `nameOf`, `pluginIdOf` and the id read with no import"
  - "[code://packages/server/src/plugins.ts#L319-L361](../../../../packages/server/src/plugins.ts#L319-L361) - `readManifest`, the package.json `ahpd` field read with no import"
  - "[code://packages/server/src/plugins.ts#L955-L1040](../../../../packages/server/src/plugins.ts#L955-L1040) - where a load reads the `manifest` and `optionsSchema` exports"
  - "[code://packages/server/src/plugins.ts#L1660-L1700](../../../../packages/server/src/plugins.ts#L1660-L1700) - `describePlugin`, which returns before it reads a disabled plugin's manifest"
  - "[code://packages/server/src/pluginschannel.ts#L150-L200](../../../../packages/server/src/pluginschannel.ts#L150-L200) - `schemaFor` and the row, which send a manifest only from the loaded copy"
  - "[code://docs/plugins/PLUGINS.md#L1075-L1135](../../../../docs/plugins/PLUGINS.md#L1075-L1135) - the manifest section of the author's guide"
  - file:///github/ahp-review/briefs/plugin-details.md - the brief this plan comes from
---

## Goal

A client shows what a disabled plugin is, what it provides and which options it takes, before an admin enables it.
An admin can also set its options before it runs.
Every plugin has a manifest that the daemon reads with no import.
A plugin from a package keeps package.json as its manifest.
A standalone plugin gets its manifest from a `plugin.json` or from its own config entry.

## Reconnaissance

The files read and the patterns to reuse are the `refs` above, each with its note.

### Searches performed

- `git grep -l "export const optionsSchema" -- 'packages/*/src/*.ts'` - eleven first-party plugins export a schema: activepieces, agent-acp, agent-claude, agent-cofold, agent-pi, bot, computer, push, tasks, tunnel-devtunnel and webhook.
- `git grep -n "optionsSchema.properties" -- packages` - agent-cofold and agent-pi read their own schema in code, to build a records schema.
- `git grep -l "export const manifest" -- packages` - only two server test fixtures export a manifest. No first-party plugin does.
- `git grep -c manifest -- 'packages/server/test/*.ts'` - eleven test files and nine fixtures name a manifest.

### Runtime path

```
config.json plugins entry -> asSpec -> describePlugin (no import) -> manifest and schema -> plugins channel row -> ahpw plugin page
```

### Gaps

- A disabled row holds only its spec, its id and its state.
- The channel sends no options schema for a disabled plugin, so a value set before an enable is masked and not checked.
- A single file with no package.json, and a spec with a scheme, have no manifest without an import.
- In a config entry, `name` is the module specifier, so the entry has no place for a display name.

## Answers

| What | Source | Task |
| --- | --- | --- |
| In a config entry, `source` replaces `name` as the module specifier, and `name` is the display name | Softov, 2026-10-25: "in plugin config we change name to source" | 01 |
| An entry with `name` and no `source` is read as the old form, and the daemon writes `source` the next time the entry changes | Softov, 2026-10-25 | 01 |
| A bare string in `plugins` stays, as shorthand for `{ "source": "<string>" }` | (defaulted: a package name needs nothing else) | 01 |
| A standalone plugin needs a declarative manifest, and a bare `.ts` or `.js` file with none fails with a clear error | Softov, 2026-10-25 | 02 |
| A standalone plugin is a file that sits in no package with an `ahpd` field, or a spec with a scheme | (defaulted: the two cases the brief found) | 02 |
| `source` can name a `plugin.json`, whose `main` names the file to run | Softov, 2026-10-25 | 02 |
| A config entry can hold the manifest itself, as `{ id, name, version, source, enabled }` | Softov, 2026-10-25 | 02 |
| A `plugin.json` and an inline entry take the same keys as the `ahpd` field, plus `id`, `name` and `version` | (defaulted: one manifest shape) | 02 |
| A standalone plugin's id is its manifest's `id`, and a module whose `name` export differs is refused at load | Softov, 2026-10-25 | 02 |
| The module's `manifest` export goes | (defaulted: a standalone manifest is now declarative) | 02 |
| A disabled row carries the manifest the daemon reads with no import, and so does an enabled plugin that failed to load | (defaulted: the goal) | 03 |
| The options schema is a JSON Schema in the manifest, at `ahpd.optionsSchema` in package.json and `optionsSchema` in a standalone manifest | Softov, 2026-10-25: "New `ahpd.optionsSchema`" | 04 |
| `ahpd.options` and its `required` flags go, because the schema's `required` list says the same | Softov, 2026-10-25: "New `ahpd.optionsSchema`" | 04 |
| The module's `optionsSchema` export goes, and a module that still exports one is refused with an error that says where it moves | Softov, 2026-10-25: "Remove it"; refusal (defaulted: a silent ignore hides the move) | 04 |
| A first-party plugin that reads its own schema in code imports its package.json with `with { type: 'json' }` | (defaulted: the schema stays in one place) | 04 |

## Proposed architecture

- **Data flow** - the daemon reads a manifest from package.json, a `plugin.json` or the config entry, with no import. The row and the options commands read the manifest and its schema from there.
- **State flow** - a row's state is as it is today. Only the fields it carries change.
- **Layer responsibilities** - sdk: the plugin types. server: the entry reader, the manifest reader, the load checks and the channel row. Each first-party package: its schema in package.json. docs: PLUGINS.md.
- **Source-of-truth files** - [`code://packages/server/src/plugins.ts`](../../../../packages/server/src/plugins.ts), [`code://packages/sdk/src/types/plugin.ts`](../../../../packages/sdk/src/types/plugin.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - `source` names the module in a config entry](task-01-source-names-the-module.md) | done | - |
| [02 - A standalone plugin has a manifest](task-02-a-standalone-plugin-has-a-manifest.md) | done | 01 |
| [03 - A disabled row carries its manifest](task-03-a-disabled-row-carries-its-manifest.md) | done | 02 |
| [04 - The options schema is in the manifest](task-04-the-options-schema-is-in-the-manifest.md) | done | 03 |

## Risks and tradeoffs

- A third-party plugin that exports `optionsSchema` or `manifest` stops loading - the error names the manifest key to move it to, and PLUGINS.md says so.
- A single-file plugin with no manifest stops loading. The error names the `plugin.json` and the entry, and PLUGINS.md's scratch example shows the manifest it needs.
- ahpw reads `row.spec.name` - the ahpw plan after this one reads `source`, and the old `name` stays readable until then.
- `ahpd plugin` commands still import a disabled package plugin to learn its id - a standalone plugin needs no import, because its manifest names the id.

## Resume state

- **Done so far:** All four tasks are implemented. An entry names its module with `source`, and an old `name` entry still loads and is rewritten at its next change. A standalone plugin declares its manifest in a `plugin.json` or in its entry, with `id`, `name` and `version` beside the manifest keys. A module's `manifest` export is refused. A standalone plugin with no manifest is refused at load, and a listing reports the same line with no import. A `plugin.json` beside a file the spec names is read for it. A disabled row carries the manifest read with no import, and the plugins channel answers its options schema and masks a secret option. The options schema is `ahpd.optionsSchema` in every first-party `package.json` and `optionsSchema` in a standalone manifest. The module export and `ahpd.options` are refused, and the loader checks options against the manifest schema. The gate passed on 2026-10-25: typecheck, build and boundary are clean. `pnpm -s test` gave 7012 passed and 29 skipped, with one timeout in `packages/computer/test/computer-plugin.test.ts`. It passed alone (23 tests) when rerun.
- **Next action:** none. The plan is built, and `implemented.md` says what exists.
- **Open questions:** none.
- **Watch out for:** A row must never carry an option value that the schema marks as a secret. A disabled plugin now has a schema, so the mask applies to it too. A `plugin.json` beside a file is read for any bare file in that folder, so a folder holding several modules needs one folder each.

## Final verification checklist

- [x] A disabled plugin's row shows its title, version, manifest and options schema, with no import of its module.
- [x] `x-ahpd/plugins/options` checks a value against a disabled plugin's schema.
- [x] An old entry with `name` loads, and is written back with `source` at its next change.
- [x] A bare file with no manifest is refused, with an error that names `plugin.json` and the entry. A listing reports the same line with no import.
- [x] A scheme spec is tested with a `data:` URI: one with an inline manifest loads under its id, and one without is refused.
- [x] The eleven first-party plugins load with their schema in package.json.
- [x] `plans/index.md` updated.
