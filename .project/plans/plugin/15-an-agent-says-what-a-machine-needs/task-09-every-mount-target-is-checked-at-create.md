---
title: Every mount target is checked at create
status: done
depends: []
layer: "computer | docs"
refs:
  - "[code://packages/computer/src/manifest.ts#L594-L621](../../../../packages/computer/src/manifest.ts#L594-L621) - the target check, which compares needs only with each other, and the \"widest first\" mount order"
  - "[code://packages/computer/src/manifest.ts#L109-L116](../../../../packages/computer/src/manifest.ts#L109-L116) - `ManifestDefaults.mounts`, documented as \"the later entry wins\""
  - "[code://packages/computer/src/runtime.ts#L666-L674](../../../../packages/computer/src/runtime.ts#L666-L674) - the dev container route, where mounts and copy-ins both become `--mount` binds"
  - "[code://packages/computer/src/runtime.ts#L726-L730](../../../../packages/computer/src/runtime.ts#L726-L730) - the Docker route's `-v` flags and the same-path session folder"
  - "[code://packages/computer/test/fixtures/docker.mjs#L192](../../../../packages/computer/test/fixtures/docker.mjs#L192) - the fake takes every `-v`, duplicates included"
  - "[code://docs/COMPUTER.md#L220](../../../../docs/COMPUTER.md#L220) - \"a later one wins for the same target\", which Docker does not do"
  - "[code://docs/COMPUTER.md#L237](../../../../docs/COMPUTER.md#L237) - the `scratch` example mounts `/ahpd/claude`, where Claude's config need lands"
---

## Objective

A machine whose mounts share a target is refused at create, with a sentence naming both and where each came from.
This applies [A shared target is refused at create only when what lands there differs](../../../decisions/a-shared-target-is-refused-only-when-the-mounts-differ.md).
Today the docs' own `scratch` example mounts `/srv/claude-home:/ahpd/claude`, a Claude session adds `claudeConfigDirectory` at `/ahpd/claude`, and real Docker refuses the duplicate mount point after the fake accepted it.

## Files

- `UPDATE: packages/computer/test/fixtures/docker.mjs:192` - first: `create` and `run` refuse two `-v` with one target, with Docker's own wording.
- `UPDATE: packages/computer/src/manifest.ts:594-621` - one check over every mount the machine will carry, each with its origin: the plugin's `mounts`, the profile's, the body's, each need mount, each copy-in when the machine is a dev container (the CLI route binds them), and the folder (the session's or the profile's, at its own path, on the Docker route).
- `UPDATE: packages/computer/src/manifest.ts:109-116`, `:616-620` - the "later entry wins" and "widest first, so the narrower statement wins" comments say what the order is and that a shared target is refused.
- `UPDATE: docs/COMPUTER.md:220` - a shared target is refused, with both named.
- `UPDATE: docs/COMPUTER.md:237` - the `scratch` example stops colliding: it drops the mount and points the need instead (`"needs": { "claudeConfigDirectory": "/srv/claude-home" }`).
- `UPDATE: packages/computer/test/computer-needs.test.ts` - the cases below.

## Steps

1. Build the list of every mount with its origin before any flag is written, and refuse the first shared target with both origins in the sentence: "the profile's mount /srv/claude-home:/ahpd/claude and need claudeConfigDirectory both land at /ahpd/claude".
2. Name a need by its need name and a mount by the `source:target` the operator wrote; never print an env need's value, which is not a mount and does not join the list.
3. The existing needs-only check (`machine needs A and B both land at T`) becomes a case of the one check, and its test keeps passing with the new wording.
4. `packages/computer/test/computer-disposable.test.ts` loads the docs' disposable example, so it moves with the `scratch` change.
5. Two needs with the same kind, source, target and `readOnly` are one entry in the list, not a clash (`container/05-p6` task 05, `sameNeed`); whichever of the two tasks lands second keeps that.

## Validation

- A profile mount and a need at one target are refused at create with both named; today the machine is made (the fake accepts it) and the case fails.
- A profile `folder` at a target a need also uses is refused.
- A dev container whose copy-in and need share a target is refused.
- The docs' `scratch` profile makes a machine for a Claude session.
- The fake refuses a duplicate `-v` target, so a later regression fails.

## Resume
