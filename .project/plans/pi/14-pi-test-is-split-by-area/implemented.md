---
title: agent-pi.test.ts is split into one test file per area - implemented
date: 2026-10-04
refs:
  - "[code://packages/agent-pi/test/fake-pi.ts](../../../../packages/agent-pi/test/fake-pi.ts) - the fake pi and the helpers the pi test files share"
---

`packages/agent-pi/test/agent-pi.test.ts` went from 2,165 lines to 669, and its other cases are four files of their own.

## What was built

- `test/fake-pi.ts` - the `beforeAll` that loads pi, `root` and its hooks, and the helpers two or more files read.
- `agent-pi.test.ts` keeps the schema, models, session, agent and plugin cases; `agent-pi-tools.test.ts`, `agent-pi-asking.test.ts`, `agent-pi-mapping.test.ts` and `agent-pi-disk.test.ts` hold the rest, none over 400 lines.
- `00-pi.md` lists the new files; `agent-pi-fork.test.ts`'s comment names `agent-pi-disk.test.ts`.

## Verified

- A pure move: the same 125 test names before and after, and every line of the old file in the new ones.
- `pnpm exec tsc --noEmit`, `pnpm boundary`, `pnpm test` pass.

## Departures from the plan

- The before-and-after name list was kept as an md5 rather than a file, because the build's shell could not write one.

## Left for later

- `00-pi.md` lists the files this plan made, not the six other pi test files that were never listed.
- The tasks stay `implemented` until Softov reviews them.
