---
title: Repositories are resources a session opens on
created: 2026-10-02
---

Softov, 2026-10-02: "plan some other feature resource called repositories like github, gitlab. So we could just clone the repo when needed.. no storage.. run remote, local, etc. a session could be opened on git:// instead file://".
Pending, to see and think about; not a plan yet.

Today a session opens on a folder this host already has (`file://`), and a machine works on that folder through a mount.
The idea is a `repository:` (or `git:`) resource scheme, served like `computer:` and the people schemes: a host lists the repositories it can reach on GitHub and GitLab, and a session is opened on one of them rather than on a folder.
The host clones it when a session needs it, where the session runs: on this host, or inside a machine that cannot mount anything ([container 05 p8](../plans/container/05-an-agent-in-a-machine-p8-a-profile-on-another-docker/plan.md) clones it there).
Nothing is kept beyond the session's own clone, so a host needs no checked-out copies to serve a repository.

| | |
| --- | --- |
| What a repository is | A provider (GitHub, GitLab, any git remote) and a path, listed through that provider's API with a token the host or the person holds. |
| What a session gets | A working directory that is a fresh clone at a branch, made where the session runs; the worktree and pull request ports already work on a clone. |
| Where it runs | Local (a temporary folder on the host), or in a machine (cloned inside it), which is what makes a machine without a mount useful. |
| What goes away | The need to keep checkouts on the host for every project, and the `paths` a host must be configured to serve. |

## A forge, not only GitHub

A repository on GitLab needs the same pull request flow a GitHub one has today, as a merge request.
The host's pull request port is named `github` ([`code://packages/sdk/src/types/github.ts`](../../packages/sdk/src/types/github.ts), `registerGithub`), though its three calls (`resource`, `forBranch`, `create`) are forge-neutral in shape.
A host with repositories on both forges needs both at once, so the port would be renamed to a forge port that routes by the remote's URL, with a GitHub and a GitLab implementation behind it.
Self-hosted instances (`git.brbyte.com`) are the case to design for: each instance has its own URL and its own token, kept in the [vault](../plans/vault/01-secrets-live-in-a-vault/plan.md).
The GitLab REST API covers merge requests, issues and pipelines without an SDK.
Issues are their own idea: [issues follow the repository](issues-follow-the-repository.md).

## Browsing what is already there

Softov, 2026-10-02: "I also want to be possible to see commits from a repository. we currently can commit, create pr. but cannot interact with those ones."
The host writes to a repository (a commit, a pull request) but cannot read back what exists.
A repository resource would list its branches, its recent commits and its open pull or merge requests, and open one: a commit's diff, a pull request's description, diff, checks and review comments.
Commenting on and reviewing an existing pull request is the write that follows, and a review comment that mentions the bot is an [initiator](initiators-start-sessions.md) turn.
Commits and branches come from git itself where a clone exists, and from the forge's API where it does not.

Open before it is a plan:

1. The URI: `git://` is the git protocol's own scheme, so a session on `git://` would read as that protocol; `repository://<provider>/<owner>/<name>` or `github:`/`gitlab:` schemes per provider are the alternatives.
2. Whose token clones and lists: the host's, or the person's own. Either is kept in the vault ([vault/01](../plans/vault/01-secrets-live-in-a-vault/plan.md)), which comes first.
3. When the clone goes: with the session, after the session is archived, or kept as a cache.
4. How a session on a repository relates to `paths`, sessions listed by directory, and the transcript stores keyed by directory (Claude's `~/.claude/projects/<dir>`).
5. Whether the `github` port is renamed to a forge port before GitLab, or GitLab ships behind `github` first.
6. Whether commits and pull requests are children of the repository's URI or schemes of their own.
7. Grants: a `repository:read` subject, and whether a person's own provider access limits what they can open.
