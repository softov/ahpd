---
title: A dev container is a computer, listed and reachable without the connection that made it - implemented
date: 2026-10-05
refs:
  - git://ae250ef
  - "[code://packages/computer/src/devcontainer.ts](../../../../packages/computer/src/devcontainer.ts) - the relay, the probe, `execArgv`, masking and adoption"
  - "[code://packages/computer/src/runtime.ts](../../../../packages/computer/src/runtime.ts) - `up` with the override config, the listing, `exec`"
  - "[code://packages/computer/src/owners.ts](../../../../packages/computer/src/owners.ts) - the `computers.json` entry: owner, probe, adopted"
---

A dev container is a computer like any other: it is made from a folder's `devcontainer.json` by the Dev Container CLI, listed, inspected, metered and removed, and every command in it, the relay's included, is a `docker exec` built from the container's own metadata.

## What was built

- [`code://packages/computer/src/devcontainer.ts`](../../../../packages/computer/src/devcontainer.ts) - the reach derived from the container's metadata label and one kept probe; `execArgv` passes only the variables the container's `Config.Env` does not already hold; `masked` and `maskedLines` keep every `-e` value out of what is printed; a container an older connect made is adopted, started, and found again by its folder on every later connect.
- [`code://packages/computer/src/runtime.ts`](../../../../packages/computer/src/runtime.ts) - `up` with the id labels and an override config holding the folder's whole config plus needs as `containerEnv`, read-only mounts as `,readonly` strings, limits and labels as `runArgs`, and `workspaceMount` for a workdir; written 0600 in a fresh directory and removed on every path; the listing covers adopted containers from their record.
- [`code://packages/computer/src/owners.ts`](../../../../packages/computer/src/owners.ts) - the `computers.json` entry keyed by machine id, holding the owner, the probe and the adopted mark, forgotten with the machine.
- [`code://packages/computer/src/plugin.ts`](../../../../packages/computer/src/plugin.ts) - the `devcontainer` source in the form, the folder allowlist and the `devcontainer: false` switch on every route, the picker row, and adoption recorded and metered.
- `test/fixtures/devcontainer.mjs` and `test/fixtures/docker.mjs` - fakes that refuse what the real CLI and Docker refuse, give a container distinct id, name and label, and drop `readOnly` from an object mount.
- `docs/CONTAINERS.md`, `docs/COMPUTER.md`, `packages/computer/README.md`, `00-container.md`.

## Verified

- Task 17 against `@devcontainers/cli` 0.89.0 and Docker 29.6.2 on 2026-10-03: the derived `docker exec` gives the environment `devcontainer exec` gives for all three definitions; the override is 0600 and removed after `up`; an older connect's container is adopted; a stopped one is started.
- `pnpm exec tsc --noEmit`, `pnpm boundary`, `pnpm test` (211 files, 2904 tests) and `pnpm build` green on 2026-10-05, rebased onto 0.9.0 (`ae250ef`).
- Read in review: the allowlist and off switch run before the relay, so adoption is gated too; masking was run over the CLI's logged `docker run` in each quoting form.

## Departures from the plan

- Task 12 is cut to the grant test, since plugin/16 already counts a session-time machine against `max` and asks `computer:write`.
- The build was replayed onto main by hand, 81 commits after its base; the listing keeps main's `ps` plus one `inspect` for labels and adds adopted containers.

## Left for later

- A vault-named need is written in clear to the override file while `up` runs and so reaches the container's `Config.Env`; `container/05-p1` task 02 passes it per `docker exec` instead.
- `masked` leaves the rest of a value written with a backslash-escaped space (`-e K=a\ b`); the CLI does not log that form.
- An adopted container gets nothing from the override config: its needs, labels and limits are what it was made with.
- The by-hand lines in the plan's checklist need the full daemon and real Docker.
- The tasks stay `implemented` until Softov reviews them.
