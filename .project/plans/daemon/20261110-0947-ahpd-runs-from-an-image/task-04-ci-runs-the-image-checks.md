---
title: CI runs the image checks
status: todo
depends: [task-03-compose-runs-the-image.md]
layer: "ci"
refs:
  - "[code://.github/workflows/ci.yml#L218-L273](../../../../.github/workflows/ci.yml#L218-L273) - the `install` job, the shape the `image` job copies"
  - "[code://docs/server/REMOTE.md#L33-L47](../../../../docs/server/REMOTE.md#L33-L47) - the 426 and 401 answers the token check reads"
---

## Objective

Every PR builds the image for `linux/amd64` and runs `docker/test/smoke.sh` against it.
The script proves that the state survives a restart, a new container and an image swap.

## Files

- `CREATE: docker/test/smoke.sh` - the checks in *Steps*, each one a named function that prints its name and fails the script.
- `UPDATE: .github/workflows/ci.yml:218-273` - a new `image` job beside `install`: build the image, then run `smoke.sh`.

## Steps

1. Check that a fresh volume gets healthy, and that the token file has mode 0600.
2. Check that `GET /?tkn=<token>` answers 426 and a wrong token answers 401.
3. Check that `docker restart` keeps the token, `config.json` and the session list.
4. Check that `docker exec <container> ahpd restart` brings the container back with the same token.
5. Check that `docker rm` and a new container on the same volume keep the same state.
6. Check the upgrade: start the last released image, install a plugin, swap to the new image, and the plugin loads.
7. Skip the upgrade check with its reason while no released image exists.
8. Check that a terminal reports `isPty: true`.
9. Check that the image runs with `--read-only` and a tmpfs `/tmp`, or print why it cannot.
10. Add the `image` job to `ci.yml`, with a timeout and the build cached by buildx.
11. Build the image again in the job from the PR's head repository URL and commit, as `docker build <git url>#<sha>`.

## Validation

- `docker/test/smoke.sh ahpd:dev` passes on this machine.
- The `image` job passes on the PR, with both builds.
- A PR from a fork builds from the fork's URL, not from the base repository.
- `shellcheck docker/test/smoke.sh` passes.

## Resume

