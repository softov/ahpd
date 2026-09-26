---
title: http.host binds the API's own listener
status: accepted
date: 2026-09-26
refs:
  - "[code://packages/server/src/config.ts#L8-L20](../../packages/server/src/config.ts#L8-L20) - `HttpSetting`, which has only `port`"
  - "[code://packages/server/src/commands/run.ts#L164-L166](../../packages/server/src/commands/run.ts#L164-L166) - `listenApi`, bound to the daemon's own host"
  - "[code://.project/decisions/the-http-api-is-on-the-daemon-port-under-api.md](the-http-api-is-on-the-daemon-port-under-api.md) - the decision whose consequence is binding the API where AHP is not"
---

## Context

`http.port` gives the API a listener of its own, and that listener is bound to the daemon's `host`.
A daemon on `0.0.0.0` therefore cannot keep its API on loopback, which is the consequence the placement decision promised.

## Decision

`http` takes a `host` beside `port`, and the API's own listener binds there.
Absent, it is the daemon's `host`.

Source: Softov, 2026-09-26, asked "Should `http` gain a `host` key so `http.port` can bind to loopback, as the decision promised?": "Add `http.host` so `http.port` can bind to loopback".

## Consequences

`{ "http": { "port": 9188, "host": "127.0.0.1" } }` keeps administration on the machine while AHP is on the network.
`http.host` without `http.port` has no listener to bind, and is refused at startup, because a host that applied to nothing would be a setting that lies (Softov confirmed, 2026-09-26).

## Options

- **Always loopback for the API's own port.** A deployment that wants the API reachable and AHP not could not say so.
