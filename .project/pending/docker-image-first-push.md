---
title: Make the ahpd image public after its first push
plans:
  - plans/daemon/20261110-0947-a-release-pushes-the-image/plan.md
---

# Make the ahpd image public after its first push

`release.yml` pushes `ghcr.io/<owner>/ahpd` for `linux/amd64` and `linux/arm64` once the release checks pass, and `edge.yml` pushes `edge` from each push to `main`. A new package is private the first time, which is GitHub's default. Nobody else can pull the image until it is made public once on its package page: https://docs.github.com/en/packages/learn-github-packages/configuring-a-packages-access-control-and-visibility

The package exists now: Edge run 43315911087 pushed `ghcr.io/ahpio/ahpd:edge` and `sha-2a04b74` on 2026-11-12. Its visibility was not read, because the `gh` token here has no `read:packages`.

## Steps

1. Open the `ahpd` package page under the `ahpio` organization's packages.
2. Set the package's visibility to public.
3. Pull the image from a machine that is not signed in to GHCR: `docker pull ghcr.io/ahpio/ahpd:edge`.

## When npm rejects the release

The image is pushed before the packages are approved on npm, so the image can offer a version that npm does not.
Remove the tags from the image by hand on its package page when the release is refused there.
Then `docker pull` and `npm i` name the same versions.
`latest` is the one tag that a pre-release must never carry, as npm refuses a pre-release under it.
