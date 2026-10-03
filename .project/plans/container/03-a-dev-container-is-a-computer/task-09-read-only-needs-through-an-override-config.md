---
title: Read-only needs reach a dev container through an override config
status: todo
depends: [task-07-the-fake-cli-behaves-like-the-real-one.md]
layer: "computer"
refs:
  - "[code://packages/computer/src/runtime.ts#L656-L674](../../../../packages/computer/src/runtime.ts#L656-L674) - the `up` argv with `--mount` and `--remote-env`"
  - "[code://packages/computer/src/runtime.ts#L494-L500](../../../../packages/computer/src/runtime.ts#L494-L500) - `cliMount`, which writes `,readonly`"
---

## Objective

A need with `readOnly: true` reaches a dev container as a read-only mount, written in an override config's `mounts`, so `devcontainer up` accepts it; and a need's environment reaches every later command, not only `up`, as `containerEnv` in the same override config.

## Files

- `UPDATE: packages/computer/src/runtime.ts:656-674` - the devcontainer branch writes an override config (a temporary file, mode 0600, removed after `up` whether it succeeds or not) holding the read-only mounts and the need's environment as `containerEnv`, passes `--override-config` on `up`, and uses `--mount` only for what the pattern allows; `--remote-env` at `:674` goes.
- `UPDATE: packages/computer/src/runtime.ts` - one function, `overrideOf(spec)`, builds the override config's object; task 11 and `container/05-p1` task 02 add to it, so what goes through the override is chosen in one place.
- `UPDATE: packages/computer/src/runtime.ts:494-500` - `cliMount` never writes `,readonly`; a read-only mount is the override config's.
- `UPDATE: packages/computer/test/computer-devcontainer.test.ts` - the read-only case from task 07 becomes `it`, and an environment case.

## Steps

1. The override must keep the folder's own config working: read how the CLI merges `--override-config` with the definition (Dockerfile paths are relative to the definition), and write only the keys this adds.
2. The override config is read at `up` only; commands afterwards are `docker exec` and need nothing from it, and `containerEnv` is the container's own environment, so every `docker exec` sees it.
3. The file holds environment values on disk while `up` runs: write it 0600 in a fresh temporary directory, and never log its contents; a need whose value is named from the vault is `container/05-p1` task 02's, which keeps it out of the file in clear.
4. Task 10 and task 11 add `runArgs` labels and limits, and `workspaceFolder`, to the same file through `overrideOf`.

## Validation

- `packages/computer/test/computer-devcontainer.test.ts`: a Claude session through `devcontainer://F` makes the container with the needs read-only (the fake now checks the pattern); fails today at `up`.
- The same file: a need's variable is set in a `computer_exec` run after the create; today it reaches `up` only.
- The same file: the fake CLI records the override file's mode as 0600 and the `up` argv has no `--remote-env`; the file is gone after `up`, including after a failed `up`.
- By hand: the same against the real CLI with task 17's `dockerfile/` folder.

## Resume
