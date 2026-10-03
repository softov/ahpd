---
title: A profile's machines may live on another Docker
domain: container
status: planned
priority: medium
created: 2026-09-26
revalidated: 2026-10-03
requires:
  - plans/container/05-an-agent-in-a-machine-p5-agents-run-from-their-parts/plan.md
  - plans/container/05-an-agent-in-a-machine-p7-a-worktree-brings-its-repository/plan.md
  - plans/container/05-an-agent-in-a-machine-p9-an-ssh-machine-runs-a-nested-host/plan.md
  - plans/container/05-an-agent-in-a-machine-p12-a-machine-off-this-host-reaches-models-through-the-proxy/plan.md
changes: []
creates: []
decisions:
  - decisions/a-machine-runtime-is-named-for-its-maker.md
  - decisions/a-nested-host-is-used-only-where-a-command-cannot-reach-the-agent.md
  - decisions/a-nested-session-resumes-its-inner-transcript-by-id.md
  - decisions/a-machine-is-owned-by-whoever-created-it-and-pays-for-its-up-time.md
refs:
  - "[code://packages/computer/src/plugin.ts#L76](../../../../packages/computer/src/plugin.ts#L76) - the `env` option, which already sets `DOCKER_HOST` for the whole plugin"
  - "[code://packages/computer/src/plugin.ts#L354-L360](../../../../packages/computer/src/plugin.ts#L354-L360) - the one `dockerRuntime`, given that `env`"
  - "[code://packages/computer/src/plugin.ts#L410-L454](../../../../packages/computer/src/plugin.ts#L410-L454) - `made`, the single `dockered` that usage/03 wraps to meter up time"
  - "[code://packages/computer/src/plugin.ts#L403-L412](../../../../packages/computer/src/plugin.ts#L403-L412) - `claimOf`, which reads the owner through `dockered.inspect`"
  - "[code://packages/computer/src/plugin.ts#L142-L175](../../../../packages/computer/src/plugin.ts#L142-L175) - `profilesOf`, where a profile's keys are read"
  - "[code://packages/computer/src/runtime.ts#L325-L341](../../../../packages/computer/src/runtime.ts#L325-L341) - `ran`, whose env carries `DOCKER_HOST`"
  - "[code://packages/computer/src/runtime.ts#L98-L106](../../../../packages/computer/src/runtime.ts#L98-L106) - `MachineSpec.mounts`, host paths a remote Docker does not have"
  - "[code://packages/computer/src/runtime.ts#L152-L159](../../../../packages/computer/src/runtime.ts#L152-L159) - `MachineSpec.folder`, mounted at the same path"
  - "[code://packages/computer/src/runtime.ts#L726-L732](../../../../packages/computer/src/runtime.ts#L726-L732) - `-v` for mounts and the folder, `-e`, `-w`"
  - "[code://packages/computer/src/runtime.ts#L123](../../../../packages/computer/src/runtime.ts#L123) - `MachineSpec.copies`"
  - "[code://packages/computer/src/runtime.ts#L736-L744](../../../../packages/computer/src/runtime.ts#L736-L744) - a copy-in is `create`, `docker cp`, `start`, which works against a remote Docker"
  - git://c81ebe0:.project/ideas/more-computer-runtimes.md - "Working without a mount, and syncing", the clone this plan takes
  - https://docs.docker.com/engine/security/protect-access/ - `DOCKER_HOST=ssh://user@host`
---

## Goal

A profile names `dockerHost: "ssh://softov@dev86.brbyte.com"`, and its machines are made on that Docker: state volumes and copies live there, and the session's code arrives by clone, because the folder is on this host's disk.
By default the clone is of a bundle this host makes, so no credential reaches the box; a profile may instead have the machine clone from `origin` with a git credential named from the vault.
A session in one runs through a nested host, since its terminals and files are the other box's.
The test is against dev86's Docker.

## Reconnaissance

The files read and the patterns to reuse are the `refs` above, each with its note.

### Searches performed

- `rg "DOCKER_HOST|env" packages/computer/src/plugin.ts` - the plugin's `env` option is passed to the one runner, so a global `DOCKER_HOST` works today and treats that Docker as this host's.
- `rg "'-v'" packages/computer/src/runtime.ts` - mounts and the folder are bind mounts, which name this host's paths.

### Runtime path

