---
title: Making a session reports its progress - implemented
date: 2026-11-12
refs:
  - git://56ef5277a
  - "[code://packages/sdk/src/types/computers.ts#L224-L238](../../../../packages/sdk/src/types/computers.ts#L224-L238)"
  - "[code://packages/sdk/src/host/sessionmethods.ts#L1255-L1282](../../../../packages/sdk/src/host/sessionmethods.ts#L1255-L1282)"
  - "[code://packages/sdk/src/host/sessionmethods.ts#L1440-L1443](../../../../packages/sdk/src/host/sessionmethods.ts#L1440-L1443)"
  - "[code://packages/sdk/src/host/machines.ts#L476-L526](../../../../packages/sdk/src/host/machines.ts#L476-L526)"
  - "[code://packages/sdk/src/host/lifecycle.ts#L2698-L2704](../../../../packages/sdk/src/host/lifecycle.ts#L2698-L2704)"
  - "[code://packages/computer/src/runtime.ts#L3212-L3223](../../../../packages/computer/src/runtime.ts#L3212-L3223)"
  - "[code://packages/computer/src/runtime.ts#L3385-L3404](../../../../packages/computer/src/runtime.ts#L3385-L3404)"
  - "[code://packages/computer/src/router.ts#L244-L250](../../../../packages/computer/src/router.ts#L244-L250)"
  - "[code://packages/computer/src/plugin.ts#L1162-L1239](../../../../packages/computer/src/plugin.ts#L1162-L1239)"
  - "[code://packages/computer/src/plugin.ts#L2185-L2306](../../../../packages/computer/src/plugin.ts#L2185-L2306)"
  - "[code://packages/sdk/test/machine-owner.test.ts#L166-L231](../../../../packages/sdk/test/machine-owner.test.ts#L166-L231)"
  - "[code://packages/computer/test/computer-disposable.test.ts#L1549-L1615](../../../../packages/computer/test/computer-disposable.test.ts#L1549-L1615)"
---

A `createSession` that carries a `progressToken` and names a machine source now says its waits through `root/progress`.
The docker runtime says `Pulling <image>` for an image Docker has not got, then `Making the machine` and `Seeding the checkout`.
The host says `Starting the agent`, and closes the wait with `progress` equal to `total`.
A `createSession` with no token, or one that makes no machine, behaves as before and sends nothing.

## What was built

- [`code://packages/sdk/src/types/computers.ts#L224-L238`](../../../../packages/sdk/src/types/computers.ts#L224-L238) - `MachineSource` has an optional `progress(message)`, with the doc on what a step is and that no total is sent.
- [`code://packages/sdk/src/host/sessionmethods.ts#L1255-L1282`](../../../../packages/sdk/src/host/sessionmethods.ts#L1255-L1282) - `createSession` reads `progressToken`, reads the machine source with `computerSource`, and builds `progress` and `done`. Both are absent when the token or the machine source is.
- [`code://packages/sdk/src/host/sessionmethods.ts#L1440-L1443`](../../../../packages/sdk/src/host/sessionmethods.ts#L1440-L1443) - one `try`/`finally` around the whole create closes the progress. It covers the refusals before the claim, the claim, and the already-held answer, and it runs once.
- [`code://packages/sdk/src/host/sessionmethods.ts#L1416-L1418`](../../../../packages/sdk/src/host/sessionmethods.ts#L1416-L1418) - the create hands `progress` to `createProviderSession`; the claim `finally` only releases the name.
- [`code://packages/sdk/src/host/machines.ts#L476-L526`](../../../../packages/sdk/src/host/machines.ts#L476-L526) - `placedIn` takes `progress` as its sixth parameter and puts it in the `MachineSource` it hands `openComputer`.
- [`code://packages/sdk/src/host/lifecycle.ts#L2698-L2704`](../../../../packages/sdk/src/host/lifecycle.ts#L2698-L2704) - `createProviderSession` takes `progress` and says `Starting the agent` before it starts the backend.
- [`code://packages/computer/src/runtime.ts#L636-L643`](../../../../packages/computer/src/runtime.ts#L636-L643) - `ComputerRuntime.run` takes an optional `progress`.
- [`code://packages/computer/src/runtime.ts#L3212-L3223`](../../../../packages/computer/src/runtime.ts#L3212-L3223) - `dockerRuntime.run` says `Pulling <image>` only when `docker image inspect` does not find the image.
- [`code://packages/computer/src/runtime.ts#L3385-L3404`](../../../../packages/computer/src/runtime.ts#L3385-L3404) - it says `Making the machine` before the one guarded `try`, and `Seeding the checkout` before `seedGit`. The #308 one-try block and `cleanUpFailed` are unchanged.
- [`code://packages/computer/src/router.ts#L244-L250`](../../../../packages/computer/src/router.ts#L244-L250) - `routed()` passes `progress` to the runtime it holds.
- [`code://packages/computer/src/plugin.ts#L1162-L1239`](../../../../packages/computer/src/plugin.ts#L1162-L1239) - the plugin's own `run` wrapper takes `progress` and hands it to the router. This was the drop: the wrapper took one argument and called `computerRouter.run(spec)` without it.
- [`code://packages/computer/src/plugin.ts#L2185-L2306`](../../../../packages/computer/src/plugin.ts#L2185-L2306) - both `create` branches pass `asked.progress` to `made.run`.

## Verified

- `pnpm exec tsc -p tsconfig.json --noEmit` at the worktree root passes, and prints nothing.
- The suites at review, 2026-11-12: sdk 4763 passed, 5 skipped; computer 607 passed, 1 skipped. `host-handshake.test.ts` still pins no progress for a create with no machine.
- [`code://packages/sdk/test/machine-owner.test.ts#L166-L231`](../../../../packages/sdk/test/machine-owner.test.ts#L166-L231) - three sdk cases. One with a token expects the two plugin steps and `Starting the agent`, then the closing line. One with no token expects none. A refused create expects `-32002` and one closing line with `progress: 0, total: 0`.
- [`code://packages/computer/test/computer-disposable.test.ts#L1549-L1615`](../../../../packages/computer/test/computer-disposable.test.ts#L1549-L1615) - a fresh-image case expects the four messages and the closing line; a present-image case expects no `Pulling` step.

## Departures from the plan

- Task 01's sdk case went in `packages/sdk/test/machine-owner.test.ts`, not a new file. That file already serves a host with a fake `ComputerPort`, which is the seam the token needs.
- The closing progress is sent from one `try`/`finally` around the whole create. A refusal thrown before the claim closes it too, as the plan's "answers or throws" says. It is sent once on every path, and only when the request carried a token and named a machine source.
- Progress is sent only for a create that names a machine source, as the plan's *Answers* row of 2026-11-12 says. A create with no machine, or with a `computer://<id>` that already exists, sends nothing. The sdk case for it already exists in `packages/sdk/test/host-handshake.test.ts`. It is "reports no progress for a session's own start, as VS Code's host". That test stays as it is.
- The devcontainer route says only `Starting the agent`. Its build goes through the docker runtime's devcontainer path, which has no image pull, run or seed step of its own.
- The line numbers in the plan's refs and task Files come from `b4ad32951` and are stale after #305, #306 and #308. Each place was found by its code, and those merges are kept.

## Left for later

- Nothing. The plan's *Final verification checklist* still waits on the sdk and computer suites, which this session could not run.
