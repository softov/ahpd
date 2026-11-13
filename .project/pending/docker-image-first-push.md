---
title: Make the ahpd image and the parts public after their first push
plans:
  - plans/daemon/20261110-0947-a-release-pushes-the-image/plan.md
---

# Make the ahpd image and the parts public after their first push

`release.yml` pushes `ghcr.io/<owner>/ahpd` for `linux/amd64` and `linux/arm64` once the release checks pass, and `edge.yml` pushes `edge` from each push to `main`. Its `parts` job pushes each machine part to `ghcr.io/<owner>/ahpd-part/<id>`, and the joined image to `ghcr.io/<owner>/ahpd-agents`. A new package is private the first time, which is GitHub's default. Nobody else can pull it until it is made public once on its package page: https://docs.github.com/en/packages/learn-github-packages/configuring-a-packages-access-control-and-visibility

A host pulls a part with no sign-in, in `packages/computer/src/parts.ts`. When the pull fails, it uses an earlier image of the part that it holds. A host with no earlier image cannot make a machine that needs the part.

## Status on 2026-11-12

- `ghcr.io/ahpio/ahpd` is public. Softov made it public after release run 43354150219, and an anonymous read of `0.15.0-rc.2`, `next` and `edge` answers 200.
- The 17 packages of the `parts` job answer 403 to an anonymous read. They are `ahpd-agents` and these 16 under `ahpd-part/`: `ahpd`, `node`, `claude`, `codex`, `copilot`, `gemini`, `cursor`, `devin`, `amp`, `goose`, `opencode`, `qwen`, `kilo`, `pi`, `copapo` and `dsh`.

## Steps

1. Open the `ahpio` organization's packages.
2. For each of the 17 packages above, open its page and set its visibility to public.
3. Tell Claude. Claude reads each one with no sign-in, and a 200 for each passes the check.

## When npm rejects the release

The image is pushed before the packages are approved on npm, so the image can offer a version that npm does not.
Remove the tags from the image by hand on its package page when the release is refused there.
Then `docker pull` and `npm i` name the same versions.
`latest` is the one tag that a pre-release must never carry, as npm refuses a pre-release under it.