```
profile.dockerHost -> [new] one docker runner per profile, env DOCKER_HOST -> router id docker-<profile>.<name>
session on disposable:<profile> -> create on that Docker: no bind mounts, copies by docker cp
  -> [new] code: bundle (default): git bundle here -> docker cp in -> cloned inside, origin set to the repo's remote
  -> [new] code: clone: git clone <origin> inside, credential by name from the vault
  -> port.remote(id) -> nested: DOCKER_HOST=... docker exec -i <name> ahpd --stdio
  -> the result comes back: git bundle inside -> docker cp out -> fetched into the session's worktree branch
```

### Gaps

- The runner always talks to the plugin's one Docker.
- Two Dockers may each hold a container of the same name, and the id does not say which.
- Every mount assumes this host's filesystem.
- Nothing brings a session's code into a machine without a mount, or brings it back.

## Decisions locked in

| Decision | Task |
| --- | --- |
| [One computer: provider, the runtime named for what makes the machine](../../../decisions/a-machine-runtime-is-named-for-its-maker.md) | 01 |
| [A nested host is used only for a backend that runs nested and for a machine on another host](../../../decisions/a-nested-host-is-used-only-where-a-command-cannot-reach-the-agent.md) | 04 |
| [A nested session is resumed by resuming the inner transcript by id](../../../decisions/a-nested-session-resumes-its-inner-transcript-by-id.md) | 04 |
| [A machine is owned by whoever created it, and its owner pays for the time it is up](../../../decisions/a-machine-is-owned-by-whoever-created-it-and-pays-for-its-up-time.md) | 01 |

