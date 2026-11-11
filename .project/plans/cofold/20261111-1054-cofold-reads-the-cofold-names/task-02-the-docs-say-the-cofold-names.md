---
title: The docs say the cofold names
status: todo
depends:
  - task-01-the-harness-reads-the-cofold-names.md
layer: "docs"
refs:
  - "[code://packages/agent-cofold/README.md#L45-L47](../../../../packages/agent-cofold/README.md#L45-L47) - the harness file and variables, under copapo's names"
  - "[code://docs/plugins/PLUGINS.md#L2307-L2311](../../../../docs/plugins/PLUGINS.md#L2307-L2311) - the cofold section, which names copapo's files"
  - "[code://docs/plugins/COMPUTERS.md#L273-L282](../../../../docs/plugins/COMPUTERS.md#L273-L282) - a cofold machine's needs, with `copapo/config.json` and `COPAPO_CONFIG`"
  - "[code://docs/plugins/COMPUTERS.md#L639](../../../../docs/plugins/COMPUTERS.md#L639) - a credential seeded from `~/.config/copapo/config.json`"
  - "[code://docs/updates/v0_15.md#L23-L24](../../../../docs/updates/v0_15.md#L23-L24) - the two *Upgrading* lines of the papo move"
  - "[code://.project/specs/cofold-backend.md#L35](../../../../.project/specs/cofold-backend.md#L35) - the spec, which names copapo's file"
---

## Objective

The README, the plugin docs, the computers doc, the spec and the release notes say the cofold names.
A person who upgrades from papo's names is told where the file goes in one step, and to remake a cofold or copapo machine.

## Files

- `UPDATE: packages/agent-cofold/README.md:45-47` - the cofold file, project file and variables.
- `UPDATE: docs/plugins/PLUGINS.md:2307-2311` - the cofold names in the cofold section.
- `UPDATE: docs/plugins/COMPUTERS.md:273-282` - `cofold/config.json` and `COFOLD_CONFIG`.
- `UPDATE: docs/plugins/COMPUTERS.md:639` - `~/.config/cofold/config.json`.
- `UPDATE: docs/updates/v0_15.md:23-24` - the two *Upgrading* lines go from papo's names to the cofold names.
- `UPDATE: .project/specs/cofold-backend.md:35` - the cofold file.

## Steps

1. Change each copapo setting name in the README, `PLUGINS.md` and `COMPUTERS.md` to the cofold name.
2. Rewrite the first *Upgrading* line: move `~/.config/papo/config.json` to `~/.config/cofold/config.json`, and rename `PAPO_*` to `COFOLD_*`.
3. Rewrite the second *Upgrading* line: remake a cofold or copapo machine made before this release.
4. Correct the spec in place.
5. Run `node tools/schema.mjs` if a changed description feeds the schema, and keep `tools/` unchanged in git.

## Validation

- `git grep -n -E "COPAPO_|\.copapo\.json|config/copapo|copapo/config\.json" -- docs packages/agent-cofold/README.md .project/specs` finds nothing.
- `git grep -n -i "papo" -- docs/updates/v0_15.md` finds only the line that names the old papo names.
- `pnpm -s docs:build` passes.

## Resume

