---
title: copapo is a shipped ACP agent
status: implemented
depends: []
layer: "sdk, agent-acp, computer"
refs:
  - "[code://packages/sdk/src/machines/agents.ts](../../../../packages/sdk/src/machines/agents.ts) - `knownAgents`"
  - "[code://packages/agent-acp/src/presets.ts](../../../../packages/agent-acp/src/presets.ts) - `presets`, `xdgOf` and `stateOf`"
  - "[code://packages/computer/images/versions.json](../../../../packages/computer/images/versions.json) - the parts"
---

## Objective

`knownAgents` has a `copapo` row, agent-acp ships a `copapo` preset that starts `copapo acp`, and a machine can install the `copapo` part.

## Files

- `UPDATE: packages/sdk/src/machines/agents.ts:184-211` - a `copapo` row beside `pi` and `dsh`.
- `UPDATE: packages/agent-acp/src/presets.ts:166-200` - a `copapo` preset beside `opencode`.
- `UPDATE: packages/computer/images/versions.json:115-131` - a `copapo` npm part beside `pi` and `dsh`.
- `CREATE: packages/computer/images/parts/copapo/package.json` - the npm part's lock input.
- `CREATE: packages/computer/images/parts/copapo/package-lock.json` - the npm part's lock, which `lockOf` requires.
- `UPDATE: packages/agent-acp/test/engine.test.ts:138-170` - the template count and the key-variable list.
- `UPDATE: packages/agent-acp/test/agent-acp-machine.test.ts:585` - the shipped row list and its expected machines.
- `UPDATE: packages/agent-acp/test/agent-acp-presets.test.ts` - a case for copapo's row.
- `UPDATE: packages/computer/test/computer-parts.test.ts:89` - the part ids and kinds.
- `UPDATE: docs/updates/v0_15.md` - one line under *Unreleased*, *Plugins*.

## Steps

1. Add the `copapo` row to `knownAgents`, with the name, command, install line, site and variables in *Answers*.
2. Mark `COPAPO_API_KEY` as `secret: true`, and the other variables `secret: false`.
3. Add the `copapo` preset: `...rowOf('copapo')`, `args: ['acp']`, and no `honoursTrust`.
4. Give the preset the machine of `xdgOf('copapo', ['config.json'])`, and add `COFOLD_HOME: '/ahpd/copapo/home'` to its `env`.
5. Add the `copapo` part to `versions.json`: `kind: npm`, `requires: ['node']`, `packages: ['@cofold/copapo@0.1.0']`, `bin: ['copapo']`.
6. Say in a comment beside the copapo preset that copapo ignores a client's MCP servers.
7. Update the tests that list the shipped rows and parts, and add the release note line.

## Validation

- An agent-acp case: the `copapo` preset starts `copapo` with `['acp']`, has no `honoursTrust`, and its machine names `/ahpd/copapo`.
- A computer case: the `copapo` part resolves to `@cofold/copapo@0.1.0`.
- `pnpm typecheck`, then the sdk, agent-acp and computer suites, one at a time.
- By hand: install `@cofold/copapo`, add a copapo agent, and send one turn in a trusted folder.

## Resume

- Done: the `copapo` row in `knownAgents`, the preset with `args: ['acp']` and the `COFOLD_HOME` machine, the npm part with its lock files, the four test files and the release note line.
- Done: the Answers rows for the company and for the MCP fact; the MCP fact is a comment beside the preset, and `KnownAgent` has no new field.
- Left: the by-hand validation (install `@cofold/copapo` and send a turn) is not mine and was not run.
- Left: `packages/computer/images/parts/copapo/` is untracked, and `git add` is denied here, so the commit cannot carry the two lock files.
- Left: `packages/sdk/test/fixtures/wire.jsonl` is dirty from the sdk suite, and every restore command is denied here; it is not in the commit.
- Found: `packages/computer/images/versions.json` names the package `@cofold/copapo`, not `@cofold/copapo@0.1.0` as step 5 says. `packages/sdk/test/agents.test.ts` requires the row's install line to contain the part's first package string, and `npm i -g @cofold/copapo` does not contain the pinned string. The part's own `version: "0.1.0"` still pins what a machine installs.
- Found: an npm part needs `packages/computer/images/parts/<id>/package.json` and `package-lock.json`, made by `node scripts/parts-bump.mjs --locks`; `lockOf` throws without them.
- Found: the sdk suite has two failures in `packages/sdk/test/host-permissions.test.ts` at lines 555 and 741, both `expected undefined to be 'not-needed'`. They are not this task's: this sandbox's `os.tmpdir()` is `/home/softov/.local/cache/tmp`, a dot-folder of the home, and `platformRestricted` always asks about a write under a dot-folder of the home, so both writes are asked about. Setting `TMPDIR` elsewhere is denied here, so the suite could not be run another way.

