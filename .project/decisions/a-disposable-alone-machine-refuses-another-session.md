---
title: A disposableAlone machine refuses every session but the one that made it
status: accepted
date: 2026-09-26
refs:
  - "[code://packages/sdk/src/computers.ts#L103-L130](../../packages/sdk/src/computers.ts#L103-L130) - `computersFor`, the wrapped port every session enters a machine through"
  - "[code://packages/computer/src/plugin.ts#L665](../../packages/computer/src/plugin.ts#L665) - the picker filter, today the only thing that keeps an alone machine to its session"
  - "[code://packages/computer/src/runtime.ts#L372-L373](../../packages/computer/src/runtime.ts#L372-L373) - `ahpd.disposable` and `ahpd.disposable.alone`, the labels a machine carries"
  - "[code://.project/ideas/an-agent-says-what-a-machine-needs.md](../ideas/an-agent-says-what-a-machine-needs.md) - \"only the session that made it runs there\""
---

## Context

A profile with `disposableAlone: true` makes a machine for one session.
The `computer` picker leaves that machine out, but a session whose `computer` setting is typed as `computer://<id>` still enters it, because nothing past the picker reads the alone label.
The idea says only the session that made it runs there.

## Decision

A session that is not the one a `disposableAlone` machine was made for is refused when it enters that machine, in `computersFor`, beside the check on the agents the machine was prepared for.
The machine records the session that made it as a label, so the refusal holds after a daemon restart.
Source: Softov, 2026-09-26, asked "`disposableAlone` against a hand-typed `computer://<id>`: refuse it in `computersFor`, or keep it picker-only and fix the docs?": "refuse a hand-typed `computer://<id>` for another session's disposable machine, in `computersFor`".

## Consequences

The port gains a way to say which session a machine belongs to, and the Docker runtime writes and reads one more label.
The docs can say "only the session it was made for runs in it" and mean it.

## Options

- **Keep it picker-only and say so in the docs.** No port change, but a typed URI or a client holding an old list walks into somebody else's machine.
