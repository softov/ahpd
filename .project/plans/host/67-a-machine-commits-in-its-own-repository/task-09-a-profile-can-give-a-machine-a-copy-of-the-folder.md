---
title: A profile can give a machine a copy of the folder
status: todo
depends: [task-04-ahpd-brings-the-work-back-by-fetch.md, task-06-the-machine-follows-the-hosts-branch.md]
layer: "computer"
refs:
  - "[code://packages/computer/src/manifest.ts#L129](../../../../packages/computer/src/manifest.ts#L129) - `sessionFolder`, the option `sessionTree` sits beside"
  - "[code://packages/computer/src/plugin.ts#L379-L388](../../../../packages/computer/src/plugin.ts#L379-L388) - the two-answer check a profile's options go through"
  - "[code://packages/computer/src/runtime.ts#L2026-L2099](../../../../packages/computer/src/runtime.ts#L2026-L2099) - the Docker route, which binds the folder or the root today"
---

## Objective

A profile's `sessionTree` is `shared`, the default, or `copy`.
Under `copy`, the machine works in its own checkout in its volume at the tree's root path, nothing of the host's folder is mounted, its commits reach the host by `bringBack`, and the host's tree follows them with `merge --ff-only` (decision 1).

## Files

- `UPDATE: packages/computer/src/manifest.ts` - `Profile.sessionTree?: 'shared' | 'copy'`, documented beside `sessionFolder`.
- `UPDATE: packages/computer/src/plugin.ts` - the schema row, the reading, and `['sessionTree', ['shared', 'copy']]` in the answers check.
- `UPDATE: packages/computer/src/runtime.ts` - under `copy`, both routes mount the volume at `<repository ?? folder>` instead of binding it, with `objects/` read-only as under `shared`; the seed ends with `reset --hard -q`; `bringBack` runs `merge --ff-only <new>` in the host's tree in place of `update-ref` and `reset -q`; `follow` runs `merge --ff-only` in the machine where its tree is clean; `remove` fetches `git stash create` to `refs/ahpd/machines/<machine>/uncommitted` when the machine's tree is not clean.
- `UPDATE: packages/computer/test/computer-plugin.test.ts`, `computer-disposable.test.ts`, `computer-git-fetch.test.ts` - the cases below.

## Steps

1. Failing case first: a profile with `sessionTree: "copy"` is refused at load today.
2. The option, then the mounts, then the seed, `bringBack`, `follow` and `remove` under `copy`.
3. `shared` stays exactly as tasks 02-06 build it.

## Validation

- `computer-plugin.test.ts`: `copy` and `shared` load; absent is `shared`; anything else is refused naming the two.
- `computer-disposable.test.ts`: under `copy` no bind of the host's folder or root, the volume at the root path, `objects/` read-only.
- `computer-git-fetch.test.ts`, real Docker, under `copy`: a file the machine writes is not in the host's folder; after a commit and `bringBack` the host's branch and tree hold it and `git status` there is clean; a host file changed in the same path makes `merge --ff-only` refuse and the work wait under the hidden ref; an uncommitted file at `remove` is in `refs/ahpd/machines/<machine>/uncommitted` on the host.
- `npx vitest run packages/computer` passes.

## Resume
