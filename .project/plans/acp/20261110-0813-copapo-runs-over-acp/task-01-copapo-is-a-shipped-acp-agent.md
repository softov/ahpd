---
title: copapo is a shipped ACP agent
status: todo
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
- `UPDATE: packages/agent-acp/test` - the case that names every shipped row, and a case for copapo's row.
- `UPDATE: docs/updates/v0_15.md` - one line under *Unreleased*, *Plugins*.

## Steps

1. Add the `copapo` row to `knownAgents`, with the name, command, install line, site and variables in *Answers*.
2. Mark `COPAPO_API_KEY` as `secret: true`, and the other variables `secret: false`.
3. Add the `copapo` preset: `...rowOf('copapo')`, `args: ['acp']`, and no `honoursTrust`.
4. Give the preset the machine of `xdgOf('copapo', ['config.json'])`, and add `COFOLD_HOME: '/ahpd/copapo/home'` to its `env`.
5. Add the `copapo` part to `versions.json`: `kind: npm`, `requires: ['node']`, `packages: ['@cofold/copapo@0.1.0']`, `bin: ['copapo']`.
6. Say in the row's description that copapo ignores a client's MCP servers.
7. Update the tests that list the shipped rows and parts, and add the release note line.

## Validation

- An agent-acp case: the `copapo` preset starts `copapo` with `['acp']`, has no `honoursTrust`, and its machine names `/ahpd/copapo`.
- A computer case: the `copapo` part resolves to `@cofold/copapo@0.1.0`.
- `pnpm typecheck`, then the sdk, agent-acp and computer suites, one at a time.
- By hand: install `@cofold/copapo`, add a copapo agent, and send one turn in a trusted folder.

## Resume

