---
title: The host sends a summary - implemented
date: 2026-11-14
refs:
  - git://c87e132f5 - the last code commit of the build
  - "[code://packages/sdk/src/summary/channel.ts](../../../../packages/sdk/src/summary/channel.ts) - the summary channel"
  - "[code://packages/sdk/src/resources/recordschannel.ts](../../../../packages/sdk/src/resources/recordschannel.ts) - the listing"
---

A client can subscribe to `x-ahpd-summary://`.
For each area it may open, it gets the total, the counts by state and the alerts grouped by text.
Each group names the rows that say it. The host sends it again one second after a change, and only to a reader whose counts moved.

## What was built

- [`code://packages/sdk/src/resources/recordschannel.ts`](../../../../packages/sdk/src/resources/recordschannel.ts) - `RecordsListing` on every records channel: `rows`, `opens`, `readable` and `onRefresh`.
- [`code://packages/sdk/src/tunnels/channel.ts`](../../../../packages/sdk/src/tunnels/channel.ts) - the tunnels channel passes the listing on.
- [`code://packages/sdk/src/summary/channel.ts`](../../../../packages/sdk/src/summary/channel.ts) - `summaryChannel`, its types and `SUMMARY_DELAY_MS`.
- [`code://packages/server/src/commands/run.ts`](../../../../packages/server/src/commands/run.ts) - the daemon serves the summary over the five lists, stops it at shutdown, and lists the `summary` subject.
- [`code://docs/plugins/PLUGINS.md`](../../../../docs/plugins/PLUGINS.md) - the `x-ahpd-summary` section.

## Verified

- `pnpm typecheck` passes, and `pnpm boundary` finds nothing undeclared.
- `packages/sdk/test/summary-channel.test.ts`: 7 cases pass, with the alerts grouped by text. `packages/sdk/test/recordschannel.test.ts`: 30 cases pass, 2 of them new.
- The sdk suite: 4781 pass. Two cases of `host-permissions.test.ts` fail on this machine, and fail the same on a clean `origin/main`. CI on Linux passes them.
- The server suite: 1880 pass, none fail.
- The computer suite: 631 pass. Two cases time out at 5000 ms, and both are in the problem `computer-cases-time-out-on-a-busy-machine`.
- A daemon from this branch, started on a free port with its own XDG folders, answered the subscribe with the five areas. A second connection gave one `x-ahpd-summary/changed` about a second later, with `clients.total` at 2.
- Softov validated it on 2026-11-14 through the ahpw badges, over a plugin that raised an error and a warning.

## Departures from the plan

- The timer starts with no subscriber too, because a subscribe is answered before the host records it.
- The daemon lists a `summary` subject in its `grants`, so the start does not say `summary:read` is unlisted.

## Left for later

- A change to a reader's grants is not a refresh, so their summary waits for the next change of any area.
