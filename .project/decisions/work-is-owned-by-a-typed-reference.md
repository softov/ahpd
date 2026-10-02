---
title: Work is owned by a typed reference, user, team or project
status: proposed
date: 2026-10-01
refs:
  - "[code://packages/sdk/src/sessions.ts#L76-L86](../../packages/sdk/src/sessions.ts#L76-L86) - the persisted session fields, none of them an owner"
  - "[code://packages/sdk/src/types/automations.ts#L14-L29](../../packages/sdk/src/types/automations.ts#L14-L29) - an automation records no creator"
---

## Context

No session, turn or automation run records who it is for, so usage cannot be attributed.
Most work is started by a person, but an automation or a CI job may belong to a team or a project rather than to anyone.

## Decision

The owner of a piece of work is a typed reference: `user:<id>`, `team:<id>` or `project:<id>`, the same spelling the usage rules use.
The team and project the work is charged under are recorded beside it.
Source: Softov, 2026-10-01: "owner means giving the system a id or needed a scope right? user:maria, team:backend, project:xyz?"; then asked "Owner as a typed reference... Start from that?": "Yes, start from it".

## Consequences

Sessions get `user:` owners now; team and project owners wait for those entities to exist.
The turn's sender, decided in host 33, stays a person: the owner says who the work belongs to, the sender who asked for this turn.

## Options

- **A bare user id**: rejected, work no person started would have no owner.
