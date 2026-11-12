---
title: A git seed takes three execs
domain: container
status: planned
priority: medium
created: 2026-11-12
revalidated: 2026-11-12
requires: []
changes: []
creates: []
refs:
  - git://b4ad32951 - the commit of ahpd this plan was checked at
  - "[code://packages/computer/src/runtime.ts#L2286-L2368](../../../../packages/computer/src/runtime.ts#L2286-L2368) - `seedGit`, which runs each step as its own `docker exec`"
  - "[code://packages/computer/src/runtime.ts#L2327-L2343](../../../../packages/computer/src/runtime.ts#L2327-L2343) - `info/alternates`, written with `docker cp -a` so an image with no shell seeds the same way: the pattern to extend"
  - "[code://packages/computer/src/machinegit.ts#L123-L152](../../../../packages/computer/src/machinegit.ts#L123-L152) - `checkedOut`: four `config` calls, `symbolic-ref`, `update-ref` and `reset`"
  - "[code://packages/computer/src/runtime.ts#L2251-L2261](../../../../packages/computer/src/runtime.ts#L2251-L2261) - `idsOfMachine`, two more execs for `id -u` and `id -g`"
---

## Goal

A new machine with a checkout is ready sooner.
On Docker Desktop each `docker exec` costs about 1 s, and the seed makes about nine of them one after another.
The seed keeps working in an image with no shell.

## Reconnaissance

The files read and the patterns to reuse are the `refs` in the frontmatter, each with its note.

### Searches performed

- Docker's events on the Windows check: `config user.name`, `config user.email`, `config core.filemode`, `config core.autocrlf`, `symbolic-ref`, `update-ref` and `reset`, each about 1 s apart.

### Runtime path

```
run -> seedGit -> chown, init --bare, config core.bare, cp -a alternates -> checkedOut: config x4, symbolic-ref, update-ref, reset
```

### Gaps

- The `config` values and `HEAD` are files git reads, and they go in as separate commands.

## Answers

| What | Source | Task |
| --- | --- | --- |
| The `config` file and `HEAD` are written in the `docker cp -a` archive that writes `info/alternates`, still with no shell | Softov, 2026-11-12: "Fewer execs, still no shell" | 01 |
| `init --bare`, `update-ref` and `reset` stay execs | `(defaulted: git builds the object store and the index itself)` | 01 |
| The two `id` reads become one `id` call | `(defaulted: one exec instead of two, same answer)` | 01 |

## Proposed architecture

- **Data flow** - `seedGit` builds one tar with `config`, `HEAD` and `info/alternates`, and `checkedOut` keeps only `update-ref` and `reset`.
- **Layer responsibilities** - computer only.
- **Source-of-truth files** - [`code://packages/computer/src/runtime.ts`](../../../../packages/computer/src/runtime.ts), [`code://packages/computer/src/machinegit.ts`](../../../../packages/computer/src/machinegit.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - The seed writes config and HEAD](task-01-the-seed-writes-config-and-head.md) | implemented | - |

## Risks and tradeoffs

- ahpd writes git's config format itself - the file holds a few fixed keys, and a case reads it back with `git config --list`.
- `init --bare` writes its own `config` - the archive goes in after `init`, so it replaces that file.

## Resume state

- **Done so far:** task-01 is implemented: the seed writes `config` and `HEAD` in the `docker cp -a` archive, and `idsOfMachine` reads uid and gid from one `id`.
- **Next action:** review and merge the PR, then the [Windows check](../../../pending/windows-machine-paths-checks.md).
- **Open questions:** none.
- **Watch out for:** the written `config` holds the three keys `git init --bare` writes, with `core.bare` false and no `logallrefupdates`.

## Final verification checklist

- [ ] A seeded machine shows the same `git config --list` and `HEAD` as before.
- [ ] The seed makes at most three git execs, plus the `docker cp`.
- [ ] The computer suite passes with an image that has no `sh`.
