---
title: A release pushes the image
domain: daemon
status: planned
priority: medium
created: 2026-11-10
revalidated: 2026-11-10
requires:
  - plans/daemon/20261110-0947-ahpd-runs-from-an-image/plan.md
changes:
  - specs/daemon.md
refs:
  - git://032300137 - the commit of ahpd this plan was revalidated at
  - "[code://.github/workflows/release.yml#L1-L30](../../../../.github/workflows/release.yml#L1-L30) - the `v*` trigger, `dry_run`, and the `release` job the image job waits for"
  - "[code://.github/workflows/release.yml#L70-L84](../../../../.github/workflows/release.yml#L70-L84) - `CHANNEL`, `next` for a pre-release and `latest` otherwise"
  - "[code://.github/workflows/release.yml#L213-L262](../../../../.github/workflows/release.yml#L213-L262) - the `parts` job: QEMU and buildx on one runner, GHCR login, `dry_run` pushes nothing"
  - "[code://packages/computer/src/parts.ts#L63-L81](../../../../packages/computer/src/parts.ts#L63-L81) - `registryOf`, the GHCR owner read from the package's `repository` field"
  - "[code://packages/server/package.json#L23](../../../../packages/server/package.json#L23) - the `repository` field the image owner is read from"
  - https://docs.docker.com/build/ci/github-actions/manage-tags-labels/ - `docker/metadata-action`, tags and labels from a Git ref
  - https://docs.docker.com/build/metadata/attestations/ - provenance and SBOM attestations from buildx
  - https://docs.github.com/en/packages/learn-github-packages/configuring-a-packages-access-control-and-visibility - a new package on a personal account is private until it is made public
---

## Goal

Each `v*` tag pushes the ahpd image to GHCR for `linux/amd64` and `linux/arm64`, once the release job's checks pass.
The image tags follow the version and the npm channel, so `0.15` follows patches and `next` follows pre-releases.
Each push to `main` pushes an `edge` image for testers.
The image is the one [daemon/20261110-0947-ahpd-runs-from-an-image](../20261110-0947-ahpd-runs-from-an-image/plan.md) builds.

## Reconnaissance

The files read and the patterns to reuse are the `refs` in the frontmatter, each with its note.

### Searches performed

- `rg -n "ghcr.io" .github packages/computer/src` - the `parts` job is the one GHCR push, and `registryOf` names the owner.
- `rg -n "Stage the release|approve" .github/workflows/release.yml` - npm packages are staged and approved by hand, so no job can wait for npm.

### Runtime path

```
git push v0.16.0 -> release job (checks, build, stage) -> image job -> buildx amd64 + arm64 -> ghcr.io/<owner>/ahpd:0.16.0, 0.16, 0, latest
git push main -> edge job -> ghcr.io/<owner>/ahpd:edge, sha-<short>
```

### Gaps

- No job builds or pushes an ahpd image.
- `Not found: an edge or nightly workflow - searched edge, nightly and schedule in .github/workflows.`

## Answers

| What | Source | Task |
| --- | --- | --- |
| The image job waits for the `release` job, then pushes at once, before npm approval | Softov, 2026-11-10, chose the recommended answer for "When should a v* tag push the ahpd image to GHCR?" | 01 |
| The image is `ghcr.io/<owner>/ahpd`, with the owner read from the server's `repository` field, lowercased | (defaulted: as `registryOf` reads it, so the move to ahpio needs no edit) | 01 |
| Both platforms on one runner, arm64 under QEMU | (defaulted: as the `parts` job builds them) | 01 |
| Stable tags `X.Y.Z`, `X.Y`, `X`, `latest`; a pre-release gets `X.Y.Z-rc.N` and `next` | [`code://.github/workflows/release.yml#L70-L84`](../../../../.github/workflows/release.yml#L70-L84) | 01 |
| A `dry_run` builds both platforms and pushes nothing | (defaulted: as the `parts` job does) | 01 |
| Provenance and SBOM attestations; no cosign signature | (defaulted: attestations first, cosign when someone asks) | 01 |
| GHCR only, no Docker Hub | (defaulted: one registry, beside the parts) | 01 |
| The tag check fails when the default `AHPD_TAG` in `docker/compose.yaml` does not match the version | Softov, 2026-11-10, chose the recommended answer for "Should I add the two run-from-GitHub paths to the Docker plans?" | 01 |
| `edge` and `sha-<short>` from each push to `main` | Softov, 2026-11-10, asked for the Docker install with an `edge` tag of `main` | 02 |

## Proposed architecture

- **Release** - a new `image` job in `release.yml`, `needs: release`, with `packages: write`.
- **Edge** - a new `edge.yml` on push to `main`, which runs the same build steps with the edge tags.
- **Tags** - `docker/metadata-action` makes the tags and the OCI labels from the version and `CHANNEL`.
- **Layer responsibilities** - workflows: build and push. `Dockerfile`: what is built, unchanged here.
- **Source-of-truth files** - [`code://.github/workflows/release.yml`](../../../../.github/workflows/release.yml), CREATE: `.github/workflows/edge.yml`.

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - The release job pushes the image](task-01-the-release-job-pushes-the-image.md) | todo | - |
| [02 - Main pushes an edge image](task-02-main-pushes-an-edge-image.md) | todo | 01 |

## Risks and tradeoffs

- The image is public before npm is approved - A release rejected on npm is untagged on GHCR by hand, and the docs say so.
- node-pty compiles under QEMU for arm64, which is slow - The job has a long timeout, and native runners are the fix if it passes it.
- The first push to a personal account is private - The pending file says to make the package public once.

## Resume state

- **Done so far:** the plan, 2026-11-10.
- **Next action:** [task-01-the-release-job-pushes-the-image.md](task-01-the-release-job-pushes-the-image.md), once [daemon/20261110-0947-ahpd-runs-from-an-image](../20261110-0947-ahpd-runs-from-an-image/plan.md) is built.
- **Open questions:** none.
- **Watch out for:**
`latest` must never go on a pre-release, as npm refuses one.
A tag push is a publish, so the job is tried with `dry_run` before any tag.
The `edge` build must not move `latest` or `next`.

## Final verification checklist

- [ ] A `dry_run` of `release.yml` builds both platforms and pushes nothing.
- [ ] After the first tag, `docker manifest inspect ghcr.io/<owner>/ahpd:<version>` lists `linux/amd64` and `linux/arm64`.
- [ ] After a push to `main`, `ghcr.io/<owner>/ahpd:edge` exists and its revision label is that commit.
