---
title: A machine off this host reaches its models through this host's proxy
domain: container
status: planned
priority: high
created: 2026-10-02
revalidated: 2026-10-03
requires:
  - plans/container/05-an-agent-in-a-machine-p9-an-ssh-machine-runs-a-nested-host/plan.md
  - plans/proxy/01-the-proxy-knows-its-providers-and-models/plan.md
changes: []
creates: []
decisions:
  - decisions/a-nested-host-is-used-only-where-a-command-cannot-reach-the-agent.md
  - decisions/a-secret-is-named-in-a-host-team-or-user-scope.md
  - decisions/the-local-vault-is-a-plain-file-until-it-is-encrypted.md
refs:
  - "[code://packages/server/src/proxy/providers.ts#L25-L99](../../../../packages/server/src/proxy/providers.ts#L25-L99) - `ProxyProvider`: an endpoint, its dialects, and its key named by an environment variable; the built-in three"
  - "[code://packages/server/src/commands/proxy.ts](../../../../packages/server/src/commands/proxy.ts) - `ahpd proxy list`, which reads the table and never a key"
  - "[code://packages/sdk/src/types/computers.ts#L38-L48](../../../../packages/sdk/src/types/computers.ts#L38-L48) - `NestedStart`, which carries no environment today"
  - "[code://packages/sdk/src/types/machine.ts#L60-L64](../../../../packages/sdk/src/types/machine.ts#L60-L64) - `EnvNeed`, the variable an agent says its machine needs"
  - "[code://packages/sdk/src/nested.ts#L115-L129](../../../../packages/sdk/src/nested.ts#L115-L129) - `startInside`, where the inner host's environment is set"
  - "[code://packages/sdk/src/host.ts#L8683-L8692](../../../../packages/sdk/src/host.ts#L8683-L8692) - the session's checks, then `placedIn`, where a machine is made or picked"
  - "[code://.project/plans/container/05-an-agent-in-a-machine/deferred.md](../05-an-agent-in-a-machine/deferred.md) - the host proxy this plan takes from the parent's deferred list"
---

## Goal

A model credential never leaves this host.
A session in a machine off this host reaches its model through this host's proxy, with a token made for that session and dropped with it, so the box holds nothing worth stealing once the session ends.
A machine off this host is refused while placing it would send a key with it.

This plan does not build the proxy's listener: proxy 02, which another session plans, does that, and this plan requires it.

## Reconnaissance

The files read and the patterns to reuse are the `refs` above, each with its note.

### Searches performed

- `rg "listen|serve" packages/server/src/proxy` - no listener; proxy 01 is the provider table and `ahpd proxy list` only.
- `rg "env" packages/sdk/src/types/computers.ts` - `SpawnOptions.env` reaches a `how` command; `NestedStart` has no environment.
- `rg "key" packages/server/src/proxy/providers.ts` - a key is `{ env: '<NAME>' }`, read from this daemon's environment.

### Runtime path

```
session placed on a machine off this host -> [new] token minted for the session
  -> nested start env: <provider key variable>=<token>, <base URL variable>=<proxy URL>
  -> agent in the box calls the proxy URL with the token
  -> proxy 02 listener -> [new] token -> session, owner, scope -> provider with the real key
session disposed -> token dropped
```

### Gaps

- Nothing mints a credential for one session.
- Nothing stops a provider key from reaching a machine on another box through an `EnvNeed`, a profile's `needs` or the plugin's `needs` option.
- Proxy 02 (the listener) does not exist yet, and nothing here can be tested end to end until it does.

## Decisions locked in

