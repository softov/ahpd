---
title: A dev container is a computer, listed and reachable without the connection that made it
domain: container
status: active
priority: medium
created: 2026-09-26
revalidated: 2026-09-26
requires:
  - plans/container/01-a-session-in-a-dev-container/plan.md
  - plans/plugin/15-an-agent-says-what-a-machine-needs/plan.md
changes: []
creates: []
decisions:
  - decisions/a-dev-container-is-a-computer-made-from-its-devcontainer-json.md
  - decisions/a-dev-container-is-made-by-the-dev-container-cli.md
  - decisions/the-host-hands-an-agents-machine-needs-to-the-machine-maker.md
  - decisions/the-computer-form-offers-a-folder-as-a-flat-source-choice.md
  - decisions/a-dev-container-is-made-only-from-a-folder-the-operator-allows.md
  - decisions/a-devcontainer-source-names-any-allowed-folder.md
  - decisions/read-only-needs-reach-a-dev-container-through-an-override-config.md
  - decisions/the-name-a-create-gives-a-dev-container-is-a-label-on-it.md
  - decisions/a-dev-containers-body-limits-reach-it-through-the-override.md
  - decisions/a-machine-made-for-a-session-counts-against-max-and-needs-computer-write.md
  - decisions/a-container-from-an-older-connect-is-adopted-by-its-folder.md
refs:
  - "[code://packages/sdk/src/host.ts#L4987](../../../../packages/sdk/src/host.ts#L4987) - `containers`, the relays a connection opened, dropped with the socket"
  - "[code://packages/computer/src/runtime.ts#L272](../../../../packages/computer/src/runtime.ts#L272) - `list`, by the `ahpd.computer=1` label"
  - "[code://packages/computer/src/plugin.ts#L297-L321](../../../../packages/computer/src/plugin.ts#L297-L321) - the `computer` key and its picker"
  - "[code://packages/computer/src/devcontainer.ts](../../../../packages/computer/src/devcontainer.ts) - the launcher: `devcontainer up`, the install line, the nested host"
  - "[code://.project/plans/container/00-container.md](../00-container.md) - the domain text that says the two are kept apart"
---

## Goal

A dev container is a computer made from a folder's `devcontainer.json`: it is listed, picked and reached like any other computer, and it survives the connection and the client that made it.
It is made from the computer form, or from a `devcontainer://<folder>` row the picker offers for a session's folder.
VS Code's own flow still works, and its `connect` finds or makes the same computer.

## Reconnaissance

The files read and the patterns to reuse are the `refs` above, each with its note.

### Runtime path

```
form: source = folder         -> [new] devcontainer up --workspace-folder F --id-label ahpd.computer=1 --id-label ahpd.devcontainer.folder=F
picker: devcontainer://F row  -> session starts -> [new] the same create, then computer://<id>
computers list                -> the label -> listed like any computer
session in it                 -> [new] how() = devcontainer exec --workspace-folder F --id-label ... <command>
vscode/devContainers/connect  -> [new] find the computer for F or make it -> nested host -> relay (as today)
```

### Gaps

- A container made by `devcontainer up` has no `ahpd.computer=1` label, so it is not listed.
- `how()` knows only `docker exec`.
- The picker has no row for a folder's dev container.
- `connect` always runs `up` itself and keeps nothing after the socket.

## Decisions locked in

