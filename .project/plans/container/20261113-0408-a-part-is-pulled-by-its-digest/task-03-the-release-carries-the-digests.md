---
title: The release carries the digests
status: todo
depends: [task-01-the-publish-job-writes-the-digests.md]
layer: "release workflow"
refs:
  - "[code://.github/workflows/release.yml#L22](../../../../.github/workflows/release.yml#L22) - the release job"
  - "[code://.github/workflows/release.yml#L117-L118](../../../../.github/workflows/release.yml#L117-L118) - the Pack step"
  - "[code://.github/workflows/release.yml#L243-L281](../../../../.github/workflows/release.yml#L243-L281) - the parts job"
---

## Objective

The release job runs after the parts job, and the `@ahpd/computer` tarball it stages holds `images/digests.json`.
A part that fails stops the npm stage, and a dry run packs with no digests.

## Files

- `UPDATE: .github/workflows/release.yml:22` - add `needs: parts` to the release job.
- `UPDATE: .github/workflows/release.yml:117-118` - put the parts job's `digests.json` in `packages/computer/images/` before the Pack step.
- `UPDATE: .github/workflows/release.yml:243-281` - upload `packages/computer/images/digests.json` as an artifact after the push.

## Steps

1. Add `needs: parts` to the release job.
2. In the parts job, upload `packages/computer/images/digests.json` with `actions/upload-artifact` after `Build the parts, and push them`, when `dry_run` is not true.
3. In the release job, download that artifact into `packages/computer/images/` with `actions/download-artifact` before the Pack step, when `dry_run` is not true.
4. Add a step after Pack, when `dry_run` is not true, that refuses a `@ahpd/computer` tarball with no `package/images/digests.json`.
5. Read the tarball with `tar -tzf`, as the step that checks version ranges reads each tarball.
6. Say in a comment on `needs: parts` why the stage waits: the package carries the digests the parts job learns.

## Validation

- A dry run of `release.yml` on the PR's branch passes, and its release job starts after its parts job.
- The PR's description says the parts job now comes before the npm stage, so a failed part stops the release.
- After the next tag run, `tar -tzf` on the staged `@ahpd/computer` tarball lists `package/images/digests.json`.

## Resume
