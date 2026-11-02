---
title: An action that changes state is said to every subscriber - implemented
date: 2026-11-01
refs:
  - "[code://packages/sdk/src/host/chatactions.ts](../../../../packages/sdk/src/host/chatactions.ts) - `sessionFlag`, the default chat's archive, the background request"
  - "[code://packages/sdk/test/ahp-test-cases.test.ts](../../../../packages/sdk/test/ahp-test-cases.test.ts) - the watching subscriber"
---

Every action that changes a channel's state by the protocol's reducer reaches every subscriber of that channel, and the protocol case driver holds a client that only watched to each case's expectation.

## What was built

- [`code://packages/sdk/test/ahp-test-cases.test.ts`](../../../../packages/sdk/test/ahp-test-cases.test.ts) - a third client subscribes before a case's actions, sends nothing, and reduces every envelope it is told of with the protocol's reducer from its own snapshot; on the keys the driver compares it must hold what the case expects. Case 272 is driven as the protocol writes it, its `HOST_OWNS` entry gone.
- [`code://packages/sdk/src/host/chatactions.ts`](../../../../packages/sdk/src/host/chatactions.ts) - a client's `chat/isArchivedChanged` on a session's default chat goes through `chatFlag` with the client's action, to every client of the chat with its origin, and `sessionFlag` archives the session; `sessionFlag` moves the default chat's archived bit with the session's, whichever action moves it, naming a resting session's default chat as its catalogue row does. A `session/mcpServerBackgroundRequested` no backend takes, on a server starting with `blocking: true`, goes to every client of the session with its origin and `session/mcpServerStateChanged` restores the server's state; on any other server it is answered to its sender.
- [`code://packages/sdk/src/types/session.ts`](../../../../packages/sdk/src/types/session.ts) - the `backgroundMcpServerStartup` contract.
- [`code://docs/sdk/AHP.md`](../../../../docs/sdk/AHP.md) - the rows for `chat/isArchivedChanged`, `session/isArchivedChanged` and `session/mcpServerBackgroundRequested`, and two paragraphs in "An action that changes nothing is not a change": the reducer on the sender's state decides what changes nothing, and a background request on a server that is not blocking is that case.

## Verified

- With the watching subscriber on `5da31824`, case 272 fails alone, on the state and on the subscriber: the chat's `status` short of the archived bit. No case reaches a blocking starting server through the driver, whose sessions list none, so cases 274, 275 and 276 compare no customization.
- On `5da31824` each new case fails for the reason it names: the second client hears no archive on the chat (host-snapshots), and hears no background request (host-harness, both cases). All pass after the change, and all 647 protocol cases pass.
- The 15 suites near these actions pass with 1164 tests; `pnpm run typecheck` and `pnpm run boundary` pass.
- The round's full run at two workers, on a loaded machine: `test:unit` passes 7338 with 12 failures. Eleven are 5 s timeouts in nine files, each of which passes whole run again alone, nested-start on its second run (its slowest case takes 4.2 s of its 5). One is `users-gate-commands`' usage pools case, which records usage dated 2026-10-02 and reads the current month; since 2026-11-01 it fails the same on the deployed union `c29baed4`. `test:processes` passes 663 with 32 failures in 13 files, 31 of them timeouts and one a restarted daemon's predecessor still alive at its check; each file passes whole run again alone, server-cli-restart on its second run. Two test daemons the loaded runs left behind were stopped by their pids.

## Departures from the plan

- none.

## Left for later

- none.
