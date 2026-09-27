---
title: A profile's machines may live on another Docker
domain: container
status: draft
priority: medium
created: 2026-09-26
revalidated: 2026-09-26
requires:
  - plans/container/05-an-agent-in-a-machine-p5-agents-run-from-their-parts/plan.md
  - plans/container/05-an-agent-in-a-machine-p7-a-worktree-brings-its-repository/plan.md
changes: []
creates: []
decisions:
  - decisions/one-computer-provider-with-runtimes-as-options.md
  - decisions/a-nested-host-is-used-only-where-a-command-cannot-reach-the-agent.md
refs:
  - "[code://packages/computer/src/runtime.ts#L299-L301](../../../../packages/computer/src/runtime.ts#L299-L301) - the runner's spawn env, where `DOCKER_HOST` goes"
  - "[code://.project/ideas/more-computer-runtimes.md](../../../ideas/more-computer-runtimes.md) - \"Working without a mount, and syncing\""
  - https://docs.docker.com/engine/security/protect-access/ - `DOCKER_HOST=ssh://user@host`
---

## Goal

A profile names `dockerHost: "ssh://build@box"`, and its machines are made on that Docker: parts are built there under the same tags, state volumes live there, and the code arrives by clone instead of a mount because the folder is on this host's disk.
A session in one runs through a nested host, since its terminals and files are the other box's.

## Reconnaissance

### Gaps

- Every mount assumes this host's filesystem.
- The runner always talks to the local Docker.

## Decisions locked in

| Decision | Plans |
| --- | --- |
| [One computer: provider, one package, the runtime chosen by option](../../../decisions/one-computer-provider-with-runtimes-as-options.md) | this plan adds an option, not a runtime |
| [A nested host is used only for a backend that runs nested and for a machine on another host](../../../decisions/a-nested-host-is-used-only-where-a-command-cannot-reach-the-agent.md) | every session here is nested |

## Proposed architecture

- **Data flow** - profile `dockerHost` -> the runner's env -> every docker call; the worktree is a clone of the session's branch made inside the machine, and the result returns as a pushed branch.

## Tasks

Written when this plan leaves draft. The outline:

1. The runner takes a Docker host per profile.
2. A remote machine refuses bind mounts and seeds by `docker cp`.
3. The session's branch is cloned inside and pushed back.
4. Sessions in a remote machine run nested.
5. Docs.

## Risks and tradeoffs

- Credentials leave this host - the host proxy in the parent's [deferred.md](../05-an-agent-in-a-machine/deferred.md) moves up.

## Resume state

- **Done so far:** nothing.
- **Next action:** leave draft once p5 and p7 are built.
- **Open questions:**
  1. Where does the clone get its credentials: a token as a secret, or a git credential helper that asks this host? - proposed: a helper that asks this host, so no token lives on the box.
  2. Does a remote machine push the branch, or does this host fetch from it? - proposed: push, through the helper.
- **Watch out for:** the same-path rule for transcripts no longer holds; the nested host keeps the transcript inside, which decision `a-nested-session-resumes-its-inner-transcript-by-id` already covers.

## Final verification checklist

- [ ] A session on a profile with `dockerHost` answers a turn and its commit reaches the host's repository as a branch.
- [ ] `plans/index.md` updated.
