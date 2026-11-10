---
title: CI runs the image checks
status: implemented
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

- **Done so far:** `docker/test/smoke.sh` takes the image as its first argument and runs eight named checks, each printing its name and stopping the script: a fresh volume gets healthy and the token file is mode 0600; the token answers 426 and a wrong one 401; a `docker restart` keeps the token and the sha256 of `connection-token`, `config.json` and every file under `sessions/`; `docker exec <container> ahpd restart` moves `State.StartedAt`, so the restart policy started the container again, with the same token; `docker rm` and a new container on the same volume keep the same state; the upgrade from the last released image keeps an installed `@ahpd/webhook` ready, and skips with its reason when no released image exists or none can be pulled; the terminal `pty()` returns a spawner; and the image gets healthy with `--read-only` and a tmpfs `/tmp`. Each container publishes an ephemeral loopback port, so nothing binds 9187 on the host, and the read-only check uses a volume of its own. `ci.yml` has a new `image` job after `install`: checkout, `docker/setup-buildx-action@v4`, `docker/build-push-action@v6` with `load: true`, `type=gha` cache and a 60-minute timeout, then the smoke script, then `docker build https://github.com/<head repository>.git#<head sha>`, which falls back to `github.repository` and `github.sha` on a push.
- **Next action:** review the checks below.
- **Open questions:** none.
- **Watch out for:** every Docker check is left for review, because Docker is denied in this mode. `shellcheck` is not installed here, so it was not run. `chmod` is denied too, so both scripts are mode 0644 in the tree; the CI step runs the smoke script with `bash` for that reason, and the file must be committed executable for the plan's own `docker/test/smoke.sh ahpd:dev` line. The checks that cannot pass yet are the ones the required plan [daemon/20261110-0947-a-container-holds-the-daemon](../20261110-0947-a-container-holds-the-daemon/plan.md) makes possible: `ahpd status --json` exits non-zero with no record, so `wait_healthy` never sees `healthy`, which fails the first check and every check after it, and `docker exec ahpd restart` never exits 75, so the container is not restarted by its policy. `plugin list --json` names a plugin by its id, so the upgrade check matches `@ahpd/webhook` by that name. The session part of the state check compares every file under `sessions/`, which is empty on a fresh volume and is covered when a session exists.

Files changed by this task: `docker/test/smoke.sh`, `.github/workflows/ci.yml`.

