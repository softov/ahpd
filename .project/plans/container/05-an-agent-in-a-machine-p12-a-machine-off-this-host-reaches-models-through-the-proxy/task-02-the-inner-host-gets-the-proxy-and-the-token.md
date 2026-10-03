---
title: The inner host gets the proxy's URL and the token instead of a key
status: todo
depends: [task-01-a-session-has-a-token.md]
layer: "sdk | computer"
refs:
  - "[code://packages/sdk/src/types/computers.ts#L38-L48](../../../../packages/sdk/src/types/computers.ts#L38-L48) - `NestedStart`"
  - "[code://packages/sdk/src/nested.ts#L115-L129](../../../../packages/sdk/src/nested.ts#L115-L129) - `startInside`"
  - "[code://packages/sdk/src/types/machine.ts#L60-L64](../../../../packages/sdk/src/types/machine.ts#L60-L64) - `EnvNeed`"
  - "[code://packages/server/src/proxy/providers.ts#L25-L39](../../../../packages/server/src/proxy/providers.ts#L25-L39) - a provider's key variable"
---

## Objective

A nested session in a remote machine starts its inner host with each of its agent's provider key variables set to the session token and each base URL variable set to the proxy, and with nothing else that came from this host's environment.

## Files

- `UPDATE: packages/sdk/src/types/computers.ts:38-48` - `NestedStart.env`.
- `UPDATE: packages/sdk/src/types/machine.ts:60-64` - `EnvNeed.proxy?: string` (a provider id) and `EnvNeed.role?: 'key' | 'url'`, documented.
- `UPDATE: packages/sdk/src/nested.ts:115-129` - `env` passed to `nested`.
- `UPDATE: packages/computer/src/ssh.ts` - `nested` writes `env` into the remote command as `how` does; p8 and p11 do the same for theirs.
- `UPDATE: packages/agent-claude/src/claude.ts` - `ANTHROPIC_API_KEY` declared with `proxy: 'anthropic', role: 'key'` and `ANTHROPIC_BASE_URL` with `proxy: 'anthropic', role: 'url'`.
- `UPDATE: packages/sdk/src/nested.ts` - `proxyUrlFor(machine, forwarded?)`, the one function that answers the proxy URL a remote machine is given.

## Steps

1. For an ssh machine and a VM reached by ssh, `proxyUrlFor` adds a `-R` forward on the session's own ssh and answers `http://127.0.0.1:<forwarded port>`; for a joined node (p10) and a remote Docker (p8) it answers the URL this host is reached at, and a machine of those kinds with no such URL configured is refused with a sentence. p8 and p10 call it rather than building their own.
2. A variable is a key when its need says `role: 'key'`, or when its name is some provider's `key.env`; a `role: 'url'` variable gets `proxyUrlFor`'s answer for its `proxy` provider.

## Validation

- `nested-start.test.ts`: the `env` a remote nested start is handed holds the token and the URL and no provider key from `process.env`.
- `computer-ssh.test.ts`: the remote command carries them quoted, and `-R` is in the argv.
- `proxyUrlFor` answers the forwarded loopback URL for an ssh machine and the configured URL for a node, and refuses a node with none.

## Resume
