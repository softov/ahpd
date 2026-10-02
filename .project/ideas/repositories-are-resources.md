---
title: Repositories are resources a session opens on
created: 2026-10-02
---

Softov, 2026-10-02: "plan some other feature resource called repositories like github, gitlab. So we could just clone the repo when needed.. no storage.. run remote, local, etc. a session could be opened on git:// instead file://".
Pending, to see and think about; not a plan yet.

Today a session opens on a folder this host already has (`file://`), and a machine works on that folder through a mount.
The idea is a `repository:` (or `git:`) resource scheme, served like `computer:` and the people schemes: a host lists the repositories it can reach on GitHub and GitLab, and a session is opened on one of them rather than on a folder.
The host clones it when a session needs it, where the session runs: on this host, or inside a machine that cannot mount anything ([more computer runtimes](more-computer-runtimes.md), "Clone the repository and branch inside the machine").
Nothing is kept beyond the session's own clone, so a host needs no checked-out copies to serve a repository.

| | |
| --- | --- |
| What a repository is | A provider (GitHub, GitLab, any git remote) and a path, listed through that provider's API with a token the host or the person holds. |
| What a session gets | A working directory that is a fresh clone at a branch, made where the session runs; the worktree and pull request ports already work on a clone. |
| Where it runs | Local (a temporary folder on the host), or in a machine (cloned inside it), which is what makes a machine without a mount useful. |
| What goes away | The need to keep checkouts on the host for every project, and the `paths` a host must be configured to serve. |

Open before it is a plan:

1. The URI: `git://` is the git protocol's own scheme, so a session on `git://` would read as that protocol; `repository://<provider>/<owner>/<name>` or `github:`/`gitlab:` schemes per provider are the alternatives.
2. Whose token clones and lists: the host's, or the person's own. Either is kept in the vault ([a secret store](a-secret-store.md)), which comes first.
3. When the clone goes: with the session, after the session is archived, or kept as a cache.
4. How a session on a repository relates to `paths`, sessions listed by directory, and the transcript stores keyed by directory (Claude's `~/.claude/projects/<dir>`).
5. Grants: a `repository:read` subject, and whether a person's own provider access limits what they can open.
