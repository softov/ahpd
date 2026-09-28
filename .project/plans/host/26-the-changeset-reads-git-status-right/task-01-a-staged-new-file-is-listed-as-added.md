---
title: A file Claude created, edited and staged through Bash is listed as added
status: todo
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
