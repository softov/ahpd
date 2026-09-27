---
title: The joined image
status: todo
depends: [task-02-a-part-image-per-kind.md]
layer: "computer"
refs:
  - "[code://.project/decisions/the-published-image-is-the-parts-joined.md](../../../decisions/the-published-image-is-the-parts-joined.md) - what it holds"
---

## Objective

`ensureJoined()` builds `ahpd-agents:<hash>`: `debian:bookworm-slim` with git, ripgrep and ca-certificates, and `COPY --from=<part tag> /opt/ahpd/<id> /opt/ahpd/<id>` for every part.

## Files

- `UPDATE: packages/computer/src/parts.ts` - `joinedDockerfile()`, `ensureJoined()`.
- `UPDATE: packages/computer/src/manifest.ts` - a profile with no `image` and no host default uses the joined image.

## Steps

1. Ensure every part, then build the joined image from their tags.
2. `PATH` in the image includes every part's `bin`.

## Validation

- The Dockerfile text copies every part once, from its tag.
- A profile with no image resolves to `ahpd-agents:<hash>`.

## Resume
