---
title: The config command hides the connection token over HTTP
status: accepted
date: 2026-09-26
refs:
  - "[code://packages/server/src/commands/config.ts#L68-L85](../../packages/server/src/commands/config.ts#L68-L85) - `daemon.config`, which returns every key of the file"
  - "[code://packages/server/src/config.ts#L200-L220](../../packages/server/src/config.ts#L200-L220) - `loadConfig`, which reads the file as it stands"
---

## Context

`GET /api/config` returns the whole configuration file, and a file may hold `connectionToken`.
A person holding `config:write` read it and so held the deployment token, which is root.

## Decision

`GET /api/config` answers every key except `connectionToken`, which it reports as present without its value.

Source: Softov, 2026-09-26, asked "Should `GET /api/config` hide `connectionToken`, or should `config` be root only?": "`GET /api/config` hides `connectionToken`".

## Consequences

A grant to read or change settings no longer carries the root credential with it.
The terminal's own `ahpd config` is the process owner reading their own file and keeps printing it.

## Options

- **`config` root only.** A person with `config:write` could change settings they cannot read back.
