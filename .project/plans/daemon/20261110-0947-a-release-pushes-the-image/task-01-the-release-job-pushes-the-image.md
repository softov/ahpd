---
title: The release job pushes the image
status: implemented
depends: []
layer: "ci"
refs:
  - "[code://.github/workflows/release.yml#L213-L262](../../../../.github/workflows/release.yml#L213-L262) - the `parts` job, the shape this job copies"
  - "[code://.github/workflows/release.yml#L70-L84](../../../../.github/workflows/release.yml#L70-L84) - `CHANNEL`, which decides `latest` or `next`"
  - "[code://packages/computer/src/parts.ts#L63-L81](../../../../packages/computer/src/parts.ts#L63-L81) - how the owner is read from `repository`"
---

## Objective

A `v*` tag pushes `ghcr.io/<owner>/ahpd` for both platforms once the `release` job passes.
A `dry_run` builds both platforms and pushes nothing.

## Files

- `UPDATE: .github/workflows/release.yml:56-67` - the tag check also compares the default `AHPD_TAG` in `docker/compose.yaml`.
- `UPDATE: .github/workflows/release.yml:213-262` - a new `image` job after the `parts` job.
- `CREATE: .project/pending/docker-image-first-push.md` - make the `ahpd` package public on GHCR once, after the first push.

## Steps

1. Fail the tag check when the default `AHPD_TAG` in `compose.yaml` does not match the version.
2. Add the `image` job with `needs: release`, `packages: write`, `id-token: write` and a 90-minute timeout.
3. Read the owner from the `repository` field of `packages/server/package.json`, lowercased.
4. Set up QEMU, buildx and the GHCR login as the `parts` job does.
5. Compute `CHANNEL` from the version as the `release` job does.
6. Make the tags with `docker/metadata-action`: the version, `X.Y` and `X` for a stable one, and `latest` or `next` from `CHANNEL`.
7. Make the labels `org.opencontainers.image.version`, `.revision` and `.source`.
8. Build with `docker/build-push-action` for `linux/amd64,linux/arm64`, with `provenance: true` and `sbom: true`.
9. Push only when `dry_run` is not true.
10. Write the pending file when the first tag pushes.

## Validation

- A `workflow_dispatch` run with `dry_run: true` builds both platforms and pushes nothing.
- The tag list for `0.16.0-rc.1` is `0.16.0-rc.1` and `next`, with no `latest`, `0.16` or `0`.
- The tag list for `0.16.0` is `0.16.0`, `0.16`, `0` and `latest`.
- A tag whose `compose.yaml` still defaults to the last version fails the tag check.

## Resume

- **Done so far:** the tag check also reads the default `AHPD_TAG` from `docker/compose.yaml` and fails unless it is the image the tag publishes: `X.Y` for a stable version and the full version for a pre-release. `release.yml` has an `image` job after `parts`, with `needs: release`, `packages: write`, `id-token: write` and a 90-minute timeout: it reads the owner from the `repository` field of `packages/server/package.json` and lowercases it, sets up QEMU, buildx and the GHCR login as `parts` does, computes `CHANNEL` from the server's version, and lets `docker/metadata-action@v5` make `{{version}}` from the tag plus `{{major}}.{{minor}}` and `{{major}}` only on `latest`, and `$CHANNEL` as a raw tag. `docker/build-push-action@v6` builds `linux/amd64,linux/arm64` with `provenance: true` and `sbom: true`, pushes when `dry_run` is not true, and takes the labels `org.opencontainers.image.version`, `.revision` and `.source`. `.project/pending/docker-image-first-push.md` says to make the package public once and to untag a release npm refuses.
- **Next action:** the `workflow_dispatch` dry run, and then a tag run, in review.
- **Open questions:** none.
- **Watch out for:** `actionlint` is not installed in this session, so the workflow is checked by parsing the YAML only. A bash step cannot be run here either, so the compose check is exercised by a node script with the same rule: `0.15.0-rc.1` passes against the default of `0.15.0-rc.1` today, and `0.16.0-rc.1`, `0.15.0` and `0.16.0` fail until the default moves. The tag lists are `0.16.0-rc.1`, `next` for a pre-release and `0.16.0`, `0.16`, `0`, `latest` for a stable version, from the `enable` on the two partial patterns. The image is public before npm is approved: the pending file says to untag by hand.
