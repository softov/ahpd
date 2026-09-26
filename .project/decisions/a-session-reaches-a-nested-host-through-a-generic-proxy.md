---
title: A session reaches a nested host through a generic proxy backend in the SDK
status: accepted
date: 2026-09-26
refs:
  - "[code://packages/sdk/src/rpc.ts#L74-L100](../../packages/sdk/src/rpc.ts#L74-L100) - `createPeer`, the seam a stdio transport is built on"
  - npm://@microsoft/agent-host-protocol@0.9.0 - `AhpClient`, already a dependency of the SDK
  - "[code://.project/decisions/a-cofold-session-in-a-computer-runs-in-a-nested-host.md](a-cofold-session-in-a-computer-runs-in-a-nested-host.md) - why a nested host"
---

## Context

A cofold session in a computer runs in an ahpd inside it, and the outer host still owns the session a client sees.
Something in the outer host has to be that session's backend and forward it to the inner host.

## Decision

The SDK has a proxy backend that speaks AHP, with `AhpClient`, to a host started inside a computer over stdio, and presents the inner session as an outer one.
It is used for any backend that cannot move its process into a machine, not only cofold.
Source: Softov, 2026-09-26, asked "where does the proxy live?", answered "Generic SDK backend".

## Consequences

Cofold is the first user; pi or any in-process backend can use the same route.
The proxy forwards the inner session's actions as its own, so the inner host's protocol version must match the outer's.

## Options

- **Inside `@ahpd/agent-cofold`.** Smaller now, and the next in-process backend would need it again.
