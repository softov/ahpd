---
title: The agents-channel case counts one change
status: implemented
depends: []
layer: "sdk tests"
refs:
  - "[code://packages/sdk/test/agents-channel.test.ts](../../../../packages/sdk/test/agents-channel.test.ts) - the case"
---

## Objective

The case counts a `root/agentsChanged` that sends the same list as the one before it as the same change.

## Files

- `UPDATE: packages/sdk/test/agents-channel.test.ts`.
- `DELETE: .project/problems/an-agents-channel-case-hears-two-changes.md`.

## Steps

1. Drop each change whose list is deep-equal to the change before it.
2. Say in a comment that the users watch sends the list again for the token `as` minted.
3. Delete the problem file.

## Validation

- The case passes, and passes with its wait raised to 1500 ms.

## Resume

Implemented 2026-11-13. See [implemented.md](implemented.md).