| Decision | Task |
| --- | --- |
| [A nested host is used only for a backend that runs nested and for a machine on another host](../../../decisions/a-nested-host-is-used-only-where-a-command-cannot-reach-the-agent.md) | 02 |
| [A secret is named in the host's, a team's or a person's scope](../../../decisions/a-secret-is-named-in-a-host-team-or-user-scope.md) | 03 |
| [Secrets live in a vault port, and the host's own vault is a plain file until it is encrypted](../../../decisions/the-local-vault-is-a-plain-file-until-it-is-encrypted.md) | 03 |

| What | Source | Task |
| --- | --- | --- |
| A model credential is never sent to another box; a machine off this host reaches its model through this host's proxy with a per-session token | the parent's [deferred.md](../05-an-agent-in-a-machine/deferred.md), "A host proxy for model credentials", which waits for p8 to p10 | 01, 02 |
| This plan goes before p8, p10, p11 and any p9 use beyond the by-hand test | (defaulted: a key would otherwise leave this host in each of them) | all |
| The listener is proxy 02's and is not planned here | proxy 01's Resume state, "Next action: the proxy listener plan" | - |
| A machine off this host is refused while a key would travel with it | (defaulted: the refusal is what keeps the first row true before every agent declares its variables) | 03 |
| For now an ssh machine and a VM reached by ssh get a reverse forward (`-R`) on the session's own ssh connection, so nothing listens on a public address; a joined node and a remote Docker use the URL this host is reached at; one function, `proxyUrlFor(machine)`, answers it | Softov, 2026-10-03, asked "how does a machine off this host reach the proxy's listener?": "as proposed" | 02 |
| For now an `EnvNeed` gains `proxy: '<provider id>'` and `role: 'key' \| 'url'`, so Claude declares `ANTHROPIC_API_KEY` as the key and `ANTHROPIC_BASE_URL` as the URL of `anthropic`, and an ACP preset says the same for its own variables | Softov, 2026-10-03, asked "which variable carries the base URL for each agent?": "as proposed" | 02 |
| For now the token is kept in memory beside the session, not as a principal in the users directory; a daemon restart mints a new one when the session resumes | Softov, 2026-10-03, asked "is the token a principal in the users directory, or a table in memory?": "as proposed" | 01 |

## Proposed architecture

- **Reach** - `proxyUrlFor(machine)`: `http://127.0.0.1:<forwarded port>` through `-R` on the session's ssh for an ssh machine or a VM reached by ssh; the URL this host is reached at for a joined node or a remote Docker.
- **Data flow** - the host mints a token when a session is placed on a machine whose port says `remote(id)`, keeps it beside the session with its owner and scope, hands it in the nested start's `env`, and drops it when the session is disposed.
- **Verification** - proxy 02's listener asks the host whose a token is; a session token resolves to the session, its owner and its scope, so usage and policy charge the right person.
- **Layer responsibilities** - `@ahpd/sdk`: the token table, `NestedStart.env`, the refusal · `@ahpd/computer`: passing `env` through `nested` for each remote runtime · `@ahpd/server`: the proxy URL a remote machine is given, and the hook proxy 02 calls.
- **Source-of-truth files** - `CREATE: packages/sdk/src/session-tokens.ts`.

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - A session placed off this host has a token of its own](task-01-a-session-has-a-token.md) | todo | - |
| [02 - The inner host gets the proxy and the token instead of a key](task-02-the-inner-host-gets-the-proxy-and-the-token.md) | todo | 01 |
| [03 - A machine off this host is refused while a key would travel](task-03-a-key-never-travels.md) | todo | - |
| [04 - Docs](task-04-docs.md) | todo | 02, 03 |

## Risks and tradeoffs

- The token sits in the box's process list and environment for the session's life - it opens only that session's model calls, through this host, and is dropped with the session.
- A box that keeps a copy can call models until the session ends - proxy 02's limits and policy/01's rows apply to the token's owner as to any other call.
- An agent that calls its provider without honouring a base URL variable cannot use the proxy - task 03 refuses such a session off this host rather than sending the key.

## Resume state

- **Done so far:** nothing; drafted 2026-10-02, planned 2026-10-03.
- **Next action:** [task-03-a-key-never-travels.md](task-03-a-key-never-travels.md), which needs nothing else; [task-01-a-session-has-a-token.md](task-01-a-session-has-a-token.md) once proxy 02's plan names its verification hook.
- **Open questions:** none.
- **Watch out for:** do not plan or build the listener here; nothing under `plans/proxy/` is this plan's to change; p9's by-hand test gives dev86 its own key by hand, which is the operator's choice and not a key this host sent.

## Final verification checklist

- [ ] A session on an ssh machine answers a turn with no provider key anywhere on the box, and its usage is charged to the session's owner.
- [ ] Disposing the session makes the token refused by the proxy.
- [ ] A machine off this host whose agent would get a key is refused with a sentence naming the variable.
- [ ] `pnpm test`, `pnpm typecheck` green.
- [ ] `docs/COMPUTER.md`, `plans/index.md` updated.
