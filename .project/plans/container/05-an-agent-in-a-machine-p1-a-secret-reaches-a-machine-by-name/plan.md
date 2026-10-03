---
title: A secret reaches a machine in its environment, never in its argv
domain: container
status: planned
priority: high
created: 2026-09-26
revalidated: 2026-10-03
requires:
  - plans/container/05-an-agent-in-a-machine/plan.md
  - plans/container/03-a-dev-container-is-a-computer/plan.md
changes: []
creates: []
decisions:
  - decisions/a-dev-container-is-reached-by-docker-exec.md
  - decisions/the-local-vault-is-a-plain-file-until-it-is-encrypted.md
refs:
  - "[code://packages/computer/src/plugin.ts#L606](../../../../packages/computer/src/plugin.ts#L606) - `docker exec -e KEY=VALUE`, inside `reach`, the value in argv"
  - "[code://packages/computer/src/plugin.ts#L579](../../../../packages/computer/src/plugin.ts#L579) - `devcontainer exec --remote-env KEY=VALUE`, which goes away with container/03's switch to `docker exec`"
  - "[code://packages/computer/src/runtime.ts#L731](../../../../packages/computer/src/runtime.ts#L731) - `docker run -e KEY=VALUE` at create"
  - "[code://packages/computer/src/runtime.ts#L674](../../../../packages/computer/src/runtime.ts#L674) - `devcontainer up --remote-env KEY=VALUE` at create"
  - "[code://packages/computer/src/runtime.ts#L570-L577](../../../../packages/computer/src/runtime.ts#L570-L577) - `must`, which runs docker with the runtime's own options"
  - "[code://packages/computer/src/runtime.ts#L325-L340](../../../../packages/computer/src/runtime.ts#L325-L340) - `ran`, which already spawns with `process.env` and an env of its own merged"
  - "[code://packages/sdk/src/types/computers.ts#L19-L28](../../../../packages/sdk/src/types/computers.ts#L19-L28) - `Spawn.env`, the docker program's own environment, which can carry the values"
  - "[code://packages/agent-claude/src/spawn.ts#L142-L164](../../../../packages/agent-claude/src/spawn.ts#L142-L164) - Claude spawns the descriptor with its `env` over `process.env`"
  - "[code://packages/agent-acp/src/session.ts#L658-L667](../../../../packages/agent-acp/src/session.ts#L658-L667) - the ACP bridge spawns the descriptor with its `env`"
  - "[code://packages/sdk/src/nested.ts#L115-L129](../../../../packages/sdk/src/nested.ts#L115-L129) - the nested host spawns the descriptor with its `env` over `process.env`"
  - "[code://packages/agent-claude/src/session.ts#L2203-L2209](../../../../packages/agent-claude/src/session.ts#L2203-L2209) - every `CLAUDE_*` and `ANTHROPIC_*` variable crosses into the machine, so `ANTHROPIC_API_KEY` is in argv today"
  - "[code://packages/computer/src/plugin.ts#L76](../../../../packages/computer/src/plugin.ts#L76) - the `env` option, whose values are `writeOnly`"
  - "[code://packages/computer/src/plugin.ts#L61](../../../../packages/computer/src/plugin.ts#L61) - `needValue`, `secretAtUse` and not yet `writeOnly`, used by `needs` and every profile's `needs`"
  - "[code://packages/computer/src/secrets.ts#L53-L78](../../../../packages/computer/src/secrets.ts#L53-L78) - `revealed`, which reads a `$secret` need at create and answers plain strings"
  - "[code://packages/server/src/commands/config.ts#L55-L58](../../../../packages/server/src/commands/config.ts#L55-L58) - the mask answers a `$secret` reference as written and `<set>` wherever a nested property is `writeOnly`"
  - https://docs.docker.com/reference/cli/docker/container/exec/ - `-e NAME` with no value takes it from the client's environment
  - "[code://packages/computer/test/fixtures/docker.mjs](../../../../packages/computer/test/fixtures/docker.mjs) - the fake Docker a test reads argv from"
---

## Goal

