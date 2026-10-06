---
title: Read-only needs reach a dev container through an override config
status: done
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

Implemented on 2026-10-03. Step 1 is answered by task 17's Resume rather than by an installed CLI: `--override-config` **replaces** the folder's `devcontainer.json` rather than merging with it, so the override this writes is that file's whole contents with the added keys laid over it. An override holding only `containerEnv` is refused by name, which is what task 07's fake now answers and what the case below would otherwise have passed here and failed there.

Files changed:

- `packages/computer/src/runtime.ts` - `overrideOf(spec, config)` builds the object, one place tasks 10 and 11 add to; `configOf(folder)` reads the folder's definition; `jsoncOf` takes the comments and trailing commas out of it before `JSON.parse`; `cliMount` no longer writes `,readonly` and `readOnlyMount` is what decides which mount goes where; `--remote-env` is gone and a need's environment is `containerEnv`. The override is written into a `mkdtempSync` directory at mode 0600 and that directory is removed after `up` returns, on the failure path as well as the good one, before the result is parsed.
- `packages/computer/src/devcontainer.ts` - `definitionOf(folder)` returns where the file is, by the CLI's two names, beside `hasDefinition`.
- `packages/computer/test/fixtures/devcontainer.mjs` - records the override as `{ where, mode, config }`, applies its `mounts` and `containerEnv` to the machine it records, and honours its `workspaceFolder`.
- `packages/computer/test/computer-devcontainer.test.ts` - the three cases below.

What the tests cover: a Claude session through `devcontainer://F` with a read-only config need is made, `up` carries no `--mount` at all for it and the override's `mounts` holds the string `type=bind,source=<configDir>,target=/ahpd/config,readonly` beside the folder's own `image`, which the fake machine records as the mount `<configDir>:/ahpd/config:ro`; a need's variable is in the override's `containerEnv` and is on the `-e` flags of a `computer_exec` run after the create, and no `--remote-env` is on `up`; and the file is recorded at mode 0600 and is gone afterwards, including after a failed `up`.

Choices the task did not settle:

- The definition is read through `jsoncOf`, a comment and trailing-comma stripper, because the file is the one the Dev Container CLI documents as JSONC and a plain parse would refuse a folder whose definition works. The CLI resolves relative paths against the **workspace's** config path rather than the override's (task 17's Resume), so copying the file's contents whole keeps a `"build": { "dockerfile": "Dockerfile" }` resolving from the workspace's `.devcontainer/`.
- The override is written on every dev container make, never conditionally. `overrideOf` always adds the name label (task 10), so there is no case today with nothing to add, and one code path is one thing to keep honest when `container/05-p1` task 02 adds to it.
- The mount in the override is the CLI's string spelling, `type=bind,source=<source>,target=<target>,readonly`, appended to whatever `mounts` the folder's own file declared. The object form `{ source, target, type: "bind", readOnly: true }` was written first and is wrong: the real CLI renders an object mount as `--mount type=...,src=...,dst=...` and silently drops `readOnly`, so the container was made with the need writable. A string entry is passed to `docker run` as written, and the real CLI then makes the mount read-only (`RW: false`, a write fails with `Read-only file system`), checked on 2026-10-03 with `@devcontainers/cli` 0.89.0 and Docker 29.6.2. The fake CLI renders the two forms the same way the real one does.

**By hand, run on 2026-10-03** with the real CLI and task 17's `dockerfile/` folder, whose definition is `{"build":{"dockerfile":"Dockerfile"},"remoteUser":"dev"}`: the override was the folder's whole config plus the added keys, written 0600 and gone after `up`; the need's `containerEnv` variable reached a later `docker exec`; and the read-only need was writable while it was an object and read-only once it was the string below. The commands, for a rerun:

```sh
cat > "$T/ov.json" <<JSON
{ "build": { "dockerfile": "Dockerfile" }, "remoteUser": "dev",
  "mounts": [ "type=bind,source=/tmp,target=/ro,readonly" ],
  "containerEnv": { "Y": "2" } }
JSON
devcontainer up --workspace-folder "$F" \
  --id-label ahpd.computer=1 \
  --id-label "ahpd.devcontainer.folder=$F" --override-config "$T/ov.json"
devcontainer exec --workspace-folder "$F" \
  --id-label ahpd.computer=1 --id-label "ahpd.devcontainer.folder=$F" env | grep Y=
docker exec <containerId> touch /ro/probe   # must fail
```

The `Y=2` line, and `touch` failing, are what confirm the two added keys are honoured when the override is the folder's whole config rather than only what was added.

### The fix turn of 2026-10-05

No code in this task changed in this turn; the string mount was already in `overrideOf`. The test "mounts a read-only need, once it is in the config the CLI is handed" in `packages/computer/test/computer-devcontainer.test.ts` still asserted the object and failed; it now asserts the string in the override and `<configDir>:/ahpd/config:ro` on the fake machine. "gives a command run after the create a need's variable" now asserts the variable is in the machine's own environment and in no command's flags, and that it is not in `computers.json` (task 18's turn). The comment on the override no longer says a vault value is kept out of it: it is written there, 0600 and only while `up` runs, until `container/05-p1` task 02 changes that.
