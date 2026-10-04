---
title: A dev container is a computer, listed and reachable without the connection that made it
domain: container
status: active
priority: medium
created: 2026-09-26
revalidated: 2026-10-04
requires:
  - plans/container/01-a-session-in-a-dev-container/plan.md
  - plans/plugin/15-an-agent-says-what-a-machine-needs/plan.md
changes: []
creates: []
decisions:
  - decisions/a-dev-container-is-a-computer-made-from-its-devcontainer-json.md
  - decisions/a-dev-container-is-reached-by-docker-exec.md
  - decisions/the-host-hands-an-agents-machine-needs-to-the-machine-maker.md
  - decisions/the-computer-form-offers-a-folder-as-a-flat-source-choice.md
  - decisions/a-dev-container-is-made-only-from-a-folder-the-operator-allows.md
  - decisions/a-devcontainer-source-names-any-allowed-folder.md
  - decisions/a-machine-made-for-a-session-counts-against-max-and-needs-computer-write.md
  - decisions/the-name-a-create-gives-a-dev-container-is-a-label-on-it.md
  - decisions/a-dev-container-owner-is-kept-beside-the-config.md
refs:
  - "[code://packages/computer/src/devcontainer.ts#L59-L62](../../../../packages/computer/src/devcontainer.ts#L59-L62) - `idLabels`, shared today by `up` and every `exec`"
  - "[code://packages/computer/src/devcontainer.ts#L311-L312](../../../../packages/computer/src/devcontainer.ts#L311-L312) - `inside()`, the launcher's commands through `devcontainer exec`"
  - "[code://packages/computer/src/devcontainer.ts#L481-L486](../../../../packages/computer/src/devcontainer.ts#L481-L486) - the relay's nested host, spawned through `devcontainer exec` with no id labels"
  - "[code://packages/computer/src/runtime.ts#L645-L696](../../../../packages/computer/src/runtime.ts#L645-L696) - `run` for a dev container: `up` with the id labels, `--mount` and `--remote-env`"
  - "[code://packages/computer/src/runtime.ts#L761-L792](../../../../packages/computer/src/runtime.ts#L761-L792) - `exec` for the `computer_exec` tool"
  - "[code://packages/computer/src/plugin.ts#L562-L620](../../../../packages/computer/src/plugin.ts#L562-L620) - `reach`, the `how` answer, with its `devcontainer exec` branch at :576-593"
  - "[code://packages/computer/src/plugin.ts#L210-L224](../../../../packages/computer/src/plugin.ts#L210-L224) - `within`, a host path mapped through the machine's mounts"
  - "[code://packages/computer/src/plugin.ts#L683-L721](../../../../packages/computer/src/plugin.ts#L683-L721) - the `devcontainer://<folder>` session-time create"
  - "[code://packages/computer/src/plugin.ts#L903-L975](../../../../packages/computer/src/plugin.ts#L903-L975) - the `computer` key and its picker, the `devcontainer://` row at :933-950"
  - "[code://packages/computer/src/owners.ts#L1-L20](../../../../packages/computer/src/owners.ts#L1-L20) - why an extra id label would give a folder a second container"
  - "[code://packages/sdk/src/host/context.ts#L277-L287](../../../../packages/sdk/src/host/context.ts#L277-L287) - `containers`, the relays a connection opened, dropped with the socket"
  - "[code://packages/computer/test/fixtures/devcontainer.mjs](../../../../packages/computer/test/fixtures/devcontainer.mjs) - the fake CLI"
  - "[code://packages/computer/test/fixtures/docker.mjs](../../../../packages/computer/test/fixtures/docker.mjs) - the fake Docker"
  - npm://@devcontainers/cli@0.89.0 - `up` makes the container; its `exec` is the reference the switch is checked against
  - https://containers.dev/implementors/json_reference/ - `remoteUser`, `remoteEnv`, `userEnvProbe` and the `devcontainer.metadata` label
---

## Goal

A dev container is a computer made from a folder's `devcontainer.json`: it is listed, picked and reached like any other computer, and it survives the connection and the client that made it.
It is made from the computer form, or from a `devcontainer://<folder>` row the picker offers for a session's folder.
The Dev Container CLI makes it, and every command afterwards reaches it through `docker exec`, so a dev container is reached the way every other machine is.
VS Code's own flow still works, and its `connect` finds or makes the same computer.

