---
title: Check host/104, host/105 and host/99 in VS Code's window
plans:
  - plans/host/104-a-session-switch-on-a-builtin-stays/plan.md
  - plans/host/105-a-synced-skill-is-named-by-its-plugin/plan.md
  - plans/host/99-a-client-sees-the-agent-account/plan.md
  - plans/host/83-p1-the-host-describes-itself/plan.md
---

# Check host/104, host/105 and host/99 in VS Code's window

host/83 p1 to p4 passed on Windows on 2026-10-16, see *Results on Windows, 2026-10-16*. Three window checks of later plans are left. Use VS Code 1.140 or later, on this Linux machine.

## Set up

```bash
source <(git -C /github/ahpd fetch -q origin && git -C /github/ahpd show origin/main:.project/pending/test-daemon.sh) agent-claude agent-acp
```

Add the entry the script prints to `chat.remoteAgentHosts` in VS Code's `settings.json`, set `"chat.remoteAgentHostsEnabled": true`, and reload the window.

## host/104: Disable (Session) on a plugin stays

1. Open a session on `ahpd-check`, and open its customizations list.
2. Choose "Disable (Session)" on a plugin installed from a marketplace. A plugin the Claude CLI ships, such as `cc-plugin-agents-md`, has no row and no switch since 0d91c97ab.
3. Check that the switch stays off and does not flicker back.
4. Check that the plugin's skills leave the slash list of that session.
5. Open a new session, and check that the plugin is on there.

## host/105: a synced skill is named by its plugin

1. Sync a plugin from the window that has only `.plugin/plugin.json`, such as the Windows run's `advisor` skill.
2. Open a session on `ahpd-check`, and type `/` in the composer.
3. Check that the skill is in the slash list once, as `vs-code-synced-data:advisor`, with no number in its name.
4. Run the skill, and check that it answers.

## host/99: the account menu shows the Codex account

1. Sign in to Codex on this machine with `codex login`, and run `ahpd restart`.
2. Connect the window to `ahpd-check` with `check-token`.
3. Start a Codex session on `ahpd-check`, then open the account menu, and check that it shows the Codex account email. The ACP backend knows the account only once a session starts.
4. Add a users file to the test daemon with a guest whose role lacks `account:read`, and `ahpd restart`. Connect as that guest, and check that the menu shows no email.

## Reply

Write "pass" for each section, or what you saw. Stop the test daemon with `ahpd stop`.

## Results on Windows, 2026-10-16

Run by Softov on Windows 10 with VS Code 1.141.2 and Node 24.12.0, from ahpd `main` at `ea7a01b8` with the fixes below.
A recording proxy, `scripts/tee.mjs`, sat between the window and ahpd for p2 to p4.

- **Set up:** pass, after a fix.
  A plugin named by a Windows drive path, as step 4 does, stopped ahpd from starting: `hasScheme` read `F:` as a URL scheme.
- **p1:** pass.
  The Agent Host channel shows `Agent host version 0.12.0`.
- **p2:** pass, after a fix.
  Stop ended the run as `cancelled`, but the session was drawn as failed.
  See the departure in host/83 p2's `implemented.md`.
- **p3:** pass, after a fix.
  The window sends the origin on the request's `_meta`, not in `config._meta`, so the agent never reported back.
  See the departure in host/83 p3's `implemented.md`.
- **p4:** pass, after a fix.
  Switching off one built-in plugin switched off all three, because they shared the enablement key `builtin`.
  With the fix, `cc-plugin-agents-md` switched off stays off in a new session after `ahpd restart`, and the other two stay on.
  "Disable (Session)" does not stay; see host/83 p4's `implemented.md`.
- **host/95:** not run.

### Seen on the way, not fixed

- The window's slash list names the skills of the "VS Code Synced Data" plugin by its nonce, as in `/1683262406:advisor`.
- The Automations view once showed "The agent host is disconnected on ahpd" while ahpd ran the whole time.
- On Windows, `pnpm boundary` fails: `scripts/boundary.mjs:60` builds `/github/ahpd/packages` from a URL pathname.
- On Windows, vitest fails 17 tests in `packages/agent-claude` and about 200 in `packages/sdk`, the same with and without the fixes.
  Most assume POSIX paths, such as `/dev/zero` and `/home/softov`, or a POSIX shell, git worktree or pty.
