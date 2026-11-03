---
title: A caller with user:write can mint a team key that holds proxy:call
status: open
date: 2026-11-03
severity: minor
blocks: []
refs:
  - "[code://packages/sdk/src/access/tokens.ts#L155-L160](../../packages/sdk/src/access/tokens.ts#L155-L160) - `boundTeam` checks `user:write` only"
  - "[code://packages/server/src/commands/token.ts#L246-L248](../../packages/server/src/commands/token.ts#L246-L248) - the command bounds a team key by `user:write` only"
  - git://2d622c94 - proxy/20261029-2014 added team keys
  - git://77ba53f8 - main when the problem was read
---

## Symptom

Read from the code in the review of 2026-11-03, and not reproduced.
A caller holds `user:write` and does not hold `proxy:call`.
The caller mints a team key, and the key opens the proxy.

## Cause

A person's key is bounded by the grants its minter holds.
A team has no grants, so `boundTeam` checks only `user:write`, and a team key always carries `proxy:call`.

## Impact

A user administrator who may not call the proxy can make a credential that does.

## Workaround

Give `user:write` only to callers that may also call the proxy.

## Fix

- Make `boundTeam` also require `proxy:call` from the minter.
- Or accept it, and say in the docs that `user:write` includes the proxy.
