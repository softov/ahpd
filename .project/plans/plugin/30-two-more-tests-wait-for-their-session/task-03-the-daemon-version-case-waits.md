---
title: The dev container case for the daemon's version waits for the scripted docker
status: done
depends: []
layer: "tests"
refs:
  - "[code://packages/computer/test/computer-devcontainer.test.ts](../../../../packages/computer/test/computer-devcontainer.test.ts) - `installs the server in a container at the daemon's version, from the plugin's context`, the one case without `answered`"
---

## Objective

The case waits on `answered` for its docker state file before `afterEach` removes the folder, as the file's other cases do.

## Validation

- The file alone 24 times, and full `pnpm test` 3 times.

## Resume

Implemented 2026-09-29, test-only, in `packages/computer/test/computer-devcontainer.test.ts`.
The case loads the plugin, whose unawaited startup listing runs the scripted `docker ps`, and it now ends with `answered(join(root, 'docker.json'), 2)`, as its siblings do. The count comes from a probe that read the state file at the case's end and again 1.5 s later: 2 calls both times, both `ps -a --filter label=ahpd.computer=1`, with no lock held, in 6 of 6 runs of the case alone; the probe is removed.
Rates: the file alone, 0 failures in 24 runs before and 0 in 24 after; the helper's own message never fired.
Gates: `pnpm typecheck` 0, `pnpm boundary` 0, full `pnpm test` 3 times, exit 0 each (121 files, 1753 tests).
