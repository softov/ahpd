---
title: What a release needs before its tag
---

# What a release needs before its tag

The last release is `v0.14.0`, of 2026-10-26. Main is `6cf8c236`, with 1179 commits and 266 merges after that tag. Status at 2026-11-04.

A pushed `v*` tag runs [release.yml](../../.github/workflows/release.yml) and publishes every package. The tag comes last, and only on Softov's word.

## Blockers

1. **Main CI on `6cf8c236`.** Main CI on `6cf8c236` was running at 04:40 UTC. The run on `125b1ff1` failed in two jobs. On Linux, a case of `agent-cofold-plugin.test.ts` failed for the first time: "resumes a paused run and shows the open turn once to a client that subscribes after". On Windows, one attachment case of the known problem failed. Its rerun was cancelled by the push of #212. A red run blocks the release until it is green.
2. **The daemon on main.** Restart the dev daemon in Softov's terminal. It runs #211 now, and the restart wires in #212 and #213. Use it for one working day before the tag.
3. **The version.** The release is `0.15.0-rc.1`, and it goes to the npm `next` tag (#163). `latest` stays on 0.14.0 until 0.15.0. Softov, 2026-11-03: "0.15.0 rc this time."
4. **The release notes.** [v0_14.md](../../docs/updates/v0_14.md) holds a 0.14.1 section that was not released. Move it to a new page, `docs/updates/v0_15.md`. The page changed last in `dbbafc43`, on 2026-10-30. About 65 PRs merged after it, #148 to #213, and nobody checked them against the notes. Add what a reader meets. #209 to #213 add the agent terminal tool, `ask_user` and async commands, and #209 adds `@xterm/headless` to the server package.
5. **The bump.** Set `0.15.0-rc.1` in every published `packages/*/package.json`. The workflow refuses a tag that differs from one package.
6. **The restart flag in ahpw.** The host sends `ahpd.restartNeeded` in the root config. The ahpw client reads it from the root's `_meta`, in `src/bridges/plugins.ts:171`. So ahpw shows no restart notice. Fix it in ahpw. Check ahpapp for the same read.
7. **ahpw on the candidate.** ahpw updates with this release. Its range `^0.14.0` does not match `0.15.0-rc.1`, and `^0.15.0` does not match a pre-release either. Set `^0.15.0-rc.1`. Pack the candidate, and run ahpw's tests and typecheck against it.
8. **A dry run.** Run the release workflow by hand with its dry-run input. It packs and checks, and publishes nothing.

## Choices for Softov

- The open problems that a review of 2026-11-03 read from the code. Each one is not reproduced. Fix before the release, or list in the notes as known:
  - [a-team-key-can-hold-a-grant-its-minter-does-not.md](../problems/a-team-key-can-hold-a-grant-its-minter-does-not.md): a caller with `user:write` gives a team key a grant they do not hold. This is the same class as #204.
  - [a-removed-teams-keys-work-again-when-the-team-is-added-back.md](../problems/a-removed-teams-keys-work-again-when-the-team-is-added-back.md)
  - [a-write-only-field-not-marked-secret-is-returned.md](../problems/a-write-only-field-not-marked-secret-is-returned.md)
  - [the-bot-picker-lists-every-bot-to-any-client.md](../problems/the-bot-picker-lists-every-bot-to-any-client.md)
  - [a-symlink-loop-in-claude-rules-hangs-the-daemon.md](../problems/a-symlink-loop-in-claude-rules-hangs-the-daemon.md)
  - [a-minute-limit-for-each-person-is-never-enforced.md](../problems/a-minute-limit-for-each-person-is-never-enforced.md)
- [an-unreadable-session-file-is-overwritten.md](../problems/an-unreadable-session-file-is-overwritten.md) loses data. It is open from 2026-10-20 and was in 0.14.0 too.

## Checks by hand on what this release adds

Each check is its own file. Run the ones for features a user meets first:

- [host-1620-terminal-tool-checks.md](host-1620-terminal-tool-checks.md), for the shell integration, `ask_user`, the agent terminal tool and async commands of #209 to #213.
- The grant role editor in ahpw: the new subjects from #205, such as `operation`, `tunnel` and `client`, show and save. No file yet; nobody has opened it in a browser.
- [bot-steer-checks.md](bot-steer-checks.md), for the bot queue and stop of #203 and #206.
- [claude-resume-checks.md](claude-resume-checks.md), [cofold-resume-checks.md](cofold-resume-checks.md) and [pi-resume-checks.md](pi-resume-checks.md).
- [client-restart-checks.md](client-restart-checks.md) and [update-checks.md](update-checks.md).
- [host-1347-mcp-checks.md](host-1347-mcp-checks.md), the tools at `/mcp`.
- [plugin-1054-device-sign-in-checks.md](plugin-1054-device-sign-in-checks.md), then [plugin-1122-tunnel-checks.md](plugin-1122-tunnel-checks.md). Both need Softov's Dev Tunnels sign-in.
- [install-path-checks.md](install-path-checks.md), [macos-checks.md](macos-checks.md) and [daemon-41-windows-checks.md](daemon-41-windows-checks.md), for the install on each system.

The other files in this folder check older plans. They do not block a release.

## Not in this release

- MayCXC's `host/124-an-agents-shell-is-a-terminal-the-person-sees` is not merged. Main has its features from the four host/20261103-1620 plans.
- 56 plans are `active` and 8 are `draft`. `plans.mjs` lists them. None is needed for the release.
- `plugin/20261103-0158` has one task `todo`. `plugin/20261103-1044` is `planned`, but #203 replaced its PR #201.

## After the tag

1. Watch the release run. A red run is reported as red.
2. Check that `npm view @ahpd/sdk dist-tags` shows `next: 0.15.0-rc.1` and `latest: 0.14.0`.
3. Release ahpw on the candidate.
