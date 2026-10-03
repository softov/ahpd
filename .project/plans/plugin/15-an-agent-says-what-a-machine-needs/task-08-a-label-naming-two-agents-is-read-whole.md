---
title: Every label a listing reads is read by name, so a value holding a comma is read whole
status: todo
depends: []
layer: "computer"
refs:
  - "[code://packages/computer/src/runtime.ts#L527-L549](../../../../packages/computer/src/runtime.ts#L527-L549) - `labelsListed`, `agentsListed` and `disposableListed`, which split the `docker ps` `Labels` column on commas"
  - "[code://packages/computer/src/runtime.ts#L602-L620](../../../../packages/computer/src/runtime.ts#L602-L620) - `list`, where the same split feeds the agents, the disposable profile, the dev container folder and `claimedBy`"
  - "[code://packages/computer/src/runtime.ts#L436-L448](../../../../packages/computer/src/runtime.ts#L436-L448) - `claimedBy`, the owner, team and project labels"
  - "[code://packages/computer/src/runtime.ts#L703](../../../../packages/computer/src/runtime.ts#L703) - where `ahpd.agents` is written with the agents joined by commas"
  - "[code://packages/computer/test/fixtures/docker.mjs#L71-L99](../../../../packages/computer/test/fixtures/docker.mjs#L71-L99) - the fake's `ps`, which always answers `{{json .}}` with one joined `Labels` column"
---

## Objective

A machine labelled `ahpd.agents=claude,cofold` is offered to both agents' pickers, and every other label a listing reads (the disposable profile and its alone flag, the dev container folder, the owner, team and project) comes back whole whatever it holds.
Today `labelsListed` splits the `Labels` column on `,`, the same character the agents are joined with, so every agent after the first is lost; a dev container folder whose path holds a comma is cut the same way.
The host's own check reads `inspect` and is right.

## Files

- `UPDATE: packages/computer/test/fixtures/docker.mjs:71-99` - first: `ps` honours a `--format` other than `{{json .}}`, rendering `{{.Names}}`-style fields and `{{.Label "<key>"}}` for each key asked, as Docker does, and lists a label value holding commas.
- `UPDATE: packages/computer/src/runtime.ts:527-549` - one reader for a listing row that asks `docker ps` for each label ahpd reads by name in its `--format` (`ahpd.agents`, `ahpd.disposable`, `ahpd.disposable.alone`, the dev container folder, `ahpd.owner`, `ahpd.team`, `ahpd.project`), so no value is split by the column's separator.
- `UPDATE: packages/computer/src/runtime.ts:602-620` - `list` builds the row from that reader; `agentsSaid` still splits the one `ahpd.agents` value on commas.
- `UPDATE: packages/computer/test/computer-needs.test.ts`, `packages/computer/test/computer-devcontainer.test.ts` - the cases below.

## Steps

1. Change the fake first, so the test can tell a by-name read from a split.
2. Keep the label keys in one list beside the `MACHINE_*` constants, so a label added later (the session label from `plugin/16` task 07) is read by adding it there.
3. `namedByFolder` filters by label and reads `Names` only, so it is left as it is.

## Validation

- `packages/computer/test/computer-needs.test.ts`: a profile with `agents: ["claude", "cofold"]` is listed for cofold; today `list()` answers `["claude"]` for it and the case fails.
- `packages/computer/test/computer-devcontainer.test.ts`: a dev container whose folder holds a comma is listed with that folder whole, so the picker does not offer a second `devcontainer://` row for it.
- `pnpm typecheck` green.

## Resume
