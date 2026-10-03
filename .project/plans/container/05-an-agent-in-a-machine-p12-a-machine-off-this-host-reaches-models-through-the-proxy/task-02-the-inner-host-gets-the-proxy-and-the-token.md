---
title: The inner host gets the proxy's URL and the token instead of a key
status: blocked
depends: [task-01-a-session-has-a-token.md]
layer: "sdk | computer"
refs:
  - "[code://packages/sdk/src/types/computers.ts#L38-L48](../../../../packages/sdk/src/types/computers.ts#L38-L48) - `NestedStart`"
  - "[code://packages/sdk/src/nested.ts#L115-L129](../../../../packages/sdk/src/nested.ts#L115-L129) - `startInside`"
  - "[code://packages/sdk/src/types/machine.ts#L60-L64](../../../../packages/sdk/src/types/machine.ts#L60-L64) - `EnvNeed`"
  - "[code://packages/server/src/proxy/providers.ts#L25-L39](../../../../packages/server/src/proxy/providers.ts#L25-L39) - a provider's key variable"
  - "[code://packages/sdk/src/nested.ts#L50](../../../../packages/sdk/src/nested.ts#L50) - `NestedAsked`, which carries no env"
  - "[code://packages/computer/src/plugin.ts#L679-L695](../../../../packages/computer/src/plugin.ts#L679-L695) - `nestedHost`, the port's `nested`"
  - "[code://.project/decisions/a-nested-host-is-configured-by-the-machine-profile-only.md](../../../decisions/a-nested-host-is-configured-by-the-machine-profile-only.md) - the decision a per-session env would contradict"
---

## Objective

A nested session in a remote machine starts its inner host with each of its agent's provider key variables set to the session token and each base URL variable set to the proxy, and with nothing else that came from this host's environment.
How the token and the URL reach the inner host waits on the plan's open question about the profile-only decision, and how the forwarded port is picked waits on the one about `-R`.
This task is `blocked` until the proxy listener plan exists.

## Files

- `UPDATE: packages/sdk/src/types/computers.ts:38-48` - `NestedStart.env`, and `ComputerPort.proxyUrl?(id): Promise<string | undefined>`, the URL a machine reaches this host's proxy at, answered by the port since only the runtime knows how its machine is reached.
- `UPDATE: packages/sdk/src/nested.ts:50` - `NestedAsked.env`.
- `UPDATE: packages/sdk/src/types/machine.ts:60-64` - `EnvNeed.proxy?: string` (a provider id) and `EnvNeed.role?: 'key' | 'url'`, documented.
- `UPDATE: packages/sdk/src/nested.ts:115-129` - `env` passed to `nested`.
- `UPDATE: packages/computer/src/plugin.ts:679-695` - `nestedHost` takes `env` and passes it by name, per p1 (`-e NAME` with the value in the spawned env, never in argv).
- `UPDATE: packages/computer/src/ssh.ts` - `nested` writes `env` into the remote command as `how` does; `proxyUrl(id)` opens the `-R` forward on the session's own ssh with `-o ExitOnForwardFailure=yes` and answers `http://127.0.0.1:<port>`; p8 and p11 do the same for theirs.
- `UPDATE: packages/agent-claude/src/claude.ts` - `ANTHROPIC_API_KEY` declared with `proxy: 'anthropic', role: 'key'` and `ANTHROPIC_BASE_URL` with `proxy: 'anthropic', role: 'url'`.

## Steps

1. The SDK cannot build an ssh `-R`, so the URL is the port's answer: `ComputerPort.proxyUrl(id)`. For an ssh machine and a VM reached by ssh, `ssh.ts` adds the `-R` forward with `-o ExitOnForwardFailure=yes`, so a forward that cannot bind fails the start rather than leaving the session without its proxy; how the remote port is picked waits on the plan's open question. For a joined node (p10) and a remote Docker (p8) it answers the URL this host is reached at, and a machine of those kinds with no such URL configured is refused with a sentence.
2. A variable is a key when its need says `role: 'key'`, or when its name is some provider's `key.env`; a `role: 'url'` variable gets the port's `proxyUrl(id)` answer for its `proxy` provider.

## Validation

- `nested-start.test.ts`: the `env` a remote nested start is handed holds the token and the URL and no provider key from `process.env`.
- `computer-ssh.test.ts`: the remote command carries them quoted, and `-R` is in the argv.
- `proxyUrl` answers the forwarded loopback URL for an ssh machine, with `ExitOnForwardFailure=yes` in the argv, and the configured URL for a node, and refuses a node with none.
- `computer-spawn.test.ts`: `nestedHost` with `env` passes each name as `-e NAME` and its value in the spawned env only.

## Resume
