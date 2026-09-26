---
title: A machine made for a session counts against max and needs computer:write
status: accepted
date: 2026-09-26
refs:
  - "[code://packages/computer/src/provider.ts#L300-L306](../../packages/computer/src/provider.ts#L300-L306) - the `max` check a `computer://` write passes"
  - "[code://packages/computer/src/plugin.ts#L460-L558](../../packages/computer/src/plugin.ts#L460-L558) - the port's `create`, which calls the runtime directly for `disposable:` and `devcontainer://`"
  - "[code://packages/sdk/src/host.ts#L4093-L4118](../../packages/sdk/src/host.ts#L4093-L4118) - `placedIn`, where the host asks the port to make a machine for a session"
  - "[code://packages/sdk/src/host.ts#L8893-L8925](../../packages/sdk/src/host.ts#L8893-L8925) - the one gate, where a principal's grants are read"
  - "[code://.project/decisions/a-grant-is-a-subject-and-a-verb.md](a-grant-is-a-subject-and-a-verb.md) - `computer:write` is the grant that makes and destroys a machine"
---

## Context

A machine made through a `computer://` write is counted against the plugin's `max` and needs the `computer:write` grant.
A machine made when a session starts, from a `disposable:<profile>` or a `devcontainer://<folder>` setting, goes through the port's `create`, which calls the runtime directly.
So any connection that may create a session makes as many containers as it likes, without `computer:write`.

## Decision

A machine made for a session is counted against the same `max` as any other machine the plugin holds, and the session that asks for it needs `computer:write` as well as `session:write`.
This holds for both sources a session can name: `disposable:<profile>` and `devcontainer://<folder>`.
Source: Softov, 2026-09-26, asked "Session-time creates and the `max` cap and `computer:write`: count them toward `max` and require `computer:write`, give them a separate cap, or leave them uncapped?": "count against `max` and require `computer:write`: yes to both".

## Consequences

The host has to know the principal behind the request that names a source, in `createSession`, in the configuration change that restarts a session before its first turn, and in an automation's start.
A person with `session:write` alone still runs sessions on the host and on machines that exist, and is refused one that would make a machine.
A full host refuses a session's machine with the same sentence a `computer://` write gets.

## Options

- **A separate cap for machines made for sessions.** Keeps form-made machines from being crowded out, at the cost of a second number to configure and explain.
- **No cap and no grant, since picking a profile is the operator's grant.** Nothing to check, and a client that loops `createSession` fills the Docker host.
