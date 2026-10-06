---
title: The proxy answers under /v1 on the listener that carries /api, and only while http is on
status: accepted
date: 2026-10-06
refs:
  - "[code://packages/server/src/commands/run.ts#L353-L394](../../packages/server/src/commands/run.ts#L353-L394) - where `/api` is mounted, on the daemon's port or on `http.port`"
  - "[code://packages/server/src/http.ts#L109-L124](../../packages/server/src/http.ts#L109-L124) - `apiHandler`, the mount the proxy sits beside"
  - "[code://packages/server/src/proxy/providers.ts#L83-L99](../../packages/server/src/proxy/providers.ts#L83-L99) - the built-in providers, whose endpoints are each vendor's base URL"
---

## Context

A person's own tool reaches a model through a base URL: Claude Code and the Anthropic SDKs take one without `/v1` and add `/v1/messages`, the OpenAI SDKs take one ending in `/v1` and add `/chat/completions`.
Both paths begin with `/v1`, so one address serves both kinds of caller.
The daemon already has an HTTP surface, `/api`, which is off unless `http` names it, refused at start without a credential, and moved to its own port by `http.port`.

## Decision

The proxy is served under `/v1` on whichever listener carries `/api`: the daemon's own port with `http: true`, or the API's own with `http.port`.
It is served only while `http` is on, so turning on the HTTP surface is the one switch for both.
A caller's base URL is `http://<host>:<port>` for the Anthropic dialect and `http://<host>:<port>/v1` for the OpenAI one.
Source: `(defaulted: one surface, one switch and one credential gate; Softov may erase it)`.

## Consequences

A daemon with `http` off answers `/v1` with the 404 it gives `/api`.
A machine off this host (container/05 p12) is handed the API's address as its proxy URL, and the daemon it calls must have `http` on.
The start-time refusal of `http` without a credential covers the proxy too, so the proxy is never open to anybody who reaches the port.

## Options

- **A port of its own, `proxy.port`**: rejected, a second listener to bind, forward and announce, for a surface that needs the same credential and the same guard.
- **Always on when a model name is configured**: rejected, an endpoint that spends the host's keys would appear without the operator turning anything on.
