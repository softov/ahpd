---
title: "Handoff: where ahpd stands, and what is pending"
---

# Handoff: where `ahpd` stands, and what is pending

Current progress and pending items only, as of 2026-11-01.
`node ~/.claude/skills/do-spec/scripts/plans.mjs` lists the backlog, and each plan's Resume state is its detail. What merged is in `git log`, and what was released is in [CHANGELOG.md](../../CHANGELOG.md).

## Main

- The last release is 0.14.0 (`v0.14.0`). The CHANGELOG holds 0.14.1 as unreleased.
- On 2026-10-30, seven PRs merged on green CI, Windows included:
  - #156: a dispatch that throws is refused.
  - #157: a targeted token reaches only its server.
  - #159: a token reaches only the sessions its connection watches (the head of #158).
  - #160: a record agent runs in a machine.
  - #161: only the echo carries the origin.
  - #151: container/05 p8, a profile's machines on another server's Docker.
  - #162: the VM plan, a VM made by libvirt or Proxmox. Nothing has run on a real hypervisor yet.
- On 2026-10-31, seventeen PRs merged on green CI, Windows included:
  - #163: CI stages a pre-release under the `next` dist-tag.
  - #164: host/20261031-0211, every client action is answered.
  - #165: claude/20261031-0228, a skill names its own file.
  - #166: claude/20261031-0258, a written agent shows at once.
  - #167: daemon/20261031-0555, an installed ahpd is found outside bash. The install script reaches people at the next release, because ahpio-site copies it from the newest `v*` tag.
  - #168: pi/20261031-0736, a failed pi turn is resumed.
  - #169: a fix with no plan. The #166 watch started a Claude probe for each write to `~/.claude/plugins/known_marketplaces.json`, which each probe's CLI writes, so CLIs piled up and `listSessions` hung. Now only `installed_plugins.json` calls, and the host runs one probe per backend at a time.
  - #170: the second cause of the same loop. Each CLI start rewrites `skills/synced/<bucket>/manifest.json` and `.last-complete-round`. The skills watch now skips them, and skips a `change` for a folder.
  - #171: plugin/20261031-0804, a browser gets a push.
  - #172: host/20261028-0947, `x-ahpd/me` answers a plugin's own connection.
  - #173: the four fork plans of host/20261031 (0804, 0931, 1019, 1118), every client action is answered. Three small gaps are in the PR text, for a follow-up.
  - #174: claude/20261031-1200, a failed Claude turn is resumed.
  - #175: plugin/20261031-1200, a plugin shows its state.
  - #176: MayCXC's host/20261031-1306 and claude/20261031-1441. A draft the chat already holds is answered to its sender alone, and the Claude session refuses a turn while the one before it is still beginning.
  - #177: cofold/20261031-1200, a failed cofold turn is resumed.
  - #178: the Dev Tunnel plugin is tested against a captured `devtunnel show` answer. A test only.
  - #179: MayCXC's host/20261031-1634 and host/20261031-2013. A `!` command sent during a turn is answered by its queued message, and a pi or bot steering message is answered and taken out.
  - #180: the Dev Tunnel page puts each label and its value on one row, and shows the tunnel's full URL as its link.
