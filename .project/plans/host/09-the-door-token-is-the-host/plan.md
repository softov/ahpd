---
title: The door token is the host, and a person's own token is that person
domain: host
status: built
priority: high
created: 2026-09-23
revalidated: 2026-09-23
requires:
  - plans/host/07-identity-and-the-record/plan.md
changes: []
creates: []
decisions:
  - decisions/the-door-token-is-the-host.md
refs:
  - "[code://packages/sdk/src/listen.ts#L73-L115](../../../../packages/sdk/src/listen.ts#L73-L115) - `identityOf`, which admits the deployment's token and names nobody"
  - "[code://packages/sdk/src/types/listen.ts#L38-L80](../../../../packages/sdk/src/types/listen.ts#L38-L80) - `ListenOptions`, which gains what the door token means"
  - "[code://packages/sdk/src/types/host.ts#L403-L441](../../../../packages/sdk/src/types/host.ts#L403-L441) - `Connection`, where a root socket is recorded"
  - "[code://packages/sdk/src/host.ts#L4474-L4485](../../../../packages/sdk/src/host.ts#L4474-L4485) - `accept`, which builds the connection the door resolved"
  - "[code://packages/sdk/src/host.ts#L6343-L6350](../../../../packages/sdk/src/host.ts#L6343-L6350) - the dispatch gate"
  - "[code://packages/sdk/src/host.ts#L7537-L7555](../../../../packages/sdk/src/host.ts#L7537-L7555) - the command gate"
  - "[code://packages/server/src/main.ts#L575-L605](../../../../packages/server/src/main.ts#L575-L605) - where the directory is handed to the listener"
  - "[code://test/users-gate.test.ts](../../../../test/users-gate.test.ts) - the gate matrix a root connection joins"
  - "[code://test/listen-identity.test.ts](../../../../test/listen-identity.test.ts) - the door matrix"
---

## Goal

The token that owns the host can use it. A client that connects with the deployment's connection token is the host: no sign-in, no refusal, and every capability including the ones a role cannot name. A person's own token still means that person, and a deployment with no directory is exactly what it was.

## Reconnaissance

The files read and the patterns to reuse are the `refs` above, each with its note.

### Searches performed

- `rg -n "connection.principal" packages/sdk/src/host.ts` - four sites: the two gates, `authenticate`, and the expiry path, which is the whole surface a root connection has to satisfy.
- `rg -n "admitted" packages/sdk/src/listen.ts` - `identityOf` is the one place admission is decided, in all three runtimes.
- `rg -n "accept\(" packages/sdk/src packages/server/src test` - the host's entry point and its callers, so a changed signature is bounded.

### Runtime path

```
client -> ?tkn=<deployment token>   -> listen.identityOf: admitted, and the host itself
       -> accept(peer, { root: true }) -> Connection.root
       -> any command                  -> the gate returns before it asks for a capability
       -> authenticate (optional)      -> a person for another resource, never a downgrade
```

### Gaps

- The deployment's token confers no principal, so a configured directory refuses the operator everything.
- Nothing distinguishes "admitted by the host's own key" from "admitted with no identity", which are different facts.
- `Not found: a root principal - searched "root" in packages/sdk/src; there is none, and this plan does not add one as a person.`

## Decisions locked in

| # | Decision | Rationale / source |
| --- | --- | --- |
| 1 | [The door token is the host, and a person's own token is that person](../../../decisions/the-door-token-is-the-host.md) | The user, 2026-09-23: "Make the deployment connection token a root login... the deploy token was supose to be the root.. thats WHY I cannot do anything anymore". |

| What | Source | Task |
| --- | --- | --- |
| Root is a property of the connection, not a person in the file | decision 1 | 01 |
| `authenticate` cannot downgrade or revoke root | decision 1 | 01 |
| A deployment with no directory is unchanged | decision 1 | 01 |
| Root holds every capability, including a scheme no role names | decision 1 | 01 |

## Proposed architecture

- **Data flow** - `ListenOptions.root` says the deployment token is the host. `identityOf` admits it with `{ root: true }`, which travels to `accept` as an `Arrival` and is written on the `Connection`. Both gates return before asking for a capability when `connection.root` is true.
- **Event flow** - unchanged. `authenticate` still attaches a person and arms their expiry; it simply does not touch a connection that is already the host.
- **State flow** - no new store. `root` lives on the connection and dies with the socket, like the principal beside it.
- **Layer responsibilities** - packages/sdk: `Connection.root`, `Arrival`, the door's resolution and the two gates · packages/server: passing `root` when a directory is configured · test/: the gate matrix and the door matrix · docs: `docs/USERS.md` and `HANDOFF.md`.
- **Source-of-truth files** - [`code://packages/sdk/src/listen.ts`](../../../../packages/sdk/src/listen.ts), [`code://packages/sdk/src/host.ts`](../../../../packages/sdk/src/host.ts).

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - A socket on the door token is the host](task-01-a-socket-on-the-door-token-is-the-host.md) | done | - |
| [02 - The prose](task-02-the-prose.md) | done | 01 |

## Risks and tradeoffs

- The deployment token is full authority, so a leak is the host. The mitigation is that it was always the key to the door, that a person who should be limited is given their own token, and that rotating it is the same operation it always was.
- A root connection can never be refused, so a bug in the gate that root short-circuits is invisible to root. The mitigation is the matrix asserting a `member` is still refused the same commands on the same host.
- `root` on the connection and `principal` beside it can both be set, and the gates must prefer root. The mitigation is one comment at each gate saying so.

## Resume state

- **Done so far:** both tasks, 2026-09-23. The door token is the host, a person's own token is that person, `authenticate` cannot downgrade root, and the prose says so. See [implemented.md](implemented.md).
- **Next action:** none; the plan is built.
- **Open questions:**
  1. Is root a person in the file? - answered by decision 1: no, it is the deployment's key and a property of the connection.
  2. Can the operator sign in as somebody else and lose root? - answered: no, root survives signing in and out, because a client's automatic sign-in must not lock the operator out.
- **Watch out for:** the two gates are the only places a principal is consulted, and both must return before the capability is asked for. `accept`'s second argument changed shape, so anything calling it with a bare principal moves to `{ principal }`.

## Final verification checklist

- [x] `pnpm test`, `pnpm typecheck`, `pnpm boundary` and `pnpm build` green.
- [x] A socket on the deployment token is served every gated command with no `authenticate`.
- [x] A scheme-scoped capability is served to root and still refused to a role that does not name it.
- [x] Signing in and out on a root connection does not change what it may do.
- [x] A deployment with no directory behaves exactly as before.
- [x] By hand: the running daemon lists sessions and automations for the deployment token.
- [x] `plans/index.md`, [00-host.md](../00-host.md) and `HANDOFF.md` updated.
