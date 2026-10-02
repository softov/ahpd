---
title: A scheme provider may let a read through that its grant would refuse
status: accepted
date: 2026-10-02
refs:
  - "[code://packages/sdk/src/host.ts](../../packages/sdk/src/host.ts) - `capabilityFor` and `admit`, which turn a scheme URI into `<scheme>:read` and refuse before the provider runs"
  - "[code://packages/sdk/src/types/resources.ts](../../packages/sdk/src/types/resources.ts) - `ResourceProvider`"
---

## Context

A person reads their own, their teams' and their projects' usage pools without `usage:read` (decision `usage-is-read-through-a-usage-scheme`).
The host's gate turns every `usage:` URI into `usage:read` and refuses before the provider is reached, and `resourceList` and `resourceRead` do not tell a provider who is asking.
host/36 solved the same need for `user://<self>` with an excuse written into the host itself.

## Decision

`ResourceProvider` gains an optional `authorize?(uri, reader)`.
The gate awaits it before requiring the scheme's grant, and a provider that answers `true` lets that read through; `resourceList` and `resourceRead` pass the connection's principal to the provider, as `resourceWrite` already passes the owner.
Source: Softov, 2026-10-02, asked "How does a person read their own pools without the grant?": "Provider authorize hook".

## Consequences

Any scheme, a plugin's included, can open part of itself to a person without a host change.
A provider that answers wrongly opens what its grant would have closed, so `authorize` only widens a read and never a write.

## Options

- **A host special case, like host/36's own-record excuse**: rejected, the host would learn a rule that belongs to the scheme.
