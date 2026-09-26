---
title: A daemon with neither a connection token nor a user directory refuses to start with the HTTP API on
status: accepted
date: 2026-09-26
refs:
  - "[code://packages/server/src/commands/authorize.ts#L64-L73](../../packages/server/src/commands/authorize.ts#L64-L73) - the branch that admits every request when neither is configured"
  - "[code://packages/server/src/commands/run.ts#L148-L166](../../packages/server/src/commands/run.ts#L148-L166) - where the API is mounted, and where `http` is already refused with `--stdio`"
  - "[code://packages/server/src/commands/options.ts#L357-L391](../../packages/server/src/commands/options.ts#L357-L391) - `secret`, which lets a loopback daemon start with no token"
  - "[code://packages/server/src/commands/user.ts#L80-L103](../../packages/server/src/commands/user.ts#L80-L103) - `user add`, one of the commands an open API would serve to anybody"
---

## Context

A loopback daemon may start with no connection token and no user directory, and on the WebSocket that host is inert and refuses nothing.
The HTTP API serves administration commands that write files and install plugins, and `authorizeOverHttp` admits every request on such a host.
A form-encoded `POST /api/user/add/mallory` with no credentials wrote a new users file, and `plugin install` runs `npm install` with its install scripts.
With no Origin or Host check, any web page the owner opens can send those requests to `127.0.0.1`, and `--without-connection-token` on `0.0.0.0` opens them to the network.

## Decision

A daemon whose configuration turns `http` on and that has neither a connection token nor a user directory refuses to start, with a sentence naming the two ways to configure one.
`authorizeOverHttp` has no branch that admits a request without a credential.

Source: Softov, 2026-09-26, asked "Should the HTTP API on a host with no token and no users refuse every request, refuse only writes, or be refused at startup?": "refuse `http: true` at startup (refuse to serve the API unconfigured)".

## Consequences

An administration API always has a credential in front of it, whatever the WebSocket allows.
`ahpd` with `http` on and no token or users stops at startup, so a person turning the API on also picks `--connection-token`, `--connection-token-file` or `--users`.
`--without-connection-token` with `http` on is refused for the same reason.

## Options

- **Refuse every request.** The daemon starts and the API answers 401 to everything, which is an API that looks on and cannot be used.
- **Refuse only writes.** Reads such as `config` and `plugin list` would still be open to any local process and any page doing DNS rebinding.
