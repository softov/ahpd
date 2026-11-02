---
title: A dispatch answered is not refused after
status: planned
depends: []
layer: "sdk host"
refs:
  - "[code://packages/sdk/src/host.ts](../../../../packages/sdk/src/host.ts) - `originOf`, `answeredBy` and `refuseFailed`"
---

## Objective

A dispatch whose apply answered it and then threw is logged, never refused.

## Files

- `UPDATE: packages/sdk/src/host.ts` - the origins answered are held; `refuseFailed` refuses only an unanswered one.
- `UPDATE: packages/sdk/test/host-turn.test.ts` - a draft the backend says and then throws on is answered once.

## Steps

1. Hold each origin an answer carried, in `originOf` and in `answeredBy`.
2. In `refuseFailed`, log a failure of an answered dispatch and send nothing.

## Validation

- `pnpm exec vitest run packages/sdk/test/host-turn.test.ts` - passes; the new case fails on e4694965.
