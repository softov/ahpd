---
title: The fake Dev Container CLI and the fake Docker refuse what the real ones refuse
status: done
depends: [task-18-every-command-reaches-it-by-docker-exec.md]
layer: "tests"
refs:
  - "[code://packages/computer/test/fixtures/devcontainer.mjs#L45-L90](../../../../packages/computer/test/fixtures/devcontainer.mjs#L45-L90) - the fake `up`, which always adds a machine and accepts any `--mount`"
  - "[code://packages/computer/test/fixtures/docker.mjs#L255-L259](../../../../packages/computer/test/fixtures/docker.mjs#L255-L259) - the fake `exec`, which answers whatever the machine's state"
  - "[code://packages/computer/src/runtime.ts#L494-L500](../../../../packages/computer/src/runtime.ts#L494-L500) - `cliMount`, which writes `,readonly`"
---

## Objective

The fakes refuse what the real CLI and Docker refuse and find what they find, so the tests of this plan can fail.
The real CLI checks `--mount` against `type=<bind|volume>,source=<source>,target=<target>[,external=<true|false>]` and answers "Unmatched argument format" otherwise (checked against 0.89.0 on 2026-09-26); its `up` with `--id-label` reuses a container carrying those labels; and `docker exec` on a stopped container fails.

## Files

- `UPDATE: packages/computer/test/fixtures/devcontainer.mjs:45-90` - `up` refuses a `--mount` outside the pattern with the CLI's sentence, and answers the existing machine when one carries the same id labels, starting it when it is stopped.
- `UPDATE: packages/computer/test/fixtures/docker.mjs:255-259` - `exec` on a machine that is not running exits 1 with `Error response from daemon: container <id> is not running`.
- `UPDATE: packages/computer/test/computer-devcontainer.test.ts` - a Claude need with `readOnly: true`, and a second `up` with the same labels.

## Steps

1. Copy the mount pattern from the installed CLI rather than writing one.
2. Copy the exact `docker exec` refusal from a real Docker on a stopped container.

## Validation

- A Claude or cofold need (`readOnly: true`) through `devcontainer://` now fails in the test, as it does against the real CLI; task 09 makes it pass.
- A second `up` with the same labels answers the first container, and the fake Docker holds one machine.
- A `docker exec` on a stopped machine in the fake fails with the real sentence; task 13 relies on it.
- `node_modules/.bin/vitest run packages/computer/test` passes, with the read-only case written as `it.fails` until task 09 turns it into `it`.

## Resume

Implemented on 2026-10-03, on top of the fixtures task 18 already changed.

Files changed:

- `packages/computer/test/fixtures/devcontainer.mjs` - `up` refuses a `--mount` outside the CLI's own pattern with `Error: Unmatched argument format: <mount>`, and it refuses an `--override-config` naming no recipe with the CLI's own sentence, `Dev container config (<folder>/.devcontainer/devcontainer.json) is missing one of "image", "dockerFile" or "dockerComposeFile" properties.` - the second is task 17's finding that the flag replaces the folder's file rather than merging with it. `up` answers the container its `--id-label` pair already names rather than making a second, and starts it when it is stopped. It records each override config it was handed as `{ where, mode, config }`, applies the override's `runArgs` labels, `workspaceFolder` and `containerEnv` to the machine it records, and puts the override's `mounts` beside the workspace mount.
- `packages/computer/test/fixtures/docker.mjs` - `exec` refuses a container that is not running with `Error response from daemon: container <id> is not running` and exit 1, which is the whole of what a stopped dev container is reached through. The probe answers with the container's own `Config.Env` under what the login shell was holding, because every process in a container inherits the environment it was created with.
- `packages/computer/test/computer-devcontainer.test.ts` - the three cases below.

What the tests cover: a Claude need with `readOnly: true` through `devcontainer://` is refused by the fake exactly as the real CLI refuses it (it was `it.fails` until task 09 turned it into `it`); a second `up` with the same labels answers the first container and the fake Docker holds one machine; and a `computer_exec` on a stopped machine comes back with the daemon's sentence and `exit 1`, with nothing asked of the CLI.

One more refusal came out of task 10 and belongs here rather than there, because it is the fixture that was wrong rather than the code: `ps` honoured only the **first** `--filter` and listed everything else. Docker intersects them, so a lookup that names two labels was answered with every machine this host holds, and `containerOf`'s `label=ahpd.computer=1 --filter label=ahpd.name=<id>` would have resolved any id to the first machine in the list. It honours every `label=` filter now, and projects the same `ahpd.computer` onto a non-bare machine that `inspect` already did, so `ps` and `inspect` answer about the same container.

Choices the task did not settle, and the by-hand checks it did not run:

- The `--mount` pattern is the one the plan records at its top, `type=<bind|volume>,source=<source>,target=<target>[,external=<true|false>]`, checked against 0.89.0 on 2026-09-26, written out in `devcontainer.mjs` as that regex. Task 17's run on 2026-10-03 did not re-record it, so it is carried from the plan rather than re-copied. The `docker exec` sentence is the daemon's own, of the same shape Docker uses for a container it cannot exec into.
- **By hand, not run.** On a Docker host, with `@devcontainers/cli@0.89.0` and a container made by `devcontainer up`, run `devcontainer up --workspace-folder F --id-label ahpd.computer=1 --id-label "ahpd.devcontainer.folder=$F" --mount 'type=bind,source=/a,target=/b,readonly'`, which must answer `Error: Unmatched argument format`, and `devcontainer up --workspace-folder F --override-config <a file holding only {"containerEnv":{"A":"1"}}>`, which must answer the missing-recipe sentence above. Then `docker stop <id>` followed by `docker exec <id> true`, which must answer `Error response from daemon: container <id> is not running`.

### The fix turn of 2026-10-05

- `packages/computer/test/fixtures/docker.mjs` - `ps` no longer skips a `bare` machine whenever a filter is given. Docker matches the labels, and the label match already keeps a machine with none of ours out of `label=ahpd.computer=1`; the skip also hid a container made by a plain `devcontainer up` from `label=devcontainer.local_folder=F`, which is the lookup task 15 adopts it by. `start` refuses with the sentence in `failStart` when a test sets one, for task 15's refused `docker start`. The `exec` comment no longer cites a task.
- `packages/computer/test/fixtures/devcontainer.mjs` - `up` writes `upLog` to stderr one piece at a time with a pause between, so the relay's reader sees a line cut across two reads, which is what task 18's masking test needs. Its object-or-string rendering of an override's `mounts` is what the real CLI does (task 09).
