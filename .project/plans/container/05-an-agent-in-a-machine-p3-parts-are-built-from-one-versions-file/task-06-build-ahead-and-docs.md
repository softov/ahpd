---
title: A person can build ahead, and the docs say how
status: done
depends: [task-03-built-on-first-use.md, task-04-the-joined-image.md]
layer: "computer, docs"
refs:
  - "[code://scripts/computer.mjs](../../../../scripts/computer.mjs) - gains a `parts` verb"
  - "[code://docs/COMPUTER.md](../../../../docs/COMPUTER.md) - gains a Parts section"
---

## Objective

`node scripts/computer.mjs parts [<id>...|--all|--joined]` builds ahead, and `docs/COMPUTER.md` explains parts, the versions file and the joined image.

## Files

- `UPDATE: scripts/computer.mjs` - the verb, calling `parts.ts`.
- `UPDATE: docs/COMPUTER.md` - a Parts section.

## Steps

1. The verb prints each tag and whether it was built or already there.
2. The docs say where the file is, how to add a part, and that bumps come by pull request.

## Validation

- By hand: `parts --all` twice; the second builds nothing.

## Resume

Done 2026-10-04.

- The verb runs the plugin's own source, so it needs `node --import
  ./scripts/dev.mjs`. It says so in the refusal rather than answering with a
  `SyntaxError`, which is what a bare `import` of a `.ts` gives.
- It asks `hasImage` before `ensurePart`, not after. What the daemon had is the
  answer; after a build it always has the image, so "was already there" would
  never be printed.
- One part that will not build is one line and one non-zero exit, and the rest
  of the file is still warmed. An id the versions file does not name is refused
  by name.
- Real Docker, not the fake, is what caught the three Dockerfile bugs behind
  this task. The `case` block's five lines had no trailing backslash, so docker
  answered `unknown instruction: amd64)`; `launchers()` emitted its second step
  as ` && printf` with no backslash, so `unknown instruction: &&`; and the
  `after` statements of `download()` had no `;` between them, so `mkdir` took
  the result of `found=$(...)` as a second argument. Text assertions see none of
  the three. `writes()` is also two `printf`s rather than one: a single
  `printf '%s\n' a b c` prints one line per argument, and the launcher came out
  as four lines.
- **This worktree does have Docker and network**, which task 04's Resume says
  it does not. Task 04's own last validation - `codex-acp --help` mounted into
  `debian:bookworm-slim` - is therefore done and closed here rather than left
  open.
- The archive build was wrong in a way only a real archive showed.
  `--strip-components=1` assumes a wrapping directory and three of the five
  archive parts do not have one: opencode and amp ship the executable at the
  root, where stripping leaves nothing at all. Extraction is unstripped now,
  which costs nothing because the launcher finds the executable by name instead
  of naming a path.
- devin then needed the rest of it: it ships `bin/devin`, which is exactly where
  its launcher goes, so a launcher written over it execs itself. The launcher
  is now written only where nothing executable is already, on one line because
  `/bin/sh` has no `else` without a command after it and `else;` is a syntax
  error there.

Validated by hand, against real Docker, on this box:

- `parts devin` builds, and `devin --version` out of the mounted image answers
  `devin 3000.11.3 (9c803229faa4)` - the publisher's own binary, not a launcher
  pointing at itself.
- `parts opencode amp` build, and out of a container with both mounted
  `opencode --version` answers `1.18.34`. amp's launcher reads
  `exec /opt/ahpd/amp/amp-acp "$@"`, its own archive's file rather than itself.
- `parts node opencode` twice: the second answers `was already there` for both
  and builds nothing, which is step 1 of the validation.
- The refusals: an id the file does not name, and a `parts` with no id at all.

**Not run by hand:** `parts --all` and `parts --joined` end to end. The disk
here has under 5 GB free and fifteen parts plus the joined image do not fit
beside what the daemon already holds, so the two were exercised one id at a
time. `ensureJoined` itself is covered by `computer-parts-build.test.ts`
against the fake docker.
