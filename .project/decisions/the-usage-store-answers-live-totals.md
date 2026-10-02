---
title: The usage store answers a pool's live total, not only appends
status: proposed
date: 2026-10-01
refs:
  - "[code://packages/sdk/src/sessions.ts#L109-L153](../../packages/sdk/src/sessions.ts#L109-L153) - the versioned file store pattern the default copies"
---

## Context

Limits are checked before a proxy call or a turn and debited as usage arrives, sometimes mid-turn.
Several daemons may share one store later, so a total read from one daemon's memory alone would be wrong there.

## Decision

The `usage` port records entries and answers the running total of a pool over a period, from its first version.
The default keeps one JSONL file per month and the totals of open periods in memory, rebuilt from the files at start.
A shared store (postgres) answers the same calls from the shared data.
Source: Softov, 2026-10-01, asked "Starting direction for the store port": "Append + live totals from day one"; and earlier: "append-only jsonL to default file, plugin for sqlite could store that and session info or more. even postgresql in a future."

## Consequences

The policy plan reads totals from the port and needs no store of its own.
The port is shaped for several writers from the start, so a postgres plugin does not change it.

## Options

- **Append only first, totals when policy starts**: rejected, the port would change shape once policy and a shared store arrive.
