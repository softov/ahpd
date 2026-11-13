---
title: What a release needs before its tag
---

# What a release needs before its tag

`v0.15.0-rc.2` is out on npm under `next`, from `8db0b85b5`, on 2026-11-12. `latest` stays on `0.14.0`. Status at 2026-11-12.

A pushed `v*` tag runs [release.yml](../../.github/workflows/release.yml) and stages every package. The tag comes last, and only on Softov's word.

## Left

1. *0.15.0-rc.2*: Softov makes the 17 part packages public, as [docker-image-first-push.md](docker-image-first-push.md) says. The `ahpd` image is public.
2. *Before 0.15.0*:
   - A working day on the daemon, and the checks by hand.
   - The digest pin of [problems/part-images-are-pulled-by-a-tag-with-no-digest.md](../problems/part-images-are-pulled-by-a-tag-with-no-digest.md).
   - The ahpd part at the release's own version: [problems/the-ahpd-part-does-not-follow-the-release.md](../problems/the-ahpd-part-does-not-follow-the-release.md).
   - Plain text for each operation, sent in the client's language: *Operations* in [briefs/the-text-a-person-reads-is-plain.md](../briefs/the-text-a-person-reads-is-plain.md#operations).

## Done

- **0.15.0-rc.2 on npm.** Softov approved the 13 staged packages on 2026-11-12. `npm view` gives `next: 0.15.0-rc.2` and `latest: 0.14.0` for each. `@ahpd/server@next` installs in an empty folder and says `0.15.0-rc.2`.
- **Main's CI after the approval.** The `image` job of run 43357606552 passed on its rerun, so `check`, `check-windows` and `image` are green at `150983cbe`.
- **The 0.15.0-rc.2 tag run.** Four PRs merged on 2026-11-12. PR #311 is the release notes, #312 the downgrade check read as semver, #313 the bump and #314 a flaky case. Dry run 43347391118 passed on the tree of `8db0b85b5`. Release run 43354150219 passed 9679 tests, staged the 13 packages under `next`, and pushed `ghcr.io/ahpio/ahpd:0.15.0-rc.2` and `:next`.
- **The release run's limits.** #313 runs the tests under `timeout 1500` and the job under 45 minutes. The first rc.2 dry run, 43336912861, reached the old limit of 600 s.
- **The ahpd part at 0.15.0-rc.1.** #313 moves it from 0.8.0, so the release pushed `ghcr.io/ahpio/ahpd-part/ahpd:0.15.0-rc.1-<hash>`.
- **npm trusts `ahpio/ahpd`.** Softov ran the 13 `npm trust github <package> --file release.yml --repo ahpio/ahpd --allow-stage-publish` commands, one for each package of `PUBLISHED`, on 2026-11-12.
- **The move to `ahpio/ahpd`.** #290 merged on 2026-11-11: each package's `repository` names `ahpio/ahpd`, and the machine parts come from `ghcr.io/ahpio`.
- **ahpw on the release candidate.** ahpw `aec9fd3` sets `@ahpd/sdk` to `^0.15.0-rc.1`, and `@ahpd/web 0.9.0-rc.1` is on npm.

- **The daemon on main.** Softov restarted the dev daemon on `4b5e1290` with `httpApi` and `modelApi` set, on 2026-11-04, and it works.
- **The release.** Run 41892315275 staged all 13 packages under `next`, and Softov approved them on 2026-11-04. `npm view` gives `next: 0.15.0-rc.1` and `latest: 0.14.0` for each. `@ahpd/server@next` installs in an empty folder and says `0.15.0-rc.1`.

- **The bump.** #231 sets `0.15.0-rc.1` in every published package. The update test takes a pre-release version.
- **A dry run.** Run 41876504603 on the bump branch: tests, build, pack and ranges pass, and the channel is `next`.
- **ahpw on the packed candidate.** ahpw at `acdcdb1`, with the packed `@ahpd/sdk 0.15.0-rc.1`, passes its typecheck and 756 tests.
- **The release notes.** [v0_15.md](../../docs/updates/v0_15.md) holds 0.15.0-rc.1, dated 2026-11-04 in #233, with the unreleased 0.14.1 section moved into it, and #149 to #229. Set the page's `date` when 0.15.0 is tagged.
- **The restart flag in ahpw.** ahpw #46, merged on 2026-11-04, reads `ahpd.restartNeeded` from the root config values.
- **The seven open problems** of the reviews of 2026-11-03 and 2026-10-20, fixed in #225 to #228.

## Before 0.15.0

- **A working day.** Softov uses the daemon on main for one working day: ahpw, VS Code, ahpc, bots, sessions and the tunnel. A fault is a problem file or a fix before 0.15.0.
- **The Compose tag.** The bump sets the default `AHPD_TAG` in [docker/compose.yaml](../../docker/compose.yaml). A stable version takes its `X.Y`, such as `0.15`, and a pre-release takes the full version. The tag check in `release.yml` refuses a tag that the file does not name. After the first tag run, [docker-image-first-push.md](docker-image-first-push.md) makes the image public.
- **The checks by hand.** [triage.md](triage.md) orders them. The ones for features a user meets first:
  - [cofold-resume-checks.md](cofold-resume-checks.md). The Claude resume passed on 2026-11-09, and the pi resume on 2026-11-10.
  - [host-1347-mcp-checks.md](host-1347-mcp-checks.md), the tools at `/mcp`.
  - [update-checks.md](update-checks.md).
  - [macos-checks.md](macos-checks.md) and [daemon-41-windows-checks.md](daemon-41-windows-checks.md), for the install on macOS and Windows. The install on Linux passed on 2026-11-09.
  - The grant role editor in ahpw: the subjects of #205, such as `operation`, `tunnel` and `client`, show and save. No file yet.

## Not in this release

- MayCXC's `host/124-an-agents-shell-is-a-terminal-the-person-sees` is not merged. Main has its features from the four host/20261103-1620 plans.
- `plans.mjs` lists the `active` and `draft` plans. None is needed for the release.
