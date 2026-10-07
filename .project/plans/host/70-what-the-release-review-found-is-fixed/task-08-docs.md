---
title: Docs
status: todo
depends: [task-01-a-machine-is-removed-only-once-its-work-is-out.md, task-04-pushing-trust-needs-trust-write.md, task-05-the-approve-everything-key-is-declared.md, task-07-a-preset-can-turn-the-sandbox-off.md]
layer: "docs"
refs:
  - "[code://docs/USERS.md](../../../../docs/USERS.md) - grants and the per-connection keys"
  - "[code://docs/PLUGINS.md](../../../../docs/PLUGINS.md) - the MCP tools endpoint and machine needs"
---

## Objective

The docs describe 0.10.0: workspace trust, its grant, and every key and endpoint the review found undocumented or described the 0.9 way.

## Files

- `UPDATE: docs/USERS.md` - `trust:write`, the member role, and `workspaceTrust` beside `defaultShell` at lines 588-611.
- `UPDATE: docs/AHP.md:176` - the per-connection keys.
- `UPDATE: docs/AHP.md:444-450` - the sandbox: a preset off wins, a stored on stays otherwise.
- `UPDATE: packages/agent-claude/README.md`, `packages/agent-pi/README.md:69-80` - an untrusted folder loads no project files.
- `UPDATE: packages/agent-acp/README.md:68-83`, `docs/PLUGINS.md:826-838` - `honoursTrust` in the per-preset table.
- `UPDATE: docs/PLUGINS.md:209-211` - the tools endpoint runs a client's tool and streams list changes.
- `UPDATE: docs/PLUGINS.md:130`, `docs/PLUGINS.md:171-178` - `gitDir`, and the six need kinds.
- `UPDATE: docs/DAEMON.md:271-296`, `docs/DAEMON.md:593` - `clientToolTimeoutMs` and its flag.
- `UPDATE: docs/PROXY.md:105-119`, `docs/POLICY.md:85` - session calls are not wired yet.
- `UPDATE: docs/COMPUTER.md` - `remove` starts a stopped machine, and keeps one it cannot empty.
- `UPDATE: docs/USERS.md` - `globalAutoApproveEnabled`, with the grant it needs.

## Steps

1. Write a "Trusted folders" section in `docs/USERS.md` that says what trust gives and who may push it.
2. Link that section from each place the file list above names trust.
3. Correct each other line in the file list to the code.
4. Write each change in plain sentences for a person who runs the daemon.

## Validation

- Run `node .agents/skills/do-spec/scripts/lint-prose.mjs docs`. It finds nothing new in the lines this task wrote.
- Run `rg -n "workspaceTrust|honoursTrust|clientToolTimeoutMs|globalAutoApproveEnabled" docs packages/*/README.md`. Each key has a hit.
- Read each changed section against the code it describes.

## Resume

