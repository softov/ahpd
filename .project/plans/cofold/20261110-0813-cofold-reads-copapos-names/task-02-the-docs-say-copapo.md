---
title: The docs say copapo
status: implemented
depends:
  - task-01-the-harness-reads-copapos-names.md
layer: "docs"
refs:
  - "[code://packages/agent-cofold/README.md#L45-L67](../../../../packages/agent-cofold/README.md#L45-L67) - the harness file and variables, under papo's names"
  - "[code://docs/plugins/PLUGINS.md#L2161-L2266](../../../../docs/plugins/PLUGINS.md#L2161-L2266) - the cofold section, which names papo"
  - "[code://docs/plugins/COMPUTERS.md#L273-L282](../../../../docs/plugins/COMPUTERS.md#L273-L282) - a cofold machine's needs, with `papo/config.json` and `PAPO_CONFIG`"
  - "[code://docs/plugins/COMPUTERS.md#L639](../../../../docs/plugins/COMPUTERS.md#L639) - a credential seeded from `~/.config/papo/config.json`"
  - "[code://docs/updates/v0_15.md](../../../../docs/updates/v0_15.md) - the release notes, with an *Upgrading* section under *Unreleased*"
  - "[code://.project/specs/cofold-backend.md#L34-L35](../../../../.project/specs/cofold-backend.md#L34-L35) - the spec, which names papo's file"
---

## Objective

The README, the plugin docs, the computers doc, the spec and the release notes say copapo.
A person who upgrades is told to move the file and remake a cofold machine.

## Files

- `UPDATE: packages/agent-cofold/README.md:45-67` - copapo's file, project file and variables.
- `UPDATE: packages/agent-cofold/package.json:155` - the `autoCompactAt` description says copapo.
- `UPDATE: docs/plugins/PLUGINS.md:2161-2266` - copapo's names in the cofold section.
- `UPDATE: docs/plugins/COMPUTERS.md:273-282` - `copapo/config.json` and `COPAPO_CONFIG`.
- `UPDATE: docs/plugins/COMPUTERS.md:639` - `~/.config/copapo/config.json`.
- `UPDATE: docs/updates/v0_15.md` - two lines under *Unreleased*, *Upgrading*.
- `UPDATE: .project/specs/cofold-backend.md:34-35` - copapo's file.

## Steps

1. Change each papo name in the README, `package.json`, `PLUGINS.md` and `COMPUTERS.md` to copapo's.
2. Add to *Upgrading*: move `~/.config/papo/config.json` to `~/.config/copapo/config.json`, and rename `PAPO_*` variables to `COPAPO_*`.
3. Add to *Upgrading*: remake a cofold machine made before this release.
4. Correct the spec in place.
5. Run `node tools/schema.mjs` if `package.json` feeds the schema, and keep `tools/` unchanged in git.

## Validation

- `git grep -n -i papo -- docs packages/agent-cofold/README.md packages/agent-cofold/package.json .project/specs` finds only links to cofold commits.
- `pnpm -s docs` or the docs build passes, if the repository has one.

## Resume

- The README, `package.json`, `PLUGINS.md` and `COMPUTERS.md` name copapo's file, project file and variables.
- The release notes say to move `~/.config/papo/config.json`, rename the variables and remake a cofold machine.
- The spec is corrected in place.
- `git grep -i papo` finds only the two release-note lines that name the old names, as step 2 requires.
- Validation passed: the docs build with `pnpm -s docs:build`, and the agent-cofold suite passes with 319 tests.

