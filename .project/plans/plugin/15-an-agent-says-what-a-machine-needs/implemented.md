---
title: An agent says what a machine needs, and the machine is made with it - implemented
date: 2026-10-03
refs:
  - "[code://packages/computer/src/manifest.ts](../../../../packages/computer/src/manifest.ts)"
  - "[code://packages/computer/src/runtime.ts](../../../../packages/computer/src/runtime.ts)"
  - "[code://packages/sdk/src/host.ts](../../../../packages/sdk/src/host.ts)"
  - "[code://packages/agent-cofold/src/agent.ts](../../../../packages/agent-cofold/src/agent.ts)"
---

An agent declares what a machine needs, a profile names the agents it prepares for, the machine is made with those needs and labelled with them, and a session is refused at creation, at a pre-turn change and at an automation's start when policy or the machine's agents label says no.

## What was built

- `packages/sdk/src/types/machine.ts`, `packages/sdk/src/machine.ts` - the need type and `resolveNeeds`, which refuses a relative or missing host path (tasks 01, 02, 10).
- [`code://packages/computer/src/manifest.ts`](../../../../packages/computer/src/manifest.ts) - needs resolved at create; `oneMountEach` treats identical entries as one and refuses a target two different mounts land at, across plugin, profile, body, needs, copy-ins and the folder (task 09).
- [`code://packages/computer/src/runtime.ts`](../../../../packages/computer/src/runtime.ts) - needs applied to `docker run`, flags emitted once each, labels read as `{{json .Labels}}` so a value with a tab or newline is read whole, and a failed command printed without any `-e` value (tasks 03, 08, 09).
- [`code://packages/sdk/src/host.ts`](../../../../packages/sdk/src/host.ts) - `admitted`: the policy check then the agents-label check, on create, the pre-turn change and an automation's start; a refusal announces and stores nothing and undoes a scope charge; an automation acts as its owner, refused until that owner has signed in (tasks 04, 11).
- `packages/agent-claude`, [`code://packages/agent-cofold/src/agent.ts`](../../../../packages/agent-cofold/src/agent.ts) - Claude and cofold declare their needs; cofold's configuration is mounted at `<computerConfigDir>/cofold/config.json` and named by `COFOLD_CONFIG` (tasks 05, 06).
- `docs/COMPUTER.md`, `docs/PLUGINS.md` (tasks 07, 12).

## Verified

- `pnpm exec tsc --noEmit` clean, `pnpm boundary` clean, `pnpm test` 171 files and 2571 tests after the rebase onto vault p2.
- A review probed each road, the flag list and the error text; its defects were fixed with tests that fail before the fix.
- By hand on 2026-10-03: a nested `ahpd --stdio` with `XDG_CONFIG_HOME` on a read-only folder exits (`EACCES` on `ahpd/usage`), so the decision moved to `COFOLD_CONFIG`; with it the nested host loads cofold over a read-only file and writes only its own home, and Docker 29 mounts the file at `/ahpd/cofold/cofold/config.json` readable by a non-root user.

## Departures from the plan

- [Cofold's configuration is named by a path variable](../../../decisions/cofold-config-reaches-a-machine-by-a-path-variable.md) supersedes the `XDG_CONFIG_HOME` decision task 06 was written for.
- `accept` records a principal handed on a personal connection token, so a session it owns is policy-checked rather than unchecked.
- A failed docker command now prints `-e NAME` without the value here, ahead of container/05 p1.

## Left for later

- A profile that moves `cofoldConfigPath` through `needs` moves the variable without the mount target, so the machine points at a file that is not there.