| Decision | Task |
| --- | --- |
| [A dev container is a computer, made from its devcontainer.json](../../../decisions/a-dev-container-is-a-computer-made-from-its-devcontainer-json.md) | 01, 02, 03, 04, 05 |
| [A dev container is made by the Dev Container CLI, not by Docker alone](../../../decisions/a-dev-container-is-made-by-the-dev-container-cli.md) | 01, 02 |
| [The host hands an agent's machine needs to the plugin that makes the machine](../../../decisions/the-host-hands-an-agents-machine-needs-to-the-machine-maker.md) | 04 |
| [The computer form offers a folder as a flat source choice](../../../decisions/the-computer-form-offers-a-folder-as-a-flat-source-choice.md) | 03 |
| [A dev container is made only from a folder the operator allows, and devcontainer false turns every route off](../../../decisions/a-dev-container-is-made-only-from-a-folder-the-operator-allows.md) | 08 |
| [A devcontainer source names any allowed folder](../../../decisions/a-devcontainer-source-names-any-allowed-folder.md) | 08 |
| [Read-only needs reach a dev container through an override config](../../../decisions/read-only-needs-reach-a-dev-container-through-an-override-config.md) | 09 |
| [The name a create gives a dev container is a label on it](../../../decisions/the-name-a-create-gives-a-dev-container-is-a-label-on-it.md) | 10 |
| [A dev container's cpus, memory and working directory reach it through the override config](../../../decisions/a-dev-containers-body-limits-reach-it-through-the-override.md) | 11 |
| [A machine made for a session counts against max and needs computer:write](../../../decisions/a-machine-made-for-a-session-counts-against-max-and-needs-computer-write.md) | 12 |
| [A container made by an older connect is adopted by its folder](../../../decisions/a-container-from-an-older-connect-is-adopted-by-its-folder.md) | 15 |

| What | Source | Task |
| --- | --- | --- |
| `--id-label` is passed with the same set on every `up` and `exec`, since it replaces the CLI's own `devcontainer.local_folder` lookup | the Dev Container CLI's `--id-label` | 01, 02 |
| The `devcontainer://F` row is offered only when F has a `devcontainer.json` and no computer exists for it | Softov, 2026-09-26: "devcontainer://<folder> entry" | 04 |
| The needs of the session's agent go in as `devcontainer up --mount` and `--remote-env`, and a read-only one through the override config | `plugin/15`'s delivery kinds, in the CLI's own flags; the CLI refuses `,readonly` in `--mount` | 04, 09 |
| The fake CLI refuses what the real one refuses | the review of 2026-09-26: every read-only need passed the fake and fails the real CLI | 07 |

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - A computer can be made from a folder's devcontainer.json](task-01-made-from-a-folder.md) | implemented | - |
| [02 - A session reaches it through devcontainer exec](task-02-reached-through-devcontainer-exec.md) | implemented | 01 |
| [03 - The computer form offers a folder as a flat source choice](task-03-the-form-offers-a-folder.md) | todo | 01 |
| [04 - The picker offers the session folder's dev container](task-04-the-picker-offers-the-folder.md) | implemented | 02 |
| [05 - VS Code's connect finds or makes the same computer](task-05-connect-uses-the-computer.md) | implemented | 02 |
| [06 - Docs and the domain text](task-06-docs.md) | todo | 03, 04, 05, 08 |
| [07 - The fake CLI behaves like the real one](task-07-the-fake-cli-behaves-like-the-real-one.md) | todo | - |
| [08 - Only allowed folders, and an off switch for every route](task-08-only-allowed-folders-and-an-off-switch-for-every-route.md) | todo | - |
| [09 - Read-only needs through an override config](task-09-read-only-needs-through-an-override-config.md) | todo | 07 |
| [10 - The name given is a label](task-10-the-name-given-is-a-label.md) | todo | 07 |
| [11 - The agents label and the body's limits](task-11-agents-label-and-body-limits.md) | todo | 09 |
| [12 - A dev container made at session start counts](task-12-a-session-time-dev-container-counts.md) | todo | plugin/16 task 09 |
| [13 - A stopped container is started first](task-13-a-stopped-container-is-started-first.md) | todo | 07 |
| [14 - The picker decodes the folder, and exec keeps the working directory](task-14-the-picker-decodes-and-exec-keeps-cwd.md) | todo | - |
| [15 - A container from an older connect is adopted](task-15-a-container-from-an-older-connect-is-adopted.md) | todo | 10 |
| [16 - Comments document](task-16-comments-document.md) | todo | - |

## Risks and tradeoffs

- A container someone made with `devcontainer up` by hand, without the label, stays unlisted; the docs say so.
- `devcontainer exec` is slower to start than `docker exec`; each backend start pays it once.

## Resume state

- **Done so far:** tasks 01, 02, 04 and 05 implemented on 2026-09-26 and reviewed the same day; task 03 is unblocked by the flat source choice, and task 06 is reopened.
- **Next action:** task 07, since every later test needs the fake to refuse what the real CLI refuses; then 09, 08 and 03.
- **Open questions:** none.
- **Watch out for:** removing a dev container computer removes the container, not the folder or its `devcontainer.json`; a container made by hand without the labels stays unlisted until task 15 adopts it by folder; the real CLI is installed at `/usr/local/bin/devcontainer` 0.89.0, so the end-to-end check can be run here.

## Final verification checklist

- [ ] A dev container made from ahpapp's form shows in the computer list and the picker, and survives an ahpapp reload.
- [ ] Picking `devcontainer://<folder>` makes it at session start, and the next session sees it as `computer://<id>`.
- [ ] A Claude session in it runs as the config's `remoteUser`.
- [ ] VS Code's "Use Dev Container" on the same folder reuses it.
- [ ] End to end against the real CLI: a Claude session through `devcontainer://F` starts, with its read-only needs mounted read-only.
- [ ] `devcontainer: false` refuses every route, and a folder outside the allowlist is refused on each.
- [ ] A container made by container/01's connect is reused, not duplicated.
- [ ] `pnpm test`, `pnpm typecheck`, `pnpm boundary` green; `docs/CONTAINERS.md`, `docs/COMPUTER.md`, `00-container.md`, `plans/index.md` updated.
