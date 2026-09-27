---
title: A nested host is used only for a backend that runs nested and for a machine on another host
status: accepted
date: 2026-09-26
refs:
  - "[code://packages/sdk/src/types/computers.ts#L97-L122](../../packages/sdk/src/types/computers.ts#L97-L122) - `how()` for a command in a machine, `nested()` for a host in one"
  - "[code://packages/sdk/src/nested.ts#L95-L120](../../packages/sdk/src/nested.ts#L95-L120) - the proxy backend"
  - "[code://.project/decisions/a-session-reaches-a-nested-host-through-a-generic-proxy.md](a-session-reaches-a-nested-host-through-a-generic-proxy.md) - the proxy any backend may use"
---

## Context

A backend reaches a machine in one of two ways: its command runs there under `docker exec`, through `ComputerPort.how()`, or a whole ahpd runs there and the SDK's proxy relays the session, through `ComputerPort.nested()`.
The nested route could carry every backend, which would make a local machine and a remote one the same shape.
It costs a second host process per machine, the ahpd part in every machine, and a protocol version check on every start.

## Decision

A local machine keeps running an agent's command directly, and the nested host is used for a backend that declares `runsNested` and for every machine that is not on this host.
Source: Softov, 2026-09-26, asked "Nested host for every agent in a machine, or only where needed?", answered "the second" (only where needed).

## Consequences

`how()` stays the path for Claude and every ACP agent in a local Docker machine.
A runtime that reaches another host answers `nested()` for every backend, and its terminals, files and worktrees are the remote host's.
A backend therefore meets two routes, and a test for each backend runs on both where it runs remotely.

## Options

- **Nested for every backend everywhere.** One route, and one more process and one more version check for every local session that gains nothing from it.
