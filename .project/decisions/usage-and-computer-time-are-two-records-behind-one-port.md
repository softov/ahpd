---
title: Model use and computer time are two record types behind one usage port
status: proposed
date: 2026-10-01
refs:
  - "[code://packages/sdk/src/types/plugin.ts#L30-L41](../../packages/sdk/src/types/plugin.ts#L30-L41) - `PortKey`, the closed union a new port joins"
  - file:///github/ahp-review/prospect/ahp-user-rules.md - the policy draft whose kinds these records feed
---

## Context

Usage comes from three places: a proxy call, an agent's model calls in a turn, and a computer's running time.
A proxy call and an agent's model use are the same thing measured: tokens and cost for a model on a provider.
Computer time is an interval with a start, an end, cpu and memory, and no model.
A shared store (postgres, several daemons) is expected later, as a plugin.

## Decision

There are two record types: model use, written by the proxy and by the agent meter with a `source` of `proxy` or `agent`, and computer time.
Both are kept and totalled by one `usage` port.
Source: Softov, 2026-10-01, asked "Starting direction for the usage record": "models and agents same shape... computer another shape and store?"; then asked "one store port or two?": "One port, two record types".

## Consequences

A store plugin implements one port, and a report reads one place.
The default store may still write each type to its own file.

## Options

- **One record shape for everything** with a `kind` field: rejected, computer time has no model and model use has no interval.
- **Two ports**, one per record type: rejected, every store plugin would implement both and reports would join two sources.
