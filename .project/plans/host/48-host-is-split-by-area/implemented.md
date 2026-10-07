---
title: host.ts is split into one file per area, and the URI routing and the grant tables are files of their own - implemented
date: 2026-10-07
refs:
  - git://ca6adcb
  - git://f1b3bd1
  - git://c78dbeb
  - "[code://packages/sdk/src/host.ts](../../../../packages/sdk/src/host.ts)"
---

Each area of the host is a file under `packages/sdk/src/host/`, and `host.ts` composes them.
`host.ts` is 1,141 lines, from 11,658, and `packages/sdk/src/host/` holds 30 files.
Each child plan says what it built and how it was verified.

## What was built

- [p1](../48-host-is-split-by-area-p1-the-grant-and-uri-tables/implemented.md) - the shared helpers, the held state, the URI and channel tables and the grant tables are files of their own.
- [p2](../48-host-is-split-by-area-p2-routing/implemented.md) - `HostContext`, URI routing, the client relay and connection admission are files of their own.
- [p3](../48-host-is-split-by-area-p3-changesets-and-facts/implemented.md) - changesets and the git and GitHub facts are files of their own, and the repository ports are in `packages/sdk/src/repo/`.
- [p4](../48-host-is-split-by-area-p4-telemetry-owners-and-machines/implemented.md) - telemetry, sign-in requirements, owners and machines are files of their own.
- [p5](../48-host-is-split-by-area-p5-session-and-root-config/implemented.md) - session config and root config are files of their own.
- [p6](../48-host-is-split-by-area-p6-catalogue-and-transcripts/implemented.md) - the catalogue, past sessions and snapshots are files of their own.
- [p7](../48-host-is-split-by-area-p7-session-lifecycle/implemented.md) - starting, restarting and removing a session are files of their own.
- [p8](../48-host-is-split-by-area-p8-tools-terminals-and-automations/implemented.md) - session tools, terminals and automations are files of their own.
- [p9](../48-host-is-split-by-area-p9-the-method-table/implemented.md) - the method table is one file per family.
- [p10](../48-host-is-split-by-area-p10-action-dispatch/implemented.md) - action dispatch and chat actions are files of their own.
- [p11](../48-host-is-split-by-area-p11-open-plans-cite-the-new-files/implemented.md) - open plans cite the new files instead of `host.ts`.

## Verified

- p1 to p4 landed in `c78dbeb`, p5 to p8 in `f1b3bd1`, and p9 to p11 in `ca6adcb`.
- Softov reviewed and merged p9 to p11 on 2026-10-06, and host 65 holds the fixes from that review.
- `pnpm exec tsc --noEmit`, `pnpm boundary` and `pnpm test` pass.

## Departures from the plan

- None.

## Left for later

- Plans written after p11 (host/52, claude/17, documentation/02) may still cite `host.ts`; see [p11's implemented.md](../48-host-is-split-by-area-p11-open-plans-cite-the-new-files/implemented.md).
