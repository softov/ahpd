---
title: Search providers are tried in the order the configuration lists them
status: accepted
date: 2026-09-26
refs:
  - "[code://packages/agent-cofold/src/capabilities.ts#L63-L70](../../packages/agent-cofold/src/capabilities.ts#L63-L70) - `searchProviders`, a fixed Brave, Tavily, DuckDuckGo order"
  - "[code://packages/agent-cofold/src/capabilities.ts#L125-L136](../../packages/agent-cofold/src/capabilities.ts#L125-L136) - `searchOf`, which rebuilds the configuration in that fixed order"
  - "file:///github/cofold/packages/tools/src/web.ts - `web({ search })`, which tries the array it is given in order, the first that answers winning"
---

## Context

`web({ search })` tries its providers in the array's order and skips a failing one.
ahpd builds that array in a fixed order whatever the configuration says, and `searchOf` rebuilds the parsed value in the same fixed order, so the order a person writes is lost twice.

## Decision

Providers are tried in the order the configuration lists them under `tools.web.search`.
Source: Softov, 2026-09-26, asked "Should search providers be tried in the order the configuration writes them, rather than the fixed Brave, Tavily, DuckDuckGo?": "Configured order".

## Consequences

`searchOf` keeps the keys in the order it meets them, and `searchProviders` builds the array in that order.
`@cofold/tools` already keeps the order of the array it is given, so it does not change.

## Options

- **A fixed order.** Simple, but a person who prefers a free provider first cannot say so.
