---
title: The joined image
status: todo
depends: [task-02-a-part-image-per-kind.md]
layer: "computer"
refs:
  - "[code://.project/decisions/the-published-image-is-the-parts-joined.md](../../../decisions/the-published-image-is-the-parts-joined.md) - what it holds, and that it is the default image"
  - "[code://packages/computer/src/plugin.ts#L233](../../../../packages/computer/src/plugin.ts#L233) - the image a machine falls back to"
  - "[code://packages/computer/src/plugin.ts#L37](../../../../packages/computer/src/plugin.ts#L37) - `defaults.image`"
---

## Objective

`ensureJoined()` builds `ahpd-agents:<hash>`: `debian:bookworm-slim` with git, ripgrep and ca-certificates, and `COPY --from=<part tag> /opt/ahpd/<id> /opt/ahpd/<id>` for every part.

## Files

- `UPDATE: packages/computer/src/parts.ts` - `joinedDockerfile()`, `ensureJoined()`.
- `UPDATE: packages/computer/src/plugin.ts:37,233` - with no `image` option, the fallback is the joined image, ensured when a machine is made rather than at load.
- `UPDATE: packages/computer/test/` every test that asserts the default image - name an image, or expect the joined tag.

## Steps

1. Ensure every part, then build the joined image from their tags.
2. `PATH` in the image includes every part's `bin`.

## Validation

- The Dockerfile text copies every part once, from its tag.
- A plugin with no `image` option and a profile with no image make a machine from `ahpd-agents:<hash>`.

## Resume
