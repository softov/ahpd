---
title: A session on a machine not prepared for its agent fails at creation
status: accepted
date: 2026-09-26
refs:
  - "[code://packages/sdk/src/computers.ts#L103-L130](../../packages/sdk/src/computers.ts#L103-L130) - `computersFor`, the port check a backend meets when it enters"
  - "[code://packages/sdk/src/host.ts#L6858](../../packages/sdk/src/host.ts#L6858) - `createSession`, where a machine is placed before the backend starts"
  - "[code://packages/sdk/src/host.ts#L3894](../../packages/sdk/src/host.ts#L3894) - `restart`, the same step before the first turn"
  - "[code://.project/decisions/the-host-hands-an-agents-machine-needs-to-the-machine-maker.md](the-host-hands-an-agents-machine-needs-to-the-machine-maker.md) - the host checks the label before a session starts there"
---

## Context

A machine records the agents it was prepared for in its `ahpd.agents` label.
The check sits in the port a backend is handed, so it fires when the backend first enters the machine, which for a lazy backend is the first turn and not the session's creation.
A session on the wrong machine is created, announced and then fails later.

## Decision

The host checks the machine's label when a session is created and when it is started again before its first turn, so the create or the restart fails with the sentence.
The port check stays, for the paths that reach a machine without either.
Source: Softov, 2026-09-26, asked "Where the wrong-machine refusal happens: accept the port-only check and amend the decision, or also check in `createSession` and `restart`?": "also check at create (in `createSession` and `restart`), so the session fails at creation; keep the port check too".

## Consequences

The client that picked the wrong machine hears it from its own `createSession` or configuration change.
The label is read once more per session start.

## Options

- **The port check alone.** One place, and a session that exists until its first turn fails.
