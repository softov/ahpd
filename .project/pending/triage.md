---
title: The checks by hand that wait, in order
---

# The checks by hand that wait, in order

Every file in this folder is a check by hand. This file lists each one once, with who runs it and what it needs first. When a check passes, delete its file and its line here, in the same commit.

Checked against main at fd9a94e5b on 2026-11-09.

## Softov, on this machine

Restart the daemon on main first. Do them from the top down.

- [plugin-63-model-list-checks.md](plugin-63-model-list-checks.md) - 10 min.
- [plugin-70-file-checks.md](plugin-70-file-checks.md) - 15 min, a Slack or Jira Cloud connector.
- [host-122-agent-records-checks.md](host-122-agent-records-checks.md) - 15 min, ahpw for steps 3 and 4.
- [plugin-71-sign-in-checks.md](plugin-71-sign-in-checks.md) - 15 min, an OpenRouter account.
- [canvas-example-checks.md](canvas-example-checks.md) - 15 min, VS Code.
- [host-1347-mcp-checks.md](host-1347-mcp-checks.md) - 25 min, VS Code as the MCP client. It adds a member and a guest.
- [plugin-view-checks.md](plugin-view-checks.md) - 10 min, VS Code through the system tunnel, and the network off for a minute.
- [the-pt-catalogs-read-right.md](the-pt-catalogs-read-right.md) - 30 min.
- [vscode-checks.md](vscode-checks.md) - 40 min.
- [claude-resume-checks.md](claude-resume-checks.md) - 30 min, VS Code. Step 2 needs a way to give a bad key.
- [cofold-resume-checks.md](cofold-resume-checks.md) - 30 min, VS Code.
- [pi-resume-checks.md](pi-resume-checks.md) - 20 min, VS Code. A pi agent record may be needed first.
- [host-108-token-checks.md](host-108-token-checks.md) - 25 min, a second computer that reaches port 37537.
- [plugin-54-webhook-checks.md](plugin-54-webhook-checks.md) - 60 min, a public port, a GitHub repo, a Slack app, users `alice` and `bob`, and the webhook plugin's grants.
- [plugin-50-first-pieces.md](plugin-50-first-pieces.md) - 60 to 120 min, one account per piece.

## The Linux test VM

A Debian 13 GNOME VM on Softov's Proxmox node, with passwordless sudo, reached through the node. It suits a check that needs sudo, a second user or a clean GNOME login. Claude runs the shell steps over ssh, and Softov does the steps at the GNOME desktop. Never write the VM's name, address or user names in a record.

- [update-checks.md](update-checks.md) - about 60 min, the Debian sections as a throwaway user. The systemd section waits on a version after 0.15.0-rc.1, and the HTTP section needs `httpApi`, a token and a person. The Windows section runs on the Windows 10 VM.

Before and after a check on the VM:

- A new user can get a uid that already owns a system path, such as an orphaned uid that owns `/usr/local/lib/node_modules`. For a user who must not write `/usr/local`, check that `sudo -iu <user> touch /usr/local/lib/node_modules/x` fails.
- After a GNOME logout, run `loginctl terminate-user <user>`, and wait before `deluser --remove-home`. An ibus that still exits can write `~/.cache` again.
- To tell nvm's npm from another npm, start the daemon with the nvm Node, on a PATH whose `npm` is not nvm's.

## Claude can run these on a test daemon

Ask, and Claude runs them on an isolated daemon, not on ports 5180 and 37537.

- [proxy-06-endpoint-checks.md](proxy-06-endpoint-checks.md) - 10 min, curl only. Steps 1, 3, 4 and 6 are left: the OpenAI key needs credit, and OpenRouter lists no rerank model.

## Softov's decision, nothing to run

- [acp-19-records-follow-up.md](acp-19-records-follow-up.md) - a question about acp/19.
- [plugin-58-icon-curation.md](plugin-58-icon-curation.md) - which icons to keep.

## Another machine

- [windows-machine-paths-checks.md](windows-machine-paths-checks.md) - the Windows 10 VM with Docker Desktop, 30 min.
- [daemon-41-windows-checks.md](daemon-41-windows-checks.md) - Windows with Bun 1.3.14 and 1.3.13, 45 min.
- [devcontainer-checks.md](devcontainer-checks.md) - VS Code on Windows, your daemon on main with the `devtunnel` connector signed in to that VS Code's GitHub account, 45 min.
- [host-1620-terminal-tool-checks.md](host-1620-terminal-tool-checks.md) - Windows and a Mac, 20 min each. It passed on Linux.
- [macos-service-checks.md](macos-service-checks.md) - a Mac, the launchd sections, 25 min.
- [macos-checks.md](macos-checks.md) - a Mac with VS Code, 90 min. Its Safari push section needs ahpw over https, such as the system tunnel.
- [vm-01-dev02-libvirt.md](vm-01-dev02-libvirt.md) - dev02 with sudo, and a choice on the iptables rules, 15 min.
- [vm-06-proxmox-node.md](vm-06-proxmox-node.md) - Softov's Proxmox node, 45 min. Left: Softov makes the template, the API user and its token on the node, as steps 2 and 3 say.
- [container-05-p10-hub-checks.md](container-05-p10-hub-checks.md) - a node behind NAT, such as the Windows VM.

## Blocked

- [release.md](release.md) - 0.15.0-rc.1 is on npm under `next`, and ahpw is on it. Left: a working day on the daemon, and the checks before 0.15.0.
