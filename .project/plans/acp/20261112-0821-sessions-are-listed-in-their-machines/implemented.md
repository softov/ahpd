---
title: An ACP agent's sessions are listed in their machines - implemented
date: 2026-11-12
refs:
  - git://822b9aea0 - the commit this plan was built on
  - "[code://packages/sdk/src/types/agent.ts](../../../../packages/sdk/src/types/agent.ts) - the `list` signature the host fills in"
  - "[code://packages/sdk/src/types/computers.ts](../../../../packages/sdk/src/types/computers.ts) - the port's optional `state` read, asked before a spawn"
  - "[code://packages/computer/src/plugin.ts](../../../../packages/computer/src/plugin.ts) - `state` served from the machine's own runtime"
  - "[code://packages/sdk/src/host/catalogue.ts](../../../../packages/sdk/src/host/catalogue.ts) - the machines a backend's kept sessions ran in"
  - "[code://packages/agent-acp/src/catalog.ts](../../../../packages/agent-acp/src/catalog.ts) - the per-machine spawn, the skipped machine, the remembered machine of a listed session, and the fallback to watched rows"
  - "[code://packages/agent-acp/test/agent-acp-machines.test.ts](../../../../packages/agent-acp/test/agent-acp-machines.test.ts) - the machine, mixed, failure, stopped and gone cases"
---

An ACP backend is listed in each machine where its kept sessions ran, and only while that machine is running. It is listed on the host only when a kept session ran there, or none is kept. A backend whose command exists only in a machine no longer spawns a failing process on the host at every client connect. A machine that is stopped, suspended or gone is not spawned in, and says so once per record.

## What was built

- [`code://packages/sdk/src/types/agent.ts`](../../../../packages/sdk/src/types/agent.ts) - `list` takes the machines of the backend's kept sessions and a flag saying whether one ran on the host.
- [`code://packages/sdk/src/types/computers.ts`](../../../../packages/sdk/src/types/computers.ts) - `ComputerPort` has an optional `state` read: `running`, `stopped`, `suspended`, or nothing for a machine that is gone.
- [`code://packages/computer/src/plugin.ts`](../../../../packages/computer/src/plugin.ts) - the computer plugin serves `state` from the machine's own runtime, as it serves `agents`.
- [`code://packages/sdk/src/host/catalogue.ts`](../../../../packages/sdk/src/host/catalogue.ts) - the catalogue builds one machine entry per machine, from each kept session's config, and hands it to `list`.
- [`code://packages/agent-acp/src/catalog.ts`](../../../../packages/agent-acp/src/catalog.ts) - `catalogueOf` asks the machine's state first and spawns only in a running machine. It merges the rows, reads the host only when told to, and remembers the machine of each session a machine listed. A stopped, suspended, gone or failing machine is said once per record and machine.
- [`code://packages/agent-acp/src/agent.ts`](../../../../packages/agent-acp/src/agent.ts) - `list` passes the machines and the host flag on; `transcript` reads the machine the listing remembered.
- [`code://packages/agent-acp/test/agent-acp-machines.test.ts`](../../../../packages/agent-acp/test/agent-acp-machines.test.ts) - the machine-only, host-only, mixed, failed-host, stopped, gone, no-state and failing-machine cases.
- [`code://packages/agent-acp/test/agent-acp-failure.test.ts`](../../../../packages/agent-acp/test/agent-acp-failure.test.ts) - the listing failure case now answers the watched rows with one line.

## Verified

- `pnpm exec tsc -p tsconfig.json --noEmit` at the repository root, which covers `packages/*/src` and `packages/*/test`: no errors.
- `pnpm -C packages/sdk exec tsc -p .` in `packages/sdk`: no errors.
- `pnpm exec tsc -p tsconfig.json --noEmit` in `packages/agent-acp`, after the SDK's `dist` is built so the workspace package resolves: no errors.
- The suites at review, 2026-11-12: agent-acp 372 passed; sdk 4760 passed, 5 skipped; computer 601 passed, 1 skipped.

## Departures from the plan

- Task 01 names `packages/sdk/src/types/host.ts` in its *Files*; the `Agent` interface is in `packages/sdk/src/types/agent.ts`, so the signature changed there.
- Task 01 step 1 names only a `machines` parameter. `list` also takes `host?: boolean`. A backend with kept sessions in both a machine and this host must be told to read both. An empty `machines` alone does not say it.
- Task 01 step 3 says the spawn is "for each running machine", but the port had no way to answer that. Softov chose an optional `state` read on `ComputerPort` (Answers, 2026-11-12), which the computer plugin serves from the runtime's own `state`. A port without `state` is spawned in as before.
- A stopped, suspended or gone machine contributes nothing, so the watched rows answer when no server listed. Its line, and a machine's failed listing, are each said once per record and machine, as the host failure is.
- Task 02 does not name `packages/agent-acp/src/agent.ts` in its *Files*. Step 3 needs the replay caller to pass the session's machine, so `transcript` there passes `machineFor(provider, id)`.
- Task 02 step 4 says `findListed` passes the machines from task 01. `find` has no machine parameter and task 02 adds none. `rowsForFind` reads the machines and host flag of the record's last `list`, kept in a `WeakMap`.
- The rows of every machine merge with the rows of the host listing. The watched rows remain the answer only when no server listed. That is the line Answer 4 cites: a backend that lists as today must not gain a watched row it never listed.
- A nested session is not counted. Its transcript is the inner host's, in the machine, and no backend here lists it.
- A host listing failure for a record with kept sessions still rejects, as the code did before. Only the record with no kept session gets the watched-rows answer, which is what Answer 3 says.

## Left for later

- The agent-acp and sdk suites, which the user runs.
