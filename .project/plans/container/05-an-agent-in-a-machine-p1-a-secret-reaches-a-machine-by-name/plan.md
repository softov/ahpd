---
title: A secret reaches a machine by name, never in a command line
domain: container
status: planned
priority: high
created: 2026-09-26
revalidated: 2026-09-26
requires:
  - plans/container/05-an-agent-in-a-machine/plan.md
changes: []
creates: []
decisions: []
refs:
  - "[code://packages/computer/src/plugin.ts#L394-L408](../../../../packages/computer/src/plugin.ts#L394-L408) - `docker exec -e KEY=VALUE`, the value in argv"
  - "[code://packages/computer/src/plugin.ts#L367](../../../../packages/computer/src/plugin.ts#L367) - `devcontainer exec --remote-env KEY=VALUE`"
  - "[code://packages/computer/src/runtime.ts#L635](../../../../packages/computer/src/runtime.ts#L635) - `docker run -e KEY=VALUE` at create"
  - "[code://packages/computer/src/runtime.ts#L585](../../../../packages/computer/src/runtime.ts#L585) - `devcontainer up --remote-env KEY=VALUE` at create"
  - "[code://packages/computer/src/runtime.ts#L299-L301](../../../../packages/computer/src/runtime.ts#L299-L301) - the runner already spawns with an env of its own"
  - "[code://packages/sdk/src/types/computers.ts#L20-L26](../../../../packages/sdk/src/types/computers.ts#L20-L26) - `Spawn.env`, which the port may already answer"
  - https://docs.docker.com/reference/cli/docker/container/exec/ - `-e NAME` with no value takes it from the client's environment
  - "[code://packages/computer/test/fixtures/docker.mjs](../../../../packages/computer/test/fixtures/docker.mjs) - the fake Docker a test reads argv from"
---

## Goal

An environment value given to a machine, at create or per command, is in the environment of the `docker` or `devcontainer` process and never in its argv, so `ps` on the host does not show it.

## Reconnaissance

### Runtime path

```
agent env / env need -> port.how() -> { command: docker, args: [exec, -e, KEY=VALUE, ...] }  (today)
                                   -> { command: docker, args: [exec, -e, KEY, ...], env: { KEY: VALUE } }  (after)
```

### Gaps

- Four places write `KEY=VALUE` into argv.
- Whether `devcontainer exec --remote-env` accepts a name with no value is not known.

## Decisions locked in

| What | Source | Task |
| --- | --- | --- |
| Every value leaves argv, not only the ones that look secret | the proposal Softov asked to plan, 2026-09-26: a host cannot tell a key from a setting | 01, 02 |

## Proposed architecture

- **Data flow** - the flags carry names, and the answered `Spawn.env` (for `how()`) or the runner's spawn env (for create) carries the values.
- **Layer responsibilities** - `@ahpd/computer` only.

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - Docker takes every value by name](task-01-docker-takes-every-value-by-name.md) | todo | - |
| [02 - The Dev Container CLI takes every value by name](task-02-the-dev-container-cli-takes-every-value-by-name.md) | todo | - |
| [03 - Docs](task-03-docs.md) | todo | 01, 02 |

## Risks and tradeoffs

- A name in the machine that the host's own environment also has would be overwritten by the host's - the answered env is built from the asked values alone on top of the host's, so the asked value wins.

## Resume state

- **Done so far:** nothing.
- **Next action:** [task-01-docker-takes-every-value-by-name.md](task-01-docker-takes-every-value-by-name.md).
- **Open questions:**
  1. If the Dev Container CLI needs `NAME=VALUE`, how does a value reach it? - proposed: stop and ask, with what the CLI accepts.
- **Watch out for:** the fake Docker must refuse `-e NAME` when `NAME` is not in its environment, or the test proves nothing.

## Final verification checklist

- [ ] No argv the fake Docker or the fake CLI records holds a value that was asked as env.
- [ ] A real `docker exec` session with `CODEX_API_KEY` set shows only the name in `ps -ww`.
- [ ] `pnpm test`, `pnpm typecheck` green.
- [ ] `plans/index.md` updated.
