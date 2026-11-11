---
title: Main pushes an edge image
status: done
depends: [task-01-the-release-job-pushes-the-image.md]
layer: "ci"
refs:
  - "[code://.github/workflows/release.yml#L213-L262](../../../../.github/workflows/release.yml#L213-L262) - the build steps the edge job runs with other tags"
---

## Objective

Each push to `main` pushes `ghcr.io/<owner>/ahpd:edge` and `sha-<short>` for both platforms.

## Files

- `CREATE: .github/workflows/edge.yml` - on push to `main`: the build steps of the `image` job, with the edge tags.

## Steps

1. Write `edge.yml` on push to `main`, with `packages: write` and `id-token: write`.
2. Set `concurrency` so a newer push cancels an edge build that still runs.
3. Copy the build steps of the `image` job.
4. Set the tags to `edge` and `sha-<short>` only.
5. Set the version label to the server version with `-edge` after it.

## Validation

- A push to `main` makes `ghcr.io/<owner>/ahpd:edge`, whose revision label is that commit.
- `latest` and `next` do not move.

## Resume

- **Done so far:** `.github/workflows/edge.yml` runs on a push to `main`, with `packages: write`, `id-token: write` and a 90-minute timeout, and `concurrency` cancels a run a newer push replaces. It reads the image name and the server version as `release.yml`'s `image` job does, then builds `linux/amd64,linux/arm64` with `provenance: true` and `sbom: true` and pushes. The tags are `edge` and `sha-<short>` only, so `latest` and `next` stay where the release put them, and the version label is the server version with `-edge` after it.
- **Next action:** the first push to `main`, in review.
- **Open questions:** none.
- **Watch out for:** GitHub Actions is not reachable from this session, so nothing here is dispatched: the file is checked by parsing the YAML, and `actionlint` is not installed. The build steps are a copy of the `image` job in `release.yml`, so a change there has to be made here too; a reusable workflow is what would remove the copy, and the plan asks for the copy.
