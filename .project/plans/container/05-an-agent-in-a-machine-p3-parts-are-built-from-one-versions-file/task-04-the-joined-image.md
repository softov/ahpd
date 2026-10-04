---
title: The joined image
status: todo
depends: [task-02-a-part-image-per-kind.md]
layer: "computer"
refs:
  - "[code://.project/decisions/the-published-image-is-the-parts-joined.md](../../../decisions/the-published-image-is-the-parts-joined.md) - what it holds, and that it is the default image"
  - "[code://packages/computer/src/plugin.ts#L267](../../../../packages/computer/src/plugin.ts#L267) - the image a machine falls back to"
  - "[code://packages/computer/src/plugin.ts#L38](../../../../packages/computer/src/plugin.ts#L38) - `defaults.image`"
---

## Objective

`ensureJoined()` builds `ahpd-agents:<hash>`: `debian:bookworm-slim` with git, ripgrep and ca-certificates, and `COPY --from=<part tag> /opt/ahpd/<id> /opt/ahpd/<id>` for every part.

## Files

- `UPDATE: packages/computer/src/parts.ts` - `joinedDockerfile()`, `ensureJoined()`.
- `UPDATE: packages/computer/src/plugin.ts:38,267` - `defaults.image` stays `debian:bookworm-slim` with its parts mounted; the joined image is ensured, when a machine is made rather than at load, only for a runtime that cannot mount image parts (plan row, Softov 2026-10-04).
- `UPDATE: packages/computer/test/` every test that asserts the default image - name an image, or expect the joined tag.

## Steps

1. Ensure every part, then build the joined image from their tags; the joined hash is `hashOf` from task 01, which folds in the `ahpd` part's `tagOf`.
2. `PATH` in the image includes every part's `bin`.
3. A part whose build fails refuses only the machines that need that part, with a sentence naming the part; every other machine is made. Where the joined image is built, it is built without the failed part and labelled with the parts it holds, so a machine needing it is refused and every other one is made.
4. A machine with no image named stays on `debian:bookworm-slim` with its parts mounted; only a runtime that cannot mount image parts (`docker` older than the `type=image` mount, or one that refuses it) is made from the joined image.

## Validation

- The Dockerfile text copies every part once, from its tag.
- A failing build of one part (the fake Docker fails `build` for `ahpd-part/goose`) refuses a machine whose agent needs goose, naming goose, and makes a machine whose agent does not.
- A machine with no image named is made from `debian:bookworm-slim` with its parts mounted, and no joined build runs; a fake runtime that refuses `--mount type=image` is made from the joined image.

## Resume
