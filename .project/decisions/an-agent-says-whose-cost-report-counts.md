---
title: Each agent says whether its cost comes from the harness or the provider
status: accepted
date: 2026-10-02
refs:
  - "[code://packages/sdk/src/meter.ts](../../packages/sdk/src/meter.ts) - where a turn's model use is recorded"
---

## Context

An agent's harness calls its model itself: Claude on a subscription, pi on OpenRouter, cofold on a provider it picks.
The cost of a turn can be what the harness reports or what the provider charges, and the two can differ.

## Decision

`proxy:` rules apply to agent rows through a setting on each agent: it names whether that agent's cost is the harness's report or the provider's, and a mismatch between the two, where both are known, is flagged.
Source: Softov, 2026-10-02, asked "does a `proxy:` rule apply to agent rows, whose harness calls its model itself?": "Per-agent setting".

## Consequences

The same model rules cover a call through the proxy and a call a harness made itself.
An agent with no setting needs a default, which the policy plan picks.

## Options

- **Only calls through the proxy**: rejected, most model use never passes it.
- **Always apply, from the provider**: rejected, a subscription has no per-call provider price.
