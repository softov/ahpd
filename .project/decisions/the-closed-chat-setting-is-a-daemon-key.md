---
title: What closing a chat does is a daemon key in root config
status: accepted
date: 2026-10-09
refs:
  - "[code://packages/server/src/rootconfig.ts#L33-L42](../../packages/server/src/rootconfig.ts#L33-L42) - `DAEMON_KEYS` and the keys that apply while the daemon runs"
  - "[code://packages/server/src/commands/options.ts#L416-L420](../../packages/server/src/commands/options.ts#L416-L420) - the `closedChats` field, declared as `advancedTools` is"
  - "[code://packages/sdk/src/types/host.ts#L370-L381](../../packages/sdk/src/types/host.ts#L370-L381) - `HostOptions.closedChats`, the option a daemon hands its host"
---

## Context

What closing a chat does to its conversation is one answer per daemon, and nothing about one session or one chat makes a different answer right.
The choice could be a daemon key, a start flag, or a per-session key a client sets.
A daemon key is what an operator can change without restarting, and it is where every other setting of this kind lives.

## Decision

The setting is the daemon key `closedChats` in root config, with the values `hidden` (the default) and `delete`.
It is declared the way `advancedTools` is, and it applies while the daemon runs: a value set through root state is read where the next chat is closed, so no session is rebuilt and none is told.

Source: Softov, 2026-10-09, asked "host/50: where does the closed-chat setting (keep hidden or delete) live?": "Daemon root config".

## Consequences

A client closing a chat cannot choose per chat, and two sessions of one daemon cannot differ.
The key travels to the host as an option, so a host built without a daemon keeps the default.

## Options

- **A per-session config key**: two sessions of one daemon could differ, and a client closing a chat would have to be told which answer its session carries.
- **A start flag only**: a daemon already running could not change it, and root config is where every other setting of this kind is written.
- **A per-chat key on `disposeChat`**: the client would decide, and a conversation deleted by one client is gone for everybody.
