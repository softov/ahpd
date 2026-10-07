---
title: A machine commits in a repository of its own, and ahpd fetches the work back - deferred
date: 2026-10-06
---

Two edges of a machine's own repository wait: one thing `remove` cannot keep, and the things a machine has no remote to do.

| What | Why it waits | Where it goes |
| --- | --- | --- |
| Under `copy`, work an agent left as a new untracked file when the machine goes is not kept | The plan's row names plain `git stash create`, which takes tracked modifications only - a stash of untracked files needs `git stash push -u` or an `add -N` before the create. The test modifies a tracked file instead, so the gap is real and untested. | A later plan; the fix is small and local to `keepUncommitted` in `packages/computer/src/runtime.ts`. |
| `git push`, `git fetch`, `git pull`, a submodule that has to be cloned, and Git LFS do not work in a machine | No remote, no submodule config and no filter driver reaches it: the machine's history is the host's objects, read-only, and the way work leaves it is the fetch. The plan's *Risks* names this, and `docs/COMPUTER.md` states it. | Unplanned; a machine with a remote is a plan of its own. |
