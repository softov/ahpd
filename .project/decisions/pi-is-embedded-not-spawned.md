---
title: The pi backend embeds `AgentSession` in the daemon's process rather than spawning `pi --mode rpc`
status: accepted
date: 2026-09-24
refs:
  - code://packages/agent-pi/src/backend.ts - the narrow seam over the embedded session
  - code://packages/agent-pi/src/session.ts - what drives it, and the `open` parameter a test replaces
  - code://.project/decisions/agent-package-only-when-it-brings-a-runtime.md - why pi is a package at all
  - code://packages/agent-acp/src/connection.ts - the spawned-server backend this one is not
  - file:///github/ahpd/packages/agent-pi/node_modules/@earendil-works/pi-coding-agent/dist/core/sdk.d.ts - `createAgentSessionServices` and `createAgentSessionFromServices`
  - file:///github/ahpd/packages/agent-pi/node_modules/@earendil-works/pi-coding-agent/dist/core/agent-session.d.ts - `AgentSession`, its event union and `navigateTree`
---

## Context

pi ships two ways to drive it. `pi --mode rpc` is a subprocess speaking JSON-RPC over stdio, which is the shape `@ahpd/agent-acp` already has and the shape `@ahpd/agent-claude` has through the Claude Agent SDK. `createAgentSessionFromServices` builds an `AgentSession` in the calling process, which is what pi's own terminal, print and RPC modes are each an I/O layer over.

The reflex is the subprocess: it is what the other two backends do, and a crashing agent taking the daemon with it is a real cost.

It buys less here than it looks. A subprocess does not isolate the model credentials - pi resolves them from its own settings either way - and it does not isolate the files, because the daemon already runs as whoever started it and the agent works in a directory the daemon served. What it adds is process lifecycle, stdio backpressure, and a second serialization of every delta on the way to a client that is already going to receive it as JSON.

It also costs the two things that make pi map onto this protocol cleanly. `steer()` and `navigateTree()` are methods on `AgentSession`; over RPC they are commands whose effect has to be inferred from the event stream that follows. Steering and truncation are exactly the two places where this backend is more honest than a bridge usually manages, and both are direct calls.

## Decision

`@ahpd/agent-pi` constructs `AgentSession` in the daemon's process.

`backend.ts` is a narrow interface - `PiBackend` - over that session, and everything above it works against the interface rather than against pi. `piSession` takes how to open one as a parameter whose default is the real thing, so the whole turn lifecycle can be driven in a test with no credentials, no network and no session file.

The failure mode is accepted rather than ignored: a throw out of `prompt` fails that turn with what went wrong, and the session stays. What is not defended against is pi taking the process down, which a subprocess would have contained.

## Consequences

Steering is `steer()` and truncation is `navigateTree()`, so `Session.steer` and `rewindAt` mean what the protocol says rather than approximating it.

The event union is consumed as a typed value rather than parsed off a pipe, so a change in pi's events is a compile error in `mapping.ts` instead of a turn that silently stops updating.

pi's version is this package's dependency and its API is not a stable protocol, so a pi release can break this package in a way an RPC bridge would have absorbed. The narrow `PiBackend` seam is where that is felt, and it is one file.

A pi that throws where it should reject takes the daemon down, and every other session with it. A subprocess is the answer if that happens, and the seam is already the place to put one: `openPi` would become a second implementation of `PiBackend` and nothing above it would change.

## Options

- **`pi --mode rpc` as a subprocess**, the shape `agent-acp` has.
  Rejected: it isolates neither credentials nor files, adds a serialization hop per delta, and turns two direct calls that map exactly onto the protocol into commands whose effect has to be inferred from the stream.
- **Both, chosen by an option.**
  Rejected for now: two transports is two sets of behaviour to keep in step before either has been used in anger. The seam makes it a later addition rather than a rewrite.
- **A worker thread.**
  Rejected: it has the subprocess's serialization cost and the embedded version's blast radius, since a worker that exhausts memory takes the process with it.
