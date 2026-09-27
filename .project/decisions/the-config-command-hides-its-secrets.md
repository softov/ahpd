---
title: The config command hides the connection token and every plugin option value over HTTP
status: accepted
date: 2026-09-26
supersedes: decisions/the-config-command-hides-the-connection-token.md
refs:
  - "[code://packages/server/src/commands/config.ts#L18-L24](../../packages/server/src/commands/config.ts#L18-L24) - `withoutToken`, which masks only `connectionToken`"
  - "[code://packages/server/src/config.ts#L228-L247](../../packages/server/src/config.ts#L228-L247) - a plugin entry's `options`, the object handed to the plugin's `apply`"
---

## Context

`GET /api/config` hides `connectionToken` and answers every other key.
A plugin entry's `options` is where a plugin's own credentials live, an API key or a webhook secret, so every `config:write` holder reads them over HTTP.

## Decision

`GET /api/config` answers `connectionToken` as `<set>`, and each plugin entry's `options` with its keys kept and every value replaced by `<set>`.
Every other key is answered as the file holds it.
The terminal's own `ahpd config` keeps printing the file.

Source: Softov, 2026-09-26, asked "Served `GET /api/config` hides only `connectionToken`, so a plugin's `options` reach every `config:write` holder over HTTP. Change it?": "Mask plugin options too".

## Consequences

A grant to read or change settings carries neither the root credential nor a plugin's.
A caller can still see which options a plugin is given, not what they are.

## Options

- **Hide only `connectionToken`.** `config:write` can replace the whole file anyway, but reading a plugin's key back is a leak replacing is not.
- **`config` root only.** A person with `config:write` could change settings they cannot read back.
