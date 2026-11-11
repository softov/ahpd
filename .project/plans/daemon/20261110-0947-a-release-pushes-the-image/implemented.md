---
title: A release pushes the image - implemented
date: 2026-11-11
refs:
  - git://a3048c8c1 - the merge of #285, both tasks
---

A `v*` tag pushes the ahpd image to GHCR for `linux/amd64` and `linux/arm64`, after the release job's checks pass.
Each push to `main` pushes `edge` and `sha-<short>`.
The tag check holds the default `AHPD_TAG` in `docker/compose.yaml` to the version.

## What was built

- [01 - The release job pushes the image](task-01-the-release-job-pushes-the-image.md).
- [02 - Main pushes an edge image](task-02-main-pushes-an-edge-image.md).

## Verified

- The `workflow_dispatch` dry run of `release.yml` on the PR branch passed on 2026-11-10.
- `edge.yml` passed on every push to `main` from #285 to `ca131f13d`.
- `ghcr.io/softov/ahpd:edge` holds `linux/amd64` and `linux/arm64`, and its revision label is `ca131f13d`, checked on 2026-11-11.
- An anonymous pull of the `edge` manifest answers 200, so the package is already public.

## Departures from the plan

- Each task's *Resume* section says what it found while it was built.

## Left for later

- The first `v*` tag after #285 is the first real run of the `image` job. Its image must list both platforms, as the plan's last check says.
