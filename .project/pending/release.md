---
title: What a release needs before its tag
---

# What a release needs before its tag

`v0.15.0-rc.1` is out on npm under `next`, from `a7b0cfd7`, on 2026-11-04. `latest` stays on `0.14.0`. Status at 2026-11-11.

A pushed `v*` tag runs [release.yml](../../.github/workflows/release.yml) and stages every package. The tag comes last, and only on Softov's word.

## Left

1. *Before the next release*: npm trusts `ahpio/ahpd` to publish each package, as *Trust the new repository* says.
2. *Before 0.15.0*: a working day on the daemon, and the checks by hand.

## Trust the new repository

The repository moved from `softov/ahpd` to `ahpio/ahpd` on 2026-11-11. npm publishes a package only from the repository it trusts for it, so each of the 13 packages in `PUBLISHED` of `release.yml` needs the new one.
Softov runs these, signed in to npm as the owner of `@ahpd`:

```sh
npm trust github @ahpd/sdk --file release.yml --repo ahpio/ahpd --allow-stage-publish
npm trust github @ahpd/activepieces --file release.yml --repo ahpio/ahpd --allow-stage-publish
npm trust github @ahpd/agent-claude --file release.yml --repo ahpio/ahpd --allow-stage-publish
npm trust github @ahpd/agent-cofold --file release.yml --repo ahpio/ahpd --allow-stage-publish
npm trust github @ahpd/agent-acp --file release.yml --repo ahpio/ahpd --allow-stage-publish
npm trust github @ahpd/agent-pi --file release.yml --repo ahpio/ahpd --allow-stage-publish
npm trust github @ahpd/bot --file release.yml --repo ahpio/ahpd --allow-stage-publish
npm trust github @ahpd/tasks --file release.yml --repo ahpio/ahpd --allow-stage-publish
npm trust github @ahpd/computer --file release.yml --repo ahpio/ahpd --allow-stage-publish
npm trust github @ahpd/push --file release.yml --repo ahpio/ahpd --allow-stage-publish
npm trust github @ahpd/webhook --file release.yml --repo ahpio/ahpd --allow-stage-publish
npm trust github @ahpd/tunnel-devtunnel --file release.yml --repo ahpio/ahpd --allow-stage-publish
npm trust github @ahpd/server --file release.yml --repo ahpio/ahpd --allow-stage-publish
```

After that, the first release from `ahpio/ahpd` is `0.15.0-rc.2`. It also pushes the image and the machine parts to `ghcr.io/ahpio`, where a host looks for them since #290.

## Done

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
  - [host-1620-terminal-tool-checks.md](host-1620-terminal-tool-checks.md), on Windows and macOS. It passed on Linux.
  - [cofold-resume-checks.md](cofold-resume-checks.md). The Claude resume passed on 2026-11-09, and the pi resume on 2026-11-10.
  - [host-1347-mcp-checks.md](host-1347-mcp-checks.md), the tools at `/mcp`.
  - [update-checks.md](update-checks.md).
  - [macos-checks.md](macos-checks.md) and [daemon-41-windows-checks.md](daemon-41-windows-checks.md), for the install on macOS and Windows. The install on Linux passed on 2026-11-09.
  - The grant role editor in ahpw: the subjects of #205, such as `operation`, `tunnel` and `client`, show and save. No file yet.

## Not in this release

- MayCXC's `host/124-an-agents-shell-is-a-terminal-the-person-sees` is not merged. Main has its features from the four host/20261103-1620 plans.
- `plans.mjs` lists the `active` and `draft` plans. None is needed for the release.
