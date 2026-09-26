---
title: A label naming two agents is read whole
status: todo
depends: []
layer: "computer"
refs:
  - "[code://packages/computer/src/runtime.ts#L453-L470](../../../../packages/computer/src/runtime.ts#L453-L470) - `labelsListed` and `agentsListed`, which split the `docker ps` Labels column on commas"
  - "[code://packages/computer/src/runtime.ts#L614](../../../../packages/computer/src/runtime.ts#L614) - where `ahpd.agents` is written with the agents joined by commas"
  - "[code://test/fixtures/docker.mjs](../../../../test/fixtures/docker.mjs) - the fake, which never lists a label with more than one agent"
---

## Objective

A machine labelled `ahpd.agents=claude,cofold` is offered to both agents' pickers.
Today `labelsListed` splits the `docker ps` Labels column on `,`, the same character the agents are joined with, so every agent after the first is lost and the machine is hidden from cofold's picker; the host's own check reads `inspect` and is right.

## Files

- `UPDATE: packages/computer/src/runtime.ts:453-470` - the listing reads each label ahpd needs by name.
- `UPDATE: test/fixtures/docker.mjs` - `ps` renders `{{.Label "<key>"}}` and lists a label holding commas the way Docker does.
- `UPDATE: test/computer-needs.test.ts` - the case below.

## Steps

1. Ask `docker ps` for each label by name in its `--format` (`{{.Label "ahpd.agents"}}` and the others `labelsListed` feeds), so no value is split by the column's separator.
2. Keep one reader for the listing; `agentsSaid` still splits the one value on commas.

## Validation

- `test/computer-needs.test.ts`: a profile with `agents: ["claude", "cofold"]` is listed for cofold; today `list()` answers `[["claude"]]` and the case fails.
- `pnpm typecheck` green.

## Resume
