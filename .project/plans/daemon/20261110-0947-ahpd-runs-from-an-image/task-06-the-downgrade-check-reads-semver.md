---
title: The downgrade check reads versions as semver
status: implemented
depends: [task-02-the-entrypoint-seeds-plugins.md]
layer: "image"
refs:
  - "[code://docker/entrypoint.sh#L35-L40](../../../../docker/entrypoint.sh#L35-L40) - the downgrade check, which compares with `sort -V`"
  - "[code://docker/test/smoke.sh#L192-L223](../../../../docker/test/smoke.sh#L192-L223) - `check_upgrade`, the check the new cases sit beside"
  - "[code://packages/server/src/compat.ts#L8-L13](../../../../packages/server/src/compat.ts#L8-L13) - the server already reads versions with node-semver"
  - https://semver.org/#spec-item-11 - a pre-release is lower than its release: `0.15.0-rc.1` < `0.15.0`
---

## Objective

The entrypoint compares the image version and the volume's `image-version` with the semver package that the server ships.
An image that moves from a pre-release to its release starts, and an image older than the volume is still refused.

## Files

- `UPDATE: docker/entrypoint.sh:35-40` - the comparison runs in `node` with the server's `semver`, in place of `sort -V`.
- `UPDATE: docker/test/smoke.sh:192-223` - two cases beside `check_upgrade`, for a pre-release and its release.

## Steps

1. Resolve `semver` from the `@ahpd/server` folder in `/opt/ahpd`, with `require.resolve` and its `paths` option.
2. Refuse the start only when `semver.lt(image, volume)` is true and `AHPD_ALLOW_DOWNGRADE` is not `1`.
3. Stop with the step's own line when a version is not valid semver.
4. Add a smoke case: a pre-release image refuses a volume at its own release.
5. Add a smoke case: a volume whose `image-version` is a lower pre-release of the same version starts.
6. Remove `sort` from the entrypoint.

## Validation

- `bash docker/test/smoke.sh ahpd:dev` passes, with the two new cases.
- By hand, outside the image: `semver.lt('0.15.0-rc.1', '0.15.0')` is true, so a volume at `0.15.0-rc.1` starts the `0.15.0` image.
- `shellcheck docker/entrypoint.sh` passes.
- The CI `image` job passes on the PR.

## Resume


- **Done so far:** `docker/entrypoint.sh` compares the image and volume versions with `semver.lt`, from the `semver` that `/opt/ahpd/lib/node_modules/@ahpd/server` resolves. A version semver cannot read stops the start with the step's line, and `AHPD_ALLOW_DOWNGRADE=1` skips the check. `sort` is gone. `docker/test/smoke.sh` has two cases after `check_upgrade`. In the first, a pre-release image refuses a volume at its own release. In the second, a volume at `X.Y.Z-0` starts the image and then holds its version. `docs/server/DOCKER.md` says that a pre-release is older than its release.
- **Verified on 2026-11-12:** `bash docker/test/smoke.sh ahpd:semver-check` passed every check, with the two new cases, on an image built from this branch. `check_upgrade` skipped, because `ghcr.io/ahpio/ahpd:0.14` does not exist. shellcheck passed on `docker/entrypoint.sh`, run from `koalaman/shellcheck:stable`. By hand, `semver.lt('0.15.0-rc.1', '0.15.0')` is true. The CI `image` job runs on the PR.
- **Next action:** review.
- **Open questions:** none.
- **Watch out for:** the refusal case is skipped on a released image, and the start case runs on every image.

Files changed by this task: `docker/entrypoint.sh`, `docker/test/smoke.sh`, `docs/server/DOCKER.md`.