- The last code merge on main is #180 (`33bab1d9`). The branch `host/20261031-1634-commands-and-steering-answered` is still on origin. The branch `host/20261031-1306-drafts-and-turns-answered` is still on origin. The branch `host/20261031-0804-actions-answered` is still on origin.
- #158 was based on the #157 branch, so its merge went into that branch and never reached main. #159 took the same head into main. Check `baseRefName` before you merge a stacked fork PR.
- Disposing a session that this process does not hold leaves its disposable machine behind. The `held === undefined` branch in `lifecycle.ts` never calls `leaveForgotten`. It is on main from before p8: [problems/a-disposed-session-not-held-leaves-its-machine.md](../problems/a-disposed-session-not-held-leaves-its-machine.md).
- The README is rewritten for people who run ahpd (`a22c1934`). The brief it came from is `ahp-review/ahpd-review/ahpd-readme-2026-10-27/`.
- `/github/ahpd` is on main at `205c5ed6`, clean. Its briefs, the plain-text brief's *Plugin text* and the plugin/20261031-1200 Answers row are committed.
- Fetch, and check the base before you cut a build worktree.
- Softov's dev daemon runs from source on port 37537. He restarted it after #180, on 2026-11-01, so it runs #176 to #180.
- Code goes through a PR on `softov/ahpd`. Plan-only commits go to main. The ruleset restricts updates to main, so a PR merges with `gh pr merge --admin --merge`, only on Softov's word. Run `gh pr checks` with `-R softov/ahpd` outside a repo.
- `packages/sdk/test/fixtures/wire.jsonl` is rewritten by every test run. Restore it with `git checkout --` and never print it.
- On Windows CI, `agent-acp-ports` (the pseudoterminal test) fails at times, also before #169. Rerun the failed jobs once; a second failure needs a look.
- On this machine, two Docker tests time out: `computer-devcontainer` and `computer-disposable`. They time out on main too, and CI passes them.
- The worktrees in `/github/ahpd.worktrees/` are `briefs-commit` (detached, for plan-only commits), `release-prerelease`, `review-maycxc-union`, `review-maycxc-1634-2013`, `devtunnel-show-fixture`, `devtunnel-view-rows`, `vm` `review-maycxc-20261101` and `review-maycxc-fe077882` (PR #183). All but the first two and the last are merged, and they wait for Softov's word to remove. The old container/05 p8 build `build-agents-fda88f4a` is removed: main does all that it did. Check `ss -ltnp` before you start a test daemon, and stop it by pid.
- The local branch `fork/maycxc-1248-1303-1334` is merged.

## Waiting for Softov

- MayCXC's union is PR #183, branch `host/20261101-0329-maycxc-union-fe077882` in the worktree `review-maycxc-fe077882`. It is `maycxc/union` at `fe077882` (ten plans, 1556 out) with main merged in as `ec0afb71`. The three blockers, the bug and the read-state row of [maycxc-union-20261101-review.md](maycxc-union-20261101-review.md) are fixed; its *Notes* are not checked. The merge keeps the usage plan's `users-gate-commands.test.ts` in place of #182's. Typecheck, boundary, i18n and the full suite pass locally (8115 tests). Softov, 2026-11-01, asked again after the rebuild: `restartNeeded` stays a read-only root config value; ahpw and ahpapp read it there, in their own repositories, after the merge. Our branch `host/20261101-0329-restart-needed-is-config` is not needed and waits for his word to delete. Two test commits on the branch, `c213917d` and `53a8f017`, make MayCXC's case driver read a directory as the host does on Windows (`localPath`, and the trust refusal's folder resolved); MayCXC should take both on `union`. CI and Windows are green at `53a8f017`. Merge #183 only on his word.
- Softov, 2026-11-01: the read-state plan follows the specification, and a session marked read leaves its chats' bits alone; this replaces host/89's answer. The restart flag becomes a read-only root config value; ahpw and ahpapp follow in their repositories.
- plugin/20261101-1803, a plugin that fails says so: merged in #181 as aa48d47f, `implemented` until his review. Checks by hand after a daemon restart: [pending/plugin-fails-says-so-checks.md](../pending/plugin-fails-says-so-checks.md). #182 fixed the usage-pools test that made main red from 2026-11-01.
- claude/20261031-0228: [pending/claude-skill-file-checks.md](../pending/claude-skill-file-checks.md).
- claude/20261031-0258: [pending/claude-reload-checks.md](../pending/claude-reload-checks.md).
- daemon/20261031-0555: [pending/install-path-checks.md](../pending/install-path-checks.md).
- pi/20261031-0736: [pending/pi-resume-checks.md](../pending/pi-resume-checks.md).
- claude/20261031-1200: [pending/claude-resume-checks.md](../pending/claude-resume-checks.md).
- cofold/20261031-1200: [pending/cofold-resume-checks.md](../pending/cofold-resume-checks.md).
- plugin/20261031-1200: [pending/plugin-view-checks.md](../pending/plugin-view-checks.md).
- host/20261031-0211, claude/20261031-0228, claude/20261031-0258, daemon/20261031-0555 and pi/20261031-0736, claude/20261031-1200, plugin/20261031-1200 and cofold/20261031-1200: review. Each is `implemented`.
- host/114 and host/116: review.
- x-ahpd/me for a plugin: PR #172 merged as `44d90a59`. The plan host/20261028-0947 stays `implemented` until his review. ahpw organization/05 task 07 can start.
- ahpw idea `a-plugin-page-draws-its-view` is on ahpw main, for the views of plan D.
- After the daemon restart for #156 to #161 and #151, open a terminal in ahpw and in ahpc. `supportsCommandDetection` is now false until the shell prints its first mark.
- host/126: review. ahpc and ahpw must create `ahp-session:` sessions.
- daemon/29: the final checklist in its plan.
- host/121: the checks by hand in its plan's Resume state.
- plugin/71: [pending/plugin-71-sign-in-checks.md](../pending/plugin-71-sign-in-checks.md).
- daemon/41 on Windows: [pending/daemon-41-windows-checks.md](../pending/daemon-41-windows-checks.md).
- host/123: [pending/host-123-engines-checks.md](../pending/host-123-engines-checks.md).
- host/122: [pending/host-122-agent-records-checks.md](../pending/host-122-agent-records-checks.md).
- proxy/05: [pending/proxy-05-model-checks.md](../pending/proxy-05-model-checks.md).
- proxy/06: [pending/proxy-06-endpoint-checks.md](../pending/proxy-06-endpoint-checks.md).
- plugin/63: [pending/plugin-63-model-list-checks.md](../pending/plugin-63-model-list-checks.md).
- proxy/04: icon curation, and [pending/proxy-04-move-config-dev.md](../pending/proxy-04-move-config-dev.md).
- plugin/58: task 05 waits for [pending/plugin-58-icon-curation.md](../pending/plugin-58-icon-curation.md).
- plugin/50: [pending/plugin-50-first-pieces.md](../pending/plugin-50-first-pieces.md).
- The VM plan, task 01: [pending/vm-01-dev02-libvirt.md](../pending/vm-01-dev02-libvirt.md). The checks by hand of tasks 03 and 05 follow it.
- The VM plan, task 06: [pending/vm-06-proxmox-node.md](../pending/vm-06-proxmox-node.md), when a Proxmox node is named.
- Four plans from 2026-10-31, in build order:
  - plugin/20261031-1200, a plugin shows its state: merged in #175. Step 1 of its check passed on this machine; #178 adds the captured `show` answer as a fixture. #180 puts each label and its value on one row, Softov's layout A of two mockups, and shows the tunnel's full URL as its link: merged as 33bab1d9. A Copy button beside the link waits for a brief: it needs a client-side copy action across ahpd's view checker, ahpw and ahpc.
  - claude/20261031-1200, a failed Claude turn is resumed: merged in #174.
  - cofold/20261031-1200, a failed cofold turn is resumed: merged in #177.
- host/20261031-1200, the sdk's text is plain: task 01 wrote [research/sdk-plain-text-strings.md](../research/sdk-plain-text-strings.md). Softov reads it and answers its *Choices to check* before any code.
- [ideas/acp-resumable-doubt.md](../ideas/acp-resumable-doubt.md): ACP is not resumable for now.
- [briefs/the-change-counters-agree.md](../briefs/the-change-counters-agree.md): the ahpw change counters disagree. Softov said write the brief on 2026-10-31. A plan only when he says plan it.
- [briefs/the-text-a-person-reads-is-plain.md](../briefs/the-text-a-person-reads-is-plain.md) stays for the server and plugin slices.
- The `active` plans with all tasks implemented wait for his review. Each stays `active` until he says his review is done.
- Three `active` plans look ready to close on his word: host/83, host/99 and plugin/69. The plan host/83 has p1 to p5 built, and host/99 has every task done. PR #104 merged plugin/69 tasks 05 and 06, which are still `implemented`.
- plugin/71 has no `implemented.md`, though its tasks are implemented.
- container/02 has three tasks `blocked`. container/05 stays `active` while p8 and p10 are `planned`.
- plugin/54 and plugin/56 are `planned` and wait on plugin/53.

## Next builds

- The VM plan `20261030-1141-a-vm-is-made-on-a-server` has its code merged. It waits on the checks by hand above.
- container/05 p10 (task 03 next).
- The ahpw Connect button for plugin/71 is ahpw plan plugins/09, planned.

## Outside this repository

- ahp-review: commit `6471a79` holds the README brief. It is not pushed.
- ahpc is level with origin. What ahpc lacks against ahpd is in `ahp-review/briefs/ahpc-catch-up.md`.
- ahpw plan plugins/09 is built and not committed. It waits for Softov's review and the PR text.
- ahpw is on main, on scena `^0.5.14`, and its agent and connector forms have a YAML view.
- scena 0.5.14 is on npm, and its tree is clean.
- The fork's shell integration branch is kept locally as `fork/host-124-shell-integration`. `ahp-review/briefs/agent-terminal-tool.md` says how to redo it on main, and its questions wait on Softov.
- A test session `claude-deepseek:/845c1908-…` is still on Softov's daemon. Remove it only when he says so.
- The preset allow-list edit in `~/.config/ahpd/agents/claude-deepseek-build.json` waits on Softov.

## By Softov's hand

The checks in [pending/](../pending/).
