---
title: What a release needs before its tag
---

# What a release needs before its tag

`v0.15.0-rc.1` is out on npm under `next`, from `a7b0cfd7`, on 2026-11-04. `latest` stays on `0.14.0`. Status at 2026-11-12.

A pushed `v*` tag runs [release.yml](../../.github/workflows/release.yml) and stages every package. The tag comes last, and only on Softov's word.

## Left

1. *Before 0.15.0-rc.2*, the first release from `ahpio/ahpd`. It also pushes the image and the machine parts to `ghcr.io/ahpio`, where a host looks for them since #290.
   - PR #311, the release notes of what merged since 0.15.0-rc.1, merges.
   - PR #312, task 06 of daemon/20261110-0947, the downgrade check read as semver, merges.
   - A bump PR sets `0.15.0-rc.2` in each package of `PUBLISHED` and as the default `AHPD_TAG` of [docker/compose.yaml](../../docker/compose.yaml). It also dates the notes' Unreleased heading, as #231 and #233 did for 0.15.0-rc.1. The tag check in `release.yml` refuses a tag that the packages or the Compose file do not name.
2. *Before 0.15.0*: a working day on the daemon, the checks by hand, and the digest pin of [problems/part-images-are-pulled-by-a-tag-with-no-digest.md](../problems/part-images-are-pulled-by-a-tag-with-no-digest.md).

## Done

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
