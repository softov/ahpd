---
title: A contributed key's picker is seeded when a config is resolved, and not on a snapshot
status: accepted
date: 2026-09-25
refs:
  - code://packages/sdk/src/host.ts - `seeded`, and the `resolveSessionConfig` handler that calls it
  - code://packages/computer/src/plugin.ts - the `computer` key, its answerer and the empty row that means this host
  - code://test/plugin-host.test.ts - the seed, and the seed that fails
  - code://packages/sdk/src/types/plugin.ts - `sessionCompletions`, the contribution this reads
  - code://docs/PLUGINS.md - what a plugin author is told about the key and its answerer
---

## Context

`enumDynamic` tells a client that a key's values are a query rather than a schema, and `sessionConfigCompletions` answers it. A client still has to draw the value it is already holding, and the reference client draws a chip by finding that value in `enum` and falling back to the raw value when there is none.

So an unseeded key draws badly in every client. A machine reads as `computer://box` where its own answerer would have said `box`, and the empty value - which the computer plugin uses for "on this host" - reads as nothing at all: a mark, a gap and an arrow. The host already seeds `branch` for exactly this reason. A contributed key had nobody to do it.

## Decision

`resolveSessionConfig` asks each contributed key's own answerer once, with an empty query, and writes what comes back into that key's `enum`, `enumLabels` and `enumDescriptions`.

The property stays `enumDynamic`: the seed is the first page and not the list, so a picker that opens still asks and still gets whatever is true then. A key that already carries an `enum` is left alone, because that plugin seeded itself. An answerer that throws costs its own seed and nothing else.

Only `resolveSessionConfig` seeds. A session snapshot carries the same schema and is not seeded.

## Consequences

A client that has not opened a picker draws the right label anyway, which is what the composer does on every redraw.

`resolveSessionConfig` now costs whatever the answerers cost - a `docker ps` for the computer key - and it is asked when a composer draws itself, which is a deliberate act. Seeding the snapshot path would have put that listing on every redraw of every session, which is why it is not there.

Inside a session the schema comes from the snapshot, so a value that has no row reads as the question's title rather than as its label. The client makes that readable; the host does not pay for a listing per frame to improve it.

## Options

- **Seed the snapshot too.** Rejected: snapshots are emitted constantly, and a listing per frame is a cost no client asked for.
- **Leave it to the client.** Rejected: every client would need the same table of what a value means, which is the thing the host is authoritative about - and three of them already disagreed about it.
- **Drop `enumDynamic` once seeded.** Rejected: the seed is a moment's answer. A machine started after it would never appear.
