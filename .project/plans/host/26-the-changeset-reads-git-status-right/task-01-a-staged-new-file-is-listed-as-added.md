---
title: A file Claude created, edited and staged through Bash is listed as added
status: blocked
depends: []
layer: "sdk, agent-claude"
refs:
  - "[code://packages/sdk/src/changes.ts#L484-L506](../../../../packages/sdk/src/changes.ts#L484-L506) - `rowsOf()`, where a row without `after` is a deletion"
  - "[code://packages/sdk/src/changes.ts#L898-L928](../../../../packages/sdk/src/changes.ts#L898-L928) - `observe`, first `before` wins"
  - "[code://packages/agent-claude/src/session.ts#L1566-L1577](../../../../packages/agent-claude/src/session.ts#L1566-L1577) - the `before` capture, and its comment on racing the write"
  - "[code://packages/agent-claude/src/session.ts#L1615-L1616](../../../../packages/agent-claude/src/session.ts#L1615-L1616) - a result whose part is unknown is skipped, and its `after` with it"
  - "[code://packages/agent-claude/src/session.ts#L1701-L1707](../../../../packages/agent-claude/src/session.ts#L1701-L1707) - the `after`"
  - "[code://packages/sdk/src/host.ts#L2780-L2811](../../../../packages/sdk/src/host.ts#L2780-L2811) - `refreshWatched`, which re-reads after a `git add` outside the host"
---

## Objective

The `D` Softov saw is reproduced, its cause found and pinned by a test that fails first, and fixed, so a file Claude wrote, edited and staged with `git add` through Bash is added in the session and uncommitted changes.

## Files

- `UPDATE:` whichever of `packages/sdk/src/changes.ts`, `packages/agent-claude/src/session.ts` or `packages/sdk/src/host.ts` the cause is in.
- `UPDATE: packages/sdk/test/` or `packages/agent-claude/test/` - the case that pins it.

## Steps

1. Reproduce on a scratch daemon (scratch `XDG_CONFIG_HOME`, a port other than 9187, 9216 and 9320, stopped by pid) with a real Claude session in a git repository: ask it to create a file, edit it, then run `git add` on it through Bash; capture the `changeset/*` payloads for `session` and `uncommitted`, and `git status --porcelain=v1 -z`.
2. Repeat with the session folder a subfolder of the repository, and with the write inside a subagent, since both change what is captured.
3. Find which scope sends `before` without `after` and why; if it is the client, record where and stop.
4. Write the failing case, then fix.

## Validation

- The captured payload that showed `D`, recorded in the Resume.
- A test that fails first on the cause and passes after.
- `pnpm typecheck`, `pnpm boundary`, `pnpm test` green.
- Softov sees `A` in ahpapp.

## Resume

- **Status:** blocked. The `D` did not reproduce in six real Claude sessions, so there is no cause to pin and no fix was written.
- **Setup:** a scratch daemon from this worktree (with tasks 02, 03 and 04 already built in it), `XDG_CONFIG_HOME=/tmp/ahpd-repro26/config`, port 9431, `--without-connection-token`, `--plugin file://<worktree>/packages/agent-claude/src/index.ts`, `--sessions memory`, `--automations memory`, `--wire /tmp/ahpd-repro26/wire.jsonl`; stopped by its pid after the runs.
- The client was a scratch script over `ws`: `createSession` with `provider: 'claude'`, subscribed to the session, its default chat, `<session>/changeset/session` and `<session>/changeset/uncommitted`; it approved every `toolConfirmation`, waited for the turn to end plus 4 seconds, subscribed again to both changesets for their snapshots, and read `git status --porcelain=v1 -z`.
- Claude Code 2.1.267, signed in on this machine, on the backend's default model.
- **A:** session at the root of a scratch repository, `bypassPermissions`, one turn: Write `notes.txt` (alpha, beta), Edit beta to gamma, Bash `git add notes.txt`. Porcelain `A  notes.txt`. Both scopes: one row, no `before`, an `after`, 2 added; `uncommitted` `_meta` `{ staged: true, unstaged: false }`.
- **B:** as A, with the session folder `sub/` of a repository. Porcelain `A  sub/notes.txt`. Both scopes: one row `file:///tmp/ahpd-repro26/nested/sub/notes.txt`, no `before`, an `after`.
- **C:** repository root, `bypassPermissions`; an `Agent` subagent wrote and edited `sub-notes.txt`, then the lead ran `git add` through Bash. Both scopes: no `before`, an `after`, staged.
- **E:** repository root, `bypassPermissions`, the three steps as three turns in one session. Both scopes: no `before`, an `after`, staged.
- **P:** as A with `permissionMode: default`, each call asked and approved. Both scopes: no `before`, an `after`, staged.
- **D:** session in `sub/`, `permissionMode: default`; an `Agent` subagent did the write, the edit and the `git add` itself, each asked on the worker chat and approved. Porcelain `A  sub/agent.txt`. Both scopes: no `before`, an `after`, staged.
- Every `changeset/contentChanged` and `changeset/fileSet` in the six runs carried an `after` and no `before` for the new file; none sent a row without an `after`, and no porcelain record had a `D`.
- The captures are `/tmp/ahpd-repro26/{A,B,C,D,E,P}.json` (each run's frames and final snapshots) and `/tmp/ahpd-repro26/wire.jsonl`.
- **Why the built tasks cannot hide it:** the `session` scope reads no git, so tasks 02 and 03 do not touch it, and task 04 changes only a count. In `uncommitted`, a staged new file is `A ` and is drawn without a `before` whatever its path, so the subfolder and rename bugs gave wrong paths or an extra row, not a `D` on this file.
- **Not tried:** a daemon restart between the write and the `git add` (the captured sides are held in memory), a fork or peer chat doing the write, a background subagent, and the ahpapp client itself, which decides the letter from the sides.
- **Question for review:** can Softov say which client and which scope showed the `D` (the session's changes, a turn, or uncommitted), and whether the daemon restarted or the session was reopened between the write and the `git add`? With that the next attempt can target the path.
