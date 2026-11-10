---
title: What a release needs before its tag
---

# What a release needs before its tag

`v0.15.0-rc.1` is out on npm under `next`, from `a7b0cfd7`, on 2026-11-04. `latest` stays on `0.14.0`. Status at 2026-11-09.

A pushed `v*` tag runs [release.yml](../../.github/workflows/release.yml) and stages every package. The tag comes last, and only on Softov's word.

## Left

1. *Before 0.15.0*: a working day on the daemon, and the checks by hand.

## Done

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
- **The Compose tag.** The bump sets the default `AHPD_TAG` in [docker/compose.yaml](../../docker/compose.yaml) to `0.15`, the `X.Y` of a stable version, or to the full version for a pre-release. The tag check in `release.yml` refuses a tag that the file does not name. After the first tag run, [docker-image-first-push.md](docker-image-first-push.md) makes the image public.
- **The checks by hand.** [triage.md](triage.md) orders them. The ones for features a user meets first:
  - [host-1620-terminal-tool-checks.md](host-1620-terminal-tool-checks.md), on Windows and macOS. It passed on Linux.
  - [cofold-resume-checks.md](cofold-resume-checks.md). The Claude resume passed on 2026-11-09, and the pi resume on 2026-11-10.
  - [host-1347-mcp-checks.md](host-1347-mcp-checks.md), the tools at `/mcp`.
  - [update-checks.md](update-checks.md).
  - [macos-checks.md](macos-checks.md) and [daemon-41-windows-checks.md](daemon-41-windows-checks.md), for the install on macOS and Windows. The install on Linux passed on 2026-11-09.
  - The grant role editor in ahpw: the subjects of #205, such as `operation`, `tunnel` and `client`, show and save. No file yet.

## Not in this release

- The move of the repository to `ahpio/ahpd`, proposed for after the release and not decided. It needs each package's `repository.url`, the 13 npm trusted publishers, and the docs links, then an rc from the new place.
- MayCXC's `host/124-an-agents-shell-is-a-terminal-the-person-sees` is not merged. Main has its features from the four host/20261103-1620 plans.
- `plans.mjs` lists the `active` and `draft` plans. None is needed for the release.
