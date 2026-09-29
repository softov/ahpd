---
title: A tool call's start and end are stamped by the plugin that runs it, as _meta startedAt, endedAt and durationMs
status: accepted
date: 2026-09-29
refs:
  - "[code://packages/agent-cofold/src/transcript.ts#L106-217](../../packages/agent-cofold/src/transcript.ts#L106-217) - already emits `_meta.startedAt`, `endedAt` and `durationMs` on restored tool calls"
  - "[code://packages/sdk/src/host.ts#L1854-1870](../../packages/sdk/src/host.ts#L1854-1870) - `telemetered`, which already clocks every tool call live for OTLP"
  - https://github.com/microsoft/agent-host-protocol - AHP 0.9.0 has `startedAt` and `duration` on a turn and no time on a tool call; `_meta` on a tool call is open
---

## Context

A client wants to say how long each tool call ran, and AHP gives a tool call no time.
`_meta` on a tool call is open in the strict schema and ahpd passes it through; VS Code reads no timing key there, so no upstream name exists.
The harnesses behind Claude, pi and cofold keep times on disk, so a restored session can have them; ACP keeps none.
The host already clocks every call live, but it keeps nothing a restore can read.

## Decision

Each agent plugin stamps its own tool calls with `_meta.startedAt` (ISO), `_meta.endedAt` (ISO) and `_meta.durationMs` (ms), live and when it restores history, from the harness's own times where the harness has them and from its own clock otherwise.
`durationMs` is always sent, so no client subtracts two timestamps.
Every later action that carries a call's `_meta` carries the timing keys again, since a new `_meta` replaces the old one.

Source: Softov, 2026-09-29, asked "Tool call timing: shall I write a plan for `_meta.startedAt` / `endedAt` / `durationMs` on every backend's tool calls, both live and from history? It would reuse cofold's names, put the work in the plugins, and add an sdk helper that keeps the timing keys when an update resends `_meta`.": "Draft the plan".

## Consequences

History has times wherever the harness kept them, which a host-side clock could never give.
A third-party backend gets no times until it stamps its own calls.
VS Code shows none of this; ahpapp and ahpc read it.

## Options

- **The host stamps every call in `dispatch`.** One place for every backend, but live only, and it has to track each call's last `_meta` and stamp snapshots too.
- **An `ahpd.*` namespaced key.** Safe from collision, but it splits from the names cofold already ships.
