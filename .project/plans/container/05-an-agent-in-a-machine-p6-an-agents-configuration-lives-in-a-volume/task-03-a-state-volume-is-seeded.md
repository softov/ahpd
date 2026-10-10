---
title: A state volume is seeded when its seed changed
status: done
depends: [task-02-a-machine-gets-its-state-volumes.md]
layer: "computer"
refs:
  - https://docs.docker.com/reference/cli/docker/container/cp/ - copying into a created container
  - "[code://packages/computer/src/runtime.ts#L736-L744](../../../../packages/computer/src/runtime.ts#L736-L744) - the copy-in pattern this replaces for state"
---

## Objective

Before a machine starts, each state volume whose `.ahpd-seed.json` stamp differs from the seeds' current size and mtime is seeded: the named files are written, `keep` and `drop` applied, others left alone, and the stamp rewritten.

## Files

- `UPDATE: packages/computer/src/runtime.ts` - `seedState(volume, seeds, image)`.
- `UPDATE: packages/computer/test/fixtures/docker.mjs` - volumes that keep files across containers.

## Steps

1. Read the stamp with `docker run --rm -v <volume>:/s <base image> cat /s/.ahpd-seed.json` or, where the image has no shell, `docker cp` out of a created container.
2. Changed: `docker create -v <volume>:/s <base image>`, `docker cp` each seed (a JSON with `keep` or `drop` is filtered into a temporary file first), write the stamp, remove the container.
3. A seed whose host source does not exist is skipped with one log line naming it, and the others are seeded; the stamp records it as absent, so it is seeded once it appears.
4. `docker cp` leaves the copied files owned by root, which a non-root machine user cannot write. After the copy, read the machine's user as numeric ids once, with `docker run --rm --user <user> <base image> id -u` and `id -g`, where `<user>` is the image's `Config.User` or the dev container's `remoteUser`; then `docker run --rm --user 0 -v <volume>:/s debian:bookworm-slim chown -R <uid>:<gid> /s` over the seeded paths, the stamp and `/s` itself. A machine whose user is root skips it.
5. One seed per volume at a time.

## Validation

- The first create seeds; the second copies nothing; touching a seed reseeds that file only; a file the agent wrote stays.
- A seed whose host source is absent is skipped with a log line, the others land, and the create goes on.
- For an image whose `Config.User` is `node` (uid 1000), the fake Docker records the `chown -R 1000:1000` after the copy; for a root image it records none.
- A `.claude.json` seed with `keep: ["mcpServers"]` lands with that key alone, and a `settings.json` with `drop: ["security.auth"]` lands without it.

## Resume

- Built 2026-10-05 on cecc459.
- `seedState` in `dockerRuntime` (`runtime.ts`) runs for each state volume before `docker run` or `devcontainer up`, one per volume at a time through `once`.
- The stamp is read with `docker cp` out of a helper created from the machine's image and never started, for every image, so no shell is needed; the seeds and the stamp go in one tar on stdin, built in memory with `keep` and `drop` applied, so no temporary file is written.
- There is no chown image (2026-10-06): every entry of the archive carries the machine user's uid and gid, read once per image and user with `id -u` and `id -g`, and is written with `docker cp -a`.
- The helper mounts the volume at `/ahpd-seed/state` and the archive is written into `/ahpd-seed` under `state/`, so the volume root is an entry of its own; a real Docker check showed a `./` entry does not change the owner of the directory written into.
- A dev container that builds its image is seeded after `up` (2026-10-06): its user's ids are read with `docker exec ... id`, and each volume's stamp is read and its changed seeds written with `docker cp -a` into the running container at the state directory, the archive written into the directory above it so the root is an entry of its own; no helper is created and nothing is chowned.
- Checked once through the real Dev Container CLI with a built `USER node` image: everything in `/ahpd/claude` was `1000:1000` and `node` could write there.
- Files are walked with `lstat`: a link inside a seeded directory is skipped with one log line and never followed, and a seed whose source is a link is followed once.
- `filteredJson` and its key walk use own properties only.
- Tests: `packages/computer/test/computer-state-seed.test.ts` (8, new file), each failing before the change except the followed seed link, a guard; the fake Docker keeps file contents in volumes, answers `id` on `run --rm` and `exec`, records each entry's owner on `cp -a`, and answers an image's `Config.User`.
- Checked once against Docker 29.6.2 with a `USER node` image: the root, directories and files were `1000:1000`, `touch` as `node` worked, and a second create copied nothing.