A value named from the vault never shows in an argv on the host: it travels in the environment of the `docker` process, so `ps` does not show it.
Docker's own `run` and `exec` take every value by name the same way, so on a Docker machine no asked value is in `ps` either.
A plain value given to a dev container goes through the Dev Container CLI's `containerEnv`, which the CLI writes into its own `docker run -e NAME=value`, its log and `docker inspect`; this plan does not change that.
A value given as a machine need in the computer plugin's options is a credential to root config, and answers `<set>`.
This plan is transport, not storage: the vault plan ([vault/01](../../vault/01-secrets-live-in-a-vault/plan.md)) resolves a `{ "$secret": "<scope:name>" }` value, claude/12's `{ "fromEnv": "NAME" }` stays the cheaper route, and whatever either resolved is delivered here.

## Reconnaissance

The files read and the patterns to reuse are the `refs` above, each with its note.

### Searches performed

- `rg "'-e'|--remote-env" packages/computer/src` - four writers put `KEY=VALUE` into argv: `plugin.ts:579` (`devcontainer exec`), `plugin.ts:606` (`docker exec`), `runtime.ts:674` (`devcontainer up`), `runtime.ts:731` (`docker run`).
- `rg "\.how\(" packages/*/src` - Claude, the ACP bridge and the nested host each spawn the descriptor with its `env` over `process.env`, so an answered `env` reaches the docker process with no caller changed.
- `rg "writeOnly" packages/computer/src/plugin.ts` - `env` and `devcontainer.env` are `writeOnly`; `needs` and a profile's `needs` are not.

### Runtime path

```
agent env / env need -> port.how() -> { command: docker, args: [exec, -e, KEY=VALUE, ...] }                 (today)
                                   -> { command: docker, args: [exec, -e, KEY, ...], env: { KEY: VALUE } }  (after)
manifest env -> runtime.run() -> must([run, -e, KEY=VALUE, ...])                                            (today)
                              -> must([run, -e, KEY, ...], { KEY: VALUE })                                  (after)
```

### Gaps

- Two Docker writers and one Dev Container CLI writer put values into argv, and this plan moves them.
- The `devcontainer exec` writer at `plugin.ts:579` goes away when container/03 task 18 switches every dev container command to `docker exec` (decision `a-dev-container-is-reached-by-docker-exec`); it then uses the `docker exec` writer this plan fixes, so this plan does not change it.
- `container/03` task 09 moves a dev container's environment from `up --remote-env` to `containerEnv` in an override config on disk, so a value is in a file while `up` runs; whether the CLI resolves `${localEnv:NAME}` there from its own environment, and what argv its own `docker run` then gets, is not known.
- A secret written as a value under the computer plugin's `needs`, or a profile's `needs`, is plain text in every root config answer.

## Decisions locked in

| Decision | Task |
| --- | --- |
| [A dev container is made by the Dev Container CLI and reached by docker exec](../../../decisions/a-dev-container-is-reached-by-docker-exec.md) | 01, 02 |

