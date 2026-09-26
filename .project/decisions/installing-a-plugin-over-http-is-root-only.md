---
title: Installing or removing a plugin over HTTP needs the deployment token
status: accepted
date: 2026-09-26
refs:
  - "[code://packages/server/src/commands/plugin.ts#L38-L79](../../packages/server/src/commands/plugin.ts#L38-L79) - `plugin.install` and `plugin.remove`, declared with `config:write`"
  - "[code://packages/server/src/install.ts](../../packages/server/src/install.ts) - one npm call and one edit of the configuration"
  - "[code://packages/server/src/commands/authorize.ts#L62-L63](../../packages/server/src/commands/authorize.ts#L62-L63) - the deployment token, which is root"
  - "[code://.project/decisions/the-door-token-is-the-host.md](the-door-token-is-the-host.md) - the deployment token is the host"
---

## Context

`plugin install` runs `npm install` in the configuration directory and names the package in the file the daemon loads at its next start.
Install scripts run at once, and the plugin runs in the daemon's process with its permissions, so installing one is running code as the host.
On the WebSocket, `config:write` changes root settings and never loads code, so the grant does not mean "may run code here".

## Decision

Over HTTP, `plugin install` and `plugin remove` are served only to a request carrying the deployment's connection token.
A person's token, whatever their grants, is refused with 403.

Source: Softov, 2026-09-26, asked "Should `plugin install` and `plugin remove` over HTTP need `config:write`, `admin`, root only, or not be exposed at all?": "root only".

## Consequences

A person can never install code on the host through the API, even an `admin`.
`ahpd --remote <url> plugin install` works only with the deployment token.
The refusal is a sentence of its own, since there is no grant pair a person could be given to pass it.

## Options

- **`config:write`.** Turns a settings grant into code execution on the host.
- **`admin`.** An `admin` is `*:*`, and still a person rather than the host.
- **Not exposed.** The deployment's own operator loses the remote path the CLI offers for everything else.
