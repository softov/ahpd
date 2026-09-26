---
title: Every mount target is checked at create
status: todo
depends: []
layer: "computer"
refs:
  - "[code://packages/computer/src/manifest.ts#L574-L600](../../../../packages/computer/src/manifest.ts#L574-L600) - the collision check, which compares needs only with each other, and the mount order"
  - "[code://docs/COMPUTER.md#L220](../../../../docs/COMPUTER.md#L220) - \"a later one wins for the same target\", which Docker does not do"
  - "[code://test/fixtures/docker.mjs#L158](../../../../test/fixtures/docker.mjs#L158) - the fake takes every `-v`, duplicates included"
---

## Objective

A machine whose mounts share a target is refused at create, with a sentence naming both, whichever sources they come from.
This applies [A need and a mount at one target are refused](../../../decisions/a-need-and-a-mount-at-one-target-are-refused.md).
Today the docs' own `scratch` example mounts `/srv/claude-home:/ahpd/claude`, a Claude session adds `claudeConfigDirectory` at `/ahpd/claude`, and real Docker refuses the duplicate mount point.

## Files

- `UPDATE: packages/computer/src/manifest.ts:574-600` - one check over the plugin's `mounts`, the profile's, the body's, the needs' and the session folder, each named by where it came from.
- `UPDATE: test/fixtures/docker.mjs` - `create`/`run` refuse two `-v` with one target, as Docker does.
- `UPDATE: docs/COMPUTER.md:220` - the sentence says a shared target is refused; the `scratch` example stops colliding.
- `UPDATE: test/computer-needs.test.ts` - the cases below.

## Steps

1. Build the list of every mount with its origin before any flag is written, and refuse the first shared target with both origins in the sentence.
2. Remove the "widest first, so the narrower statement wins" comment and ordering claim, since nothing wins any more.

## Validation

- A profile mount and a need at one target are refused at create with both named; today the machine is made (the fake accepts it) and the case fails.
- The docs' `scratch` profile makes a machine for a Claude session.
- The fake refuses a duplicate target, so a later regression fails.

## Resume
