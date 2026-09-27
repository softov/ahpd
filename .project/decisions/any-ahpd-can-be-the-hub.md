---
title: Any ahpd can be the hub other hosts join
status: accepted
date: 2026-09-26
refs:
  - "[code://packages/sdk/src/nested.ts#L95-L120](../../packages/sdk/src/nested.ts#L95-L120) - the proxy that relays a nested host's session, which a joined host reuses"
  - "[code://packages/sdk/src/listen.ts](../../packages/sdk/src/listen.ts) - the listener a joining host dials"
  - "[code://.project/decisions/a-nested-host-speaks-stdio.md](a-nested-host-speaks-stdio.md) - the relay is a byte stream, whatever carries it"
---

## Context

A machine behind NAT cannot be reached by the host that wants to run a session on it, so it has to dial out and register itself with a host that can be reached.
That host could be ahpd itself or a separate service made for the job.

## Decision

The hub is a role any ahpd takes: `ahpd join <url>` on one host dials another ahpd's listener, and that ahpd lists it as a computer and relays its sessions.
Source: Softov, 2026-09-26, asked "A role any ahpd can take, or a separate small service?", answered "any ahpd".

## Consequences

One program covers the laptop, the box and the hub, and the hub's users, grants and issuers are the ones every ahpd already has.
A hub is only as available as the daemon it is, so a fleet that needs a hub up all the time runs one ahpd for that purpose.

## Options

- **A separate hub service.** Could be smaller and always on, and would be a second program with its own auth to build and keep in step.
