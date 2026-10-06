---
title: A machine commits in a git directory of its own, and ahpd fetches the work into the host's repository
status: accepted
date: 2026-10-06
supersedes: decisions/a-machines-git-directory-is-read-only-but-what-a-commit-writes.md
refs:
  - "[code://packages/computer/src/gitdir.ts](../../packages/computer/src/gitdir.ts) - `gitMounts`, the writable allowlist this replaces"
  - "[code://packages/sdk/src/repo/hardened.ts#L11-L30](../../packages/sdk/src/repo/hardened.ts#L11-L30) - the argv every host git runs with"
  - git://0cdbb95 - the superseded decision, as committed
  - https://git-scm.com/docs/git-bundle - a bundle is refs and a pack, read by `git fetch` like a remote
  - https://git-scm.com/docs/gitrepository-layout - `objects/info/alternates`
---

## Context

The superseded decision left `objects/`, `refs/`, `logs/` and the session's worktree entry writable, and for a main checkout the git directory's root.
A reviewer reproduced with git 2.47.3 that any writable bind of the host's git directory is enough: a machine replaces `<gitDir>/logs/HEAD`, or `logs/refs/heads/<branch>`, with a symbolic link to any host file, and the host user's next commit appends a reflog line with text the machine chose to that file.
Git 2.47 refuses a symbolic link under `refs/`; a directory under `objects/` replaced by a link is a lesser way in.
No list of writable paths closes this, because the host's own git writes into every one of them.

## Decision

Nothing of the host's git directory is mounted writable in a machine.
A machine with a repository gets a git directory of its own, in a volume, and commits there; ahpd brings the work back by fetching it into the host's repository, where git checks every object and ref and follows nothing the machine wrote.

- A profile's `sessionTree` says where the machine works `(defaulted: the name mirrors sessionFolder and sessionRepository beside it)`: `shared`, the default, binds the host's folder read-write as before, so the host sees the agent's edits as it makes them; `copy` gives the machine its own checkout in its volume, at the folder's path, with nothing of the host's folder writable, and its work reaches the host only as commits fetched by bundle.
- Under `copy`, the session's changes view reads the host's folder, which holds the fetched commits and nothing uncommitted `(defaulted: simpler than streaming a diff out of the machine, and the view stays git on the host)`.
- The machine's git directory reads the host's objects through `objects/info/alternates`, from the host's `objects/` mounted read-only `(defaulted: read-only, the machine only reads; a bundle or a fresh clone would copy the whole history into every machine)`.
- The work comes back as a bundle the machine's git writes to standard output through `docker exec`, saved by ahpd to a private file and fetched by the host's git with `transfer.fsckObjects` into `refs/ahpd/machines/<machine>/<branch>` `(defaulted: a bundle on a pipe is data; a fetch from a path in the machine's volume would have the host's git run `upload-pack` against a repository the machine wrote, reading its config)`.
- The session's branch on the host moves to what was fetched only when that is a fast-forward and the host's index holds nothing staged; otherwise the commits wait under the hidden ref and the log says so `(defaulted: never rewrite a branch or an index a person moved)`.

`gitGuard` takes `fetch`, this decision and the default, and `open`, unchanged: the git directory mounted writable as a whole, the operator's own choice for a machine they trust with it.
`bind`, the allowlist, is gone; a profile that says `bind` is read as `fetch`, with one line at load `(defaulted: a profile written for the old default keeps working and gets the safer layout)`.

Source: Softov, 2026-10-06, asked "Any writable bind of the host's git directory lets a machine plant symlinks that the host's own git later writes through. How should a machine commit?" and chose "Host fetches from machine". Asked "Does the machine keep working in the host's folder (shared working tree), or in a copy of it?", he answered "configurable shared bound read-write as default, copy as opt".

## Consequences

- A machine cannot write anything the host's git reads or writes through: under `fetch`, only `objects/`, read-only, is mounted from the host's git directory.
- A commit in the machine reaches the host's branch at the end of the turn, not at once; until then the host shows it as uncommitted changes in the folder.
- ahpd moves the host's branch and resets its index after a fetch, which a machine's own commit used to do directly.
- A change the host makes to the branch, from the changes view or a terminal, is handed to the machine before its next turn, since the machine's branch is its own.
- Pushing from inside a machine has no remote; a submodule, a filter driver such as LFS, and a repository whose objects have alternates of their own are not carried into the machine.
- Under `copy`, uncommitted work is invisible to the host until it is committed; what is still uncommitted when the machine goes is kept as a stash commit under the hidden ref.
- A machine made under `bind` is never entered again, and a symbolic link found in a host git directory refuses the session until a person removes it.

## Options

- **Keep the allowlist and refuse links before each host git run.** Lost: a link can be planted between the check and the write, and the host's own git outside ahpd never checks.
- **Fetch from a read-only mount of the machine's repository.** Lost: the host's git would read a config and refs the machine wrote, and `protocol.file`, `upload-pack` and `safe.directory` are each a setting to get right.
