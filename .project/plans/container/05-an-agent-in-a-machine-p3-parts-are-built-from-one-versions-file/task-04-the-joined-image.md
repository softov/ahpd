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
- `UPDATE: packages/computer/src/plugin.ts:38,267` - which machines fall back to the joined image waits on the plan's open question; whatever it answers, it is ensured when a machine is made rather than at load.
- `UPDATE: packages/computer/test/` every test that asserts the default image - name an image, or expect the joined tag.

## Steps

1. Ensure every part, then build the joined image from their tags; the joined hash is `hashOf` from task 01, which folds in the `ahpd` part's `tagOf`.
2. `PATH` in the image includes every part's `bin`.
3. A part whose build fails refuses only the machines that need that part, with a sentence naming the part; every other machine is made. With answer (a) below, the joined image is then built without the failed part and labelled with the parts it holds, so a machine needing it is refused and every other one is made.
4. Which machines use the joined image by default waits on the open question in the plan's *Resume state*; do not change `defaults.image` until it is answered.

## Validation

- The Dockerfile text copies every part once, from its tag.
- A failing build of one part (the fake Docker fails `build` for `ahpd-part/goose`) refuses a machine whose agent needs goose, naming goose, and makes a machine whose agent does not.
- The default image case follows the answer to the open question.

## Resume
