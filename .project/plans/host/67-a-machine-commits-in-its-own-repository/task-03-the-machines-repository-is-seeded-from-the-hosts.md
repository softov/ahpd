---
title: The machine's repository is seeded from the host's
status: done
depends: [task-02-a-machine-gets-a-git-directory-of-its-own.md]
layer: "computer"
refs:
  - "[code://packages/computer/src/runtime.ts#L1655-L1660](../../../../packages/computer/src/runtime.ts#L1655-L1660) - `seedState`, a volume owned by the machine's user"
  - "[code://packages/computer/src/runtime.ts#L2179-L2204](../../../../packages/computer/src/runtime.ts#L2179-L2204) - `exec` as the labelled user, and the dev container road"
  - "[code://packages/sdk/src/repo/hardened.ts#L11-L30](../../../../packages/sdk/src/repo/hardened.ts#L11-L30) - the argv for the host-side reads"
---

## Objective

Once the machine is up, its git directory is a repository whose objects come from the host's through `objects/info/alternates`, whose branch is the one checked out in the host's tree at the same commit, whose index matches that commit, and whose config holds only the host's `user.name` and `user.email`.

## Files

- `UPDATE: packages/computer/src/gitdir.ts` - `seedOf(gitDir, root)`: the host-side reads, with the hardened argv: `symbolic-ref -q HEAD`, `rev-parse HEAD`, `config --get user.name`, `config --get user.email`.
- `UPDATE: packages/computer/src/runtime.ts` - after the container is up, on both routes, as the machine's user: `git init` at the volume's target, `objects/info/alternates` naming `<gitDir>/objects`, `update-ref` of the branch, `symbolic-ref HEAD` (or a detached `HEAD`), the two config values, `reset -q`. The volume is owned by the machine's user before this, as `seedState` does.
- `UPDATE: packages/sdk/src/index.ts` - export `gitArgv`, so the computer package runs host git the same way.
- `UPDATE: packages/computer/test/computer-git-fetch.test.ts` - the cases below.

## Steps

1. Failing case first, real Docker: `git status` in the machine is clean right after it is made; with an empty volume it is not a repository.
2. Read the host's side, then seed through the machine's own git; nothing on the host is written.
3. A seed that fails removes the machine and answers git's words.

## Validation

- `computer-git-fetch.test.ts`: on a linked worktree and on a main checkout, the machine's `git status` is clean, `git log -1` is the host's commit, `git branch --show-current` is the host's branch; a detached host HEAD gives a detached machine; the machine's `git config --list --local` holds `user.name` and `user.email` and no remote.
- `npx vitest run packages/computer` passes.

## Resume

- **Implemented** 2026-10-06 on `build/agents/c016a0e4`.
- `gitdir.ts`: `MACHINE_OBJECTS` (`/opt/ahpd/host-objects`) is new, and `GitMounts` gained `objects`, the path the machine's `objects/info/alternates` names. `gitMounts` mounts the host's `objects/` there on both tree kinds. `seedOf(root)` is new, answering `{ branch?, commit?, name?, email? }` from the host-side reads through `gitArgv`: `symbolic-ref -q HEAD` (a `refs/heads/` name, else no branch), `rev-parse HEAD`, `config --get user.name`, `config --get user.email`. Every value that git does not answer is left out of the answer rather than defaulted.
- **The one departure, and it is forced:** the task places the objects bind at `<gitDir>/objects`, where the machine's alternates would name it. That is wrong on a main checkout: the machine's own git directory is a volume at `<root>/.git`, and a bind inside a mount wins, so `<root>/.git/objects` in the machine would be the read-only host's - a git that cannot write an object cannot commit. The objects therefore land at a path of ahpd's own, `/opt/ahpd/host-objects`, and `GitMounts.objects` carries that path so the alternates and the mount cannot drift apart. The real-Docker case `gives a machine on a main checkout the branch its tree is on` fails on exactly this, and its comment says why.
- `seedOf` takes the root alone, not the `(gitDir, root)` the task names: it is the host-side reads of the tree's own repository, and the objects' location is the mount's, which `gitMounts` answers separately.
- `runtime.ts`: `idsOfMachine` (the machine's `uid`/`gid`, from `spec.user` where it is `uid:gid`, else `id -u` and `id -g` run in the container, as the machine's user; nothing where neither answers) and `seedGit(machine, spec, git, container)`, called on both routes once the container is up. In the machine, as the machine's user: `chown` of the volume root as root first, because a named volume is made owned by root and git has to write at the top of its own git directory; `git init --bare -q <at>` followed by `git --git-dir=<at> config core.bare false`, because a plain `git init <at>` makes the git directory `<at>/.git` and the volume is mounted where git looks for the directory itself; `objects/info/alternates` naming `git.objects`, written through `docker cp -a -` of an archive holding an `info/` directory and the file, owned as the machine's user, so no shell is needed and no image without one is left out; `user.name` and `user.email` where the host answered them; `symbolic-ref HEAD` to the tree's branch where it has one, else `update-ref --no-deref HEAD` to the commit; `update-ref` of the commit; `reset -q` for the index. A seed that throws removes the machine before git's words go on, so nothing is left up with nothing to commit into.
- The chown is the one command in a machine that does not run as the host user, and it is why: nothing in the volume can be written before it. It runs only where the machine's ids are not root's, and a machine whose ids cannot be read is left as it is with one log line rather than made to fail.
- `packages/sdk/src/index.ts`: `gitArgv` is exported, so the computer package reads the host's git through the hardened argv the sdk already uses.
- `computer-git-fetch.test.ts`: three more real-Docker cases, each with the plan's 120 s budget. On a linked worktree the machine's `git status --porcelain` is empty, `rev-parse HEAD` is the host's commit, `branch --show-current` is `work`, `log -1` is the host's subject, and `config --list --local` holds `user.name` and `user.email` and no `remote.`. On a main checkout the same for `main`, plus `touch <MACHINE_OBJECTS>/probe` failing while `touch <gitDir>/objects/probe` succeeds and leaves nothing in the host's git directory. A host tree checked out detached gives a machine with no branch and a `symbolic-ref -q HEAD` that fails. All five cases pass (21 s).
- The other cases that named the old objects target move with it: `computer-git-own.test.ts` (the binds and `mounts.objects`), `computer-disposable.test.ts` (five mount expectations) and `computer-devcontainer.test.ts` (the override's mounts). The devcontainer case's "every `docker exec` as the host user" now excepts the chown, which is asserted to be the only command that is not.
- `npx tsc -b` clean; `npx vitest run --no-file-parallelism packages/computer` passes 353 of 354, the one failure `computer-needs.test.ts > gives a vault-filled key only to the agent whose need declared it` a 5 s timeout with no assertion failure, under a load average near 30. It passes on its own at 5.36 s, which is the same load flake host/65's tasks recorded, in a file this task does not touch and whose machine has no git directory to seed.
