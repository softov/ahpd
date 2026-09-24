---
title: The pages, and the client that drives it
status: done
depends:
  - task-02-the-host-serves-the-surface.md
  - task-05-the-relay-carries-the-frames.md
layer: docs, /github/ahpapp, .project
refs:
  - "[code://docs/COMPUTER.md](../../../../docs/COMPUTER.md) - the machine page this one must not be confused with"
  - "[code://docs/PLUGINS.md](../../../../docs/PLUGINS.md) - where a `register*` is documented"
  - "[code://packages/sdk/README.md](../../../../packages/sdk/README.md) - the package's own page"
  - "[code://.project/working/HANDOFF.md](../../../working/HANDOFF.md) - the pending list"
  - "[code://.project/plans/index.md](../../index.md) - the plan index"
---

## Objective

The container feature is written down where a person meets it: a page that says what a dev container session is, how a host says it can do one, and what the client has to be; and a plan in `ahpapp` for the client half.

## Files

- `CREATE: docs/CONTAINERS.md` - the operator's page: what a dev container session is, the CLI dependency, the capability key, the four methods and four notifications, the `container:write` grant, and the by-hand case.
- `UPDATE: docs/PLUGINS.md` - `registerContainers` beside the other registrations, and the key it makes the host advertise.
- `UPDATE: docs/DAEMON.md` - `--stdio` and what it is for, which task 01 wrote and this task checks against the code.
- `UPDATE: README.md`, `packages/sdk/README.md` - one line each that points at the page.
- `UPDATE: .project/plans/index.md` - the `container` domain and this plan.
- `UPDATE: .project/working/HANDOFF.md` - the pending list, with this plan and what it does not cover.
- `CREATE: /github/ahpapp/.project/plans/.../plan.md` - the client half: a transport over `relaySend` and `relayMessage`, the nested connection in the host list, and the workspace folder it reports.

## Steps

1. Write the page around the one question a reader has, which is why the container is not a `computer://` machine. Answer it first, then the mechanism.
2. Name the dependency plainly: `@devcontainers/cli` and Docker, both on the host, and the key absent when either is missing.
3. Record the by-hand case exactly as it was run, with the versions, the workspace, and what the session's shell showed. A checklist that was not run is not written as one that was.
4. Write the client plan in `ahpapp` so a fresh session can build it: the transport interface to implement, the two methods it calls, the notifications it reads, and where the nested host appears in the host list.
5. Update the index and the handoff last, so they describe what the pages describe.

## Validation

- Every link in `docs/CONTAINERS.md` resolves, and every method and notification named there exists in the code with the same spelling.
- The by-hand case is either run and recorded with its versions, or written as not yet run in the handoff rather than in the page's present tense.
- `pnpm test`, `pnpm typecheck` and `pnpm boundary` green.
- In `ahpapp`: `npx tsc --noEmit` and the web export green, with the plan only and no code.

## Resume

Done, 2026-09-24. The pages are `docs/CONTAINERS.md`, `docs/DAEMON.md`, `docs/PLUGINS.md` and the README; the client half is `/github/ahpapp/.project/working/dev-containers.md`, a scope document in that repository's own convention rather than a plan, because it has no `plans/`.
The page is the last thing written and the first thing read: it says what is true when the tasks above are done, and nothing about them before that.