| What | Source | Task |
| --- | --- | --- |
| Every value leaves argv, not only the ones that look secret | the proposal Softov asked to plan, 2026-09-26: a host cannot tell a key from a setting | 01, 02 |
| A need value in the computer plugin's options answers `<set>`, as its `env` does | [code://packages/computer/src/plugin.ts#L76](../../../../packages/computer/src/plugin.ts#L76): the `env` option beside it is `writeOnly` because "a variable is a credential wherever the image keeps one", and a need value is the same variable | 04 |
| A need value keeps `secretAtUse: true` and gains `writeOnly: true`: a `$secret` answers as written and a plain value `<set>` | [code://packages/computer/src/plugin.ts#L61](../../../../packages/computer/src/plugin.ts#L61) and the mask at [code://packages/server/src/commands/config.ts#L55-L58](../../../../packages/server/src/commands/config.ts#L55-L58) | 04 |
| `revealed` answers `{ values, named }`, and the set of vault-named needs reaches the runtime through `MachineSpec.named` and `ResolvedNeed.named` | (defaulted: nothing else carries which values came from the vault once `revealed` has read them) | 02 |
| On a reach after a restart, a vault-named value is read again for the machine's owner and team from `claimOf` | (defaulted: the owner and team the machine was made for are the scope its secret was read in) | 02 |
| The fake Docker fails on an absent `-e NAME`, stricter than Docker, which drops it silently | (defaulted: a dropped `Spawn.env` must fail a test rather than leave a variable missing) | 01 |
| A `$secret` is resolved by the vault before it reaches this plan; this plan only delivers | [Secrets live in a vault port, and the host's own vault is a plain file until it is encrypted](../../../decisions/the-local-vault-is-a-plain-file-until-it-is-encrypted.md) | - |
| For now the names the `docker` program itself reads (`PATH`, `HOME`, `DOCKER_HOST`) stay `NAME=VALUE` in argv, and every other name goes by name; the list is one constant beside `byName`, so it can grow or change | Softov, 2026-10-03, asked "how does a variable docker itself reads reach the machine?": "those stay NAME=VALUE, every other name by name" | 01 |
| For now a dev container's plain values reach it as `containerEnv` in the override config `container/03` task 09 writes 0600 | `container/03`, Softov, 2026-10-03: "`containerEnv` in the override config" | 02 |
| For now a vault-named value reaches a dev container on each `docker exec` as `-e NAME`, never through `up`, since the real CLI puts `containerEnv` values in its own `docker run` argv, its log and `docker inspect` | Softov, 2026-10-03, asked how a secret reaches a dev container: "Per docker exec, by name" | 02 |

## Proposed architecture

- **Data flow** - the flags carry names; the answered `Spawn.env` (for `how()`) or the runner's spawn env (for create) carries the values.
- **Layer responsibilities** - `@ahpd/computer` only.

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - Docker takes every value by name](task-01-docker-takes-every-value-by-name.md) | todo | - |
| [02 - A vault-named value reaches a dev container on each docker exec, by name](task-02-the-dev-container-cli-takes-every-value-by-name.md) | todo | 01, container/03 tasks 09 and 18, rebased onto vault/01 p2 |
| [03 - Docs](task-03-docs.md) | todo | 01, 02, 04 |
| [04 - A need value answers set](task-04-a-need-value-answers-set.md) | todo | - |

## Risks and tradeoffs

- A name in the machine that the host's own environment also has would be overwritten by the host's - the answered env is the asked values laid over the runtime's own, so the asked value wins.
- Claude's `CLAUDE_*` and `ANTHROPIC_*` filter sends the daemon's own key into every machine - it moves out of argv here; whether it should cross at all is p5's.

## Resume state

- **Done so far:** nothing.
- **Next action:** [task-01-docker-takes-every-value-by-name.md](task-01-docker-takes-every-value-by-name.md).
- **Open question (ask before task 02):** a vault-named value read again when a machine is reached after a restart cannot be read (the secret is gone, or the owner lost the scope); what fails - (a) every exec into that machine fails with a line naming the need, or (b) only that variable is dropped from the exec and the line is logged?
- **Open question (ask before task 01):** a vault-named value given to a plain Docker machine at create goes as `docker run -e NAME`, so it stays out of `ps` but `docker inspect` keeps it in `Config.Env` - (a) keep vault-named values off `docker run` for every runtime and pass them on each `docker exec`, as task 02 does for a dev container, or (b) accept `docker inspect` for plain Docker?
- **Watch out for:**
  - The fake Docker must refuse `-e NAME` when `NAME` is not in its environment, or the test proves nothing.
  - The check that `ps` shows no value in a dev container session waits for container/03's switch to `docker exec`.
  - The override config `container/03` task 09 writes holds environment values on disk (0600, removed after `up`); a value named from the vault goes in as a `${localEnv:NAME}` reference with the value in the CLI's spawned environment, never in clear.
  - `PATH`, `HOME` and `DOCKER_HOST` stay in argv as `NAME=VALUE`; a secret under one of those names would show in `ps`, which the docs say.

## Final verification checklist

- [ ] No argv the fake Docker records holds a value that was asked as env, except `PATH`, `HOME` and `DOCKER_HOST`, and no argv the fake CLI records holds a vault-named value.
- [ ] No override config the fake CLI reads holds a vault-named value in clear.
- [ ] A real `docker exec` session with `ANTHROPIC_API_KEY` set shows only the name in `ps -ww`.
- [ ] `ahpd config` answers `<set>` for a value under the computer plugin's `needs` and under a profile's `needs`.
- [ ] `pnpm test`, `pnpm typecheck` green.
- [ ] `plans/index.md` updated.