## Reconnaissance

The files read and the patterns to reuse are the `refs` above, each with its note.

### Runtime path

```
form: source = folder         -> devcontainer up --workspace-folder F --id-label ahpd.computer=1 --id-label ahpd.devcontainer.folder=F
                                 -> [new] --override-config: mounts, runArgs (--label ahpd.name, --label ahpd.agents, limits), containerEnv
                                 -> [new] one userEnvProbe run, kept in computers.json by machine id
picker: devcontainer://F row  -> session starts -> the same create, then computer://<id>
computers list                -> the label -> listed like any computer
session in it                 -> [new] how() = docker exec -i -u <remoteUser> -w <folder inside> -e <probe + remoteEnv> <id> <command>
computer_exec                 -> [new] the same docker exec
vscode/devContainers/connect  -> find the computer for F or make it -> [new] probe, installs, config and nested host by docker exec -> relay
```

### Gaps

- Every command in a dev container goes through `devcontainer exec` today: the launcher's probe, install, plugin install and config write ([`code://packages/computer/src/devcontainer.ts#L409`](../../../../packages/computer/src/devcontainer.ts#L409), `:424`, `:445`, `:469`), the relay's nested host (`:482-486`), `how()` and `computer_exec`.
- The relay's nested host passes no id labels, so the CLI finds the container by its own `devcontainer.local_folder` lookup rather than by ahpd's labels.
- `cliMount` writes `,readonly`, which the CLI refuses ([`code://packages/computer/src/runtime.ts#L494-L500`](../../../../packages/computer/src/runtime.ts#L494-L500)).
- A need's environment goes to `up` as `--remote-env` ([`code://packages/computer/src/runtime.ts#L674`](../../../../packages/computer/src/runtime.ts#L674)), which a later command never sees.
- `MANIFEST_SCHEMA` has no `source`, so the form cannot offer a folder.
- `existing` ignores whether the container is running.
- `reach` drops a caller's `cwd` for a dev container, and the picker strips `file://` instead of decoding the URI ([`code://packages/computer/src/plugin.ts#L942`](../../../../packages/computer/src/plugin.ts#L942)).
- policy/01's `computer:` rows gate `devcontainer://F` before placement ([`code://packages/sdk/src/host/machines.ts#L150-L153`](../../../../packages/sdk/src/host/machines.ts#L150-L153)), but not the form create or the relay's `connect`.
- `computer:write` is not in the SDK yet; plugin/16 task 09 adds it.

## Decisions locked in

| Decision | Task |
| --- | --- |
| [A dev container is a computer, made from its devcontainer.json](../../../decisions/a-dev-container-is-a-computer-made-from-its-devcontainer-json.md) | 01, 03, 04, 05 |
| [A dev container is made by the Dev Container CLI and reached by docker exec](../../../decisions/a-dev-container-is-reached-by-docker-exec.md) | 01, 17, 18 |
| [The host hands an agent's machine needs to the plugin that makes the machine](../../../decisions/the-host-hands-an-agents-machine-needs-to-the-machine-maker.md) | 04, 09 |
| [The computer form offers a folder through a flat source choice, not a oneOf](../../../decisions/the-computer-form-offers-a-folder-as-a-flat-source-choice.md) | 03 |
| [A dev container is made only from a folder the operator allows, and devcontainer false turns every route off](../../../decisions/a-dev-container-is-made-only-from-a-folder-the-operator-allows.md) | 08 |
| [A devcontainer source may name any allowed folder, not only the session's own](../../../decisions/a-devcontainer-source-names-any-allowed-folder.md) | 08 |
| [A machine made for a session counts against max and needs computer:write](../../../decisions/a-machine-made-for-a-session-counts-against-max-and-needs-computer-write.md) | 12 |
| [The name a create gives a dev container is kept as a label on the container](../../../decisions/the-name-a-create-gives-a-dev-container-is-a-label-on-it.md) | 10 |
| [A machine the Dev Container CLI made keeps its owner in a file beside the config, not on the container](../../../decisions/a-dev-container-owner-is-kept-beside-the-config.md) | 10, 11 |

| What | Source | Task |
| --- | --- | --- |
| `--id-label ahpd.computer=1 --id-label ahpd.devcontainer.folder=F` on every `up`, and no other id label, since the set is how the CLI finds a folder's container | the Dev Container CLI's `--id-label`; [`code://packages/computer/src/owners.ts#L10-L14`](../../../../packages/computer/src/owners.ts#L10-L14) | 01, 10, 11 |
| The switch is checked first: `devcontainer exec ... env` against the derived `docker exec`, for a Dockerfile definition, one with features, and one with `remoteEnv` and a login-shell `PATH` (nvm), with the CLI installed by npm in the task and not vendored | [decision](../../../decisions/a-dev-container-is-reached-by-docker-exec.md), Consequences | 17 |
| The `devcontainer://F` row is offered only when F has a `devcontainer.json` and no computer exists for it | Softov, 2026-09-26: "devcontainer://<folder> entry" | 04 |
| A need's mount goes in as `devcontainer up --mount`, and a read-only one through the override config | `plugin/15`'s delivery kinds; the CLI refuses `,readonly` in `--mount` | 04, 09 |
| Read-only needs go into an override config's `mounts`, passed as `--override-config` on `up` | Softov, 2026-09-26: "through an override config's `mounts`". | 09 |
| `cpus` and `memory` go through the override config as `runArgs`, `workdir` as `workspaceFolder` | Softov, 2026-09-26: "All via override". | 11 |
| The fake CLI and the fake Docker refuse what the real ones refuse | the review of 2026-09-26: every read-only need passed the fake and fails the real CLI | 07 |
| When no container carries ahpd's labels for a folder, the plugin looks for one by `devcontainer.local_folder` and adopts it | Softov, 2026-09-26: "Adopt by folder". | 15 |
| A dev container's working directory is `docker exec -w`, mapped through the machine's mounts by `within`, never a `sh -c cd` wrapper | follows from the docker exec reach; [`code://packages/computer/src/plugin.ts#L210`](../../../../packages/computer/src/plugin.ts#L210) | 14, 18 |
| For now the name a create gives (`ahpd.name`) and the `ahpd.agents` list are `--label` entries in the override config's `runArgs`, which the CLI does not use to find the container; this is how the name decision's "label on the container" is kept, and one function writes the override's labels so the record can move later | Softov, 2026-10-03, asked "where do the name and the `ahpd.agents` list live, since an extra `--id-label` gives a folder a second container?": "`--label` entries in the override config's `runArgs`" | 10, 11 |
| For now the probed environment is kept in the machine's `computers.json` entry, keyed by machine id, and rewritten when `up` answers a new container id; one pair of functions reads and writes it, so the store can change | Softov, 2026-10-03, asked "where is the probed environment kept between commands and across a restart?": "the `computers.json` entry, keyed by machine id" | 13, 18 |
| For now a need's environment reaches every command as `containerEnv` in the override config, in place of `up --remote-env`; the override is written 0600 and a need named from the vault is not written there in clear (`container/05-p1` task 02) | Softov, 2026-10-03, asked "how does a need's environment reach every command?": "`containerEnv` in the override config" | 09 |

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - A computer can be made from a folder's devcontainer.json](task-01-made-from-a-folder.md) | implemented | - |
| [02 - A session reaches it through devcontainer exec](task-02-reached-through-devcontainer-exec.md) | implemented; replaced by 18 | 01 |
| [03 - The computer form offers a folder as a flat source choice](task-03-the-form-offers-a-folder.md) | todo | 01 |
| [04 - The picker offers the session folder's dev container](task-04-the-picker-offers-the-folder.md) | implemented | 02 |
| [05 - VS Code's connect finds or makes the same computer](task-05-connect-uses-the-computer.md) | implemented | 02 |
| [06 - Docs and the domain text](task-06-docs.md) | todo | 03, 08, 18 |
| [07 - The fakes behave like the real CLI and Docker](task-07-the-fake-cli-behaves-like-the-real-one.md) | todo | 18 |
| [08 - Only allowed folders, and an off switch for every route](task-08-only-allowed-folders-and-an-off-switch-for-every-route.md) | todo | - |
| [09 - Read-only needs through an override config](task-09-read-only-needs-through-an-override-config.md) | todo | 07 |
| [10 - The name given is kept for the container](task-10-the-name-given-is-a-label.md) | todo | 07, 09 |
| [11 - The agents and the body's limits reach the container](task-11-agents-label-and-body-limits.md) | todo | 09 |
| [12 - A dev container made at session start counts](task-12-a-session-time-dev-container-counts.md) | todo | plugin/16 task 09 |
| [13 - A stopped container is started first](task-13-a-stopped-container-is-started-first.md) | todo | 07 |
| [14 - The picker decodes the folder, and a dev container keeps the working directory](task-14-the-picker-decodes-and-exec-keeps-cwd.md) | todo | 18 |
| [15 - A container from an older connect is adopted](task-15-a-container-from-an-older-connect-is-adopted.md) | todo | 10 |
| [16 - Comments document](task-16-comments-document.md) | todo | 18 |
| [17 - docker exec matches devcontainer exec against the real CLI](task-17-docker-exec-matches-devcontainer-exec.md) | todo | - |
| [18 - Every command reaches a dev container by docker exec](task-18-every-command-reaches-it-by-docker-exec.md) | todo | 17 |

## Risks and tradeoffs

- A container someone made with `devcontainer up` by hand, without the labels, stays unlisted until task 15 adopts it; the docs say so.
- The probed environment is what the user's shell set when the container was made: a dotfile changed afterwards is not seen until the container is made again, and the docs say so.
- A later CLI that derives the user, folder or environment differently would make the two routes disagree; task 17's comparison is kept as a by-hand check to rerun on a CLI upgrade.

## Resume state

- **Done so far:** tasks 01, 02, 04 and 05 implemented on 2026-09-26 and reviewed the same day; task 02's `devcontainer exec` route is replaced by task 18.
- **Next action:** [task-17-docker-exec-matches-devcontainer-exec.md](task-17-docker-exec-matches-devcontainer-exec.md); then 18, 07, 09, 08 and 03.
- **Open questions:** none.
- **Watch out for:** the override config now holds environment values on disk, so it is written 0600 and removed after `up`, and a need whose value is named from the vault (`container/05-p1` task 02) is not written there in clear; the probed environment in `computers.json` is kept under the same 0600 file the owners are; a label in `runArgs` is set only when the container is made, so a second create for a folder whose container exists reads the label back rather than writing it; removing a dev container computer removes the container, not the folder or its `devcontainer.json`; an id label beyond the two gives a folder a second container; the real CLI 0.89.0 is at `/usr/local/bin/devcontainer`, but task 17 installs its own copy with npm so the result does not depend on the workstation.

## Final verification checklist

- [ ] Task 17's comparison is recorded for all three definitions, with the exact `docker exec` argv the CLI builds.
- [ ] No `devcontainer exec` is left in `packages/computer/src`, and `devcontainer` runs only for `up` and `--version`.
- [ ] A dev container made from ahpapp's form shows in the computer list and the picker, and survives an ahpapp reload.
- [ ] Picking `devcontainer://<folder>` makes it at session start, and the next session sees it as `computer://<id>`.
- [ ] A Claude session in it runs as the config's `remoteUser`, with the `PATH` its login shell sets.
- [ ] VS Code's "Use Dev Container" on the same folder reuses it.
- [ ] End to end against the real CLI: a Claude session through `devcontainer://F` starts, with its read-only needs mounted read-only.
- [ ] `devcontainer: false` refuses every route, and a folder outside the allowlist is refused on each.
- [ ] A container made by container/01's connect is reused, not duplicated.
- [ ] A need's variable is seen by a `computer_exec` run after the create, the override config is 0600 while it exists, and no vault-named value is in it.
- [ ] A dev container carries `ahpd.name` and `ahpd.agents` as plain labels and exactly the two id labels.
- [ ] `pnpm test`, `pnpm typecheck`, `pnpm boundary` green; `docs/CONTAINERS.md`, `docs/COMPUTER.md`, `00-container.md`, `plans/index.md` updated.
