---
title: The HTTP API is off by default, and on the daemon's own port under /api unless http.port is set
status: accepted
date: 2026-09-26
refs:
  - "[code://packages/sdk/src/listen.ts](../../packages/sdk/src/listen.ts) - the listener the WebSocket is served from"
---

## Context

The HTTP API is a person's choice, and it serves the same commands as the CLI.
The daemon already listens on one port, reachable through a Dev Tunnel when that plugin runs.

## Decision

`http` in the configuration turns the API on.
It is served under `/api` on the daemon's own port, beside the WebSocket; `http.port` moves it to a listener of its own.
Source: Softov, 2026-09-26, asked "When HTTP is enabled, where is it served?", answered "configurable, same port by default unless http.port, under /api".

## Consequences

One port by default, so the tunnel carries the API with no more setup.
A separate `http.port` lets the API be bound where AHP is not, such as loopback only.

## Options

- **Always its own port.** Separate binding by default, and a second port to open and forward for everyone.
- **Always the daemon's port.** Simplest, and no way to keep the API off a public listener.
