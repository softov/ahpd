---
title: A dev container is a computer, listed and reachable without the connection that made it
domain: container
status: planned
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

| What | Source | Task |
| --- | --- | --- |
| `--id-label` is passed with the same set on every `up` and `exec`, since it replaces the CLI's own `devcontainer.local_folder` lookup | the Dev Container CLI's `--id-label` | 01, 02 |
| The `devcontainer://F` row is offered only when F has a `devcontainer.json` and no computer exists for it | Softov, 2026-09-26: "devcontainer://<folder> entry" | 04 |
| The needs of the session's agent go in as `devcontainer up --mount` and `--remote-env` | `plugin/15`'s delivery kinds, in the CLI's own flags | 04 |

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - A computer can be made from a folder's devcontainer.json](task-01-made-from-a-folder.md) | todo | - |
| [02 - A session reaches it through devcontainer exec](task-02-reached-through-devcontainer-exec.md) | todo | 01 |
| [03 - The computer form offers a folder as the source](task-03-the-form-offers-a-folder.md) | todo | 01 |
| [04 - The picker offers the session folder's dev container](task-04-the-picker-offers-the-folder.md) | todo | 02 |
| [05 - VS Code's connect finds or makes the same computer](task-05-connect-uses-the-computer.md) | todo | 02 |
| [06 - Docs and the domain text](task-06-docs.md) | todo | 03, 04, 05 |

## Risks and tradeoffs

- A container someone made with `devcontainer up` by hand, without the label, stays unlisted; the docs say so.
- `devcontainer exec` is slower to start than `docker exec`; each backend start pays it once.

## Resume state

- **Done so far:** the decisions, 2026-09-26.
- **Next action:** [task-01-made-from-a-folder.md](task-01-made-from-a-folder.md).
- **Open questions:** none.
- **Watch out for:** removing a dev container computer removes the container, not the folder or its `devcontainer.json`.

## Final verification checklist

- [ ] A dev container made from ahpapp's form shows in the computer list and the picker, and survives an ahpapp reload.
- [ ] Picking `devcontainer://<folder>` makes it at session start, and the next session sees it as `computer://<id>`.
- [ ] A Claude session in it runs as the config's `remoteUser`.
- [ ] VS Code's "Use Dev Container" on the same folder reuses it.
- [ ] `pnpm test`, `pnpm typecheck`, `pnpm boundary` green; `docs/CONTAINERS.md`, `docs/COMPUTER.md`, `00-container.md`, `plans/index.md` updated.