| What | Source | Task |
| --- | --- | --- |
| `dockerHost` is a profile option, not a runtime: the machine is still made by Docker | decision `a-machine-runtime-is-named-for-its-maker`, the runtime names what makes the machine | 01 |
| One Docker runner per profile that names `dockerHost`, beside the plugin's own | the single `dockered` at [`code://packages/computer/src/plugin.ts#L354-L360`](../../../../packages/computer/src/plugin.ts#L354-L360) | 01 |
| A remote runner's machines carry a per-host label its listing filters on, and a `dockerHost` equal to the plugin's own Docker is skipped with a line | (defaulted: the plugin label is the same on every host, so two hosts on one Docker would list each other's machines, and one Docker reached twice lists each machine twice) | 01 |
| Every call through the router has a per-runner timeout, and a startup adoption that fails is logged and tried again at the next listing | (defaulted: `ran` has no timeout, so a hung `ssh://` Docker would block the listing and the picker) | 01 |
| A need marked `credential: true` is refused on a remote runner, never copied | (defaulted: a copy puts the host's keys on another box) | 02 |
| The work comes back by a fetch into its own ref and a `merge --ff-only` in the worktree, and a disposable machine whose bring-back failed is kept | (defaulted: git refuses a fetch into a branch checked out in a worktree, and removing the machine would lose the work) | 03 |
| `gitCredential` is `secretAtUse`, read with `host.secret` at create for the machine's owner, and a missing one fails only that create | Softov, 2026-10-03, asked "when a `$secret` in a plugin's options can't be read at load, what fails?": "Only its item" | 07 |
| The plugin's `env.DOCKER_HOST` stays the whole plugin's Docker and is treated as this host's | it works today, and an operator who set it chose that | 01 |
| A machine's id records which Docker made it | two Dockers can hold the same name | 01 |
| The session's code reaches the machine by clone | Softov, 2026-10-02, asked "How does a session's code reach a machine on another box?": "clone everywhere.. but leave open for future case with virtiofs on local libvirt" | 03 |
| A machine on another Docker takes no bind mount; a copy-in still works | `docker cp` streams through the Docker API, a bind mount names a path on the Docker's own host | 02 |
| Every session in such a machine runs nested | decision `a-nested-host-is-used-only-where-a-command-cannot-reach-the-agent` | 04 |
| The test target is dev86's Docker | Softov, 2026-10-02, asked "Which box is the test target?": "ssh to softov@dev86.brbyte.com worked." | 05 |
| Both ways in exist, chosen per profile with `code` (for now the option's name and its two values): `bundle` (default), a git bundle of the session's branch made here, copied in with `docker cp` and cloned inside with `origin` set to the repository's remote, with no credential in the box; and `clone`, the machine cloning from `origin` with a git credential named from the vault as `gitCredential: { "$secret": ... }`; one function picks the route | Softov, 2026-10-03, asked "where does the clone come from and get its credentials?": "Both, a profile option"; "one or another is not a valid choise" | 03, 07 |
| For now this host fetches the work back: a bundle made inside, copied out with `docker cp`, fetched into the session's worktree branch | Softov, 2026-10-03, asked "does the machine push the branch back, or does this host fetch it?": "as proposed" | 03 |
| For now a machine on a profile's Docker is `docker-<profile>.<name>`, spelled and parsed by p9 task 01's functions; a profile named like a runtime value is refused | Softov, 2026-10-03, answered in p9: "put runtime.name" | 01 |

## Proposed architecture

- **Data flow** - `profiles.<key>.dockerHost` -> a `dockerRuntime` with `env.DOCKER_HOST` set -> registered with the router under `docker-<key>`; its listing filters by the plugin label and `ahpd.profile=<key>`, so two profiles on one Docker list disjoint machines.
- **Code** - `codeRouteOf(profile)` picks `bundle` (default) or `clone`; both land the session's branch at the machine's `workdir`, and both come back as a bundle made inside, copied out and fetched into the session's worktree branch, when the session leaves the machine and before a disposable machine is removed.
- **Metering** - `made` wraps the router, so each runner's machines are metered as the local ones; `claimOf` reads through the router.
- **Layer responsibilities** - `@ahpd/computer` only.
- **Source-of-truth files** - [`code://packages/computer/src/plugin.ts`](../../../../packages/computer/src/plugin.ts), `packages/computer/src/router.ts` (p9).

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - A profile names its Docker, and its machines' ids say which](task-01-a-profile-names-its-docker.md) | todo | - |
| [02 - A machine on another Docker takes no bind mount](task-02-no-bind-mount-on-another-docker.md) | todo | 01 |
| [03 - The session's code arrives by bundle and returns as a branch](task-03-the-code-arrives-by-clone.md) | todo | 02 |
| [04 - Sessions in a machine on another Docker run nested](task-04-sessions-there-run-nested.md) | todo | 01 |
| [05 - dev86's Docker runs a session](task-05-dev86s-docker-runs-a-session.md) | todo | 03, 04, 07 |
| [06 - Docs](task-06-docs.md) | todo | 05, 07 |
| [07 - A profile may have its machine clone from origin](task-07-a-profile-may-clone-from-origin.md) | todo | 03, vault/01-p1 task 04 |

## Risks and tradeoffs

- `ssh://` Docker connections are slow to open - each verb is one `docker` run; a listing across several Dockers runs them in parallel and bounds each.
- The nested host needs ahpd inside the image - the test image installs it as `docs/COMPUTER.md` shows; p5's ahpd part replaces that once built, and a part image must then be built on the Docker that mounts it.
- A Docker that is down makes its profile's machines unlisted - the listing says which Docker did not answer rather than failing the whole listing.

## Resume state

- **Done so far:** nothing; planned 2026-10-02.
- **Next action:** [task-01-a-profile-names-its-docker.md](task-01-a-profile-names-its-docker.md), once p9 task 01 and p12 are built.
- **Open question (ask before task 03):** a session with `isolation: folder` on a remote profile has no worktree branch of its own, and its folder may have another branch checked out - (a) refuse `isolation: folder` on a remote profile with a sentence, or (b) bring the work back to a side branch named for the session and leave merging to the person?
- **Watch out for:** the `clone` route puts a git credential in the box for the clone command only, and needs the vault (vault/01-p1 task 04) to name it; the `bundle` route needs neither; a git credential helper that asks this host is needed only if an agent must reach the remote itself, and waits until one does; a folder that is not a repository has no clone; it is refused here, and copying it in stays in [the idea](../../../ideas/more-computer-runtimes.md); p7's git directory mount does not apply on another Docker; p12 must land first, or a profile's `needs` would carry a key to dev86.

## Final verification checklist

- [ ] A disposable session on a profile with `dockerHost` set to dev86 answers a turn, and its commit reaches this host's repository as a branch, with `code: "bundle"` and with `code: "clone"`.
- [ ] No git credential is in any argv on either host, and none is left in the machine after a `clone` route's clone.
- [ ] A local profile and a dev86 profile list their machines side by side with distinct ids, and both are metered.
- [ ] A profile on another Docker with a bind mount is refused with a sentence.
- [ ] `pnpm test`, `pnpm typecheck` green.
- [ ] `docs/COMPUTER.md`, `plans/index.md` updated.
