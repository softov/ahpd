---
title: A container made by an older connect is adopted by its folder
status: implemented
depends: [task-10-the-name-given-is-a-label.md]
layer: "computer"
refs:
  - "[code://packages/computer/src/devcontainer.ts#L369-L388](../../../../packages/computer/src/devcontainer.ts#L369-L388) - `connect`, which passes `--id-label` on every `up`"
---

## Objective

A container made by container/01's `connect`, labelled only with the CLI's `devcontainer.local_folder`, is found for its folder and adopted instead of a second one being made.


## Files

- `UPDATE: packages/computer/src/devcontainer.ts`, `packages/computer/src/runtime.ts` - when no container carries ahpd's labels for a folder, look for `devcontainer.local_folder=<folder>`, and adopt it; an adopted container is probed once like any other (task 18).
- `UPDATE: packages/computer/test/fixtures/devcontainer.mjs`, `packages/computer/test/devcontainer.test.ts` - the case below.

## Steps

1. Read what the real CLI does when `--id-label` is passed and a container with only `devcontainer.local_folder` exists, and choose adoption (record the id against the folder, or recreate through `up`) from that; write the choice in Resume.

## Validation

- A fake container labelled only `devcontainer.local_folder=/w`: `connect` for `/w` reaches it and makes no second one; today a second is made.

## Resume

Implemented on 2026-10-03.

Files changed:

- `packages/computer/src/runtime.ts` - `LOCAL_FOLDER`, the label the CLI leaves, and `adoptedDevContainer`, which answers the container a folder already has by it: one `docker ps -a --filter label=devcontainer.local_folder=<folder>`, then one `docker inspect` for the mount that says where in it the folder lands.
- `packages/computer/src/devcontainer.ts` - the `adopted` option, asked in `connect` only where `existing` answered nothing. An adopted container is started with `docker start` and taken as it stands; `up` is not asked. `workdirOf` takes the folder rather than only reading it off the `ahpd.devcontainer.folder` label, because a container this adopts does not carry that label and the mount names the same host path either way.
- `packages/computer/src/plugin.ts` - hands `adopted` in from the runtime, as it hands `existing` in. This file is not in the task's list; it is where every other `devContainer` option is given, and leaving it out would have made the feature unreachable from the only caller.
- `packages/computer/test/devcontainer.test.ts` - the case below.

What the tests cover: a container labelled only `devcontainer.local_folder=<folder>`, stopped, is adopted by a `connect` for that folder. The CLI is asked nothing (`read().calls` is empty), there is still one machine, it is running, and every command went into it by its id. It is probed like any other, so the commands after the probe carry the probed environment rather than this process's.

Notes and open questions:

- Step 1 was answered against the real CLI on 2026-10-03, with `@devcontainers/cli` 0.89.0 and Docker 29.6.2: with a container made by a plain `devcontainer up` for the folder, `devcontainer up --workspace-folder F --id-label ahpd.computer=1 --id-label ahpd.devcontainer.folder=F` made a **second** container, which carries the two id labels and no `devcontainer.local_folder` (with `--id-label` given, the CLI writes only the id labels). So the CLI does not find the older container, and adoption here is necessary rather than belt and braces. The commands:

  ```
  mkdir -p /tmp/ahpd-adopt/w && cd /tmp/ahpd-adopt/w
  printf '{ "image": "debian:bookworm-slim" }' > .devcontainer.json
  devcontainer up --workspace-folder /tmp/ahpd-adopt/w
  docker inspect --format '{{json .Config.Labels}}' \
    "$(docker ps -aq --filter label=devcontainer.local_folder=/tmp/ahpd-adopt/w)"
  devcontainer up --workspace-folder /tmp/ahpd-adopt/w \
    --id-label ahpd.computer=1 --id-label ahpd.devcontainer.folder=/tmp/ahpd-adopt/w
  docker ps -a --filter label=devcontainer.local_folder=/tmp/ahpd-adopt/w \
    --format '{{.ID}} {{.Names}}'
  ```

  The same run drove this task's branch against the real pair: a stopped container labelled only `devcontainer.local_folder` was adopted by `docker start` with no `up`, left one container, and the host inside saw the probed `PATH` and the label's `remoteEnv`.
- The choice step 1 leaves open - record the id against the folder, or recreate through `up` - is settled by the plan's own Decisions table, which records Softov on 2026-09-26 answering "Adopt by folder". Recreating is `up` with different labels, which is the second container the task is about. So the id is recorded and the container is taken as it stands.
- An adopted container is a computer by its record. Docker cannot add `ahpd.computer` to a container that exists, so the connect that adopts it writes `{ adopted: true }` under its container id in `computers.json`, with the owner when the connect carried one, which is the file decision `a-dev-container-owner-is-kept-beside-the-config` already keeps. `list` reads the record and asks Docker about the ids it names, `inspect` accepts an id the record names, the relay meters it from the connect, and removing it forgets the record. Every later connect, and the first one after a restart, finds it by its folder: the listing answers it, and since no `up` brought it up the launcher adopts it again (a `docker start`, which is nothing to a running container) rather than running `up`, which would make the second container step 1 found.
- Because it is started here rather than by the CLI, an adopted container does not get the override config - no read-only need, no `containerEnv`, no limits - and none of task 09 or 11 reaches it. That is the same trade as its labels: the container was made before this host knew about the folder, and re-making it to apply settings would be the second container the task exists to avoid.
- The fake CLI finds a container by its `--id-label` pair alone, as the real CLI does (step 1).

### The fix turn of 2026-10-05

The real-CLI run found that the adoption branch never remembered the folder's remote workspace, and that an adopted container was recorded only when the connect carried an owner. So a second connect, or any connect after a restart, found the adopted container listed from its record, knew no remote for it, and ran `up` with the id labels, and the real CLI then made a second container.

Files changed:

- `packages/computer/src/devcontainer.ts` - the adoption branch does `remotes.set`, and `adopted` is asked again when `existing` answers a computer whose remote this launcher has not learned; when it answers that same container, it is adopted again rather than brought up.
- `packages/computer/src/owners.ts` - an entry that holds only `adopted: true` is kept, and `claimAdopted` takes an optional owner, keeping the first one recorded.
- `packages/computer/src/plugin.ts` - `onAdopted` records every adoption, with or without an owner.
- `packages/computer/test/fixtures/docker.mjs` - `ps` no longer skips a `bare` machine whenever a filter is given: the label match already keeps it out of `label=ahpd.computer=1`, and skipping it hid it from `label=devcontainer.local_folder=F` as well. `start` refuses with `failStart` when a test sets it.
- Tests: `computer-devcontainer.test.ts` "finds an adopted container again by its folder, on a second connect and after a restart" (an ownerless connect, a second connect and a connect on a freshly loaded plugin, no `up` and one container); `computer-uptime.test.ts` "records an adopted container, lists, inspects and meters it, and forgets it once removed"; `devcontainer.test.ts` "refuses an adopted container that will not start, with Docker's own sentence". The first two failed before the fix: the ownerless record was missing, and the second connect ran `up`. The `docker start` case covers a refusal that was already in the code.
