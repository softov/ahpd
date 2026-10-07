---
title: Docs
status: done
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

- **Implemented** 2026-10-07 on `build/agents/4f2c8f8e`. Nothing is left.
- `docs/USERS.md`: a "Trusted folders" section, linked from the `trust` grants row, the dispatch paragraph and the per-connection keys. It covers `workspaceTrust`, the `trust:write` grant and the `member` role, and what trust gives. It also covers the key being kept per connection, and `vscode/requestWorkspaceTrust` with its refusal sentence. A worktree inherits its repository's answer, and `globalAutoApproveEnabled` needs `config:write`.
- `docs/AHP.md`: the `root/configChanged` row names the two per-connection keys. The sandbox paragraph says a preset `off` wins over a stored `on`, and that a stored `on` otherwise stays.
- `docs/PLUGINS.md`: `registerWorktrees` gains its optional `gitDir`, and the need table is six kinds, `part` and `state` added. The tools endpoint runs a client's tool through the backend's runner, and holds a `GET` stream for `notifications/tools/list_changed`. The ACP preset table gains `honoursTrust` and `toolsChanged`.
- `packages/agent-claude/README.md` and `packages/agent-pi/README.md`: an untrusted folder loads no project files, and both the agent's own question and the host's answer have to say yes.
- `packages/agent-acp/README.md`: `honoursTrust` in the per-preset table.
- `docs/DAEMON.md`: the `--client-tool-timeout-ms` row, and `clientToolTimeoutMs` in the keys a client does not configure.
- `docs/COMPUTER.md`: removal starts a stopped machine that has work to read, keeps a machine it cannot empty, and names the refusal.
- `docs/PROXY.md:105-119` and `docs/POLICY.md:85` already describe session calls as wired, `proxy.sessionCalls` and all. Read against `listener.ts`'s `chargedAs`, so nothing was corrected there.
- The validation `rg` finds each of `workspaceTrust`, `honoursTrust`, `clientToolTimeoutMs` and `globalAutoApproveEnabled`. `lint-prose.mjs` finds nothing new in the lines written here; the long sentences left in `docs` are older than this plan.
