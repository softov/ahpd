---
title: A part is pulled by its digest - implemented
date: 2026-11-13
refs:
  - git://9f5041db2 - main when the build started
  - "[code://scripts/parts-publish.mjs](../../../../scripts/parts-publish.mjs)"
  - "[code://packages/computer/src/parts.ts](../../../../packages/computer/src/parts.ts)"
  - "[code://.github/workflows/release.yml](../../../../.github/workflows/release.yml)"
---

An installed host pulls each machine part and the joined image by the digest the release published it at. The release writes the digests while it pushes the parts, and packs them into `@ahpd/computer`. A checkout pulls by tag and logs a warning for each part.

## What was built

- [`code://scripts/parts-publish.mjs`](../../../../scripts/parts-publish.mjs) - `digestOf` reads an image's digest with `docker buildx imagetools inspect --format '{{json .Manifest}}'`. `--push` keeps the digest of each image it pushed or found published. An image with no sha256 digest fails the run. The file goes to `packages/computer/images/digests.json`, sorted by tag. `--digests <file>` writes it elsewhere, with `--push` only.
- [`code://packages/computer/src/parts.ts`](../../../../packages/computer/src/parts.ts) - `digestsPath`, `digestOf(tag, path)` and `remoteOf(tag, log, path)`. The part pull and the joined image pull use `remoteOf`. `EnsureOptions.digests` names another digests file.
- [`code://.github/workflows/release.yml`](../../../../.github/workflows/release.yml) - the release job `needs: parts`. The parts job uploads `digests.json` as the artifact `parts-digests`. The release job downloads it into `packages/computer/images/` before Pack. A step refuses a computer tarball without `package/images/digests.json`. A dry run skips all three.
- `.gitignore` - names `packages/computer/images/digests.json`.
- [`code://packages/computer/test/fixtures/docker.mjs`](../../../../packages/computer/test/fixtures/docker.mjs) - `imagetools inspect --format` prints a manifest with a digest: the one `digests` names, else the sha256 of the reference.
- `docs/plugins/COMPUTERS.md` *Parts* and `DEVELOPER.md` - the digest pin, the checkout's warning, and the release job that waits for the parts job.

## Verified

- `packages/computer/test/parts-publish.test.ts`: 11 passed, 6 of them new.
  - The digests of a push, and of an image already published.
  - A registry answer with no sha256 digest.
  - No file for a rehearsal or `--local`, and `--digests` without `--push` refused.
- `packages/computer/test/computer-parts-build.test.ts`: 25 passed, 4 of them new.
  - A part by its digest, and a part by tag with one warning.
  - A malformed digests file refused by its path, and the joined image by its digest.
- `npx vitest run packages/computer` under the shared lock: 39 files, 627 passed, 1 skipped.
- `pnpm typecheck`, `pnpm boundary`, `pnpm i18n` and `pnpm docs:build` pass.
- `pnpm pack` of `packages/computer`, with a placeholder `images/digests.json`, lists `package/images/digests.json` in `ahpd-computer-0.15.0-rc.2.tgz`. The root `.gitignore` does not keep it out.
- No `digests.json` is left in the checkout after the runs.

## Departures from the plan

- Task 01 adds `--digests <file>`: the publish cases run the real script with `--push`, and without it they wrote into the checkout's `images`.
- Task 01 makes the publish cases run the script as an async child. Eleven synchronous runs held the worker for over a minute, and vitest reported `Timeout calling "onTaskUpdate"` with every case passing.
- Task 02 adds `EnsureOptions.digests`, the way `parts` names another versions file, and `digestOf` takes the path as the plan's step 8 says.
- Task 03 uses `actions/upload-artifact@v4` and `actions/download-artifact@v4`. No other workflow in the repository uses them. A dry run skips them, so the next tag run is their first run.

## Left for later

- The first tag run with the pin shows the staged `@ahpd/computer` with its digests, and a host from it that pulls by `@sha256:`. Both are in the plan's *Final verification checklist*.
