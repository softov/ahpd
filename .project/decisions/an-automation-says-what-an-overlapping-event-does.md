---
title: An automation says what an event does while it runs
status: accepted
date: 2026-10-07
refs:
  - "[code://packages/sdk/src/host/automations.ts#L233-L246](../../packages/sdk/src/host/automations.ts#L233-L246) - `due`, which starts every run it is given"
---

## Context

An event can come while the automation's last run is still running.
Automations want different answers.
A reviewer wants one more pass, a watcher wants the news at once, and a fan-out wants one run per event.

## Decision

Each automation picks `queue`, `steer`, `parallel` or `skip`, with `queue` as the default.
`queue` keeps at most one waiting run, and later events fold into it.
`steer` sends the event into the running turn as a message.
`parallel` starts a run for each event, and a pinned automation refuses it.
`skip` drops the event and counts it on the run.

Source: Softov, 2026-10-07, asked "An event arrives while the automation is already running. What happens?" and chose "configurable if possible. queue, steer, parallel, skip."

## Consequences

- A pinned automation has one chat, so `parallel` is refused there when the automation is saved.
- A `steer` with no running turn becomes a `queue`.

## Options

- One fixed answer for every automation.
