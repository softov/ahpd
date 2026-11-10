---
title: Main pushes an edge image
status: todo
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

