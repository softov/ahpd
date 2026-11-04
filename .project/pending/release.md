---
title: What a release needs before its tag
---

# What a release needs before its tag

The last release is `v0.14.0`, of 2026-10-26. Main is `c1b9b792`, the merge of #228, with 287 merges after that tag. Status at 2026-11-04.

A pushed `v*` tag runs [release.yml](../../.github/workflows/release.yml) and publishes every package. The tag comes last, and only on Softov's word.

## Blockers

1. **The daemon on main.** Restart the dev daemon in Softov's terminal, on `c1b9b792` or later. It wires in #212 to #228.
2. **The bump.** Set `0.15.0-rc.1` in every published `packages/*/package.json`. The workflow refuses a tag that differs from one package. The release goes to the npm `next` tag (#163), and `latest` stays on 0.14.0 until 0.15.0. Softov, 2026-11-03: "0.15.0 rc this time."
3. **ahpw on the candidate.** ahpw updates with this release. Its range `^0.14.0` does not match `0.15.0-rc.1`, and `^0.15.0` does not match a pre-release either. Set `^0.15.0-rc.1`. Pack the candidate, and run ahpw's tests and typecheck against it.
4. **A dry run.** Run the release workflow by hand with its dry-run input. It packs and checks, and publishes nothing. `npm stage publish --tag next` has not run yet, so the first rc shows whether npm takes it.

## Done

- **The release notes.** [v0_15.md](../../docs/updates/v0_15.md) holds 0.15.0-rc.1, with the unreleased 0.14.1 section moved into it, and #149 to #229. Set its `date` to the day 0.15.0 is tagged.
- **The restart flag in ahpw.** ahpw #46, merged on 2026-11-04, reads `ahpd.restartNeeded` from the root config values.
- **The seven open problems** of the reviews of 2026-11-03 and 2026-10-20, fixed in #225 to #228.

## Before 0.15.0

- **A working day.** Softov uses the daemon on main for one working day: ahpw, VS Code, ahpc, bots, sessions and the tunnel. A fault is a problem file or a fix before 0.15.0.
- **The checks by hand.** [triage.md](triage.md) orders them. The ones for features a user meets first:
  - [host-1620-terminal-tool-checks.md](host-1620-terminal-tool-checks.md), on Windows and macOS. It passed on Linux.
  - [claude-resume-checks.md](claude-resume-checks.md), [cofold-resume-checks.md](cofold-resume-checks.md) and [pi-resume-checks.md](pi-resume-checks.md).
  - [host-1347-mcp-checks.md](host-1347-mcp-checks.md), the tools at `/mcp`.
  - [client-restart-checks.md](client-restart-checks.md) and [update-checks.md](update-checks.md).
  - [install-path-checks.md](install-path-checks.md), [macos-checks.md](macos-checks.md) and [daemon-41-windows-checks.md](daemon-41-windows-checks.md), for the install on each system.
  - The grant role editor in ahpw: the subjects of #205, such as `operation`, `tunnel` and `client`, show and save. No file yet.

## Not in this release

- The move of the repository to `ahpio/ahpd`, proposed for after the release and not decided. It needs each package's `repository.url`, the 13 npm trusted publishers, and the docs links, then an rc from the new place.
- MayCXC's `host/124-an-agents-shell-is-a-terminal-the-person-sees` is not merged. Main has its features from the four host/20261103-1620 plans.
- `plans.mjs` lists the `active` and `draft` plans. None is needed for the release.

## After the tag

1. Watch the release run. A red run is reported as red.
2. Check that `npm view @ahpd/sdk dist-tags` shows `next: 0.15.0-rc.1` and `latest: 0.14.0`.
3. Release ahpw on the candidate.
