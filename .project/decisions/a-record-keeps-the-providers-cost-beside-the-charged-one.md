---
title: A record keeps the provider's cost beside the cost it charges, and a configured price is what it charges
status: accepted
date: 2026-10-07
refs:
  - "[code://packages/sdk/src/types/usage.ts#L21-L29](../../packages/sdk/src/types/usage.ts#L21-L29) - `Cost`, one amount today"
  - "[code://packages/server/src/proxy/listener.ts#L225-L238](../../packages/server/src/proxy/listener.ts#L225-L238) - the proxy's price, the only cost it writes today"
---

## Context

A provider can report what a call cost: OpenRouter sends `usage.cost` and its split in `cost_details`.
A harness reports a cost too: Claude, pi, cofold and ACP agents each send one.
A `price` on a `proxy.models` entry is a cost the host sets.
Until now a record had one `cost`.
It could not keep both the host's price and the provider's figure, so a price could not differ from what was paid.

## Decision

A record has two costs: `cost`, what its pools are charged, and `providerCost`, what the provider or harness reported.
When the provider reports a cost and no price is set, both hold the provider's figure.
When a price is set, `cost` is the price's result and `providerCost` is the provider's figure, if it reported one.
A missing cost is absent, never 0.
Source: Softov, 2026-10-07: "if a provider price is informmed use that in both. provider price and cost price. if a cost is informed store provider as provider cost, and cost as internal cost. so that way resolve both cases and we also could proxy and tax the proxy."

## Consequences

A host can charge a markup over what the provider bills, and the margin shows as `usd` against `providerUsd`.
Totals and policy limits keep reading `cost`, so they count what a person is charged.
A price that is out of date shows as a gap between the two, not as a wrong figure.

## Options

- **The provider's figure wins over the price**: rejected, it leaves a host no way to charge a different amount from what it pays.
- **One cost, with `from` saying which**: rejected, it keeps one figure and loses the other.
