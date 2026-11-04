---
title: What a release needs before its tag
---

# What a release needs before its tag

The last release is `v0.14.0`, of 2026-10-26. Main's last code change is `6cf8c236`, the merge of #212, with 266 merges after that tag. Main CI is green on `f9e99b34`, in run 41768795261. Status at 2026-11-04.

A pushed `v*` tag runs [release.yml](../../.github/workflows/release.yml) and publishes every package. The tag comes last, and only on Softov's word.

## Blockers

1. **The daemon on main.** Restart the dev daemon in Softov's terminal. It runs #211 now, and the restart wires in #212 and #213. Use it for one working day before the tag.
2. **The version.** The release is `0.15.0-rc.1`, and it goes to the npm `next` tag (#163). `latest` stays on 0.14.0 until 0.15.0. Softov, 2026-11-03: "0.15.0 rc this time."
3. **The release notes.** [v0_14.md](../../docs/updates/v0_14.md) holds a 0.14.1 section that was not released. Move it to a new page, `docs/updates/v0_15.md`. The page changed last in `dbbafc43`, on 2026-10-30. About 65 PRs merged after it, #148 to #213, and nobody checked them against the notes. Add what a reader meets. #209 to #213 add the agent terminal tool, `ask_user` and async commands, and #209 adds `@xterm/headless` to the server package.
4. **The bump.** Set `0.15.0-rc.1` in every published `packages/*/package.json`. The workflow refuses a tag that differs from one package.
5. **The restart flag in ahpw.** The host sends `ahpd.restartNeeded` in the root config. The ahpw client reads it from the root's `_meta`, in `src/bridges/plugins.ts:171`. So ahpw shows no restart notice. Fix it in ahpw. Check ahpapp for the same read.
6. **ahpw on the candidate.** ahpw updates with this release. Its range `^0.14.0` does not match `0.15.0-rc.1`, and `^0.15.0` does not match a pre-release either. Set `^0.15.0-rc.1`. Pack the candidate, and run ahpw's tests and typecheck against it.
7. **A dry run.** Run the release workflow by hand with its dry-run input. It packs and checks, and publishes nothing.

## Choices for Softov

- The seven open problems of the review of 2026-11-03 and of 2026-10-20 are planned, to fix before the release, on Softov's word of 2026-11-04:
  - [host/20261104-1505-a-reader-gets-only-what-they-may](../plans/host/20261104-1505-a-reader-gets-only-what-they-may/plan.md)
  - [claude/20261104-1505-a-rules-walk-visits-a-folder-once](../plans/claude/20261104-1505-a-rules-walk-visits-a-folder-once/plan.md)
  - [usage/20261104-1505-a-minute-limit-counts-each-person](../plans/usage/20261104-1505-a-minute-limit-counts-each-person/plan.md)
  - [host/20261104-1505-an-unreadable-session-file-is-kept](../plans/host/20261104-1505-an-unreadable-session-file-is-kept/plan.md)

## Checks by hand on what this release adds

Each check is its own file. Run the ones for features a user meets first:

- [host-1620-terminal-tool-checks.md](host-1620-terminal-tool-checks.md), for the shell integration, `ask_user`, the agent terminal tool and async commands of #209 to #213.
- The grant role editor in ahpw: the new subjects from #205, such as `operation`, `tunnel` and `client`, show and save. No file yet; nobody has opened it in a browser.
- [bot-steer-checks.md](bot-steer-checks.md), for the bot queue and stop of #203 and #206.
- [claude-resume-checks.md](claude-resume-checks.md), [cofold-resume-checks.md](cofold-resume-checks.md) and [pi-resume-checks.md](pi-resume-checks.md).
- [client-restart-checks.md](client-restart-checks.md) and [update-checks.md](update-checks.md).
- [host-1347-mcp-checks.md](host-1347-mcp-checks.md), the tools at `/mcp`.
- The Dev Tunnels sign-in and tunnel checks passed on 2026-11-04.
- [install-path-checks.md](install-path-checks.md), [macos-checks.md](macos-checks.md) and [daemon-41-windows-checks.md](daemon-41-windows-checks.md), for the install on each system.

The other files in this folder check older plans. They do not block a release.

## Not in this release

- MayCXC's `host/124-an-agents-shell-is-a-terminal-the-person-sees` is not merged. Main has its features from the four host/20261103-1620 plans.
- 56 plans are `active` and 8 are `draft`. `plans.mjs` lists them. None is needed for the release.
- `plugin/20261103-0158` has one task `todo`. `plugin/20261103-1044` is `planned`, but #203 replaced its PR #201.

## After the tag

1. Watch the release run. A red run is reported as red.
1. Check that `npm view @ahpd/sdk dist-tags` shows `next: 0.15.0-rc.1` and `latest: 0.14.0`.
2. Release ahpw on the candidate.
