---
title: The harness reads the cofold names
status: todo
depends: []
layer: "agent-cofold, sdk, agent-acp, computer"
refs:
  - "[code://packages/agent-cofold/src/config.ts#L41-L107](../../../../packages/agent-cofold/src/config.ts#L41-L107) - the file, the resolver name, the project file and the variables"
  - "[code://packages/agent-cofold/src/agent.ts#L947-L1004](../../../../packages/agent-cofold/src/agent.ts#L947-L1004) - the machine needs that seed, mount and name the file"
  - "[code://packages/sdk/src/machines/agents.ts#L210-L223](../../../../packages/sdk/src/machines/agents.ts#L210-L223) - the copapo profile's variables"
  - "[code://packages/agent-acp/src/presets.ts#L107-L111](../../../../packages/agent-acp/src/presets.ts#L107-L111) - `xdgOf`, which ties the seeded folder to the preset id"
---

## Objective

agent-cofold reads `COFOLD_CONFIG`, `cofold/config.json`, `.cofold.json` and `COFOLD_*` alone, and a cofold machine gets `cofold/config.json` with `COFOLD_CONFIG`.
The copapo profile names the `COFOLD_*` variables, the copapo ACP preset seeds `~/.config/cofold/config.json`, and the copapo part runs the release that reads them.

## Files

- `UPDATE: packages/agent-cofold/src/config.ts:41-107` - `harnessConfigPath`, `harnessConfig` and `variable` read the cofold names; the comments say so.
- `UPDATE: packages/agent-cofold/src/agent.ts:72` - the comment on `computerConfigDir` names `COFOLD_CONFIG`.
- `UPDATE: packages/agent-cofold/src/agent.ts:881` - the comment names `.cofold.json`.
- `UPDATE: packages/agent-cofold/src/agent.ts:947-1004` - the seed target, the mount target and the variable are `cofold/config.json` and `COFOLD_CONFIG`.
- `UPDATE: packages/agent-cofold/src/plugin.ts:222` - the template description names `~/.config/cofold/config.json` and `.cofold.json`.
- `UPDATE: packages/sdk/src/machines/agents.ts:218-221` - the copapo profile names `COFOLD_BASE_URL`, `COFOLD_API_KEY`, `COFOLD_MODEL` and `COFOLD_CONFIG`.
- `UPDATE: packages/agent-acp/src/presets.ts:107-111` - `xdgOf` takes the config folder name apart from the part id.
- `UPDATE: packages/agent-acp/src/presets.ts:216` - the copapo preset seeds `~/.config/cofold/config.json`, under the part `copapo`.
- `UPDATE: packages/computer/images/versions.json:137` - the copapo part's version is the release with the cofold names.
- `UPDATE: packages/computer/images/parts/copapo/package.json` - the same version.
- `UPDATE: packages/computer/images/parts/copapo/package-lock.json` - the lock for that version.
- `UPDATE: tools/test-tmpdir.ts:46` - the comment names `~/.config/cofold/config.json`.
- `UPDATE: packages/agent-cofold/test/agent-cofold-config.test.ts` - the cases use the cofold file, project file and variables.
- `UPDATE: packages/agent-cofold/test/engine.test.ts` - the template description names the cofold file.
- `UPDATE: packages/sdk/test/agent-machine-needs.test.ts` - the machine needs name `cofold/config.json` and `COFOLD_CONFIG`.
- `UPDATE: packages/agent-acp/test/agent-acp-machine.test.ts:618-623` - the copapo machine seeds `~/.config/cofold/config.json`.
- `UPDATE: packages/agent-acp/test/engine.test.ts:144` - the key variable is `COFOLD_API_KEY`.
- `UPDATE: packages/server/test/schema-gaps.test.ts:194` - the test stubs `COFOLD_CONFIG`.

## Steps

1. Confirm that a `@cofold/copapo` release reads the cofold names, with `npm view @cofold/copapo versions`.
2. In `config.ts`, read `env['COFOLD_CONFIG']` and `<XDG>/cofold/config.json` in `harnessConfigPath`.
3. In `config.ts`, call `resolveConfig` with `name: 'cofold'` and `project: '.cofold.json'`.
4. In `config.ts`, read `COFOLD_${name}` alone in `variable`.
5. In `agent.ts`, set the seed target, the mount target and the need's variable to `cofold/config.json` and `COFOLD_CONFIG`.
6. Rewrite each comment that names a copapo file or variable, in `config.ts`, `agent.ts` and `tools/test-tmpdir.ts`.
7. Leave each comment that names copapo the program as it is.
8. Change the template description in `plugin.ts`.
9. Change the copapo profile's four variables in `machines/agents.ts`.
10. Give `xdgOf` a config folder name apart from the part id, and seed the copapo preset from `~/.config/cofold/config.json`.
11. Pin the copapo part to the release from step 1, in `versions.json`, its `package.json` and its lock.
12. Change each test named in *Files* to the cofold names.
13. Add a case that `COPAPO_BASE_URL` alone adds no provider.
14. Run the `git grep` in *Validation*, and change each hit that names a copapo setting.

## Validation

- `agent-cofold-config.test.ts`: the user file, the project file, `COFOLD_CONFIG` and `COFOLD_*`; `COPAPO_*` adds nothing.
- `agent-machine-needs.test.ts`: the cofold needs name `cofold/config.json` and `COFOLD_CONFIG`.
- `agent-acp-machine.test.ts`: the copapo machine seeds `~/.config/cofold/config.json` into `/ahpd/copapo`.
- `git grep -n -E "COPAPO_|\.copapo\.json|config/copapo|copapo/config\.json" -- packages tools` finds nothing.
- `pnpm typecheck` passes.
- `TMPDIR=/home/softov/tmp/ahpd-test npx vitest run packages/agent-cofold` passes, then `packages/agent-acp`, `packages/sdk`, `packages/computer` and `packages/server`, one at a time.

## Resume

