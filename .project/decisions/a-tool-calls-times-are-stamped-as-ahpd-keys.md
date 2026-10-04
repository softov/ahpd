---
title: A tool call's start and end are stamped by the plugin that runs it, as _meta ahpd.startedAt, ahpd.endedAt and ahpd.durationMs
status: accepted
date: 2026-10-03
supersedes: decisions/a-tool-calls-times-are-stamped-by-its-plugin.md
refs:
  - "[code://packages/agent-cofold/src/transcript.ts#L107-L113](../../packages/agent-cofold/src/transcript.ts#L107-L113) - `callPartOf`, which writes the unprefixed `durationMs`, `startedAt` and `endedAt` on restored cofold calls today"
  - "[code://packages/sdk/src/host.ts#L2269-L2318](../../packages/sdk/src/host.ts#L2269-L2318) - `telemetered`, which clocks every tool call live for OTLP and keeps nothing a client reads"
  - https://github.com/microsoft/agent-host-protocol - AHP 1.0.0 still gives a tool call no time, only an open `_meta`; its new `startedAt` is on background work, and a turn keeps the `startedAt` and `duration` it had in 0.9.0
---

## Context

The decision this supersedes chose the plugin as the stamper and named the keys `startedAt`, `endedAt` and `durationMs`, unprefixed, to match what cofold's transcript already wrote.
It named an `ahpd.*` key as the rejected option.
Since then every `_meta` key ahpd invents is being moved to `ahpd.<name>` ([host/43 p4](../plans/host/43-the-wire-is-the-protocols-p4-ahpds-own-meta-keys-say-ahpd/plan.md)), so a reader can tell ahpd's extensions from the protocol's.
AHP 1.0.0 does not change the ground: a tool call has no timing field of its own, and `_meta` is still the only place for one.

## Decision

Each agent plugin stamps its own tool calls with `_meta['ahpd.startedAt']` (ISO), `_meta['ahpd.endedAt']` (ISO) and `_meta['ahpd.durationMs']` (ms), live and when it restores history, from the harness's own times where the harness has them and from its own clock otherwise.
`ahpd.durationMs` is always sent with an end, so no client subtracts two timestamps.
Every later action that carries a call's `_meta` carries the timing keys again, since a new `_meta` replaces the old one.
Only the names change; everything else the superseded decision says carries over.

Source: Softov, 2026-10-03, asked "Does \"Rename all + clients\" also cover the tool-call timing keys?": "We will prefix all.. then after I will see about that to remove the prefixes.. So its not a decision to rule.. Its to organize all that is not ahp protocol and to avoid breaking the protocol."

## Consequences

The prefix marks the keys as ahpd's, for now; it is not a standing rule, and Softov may drop the prefixes later.
cofold's restored calls, which already carry the unprefixed names, move to the prefixed ones in [plugin/29 p5](../plans/plugin/29-a-tool-call-says-when-it-ran-p5-cofold-stamps-its-live-calls/plan.md).
No client reads the unprefixed names today, so nothing goes blank when they go.
The wire test's census ([host/43 p1](../plans/host/43-the-wire-is-the-protocols-p1-the-wire-test-checks-every-frame/plan.md)) allows these keys by their prefix, with no entry of their own.

## Options

- **The unprefixed names cofold already ships.** No rename in cofold, but they read as if the protocol defined them, which is what the `ahpd.` prefix is for.
