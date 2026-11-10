---
title: The release job pushes the image
status: todo
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

