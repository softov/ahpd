---
title: A session on an ssh machine runs nested over ssh
status: todo
depends: [task-02-an-ssh-machine-is-listed-from-the-options.md]
layer: "computer | sdk"
refs:
  - "[code://packages/sdk/src/types/computers.ts#L110-L143](../../../../packages/sdk/src/types/computers.ts#L110-L143) - `how` and `nested` on the port"
  - "[code://packages/sdk/src/computers.ts#L103-L129](../../../../packages/sdk/src/computers.ts#L103-L129) - `computersFor`, which spreads the port"
  - "[code://packages/sdk/src/host.ts#L3617-L3619](../../../../packages/sdk/src/host.ts#L3617-L3619) - the nested route, chosen by `runsNested` alone"
  - "[code://packages/sdk/src/nested.ts#L115-L129](../../../../packages/sdk/src/nested.ts#L115-L129) - `startInside`, which spawns what `nested` answers"
  - "[code://packages/computer/src/plugin.ts#L210-L224](../../../../packages/computer/src/plugin.ts#L210-L224) - `within`, which has nothing to read for an ssh machine"
---

## Objective

`how` and `nested` for an ssh machine answer an `ssh` descriptor whose remote command carries the directory and the variables, and the host runs every backend nested in a machine the port says is off this host.

## Files

- `UPDATE: packages/computer/src/ssh.ts` - `how(id, asked)` and `hostCommand(id)`.
- `UPDATE: packages/sdk/src/types/computers.ts:118-143` - `remote?(id: string): boolean`, whether a machine is on another host.
- `UPDATE: packages/computer/src/plugin.ts:648-662` - `remote` answers the routed runtime's `remote` for the id's prefix.
- `UPDATE: packages/sdk/src/host.ts:3617-3619` - nested when the backend says `runsNested` or the port says `remote(id)`.
- `UPDATE: packages/sdk/test/nested-start.test.ts`.

## Steps

1. `how` answers `{ command: 'ssh', args: [...flags, destination, '--', 'cd <q(dir)> && env <q(K=V)>... <q(cmd)> <q(arg)>...'] }`; `dir` is the machine's `workdir`, never `asked.cwd`, which is a path on this host; with no `workdir` the `cd` is left out and the login directory stands.
2. `nested` sends no `env`: the box's ahpd uses what it was configured with there.
3. `hostCommand` is the machine's `host`, default `['ahpd']`, so the plugin's `nestedHost` answers `ssh ... -- 'cd <workdir> && ahpd --stdio --plugin <each>'`.
4. For now non-secret variables are written inline, and a secret env need, one whose value is named from the vault, is refused for an ssh machine with a sentence naming the need and not its value; p12's per-session token is the one credential that travels. The refusal is one check in `how`, so the rule can change.
5. `computersFor` keeps `remote` as it spreads the port; a backend without `runsNested` in a remote machine is wrapped by `nestedAgent` with its default plugin.

## Validation

- `computer-ssh.test.ts`: `how` with `cwd: '/home/me/repo'` and `env` answers the `cd <workdir>` and quoted `env` string; `nested` answers `ahpd --stdio --plugin @ahpd/agent-cofold` with no env.
- `nested-start.test.ts`: a fake port with `remote` true makes a session of a backend without `runsNested` a nested one.

## Resume
