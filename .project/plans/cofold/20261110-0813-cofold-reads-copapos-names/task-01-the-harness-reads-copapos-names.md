---
title: The harness reads copapo's names
status: todo
depends: []
layer: "agent-cofold"
refs:
  - "[code://packages/agent-cofold/src/config.ts](../../../../packages/agent-cofold/src/config.ts) - the file, the resolver name, the project file and the variables"
  - "[code://packages/agent-cofold/src/agent.ts](../../../../packages/agent-cofold/src/agent.ts) - the machine needs that seed, mount and name the file"
---

## Objective

agent-cofold reads `COPAPO_CONFIG`, `copapo/config.json`, `.copapo.json` and `COPAPO_*` over `COFOLD_*`, and a machine gets `copapo/config.json` with `COPAPO_CONFIG`.

## Files

- `UPDATE: packages/agent-cofold/src/config.ts:41-107` - `harnessConfigPath`, `harnessConfig` and `variable` read copapo's names; the comments say copapo.
- `UPDATE: packages/agent-cofold/src/agent.ts:934-998` - the seed target, the mount target and the variable are `copapo/config.json` and `COPAPO_CONFIG`.
- `UPDATE: packages/agent-cofold/src/agent.ts:64` - the comment on `computerConfigDir` names `COPAPO_CONFIG`.
- `UPDATE: packages/agent-cofold/src/plugin.ts:222` - the template description names `~/.config/copapo/config.json` and `.copapo.json`.
- `UPDATE: packages/agent-cofold/src/mapping.ts:167` - the comment names copapo's `compactedNotice`.
- `UPDATE: packages/agent-cofold/src/turnagent.ts:68` - the comment names copapo.
- `UPDATE: tools/test-tmpdir.ts:46` - a test reads no `~/.config/copapo/config.json`.
- `UPDATE: packages/agent-cofold/test/agent-cofold-config.test.ts` - the cases use copapo's file, project file and variables.
- `UPDATE: packages/sdk/test/agent-machine-needs.test.ts` - the machine needs name `copapo/config.json` and `COPAPO_CONFIG`.
- `UPDATE: packages/server/test/schema-gaps.test.ts:194` - the test stubs `COPAPO_CONFIG`.
- `UPDATE: packages/agent-cofold/test/agent-cofold-modes.test.ts` - the papo paths become copapo's.
- `UPDATE: packages/agent-cofold/test/agent-cofold-turn.test.ts` - the papo paths become copapo's.
- `UPDATE: packages/agent-cofold/test/engine.test.ts` - the template description says copapo.
- `UPDATE: packages/agent-cofold/test/agent-cofold-compact.test.ts` - the papo paths become copapo's.
- `UPDATE: packages/agent-cofold/test/agent-cofold-usage.test.ts` - the papo paths become copapo's.
- `UPDATE: packages/agent-cofold/test/agent-cofold-models.test.ts` - the `put` helper writes `copapo/config.json`.

## Steps

1. In `config.ts`, read `env['COPAPO_CONFIG']` and `<XDG>/copapo/config.json` in `harnessConfigPath`.
2. In `config.ts`, call `resolveConfig` with `name: 'copapo'` and `project: '.copapo.json'`.
3. In `config.ts`, read `COPAPO_${name}` over `COFOLD_${name}` in `variable`.
4. In `agent.ts`, set the seed target, the mount target and the need's variable to `copapo/config.json` and `COPAPO_CONFIG`.
5. Rewrite each comment that names papo's file, variable or name, in `config.ts`, `agent.ts`, `mapping.ts` and `turnagent.ts`.
6. Leave each link to cofold's source at a commit as it is.
7. Change the template description in `plugin.ts`.
8. Point `tools/test-tmpdir.ts` at copapo's file.
9. Change each test named in *Files* to copapo's names, and add a case that `COPAPO_MODEL` wins over `COFOLD_MODEL`.
10. Run `git grep -n -i papo -- packages tools`, and change each hit that is not a link to a cofold commit.

## Validation

- `agent-cofold-config.test.ts`: the user file, the project file, `COPAPO_CONFIG`, and `COPAPO_*` over `COFOLD_*`.
- `agent-machine-needs.test.ts`: the cofold needs name `copapo/config.json` and `COPAPO_CONFIG`.
- `pnpm typecheck`, then `pnpm exec vitest run packages/agent-cofold`, then the sdk and server suites, one at a time.

## Resume

