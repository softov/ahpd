---
title: COMPUTER.md says how a machine commits
status: done
depends: [task-05-the-work-comes-back-when-it-matters.md, task-06-the-machine-follows-the-hosts-branch.md, task-07-a-machine-made-under-bind-is-replaced.md, task-09-a-profile-can-give-a-machine-a-copy-of-the-folder.md]
layer: "docs"
refs:
  - "[code://docs/COMPUTER.md#L344](../../../../docs/COMPUTER.md#L344) - the `gitGuard` row"
  - "[code://docs/COMPUTER.md#L435](../../../../docs/COMPUTER.md#L435) - a worktree brings its repository"
  - "[code://docs/COMPUTER.md#L580](../../../../docs/COMPUTER.md#L580) - a mounted git directory"
---

## Objective

The docs say that a machine commits in a git directory of its own, that the commit reaches the host's branch when the turn ends, when it waits under `refs/ahpd/machines/`, what `fetch` and `open` are, what `sessionTree: "copy"` changes and what the changes view shows under it, that `bind` is read as `fetch`, and what does not work in a machine: `git push`, submodules, filter drivers such as LFS, and a repository whose objects have alternates.

## Files

- `UPDATE: docs/COMPUTER.md:344` - the `gitGuard` row, and a `sessionTree` row beside it.
- `UPDATE: docs/COMPUTER.md:435` - the paragraph rewritten for `fetch`.
- `UPDATE: docs/COMPUTER.md:580` - the security note: nothing of the host's git directory is writable under `fetch`, and a link in it refuses a session.

## Steps

1. Rewrite the three places; short, one sentence per line.

## Validation

- Read against the built behaviour and the tests of tasks 02-07 and 09; no claim the tests do not show.

## Resume

- **Implemented** 2026-10-06 on `build/agents/c016a0e4`.
- `docs/COMPUTER.md`'s profile-options table gains a `gitGuard` row rewritten for `fetch` and `open` and a `sessionTree` row beside it. The `gitGuard` row says what `fetch` makes - a git directory of its own in the volume `ahpd-git-<machine>`, nothing of this host's mounted but `objects/` read-only, the host user's uid:gid, the work fetched back - and that `open` is the operator's own choice, with the image's user at a repository root and the host user still on a worktree's directory; and it says `bind` is read as `fetch` with a line saying so. The `sessionTree` row says `shared`, the default, mounts this host's tree at the same path read-write, `copy` mounts the machine's git volume there instead with nothing of this host's tree bound, it needs `sessionFolder`, and a folder with no repository is refused rather than given an empty volume.
- The paragraph at `docs/COMPUTER.md:435` ("A worktree brings its repository.") is rewritten for `fetch`: the allowlist it described - `objects/` writable with `objects/info/` pinned, `refs/`, `logs/`, the session's worktree entry, and the main-checkout exception with `index`, `HEAD` and `COMMIT_EDITMSG` writable in the directory's root - is gone with the guard it described, and what replaces it is that under `fetch` nothing of this host's git directory is writable in a machine and nothing of it is mounted but the objects, with `open` stated as the other answer.
- A new paragraph, "**The work comes back by fetch.**", follows it: where the machine's git directory is mounted for a `.git` directory and for a file, that `objects/info/alternates` names the host's `objects/` read-only at `/opt/ahpd/host-objects` and never at a path inside the machine's own git directory, the branch and identity the seed gives it, the bundle poured out on a pipe and fetched with `transfer.fsckObjects`, the hidden ref `refs/ahpd/machines/<machine>/<branch>`, the fast-forward where the tree has nothing staged and the waiting where it has, the four moments, and the plain statement that a commit made in a machine reaches the branch at the turn's end and not before. `follow` is the paragraph after it. A "**What does not work in a machine.**" paragraph names `git push`, `git fetch`, `git pull`, a submodule that has to be cloned, a filter driver such as LFS, and a host repository whose `objects/info/alternates` names anything. A "**A copy of the tree.**" paragraph covers `sessionTree: "copy"`: the volume at the tree's own path, the hard reset in the seed, the two differences (`merge --ff-only` on the host's tree, and uncommitted work kept at `refs/ahpd/machines/<machine>/uncommitted`), what the changes view shows under it, the refusal of a folder with no repository, and that no git-ignored file is carried into a copy.
- The security note at `docs/COMPUTER.md:580` ("A mounted git directory.") is rewritten as "**This host's git directory, and a machine's own.**": under `fetch` a machine is never given a writable path in this host's git directory, so a link planted under `logs/`, `refs/`, `objects/` or a worktree entry is a link in a volume this host's git never opens, and the host's own git directory is read first - a link under its root or in any of those places refuses the machine and names each link and what it points at, with nothing removed. `open` is stated as the one guard that mounts it writable and takes that risk. The sentence about a hook path inside the worktree such as `.husky` is kept, since it is true under every guard.
- The old note's last sentence - an `index.lock` left in the session's worktree entry by a machine being removed after it is gone, and one whose own time is after the machine stopped being left where it is - is deleted with `releaseLock`, which no longer exists: the worktree entry the machine locked is inside the machine's own git volume, which goes with the machine, and the host's git directory is never the machine's to lock.
- `packages/computer/src/plugin.ts`'s comment above the answers list is corrected in the same change: it named `secretUnreadable`, `state`, `stateScope`, `gitGuard` and `nestedDelete`, and `sessionTree` is now one of the fields a profile's value is checked against. That is the only code change this task makes, and it says nothing the code did not already do.
- **Validation**, read against the built behaviour and the tests: `computer-git-guard.test.ts` and `computer-git-own.test.ts` for the mounts, the gitfile, the link refusal and the alternates refusal; `computer-plugin.test.ts` for `bind` read as `fetch` with its line, and for the `sessionTree` values and the refusal; `computer-disposable.test.ts` for the `copy` mounts, the `ahpd.git=fetch` label and the seed's `reset --hard`; `computer-git-fetch.test.ts` for the fetch, the waiting ref, `follow` and the removal's `uncommitted` ref. Every claim in the three places is one of those, and nothing is written that no test shows.
- Gates: `npx tsc -b` clean; `pnpm boundary` reports nothing undeclared in any package; `npx vitest run packages/computer packages/sdk/test` passes, and the plan's own `implemented.md` records the run.
- **Review round** 2026-10-06: two paragraphs corrected against what the code does.
  - The first paragraph of `docs/COMPUTER.md:440` still said a commit made in a machine is one ahpd "brings back onto that branch", which is a single-branch fetch and no longer what happens. It now says the commit is brought back onto the branch the tree is on at the turn's end, by the fetch below; the sentence about `open` is unchanged, since there is still no fetch to make under it.
  - The fetch paragraph (`docs/COMPUTER.md:444`) now says every branch the machine holds is asked for and not only the one it is on, that each one comes back under a hidden ref of its own and moves the host's branch of that name, and that a branch the host has no name for is made at the machine's commit. The `follow` paragraph (`docs/COMPUTER.md:446`) now names both things it checks - the commit the machine is at, and the branch of that name it is about to be pointed at, re-pointed only where the host's commit leads on from it - and closes with the sentence that a branch of the machine's the host is not on is left exactly where it is.
