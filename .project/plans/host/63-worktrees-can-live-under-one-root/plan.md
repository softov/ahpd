---
title: Worktrees can live under one root
domain: host
status: planned
priority: medium
created: 2026-10-06
revalidated: 2026-10-06
decisions:
  - decisions/worktrees-can-live-under-one-root.md
refs:
  - "[code://packages/sdk/src/repo/worktrees.ts#L31-L45](../../../../packages/sdk/src/repo/worktrees.ts#L31-L45) - `worktreesOf` and `worktreeFor`, the path a tree is given"
  - "[code://packages/sdk/src/host/lifecycle.ts#L590-L640](../../../../packages/sdk/src/host/lifecycle.ts#L590-L640) - `isolated`, the one caller that makes a session's tree path"
  - "[code://packages/sdk/src/types/host.ts#L150-L164](../../../../packages/sdk/src/types/host.ts#L150-L164) - `worktrees` on the host's options, beside which the root is declared"
  - "[code://packages/sdk/src/host.ts#L27](../../../../packages/sdk/src/host.ts#L27) - imports `worktreesOf` and `worktreeFor` and uses neither"
  - "[code://packages/server/src/commands/options.ts#L277-L330](../../../../packages/server/src/commands/options.ts#L277-L330) - `serverFields`, where `paths` shows the shape of a directory option"
  - "[code://packages/server/src/commands/run.ts#L460-L490](../../../../packages/server/src/commands/run.ts#L460-L490) - the `createHost` call that hands in `gitWorktrees()`"
  - "[code://docs/DAEMON.md#L261-L265](../../../../docs/DAEMON.md#L261-L265) - the flag table"
  - "[code://docs/AHP.md#L697-L720](../../../../docs/AHP.md#L697-L720) - `### Worktrees the window manages`"
  - https://github.com/microsoft/vscode/blob/7516b04bc94/src/vs/platform/agentHost/common/worktreePaths.ts#L11-L20 - the reference's fixed `<repo>.worktrees`
---

## Goal

A daemon can be told one folder to keep every session worktree in, so a machine with many repositories has its worktrees under `<root>/<repo>/<name>` instead of a `<repo>.worktrees` folder beside each repository.
Without it nothing changes.

## Reconnaissance

The files read and the patterns to reuse are the `refs` above, each with its note.

### Searches performed

- `rg "worktreesOf|worktreeFor" packages --glob '!**/dist/**'` - made in `repo/worktrees.ts`, exported from `index.ts`, used only at `host/lifecycle.ts:612`; `host.ts:27` imports both and uses neither.
- `rg "worktreesRoot|worktreeLocation" /github/externals/vscode/src/vs/platform/agentHost` - nothing; the reference has no setting.

### Runtime path

```
ahpd config / --worktrees-root -> run.ts createHost({ worktreesRoot }) -> lifecycle isolated -> worktreesOf(repository, root) -> port.create({ path })
```

### Gaps

- `worktreesOf` takes no root.
- The host's options and the daemon's fields have no key for one.

## Decisions locked in

| # | Decision | Rationale / source |
| --- | --- | --- |
| 1 | [Worktrees can live under one root, as an option beside the reference's default](../../../decisions/worktrees-can-live-under-one-root.md) | Softov, 2026-10-06, "Plan an option" |

| What | Source | Task |
| --- | --- | --- |
| `<root>/<repo>/<name>`, `<repo>` the repository folder's name | the decision | 01 |
| The daemon key is `worktreesRoot`, flag `--worktrees-root <dir>` | `(defaulted: named after the sdk option, in the shape of `paths`)` | 02 |
| A relative root resolves against the config file's folder for the file, and the working directory for the flag | `(defaulted: what a path option means elsewhere in the daemon)` | 02 |

## Proposed architecture

- **Data flow** - the daemon reads `worktreesRoot` and hands it to `createHost`; `isolated` passes it to `worktreesOf`.
- **State flow** - none new; a session keeps the path it was given.
- **Layer responsibilities** - sdk: the option and the path · server: the field, the flag and the docs.
- **Source-of-truth files** - [`code://packages/sdk/src/repo/worktrees.ts`](../../../../packages/sdk/src/repo/worktrees.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - The host takes a worktrees root](task-01-the-host-takes-a-worktrees-root.md) | todo | - |
| [02 - The daemon reads the root](task-02-the-daemon-reads-the-root.md) | todo | 01 |

## Risks and tradeoffs

- A tree under a root is not where VS Code's host looks - the default stays the reference's, and the docs say so.
- Two repositories with one folder name share `<root>/<repo>` - session branches are unique, and git refuses a taken path rather than mixing them.

## Resume state

- **Done so far:** nothing.
- **Next action:** [task-01-the-host-takes-a-worktrees-root.md](task-01-the-host-takes-a-worktrees-root.md).
- **Open questions:** none.
- **Watch out for:** `worktreesOf` is exported from the sdk's `index.ts`, so its one-argument form must keep working.

## Final verification checklist

- [ ] A session with `isolation: worktree` on a host given a root gets its tree at `<root>/<repo>/<name>`.
- [ ] Without a root, the tree is at `<repo>.worktrees/<name>` as before.
- [ ] `pnpm typecheck`, `pnpm boundary`, `pnpm test` pass.
- [ ] `plans/index.md` updated.
