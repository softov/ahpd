---
title: A session on an ssh machine runs nested over ssh
status: todo
depends: [task-02-an-ssh-machine-is-listed-from-the-options.md]
layer: "computer | sdk"
refs:
  - "[code://packages/sdk/src/types/computers.ts#L110-L143](../../../../packages/sdk/src/types/computers.ts#L110-L143) - `how` and `nested` on the port"
  - "[code://packages/sdk/src/computers.ts#L103-L129](../../../../packages/sdk/src/computers.ts#L103-L129) - `computersFor`, which spreads the port"
  - "[code://packages/sdk/src/host/spawn.ts#L332-L334](../../../../packages/sdk/src/host/spawn.ts#L332-L334) - the nested route, chosen by `runsNested` alone"
  - "[code://.project/plans/container/04-a-cofold-session-in-a-computer/task-17-a-backend-names-its-nested-plugin.md](../04-a-cofold-session-in-a-computer/task-17-a-backend-names-its-nested-plugin.md) - removes the `@ahpd/agent-<provider>` default this task would otherwise lean on"
  - "[code://packages/sdk/src/nested.ts#L115-L129](../../../../packages/sdk/src/nested.ts#L115-L129) - `startInside`, which spawns what `nested` answers"
  - "[code://packages/computer/src/plugin.ts#L210-L224](../../../../packages/computer/src/plugin.ts#L210-L224) - `within`, which has nothing to read for an ssh machine"
---

## Objective

`how` and `nested` for an ssh machine answer an `ssh` descriptor whose remote command carries the directory and the variables, and the host runs every backend nested in a machine the port says is off this host.

## Files

- `UPDATE: packages/computer/src/ssh.ts` - `how(id, asked)` and `hostCommand(id)`.
- `UPDATE: packages/sdk/src/types/computers.ts:118-143` - `remote?(id: string): boolean`, whether a machine is on another host.
- `UPDATE: packages/computer/src/plugin.ts:648-662` - `remote` answers the routed runtime's `remote` for the id's prefix.
- `UPDATE: packages/sdk/src/host/spawn.ts:332-334` - nested when the backend says `runsNested` or the port says `remote(id)`.
- `UPDATE: packages/sdk/test/nested-start.test.ts`.

## Steps

1. `how` answers `{ command: 'ssh', args: [...flags, destination, '--', 'cd <q(dir)> && env <q(K=V)>... <q(cmd)> <q(arg)>...'] }`; `dir` is the machine's `workdir`, never `asked.cwd`, which is a path on this host; with no `workdir` the `cd` is left out and the login directory stands.
2. `nested` sends no `env`: the box's ahpd uses what it was configured with there.
3. `hostCommand` is the machine's `host`, default `['ahpd']`, so the plugin's `nestedHost` answers `ssh ... -- 'cd <workdir> && ahpd --stdio --plugin <each>'`.
4. For now non-secret variables are written inline, and a secret env need, one whose value is named from the vault, is refused for an ssh machine with a sentence naming the need and not its value. The refusal is one check in `how`, and it applies to the host's exec tools (a terminal, a command run in the machine): a session never reaches it, since a session on a remote machine runs nested and `nested` sends no env. What a nested session's credentials may carry is p12 task 03's.
5. `computersFor` keeps `remote` as it spreads the port; a backend without `runsNested` in a remote machine is wrapped by `nestedAgent` with the plugin package it comes from. This needs container/04 task 17, which removes the `@ahpd/agent-${name}` default; how the host knows that package waits on container/04's open question, and this step is built after it is answered.

## Validation

- `computer-ssh.test.ts`: `how` with `cwd: '/home/me/repo'` and `env` answers the `cd <workdir>` and quoted `env` string; `nested` answers `ahpd --stdio --plugin @ahpd/agent-cofold` with no env.
- `nested-start.test.ts`: a fake port with `remote` true makes a session of a backend without `runsNested` a nested one, loading the package that registered the backend.
- `computer-ssh.test.ts`: an exec tool asked with a vault-named env value on an ssh machine is refused naming the need, and the value is in no argv.

## Resume
