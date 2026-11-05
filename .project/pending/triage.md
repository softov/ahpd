---
title: The checks by hand that wait, in order
---

# The checks by hand that wait, in order

Every file in this folder is a check by hand. This file lists each one once, with who runs it and what it needs first. When a check passes, delete its file and its line here, in the same commit.

Checked against main at 16bf971c on 2026-11-04. Wrong steps were fixed in fb040e0e.

## Softov, on this machine

Restart the daemon on main first. Do them from the top down.

- [install-path-checks.md](install-path-checks.md) - 20 min, sudo and a test user. Claude cannot add a system user here.
- [plugin-63-model-list-checks.md](plugin-63-model-list-checks.md) - 10 min.
- [session-picker-checks.md](session-picker-checks.md) - 10 min.
- [linux-checks.md](linux-checks.md) - 10 min, the sign-in only.
- [plugin-70-file-checks.md](plugin-70-file-checks.md) - 15 min.
- [host-122-agent-records-checks.md](host-122-agent-records-checks.md) - 15 min, steps 3 and 4.
- [plugin-71-sign-in-checks.md](plugin-71-sign-in-checks.md) - 15 min, an OpenRouter account.
- [canvas-example-checks.md](canvas-example-checks.md) - 15 min, VS Code.
- [host-1347-mcp-checks.md](host-1347-mcp-checks.md) - 25 min, VS Code as the MCP client.
- [host-103-drawing-checks.md](host-103-drawing-checks.md) - 30 min.
- [plugin-view-checks.md](plugin-view-checks.md) - 10 min, VS Code through the system tunnel, and the network off for a minute.
- [push-web-checks.md](push-web-checks.md) - 25 min, Chrome and Firefox.
- [the-pt-catalogs-read-right.md](the-pt-catalogs-read-right.md) - 30 min.
- [vscode-checks.md](vscode-checks.md) - 40 min.
- [claude-resume-checks.md](claude-resume-checks.md) - 30 min, VS Code. Step 2 needs a way to give a bad key.
- [cofold-resume-checks.md](cofold-resume-checks.md) - 30 min, VS Code.
- [pi-resume-checks.md](pi-resume-checks.md) - 20 min, VS Code. A pi agent record may be needed first.
- [host-108-token-checks.md](host-108-token-checks.md) - 25 min, a second computer that reaches port 37537.
- [plugin-54-webhook-checks.md](plugin-54-webhook-checks.md) - 60 min, a public port, a GitHub repo, a Slack app, and users `alice` and `bob`.
- [plugin-50-first-pieces.md](plugin-50-first-pieces.md) - 60 to 120 min, one account per piece.

## Claude can run these on a test daemon

Ask, and Claude runs them on an isolated daemon, not on ports 5180 and 37537.

- [proxy-06-endpoint-checks.md](proxy-06-endpoint-checks.md) - 10 min, curl only. Steps 1, 3, 4 and 6 are left: the OpenAI key needs credit, and OpenRouter lists no rerank model.

## Softov's decision, nothing to run

- [acp-19-records-follow-up.md](acp-19-records-follow-up.md) - a question about acp/19.
- [plugin-58-icon-curation.md](plugin-58-icon-curation.md) - which icons to keep.

## Another machine

- [windows-machine-paths-checks.md](windows-machine-paths-checks.md) - the Windows 10 VM with Docker Desktop, 30 min.
- [daemon-41-windows-checks.md](daemon-41-windows-checks.md) - Windows with Bun 1.3.14 and 1.3.13, 45 min.
- [devcontainer-checks.md](devcontainer-checks.md) - VS Code on Windows, 45 min.
- [host-1620-terminal-tool-checks.md](host-1620-terminal-tool-checks.md) - Windows and a Mac, 20 min each. It passed on Linux.
- [daemon-31-service-checks.md](daemon-31-service-checks.md) - a Mac, the launchd sections, 25 min.
- [macos-checks.md](macos-checks.md) - a Mac with VS Code, 90 min.
- [vm-01-dev02-libvirt.md](vm-01-dev02-libvirt.md) - dev02 with sudo, and a choice on the iptables rules, 15 min.
- [vm-06-proxmox-node.md](vm-06-proxmox-node.md) - a Proxmox node, not named yet, 45 min.

## Blocked

- [container-05-p10-hub-checks.md](container-05-p10-hub-checks.md) - a hub refuses a node older than 0.14.1, and main is 0.14.0. Step 3's `ahpd restart` also fails on a hub that runs in the foreground: stop it with Ctrl+C and start it again.
- [update-checks.md](update-checks.md) - needs a published version newer than 0.14.0. A release candidate goes to `next`, so use `ahpd update --version <rc>`.
- [host-100-p2-review.md](host-100-p2-review.md) - fails until the problem `a-claude-session-from-vs-code-has-no-owner` is fixed.
- [release.md](release.md) - 0.15.0-rc.1 is on npm under `next`. Left: ahpw on the candidate.
