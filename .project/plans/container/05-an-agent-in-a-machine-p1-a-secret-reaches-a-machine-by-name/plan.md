---
title: A secret reaches a machine in its environment, never in its argv
domain: container
status: built
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
A value named from the vault is never given at create on any runtime: it is passed by name on each `docker exec`, so `docker inspect` never holds it in `Config.Env`.
When such a value cannot be read again after a restart, the machine's profile says whether every exec into the machine fails or only that variable is dropped.
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
| `revealed` answers `{ values, named }`, and the set of vault-named needs reaches the runtime through `MachineSpec.named` and `ResolvedNeed.named` | (defaulted: nothing else carries which values came from the vault once `revealed` has read them) | 01 |
| On a reach after a restart, a vault-named value is read again for the machine's owner and team from `claimOf` | (defaulted: the owner and team the machine was made for are the scope its secret was read in) | 01 |
| Vault-named values are kept off `docker run` for every runtime and passed by name on each `docker exec`, as for a dev container, so nothing lands in `docker inspect`'s `Config.Env` | Softov, 2026-10-04, asked "a vault-named value given to a plain Docker machine at create goes as `docker run -e NAME`, so `docker inspect` keeps it in `Config.Env`: keep vault-named values off `docker run` for every runtime and pass them on each `docker exec`, or accept `docker inspect` for plain Docker?": keep them off `docker run` for every runtime and pass them on each `docker exec`, as task 02 does for a dev container | 01, 02 |
| When a vault-named value cannot be read again after a restart, the behaviour is a setting: by default every exec into that machine fails with a line naming the need, and the other setting drops only that variable from the exec and logs the line | Softov, 2026-10-04, asked "a vault-named value read again when a machine is reached after a restart cannot be read; does every exec into that machine fail with a line naming the need, or is only that variable dropped from the exec and the line logged?": configurable, failing every exec by default, and dropping only that variable with a logged line as the other setting | 01, 03 |
| Every `DOCKER_*` name, with `PATH` and `HOME`, is the `docker` program's own: it goes `-e NAME=VALUE` and never into docker's environment, so no need can change which daemon or configuration docker uses | Softov, 2026-10-05, asked "a need named `DOCKER_CONTEXT`, `DOCKER_CONFIG` and so on lands in the docker program's own environment and changes which daemon or config docker uses: does every `DOCKER_*` name count as docker's own, or is a `DOCKER_*` need refused?": every `DOCKER_*` is docker's | 01 |
| A dev container's `remoteEnv` and probe values reach `docker exec` by name too, through `byName`, so a host value a definition pulls in with `${localEnv:NAME}` is not in `ps` | Softov, 2026-10-05, asked "a dev container's `remoteEnv` and probe values still go `-e NAME=VALUE`, so a host secret pulled in with `${localEnv:NAME}` is visible in `ps`: send those by name too?": by name too | 02 |
| The needs a machine was made with (names and `$secret` references, never values) are recorded in its `computers.json` entry, and a re-read after a restart uses those rather than the agent's registered needs | Softov, 2026-10-05, asked "after a restart, a session-time machine's vault values are re-read with the agent's registered needs, not the needs the session asked with: record the session's needs with the machine?": record them | 01 |
| The setting is the profile's `secretUnreadable: "fail" \| "drop"`, `"fail"` when absent, and a machine made without a profile always fails | (defaulted: a profile is the machine's recipe, and its other per-machine choices, `disposable`, `sessionFolder` and `host`, are flat fields of `Profile` in [code://packages/computer/src/manifest.ts#L34-L100](../../../../packages/computer/src/manifest.ts#L34-L100) read by `profilesOf` in [code://packages/computer/src/plugin.ts#L142-L178](../../../../packages/computer/src/plugin.ts#L142-L178)) | 01, 03 |
| The fake Docker fails on an absent `-e NAME`, stricter than Docker, which drops it silently | (defaulted: a dropped `Spawn.env` must fail a test rather than leave a variable missing) | 01 |
| A `$secret` is resolved by the vault before it reaches this plan; this plan only delivers | [Secrets live in a vault port, and the host's own vault is a plain file until it is encrypted](../../../decisions/the-local-vault-is-a-plain-file-until-it-is-encrypted.md) | - |
| For now the names the `docker` program itself reads (`PATH`, `HOME`, `DOCKER_HOST`) stay `NAME=VALUE` in argv, and every other name goes by name; the list is one constant beside `byName`, so it can grow or change | Softov, 2026-10-03, asked "how does a variable docker itself reads reach the machine?": "those stay NAME=VALUE, every other name by name" | 01 |
| For now a dev container's plain values reach it as `containerEnv` in the override config `container/03` task 09 writes 0600 | `container/03`, Softov, 2026-10-03: "`containerEnv` in the override config" | 02 |
| For now a vault-named value reaches a dev container on each `docker exec` as `-e NAME`, never through `up`, since the real CLI puts `containerEnv` values in its own `docker run` argv, its log and `docker inspect` | Softov, 2026-10-03, asked how a secret reaches a dev container: "Per docker exec, by name" | 02 |

## Proposed architecture

- **Data flow** - the flags carry names; the answered `Spawn.env` (for `how()`) or the runner's spawn env (for create) carries the values.
- **State flow** - a vault-named value is held with its machine in the plugin's memory, never in `computers.json` or the container's env; the machine's `computers.json` entry records the need, variable and secret name, and the value is read again from that for the machine's owner and team on the first reach after a restart.
- **Layer responsibilities** - `@ahpd/computer` only.

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - Docker takes every value by name, and a vault-named value only on each exec](task-01-docker-takes-every-value-by-name.md) | implemented | - |
| [02 - A vault-named value reaches a dev container on each docker exec, by name](task-02-the-dev-container-cli-takes-every-value-by-name.md) | implemented | 01, container/03 tasks 09 and 18, rebased onto vault/01 p2 |
| [03 - Docs](task-03-docs.md) | implemented | 01, 02, 04 |
| [04 - A need value answers set](task-04-a-need-value-answers-set.md) | implemented | - |

## Risks and tradeoffs

- A name in the machine that the host's own environment also has would be overwritten by the host's - the answered env is the asked values laid over the runtime's own, so the asked value wins.
- Claude's `CLAUDE_*` and `ANTHROPIC_*` filter sends the daemon's own key into every machine - it moves out of argv here; whether it should cross at all is p5's.

## Resume state

- **Done so far:** tasks 04, 01, 02 and 03 implemented on 2026-10-05, on main after container/03 (`52f98f6`). Every asked value reaches `docker run` and `docker exec` as `-e NAME` with the value in the spawned `docker` process's environment, except `PATH`, `HOME` and every `DOCKER_*` name, which stay `-e NAME=VALUE` and never enter docker's spawn env; a dev container's `remoteEnv` and probe values go by name too, as `execArgv` answers `{ argv, env }` to every caller; a vault-named value is left out of `docker run`, the override config and so `Config.Env` on both recipes, held in the plugin's memory per machine, and passed by name on every `docker exec` - `how`, the nested host, `computer_exec` and the relay's `connect`; the needs it was made with are recorded by need, variable and secret name in the machine's `computers.json` entry, and after a restart they are read again for `claimOf(id)` from that record, or, for a machine with none recorded, from the machine's `ahpd.agents` and its `ahpd.profile`; `secretUnreadable` decides a failed read. [implemented.md](implemented.md) sums it up. Each task's Resume lists its files, tests and differences from its steps.
- **Next action:** Softov's review.
- **Ran on 2026-10-05:** against Docker 29.6.2 with the built runtime: `Config.Env` held the plain variable and not the vault-named one, an `exec` given the vault-named one by name printed it, and `ps -ww` during `docker exec -e ANTHROPIC_API_KEY` showed only the name.
- **Watch out for:**
  - The fake Docker refuses `-e NAME` when `NAME` is not in its environment, where real Docker drops it silently; a test that spawns a descriptor must spawn it with its `env`.
  - `PATH`, `HOME` and every `DOCKER_*` name stay in argv as `NAME=VALUE`; a secret under one of those names shows in `ps`, which the docs say.
  - A missing `computers.json` now reads as empty without a log line, since every first reach after a restart reads it for recorded needs.
  - A held value lives for the daemon's life under the machine id the create answered; a command that names the machine by another of its ids reads the vault again for it, which answers the same values.
- **Open questions:** none; the three raised in the build are answered in the table above (Softov, 2026-10-05).

## Final verification checklist

- [x] No argv the fake Docker records holds a value that was asked as env, except `PATH`, `HOME` and `DOCKER_*` names, and no argv the fake CLI records holds a vault-named value.
- [x] No override config the fake CLI reads holds a vault-named value in clear.
- [x] No `docker run` the fake Docker records, by name or by value, carries a vault-named need, and a real `docker inspect` of a machine given one shows no such variable in `Config.Env`.
- [x] After a restart with a secret gone, `secretUnreadable: "fail"` fails every exec naming the need, and `"drop"` runs the exec without it and logs the line.
- [x] A real `docker exec` session with `ANTHROPIC_API_KEY` set shows only the name in `ps -ww`.
- [x] `ahpd config` answers `<set>` for a value under the computer plugin's `needs` and under a profile's `needs`.
- [x] `pnpm test`, `pnpm typecheck` green.
- [x] `plans/index.md` updated.
