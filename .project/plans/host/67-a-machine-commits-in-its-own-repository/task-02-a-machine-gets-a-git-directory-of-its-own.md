---
title: A machine gets a git directory of its own, and nothing of the host's is writable
status: todo
depends: [task-01-gitguard-is-fetch-or-open.md]
layer: "computer"
refs:
  - "[code://packages/computer/src/gitdir.ts](../../../../packages/computer/src/gitdir.ts) - the allowlist, `mainCheckoutBinds`, `releaseLock`, `MACHINE_WORKTREE` go; `ownOf`, `spellingOf`, `notLinked` stay"
  - "[code://packages/computer/src/runtime.ts#L2026-L2099](../../../../packages/computer/src/runtime.ts#L2026-L2099) - the Docker route's mounts"
  - "[code://packages/computer/src/runtime.ts#L1108-L1122](../../../../packages/computer/src/runtime.ts#L1108-L1122) - the dev container route's mounts and labels"
  - "[code://packages/computer/src/runtime.ts#L1919-L1921](../../../../packages/computer/src/runtime.ts#L1919-L1921) - the dev container route asks `guardedMounts`"
  - "[code://packages/computer/src/runtime.ts#L2164-L2172](../../../../packages/computer/src/runtime.ts#L2164-L2172) - `remove` and `releaseLock`"
---

## Objective

Under `fetch`, a machine with a repository mounts the host's `<gitDir>/objects` read-only at its own path and a volume `ahpd-git-<machine>` as the tree's git directory, and nothing else of the host's git directory.
A host git directory holding a symbolic link, or whose objects have alternates, refuses the machine before anything is made.

## Files

- `UPDATE: packages/computer/src/gitdir.ts` - `gitMounts` answers `{ binds, volume, gitfile? }`: the read-only `objects/` bind; the volume's target, `<root>/.git` where the tree's `.git` is a directory, else `/opt/ahpd/git`; and for a linked worktree a gitfile reading `gitdir: /opt/ahpd/git`, made by ahpd in its own state directory and bound read-only over `<root>/.git`. Delete the allowlist, `mainCheckoutBinds`, `releaseLock` and `MACHINE_WORKTREE`.
- `UPDATE: packages/computer/src/gitdir.ts` - `linksIn(gitDir, entry)`: every symbolic link in the git directory's root, under `logs/`, `refs/` and `objects/`, and in the session's worktree entry, with what each names.
- `UPDATE: packages/computer/src/runtime.ts:2026-2099` - the Docker route mounts what `gitMounts` answers, adds `-v ahpd-git-<machine>:<target>`, and labels the machine `ahpd.git=fetch`; `open` labels `ahpd.git=open` and keeps its one writable bind.
- `UPDATE: packages/computer/src/runtime.ts:1108-1122` and `1919-1921` - the dev container route the same, through the override's mounts.
- `UPDATE: packages/computer/src/runtime.ts:2164-2172` - `remove` takes the git volume with the container, after task 04's `bringBack`; no lock to release.
- `UPDATE: packages/computer/test/computer-disposable.test.ts` - the mount cases.
- `CREATE: packages/computer/test/computer-git-fetch.test.ts` - real Docker, skipped without it.

## Steps

1. Failing case first, real Docker: a machine on a linked worktree runs `ln -sf /tmp/x <gitDir>/logs/HEAD`; today it succeeds.
2. Rewrite `gitMounts` and the two routes; a machine never gets a bind of the host's git directory but `objects/` read-only.
3. `linksIn` before anything is made: one link refuses with `<gitDir> holds <path>, a symbolic link to <target>, which git never makes; remove it and start the session again`.
4. A non-empty `<gitDir>/objects/info/alternates` refuses with a sentence naming it.
5. Keep `ownOf` and `spellingOf`: the volume and the gitfile land at the spelling the machine mounts the tree at.

## Validation

- `computer-disposable.test.ts`: a worktree session's mounts are the root, `objects/` read-only, the gitfile read-only over `<root>/.git` and the volume at `/opt/ahpd/git`; a main checkout's are the root, `objects/` read-only and the volume at `<root>/.git`; no other path under the git directory; a link under `logs/` refuses naming it and makes nothing; alternates refuse; `open` is unchanged.
- `computer-git-fetch.test.ts`: in the machine, `ln -sf` over `logs/HEAD` and `touch <gitDir>/config` fail on both kinds of tree, and `<root>/.git` cannot be replaced.
- `npx tsc -b` clean; `npx vitest run packages/computer` passes.

## Resume
