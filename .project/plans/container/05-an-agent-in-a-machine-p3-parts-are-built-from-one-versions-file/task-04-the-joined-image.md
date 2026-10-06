---
title: The joined image
status: done
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

Done 2026-10-04, for the image. The machine-facing half is not implementable in
p3 and is written down here rather than designed around.

- `joinedDockerfile(parts, tags)` takes the tags rather than spelling them,
  because the ahpd part's tag carries the hash of its own source and only the
  build knows it. It is a single stage on `debian:bookworm-slim` - unlike a
  part, the joined image *is* a Debian, so a session's shell, git and ripgrep
  work in it without another base.
- `ensureJoined` ensures every part first and catches a failure rather than
  letting it out: the image is built without that part, `LABEL ahpd.parts` says
  what it does hold, and the answer carries `missing` so a machine whose agent
  needs the part can be refused by name. Refusing the whole image over one CLI
  would take thirteen working agents down with a fourteenth that will not
  download.
- `hashOf` grew a second argument, the parts to hash beside the file. It reads
  the file that ships either way, so a version move still moves the tag; the
  argument is what lets a caller that read its own file be hashed beside its own
  ahpd tag instead of the shipped one.
- The joined build is held by the same `once` as a part's, under its own tag, so
  two callers get one build of the fifteen-part image rather than two.

**Not done, and why.** Steps 3 and 4's machine-facing half - refusing a machine
that needs a part the joined image does not hold, and choosing the joined image
for a runtime that cannot mount image parts - cannot be written in p3. The SDK
has no `part` need kind (`NeedKind` is `directory | file | env | copy`), so
nothing names a part for a machine yet, and `--mount type=image` is written by
container/05 p4's tasks 01-03. What is here is the other half of step 3: the
image is built without a failed part and labelled with the parts it holds. The
refusal that reads `missing`, and `defaults.image` staying
`debian:bookworm-slim` (which it already is, unchanged, as the plan row asks),
are p4's to wire.

**Not run by hand:** `docker run --rm ahpd-agents:<hash> /opt/ahpd/codex/bin/codex-acp --help`
on a real Docker. There is no Docker and no network in this worktree.
