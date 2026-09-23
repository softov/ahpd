---
title: A person reaches the host as themselves, and the host advertises only what is true
domain: host
status: built
priority: high
created: 2026-09-23
revalidated: 2026-09-23
requires: []
changes: []
creates: []
decisions:
  - decisions/a-connection-token-may-carry-a-person.md
  - decisions/a-host-advertises-only-what-is-true.md
refs:
  - "[code://packages/sdk/src/users.ts#L29-L52](../../../../packages/sdk/src/users.ts#L29-L52) - `DEFAULT_RESOURCE`, whose `authorization_servers` is a documentation page and whose `resource` is not an https identifier"
  - "[code://packages/sdk/src/users.ts#L148-L162](../../../../packages/sdk/src/users.ts#L148-L162) - `Users.verify`, the one question both a door and the protocol will ask"
  - "[code://packages/sdk/src/host.ts#L2144-L2150](../../../../packages/sdk/src/host.ts#L2144-L2150) - `resourcesOf`, which appends the host's record to every agent"
  - "[code://packages/sdk/src/host.ts#L4474-L4478](../../../../packages/sdk/src/host.ts#L4474-L4478) - `accept`, which builds a `Connection` and is where a principal has to arrive early"
  - "[code://packages/sdk/src/host.ts#L5415-L5432](../../../../packages/sdk/src/host.ts#L5415-L5432) - `authenticate`, the one place a person becomes a principal today, unchanged by this plan"
  - "[code://packages/sdk/src/listen.ts#L73-L86](../../../../packages/sdk/src/listen.ts#L73-L86) - `allowed`, the synchronous root-token check that gains a second question"
  - "[code://packages/sdk/src/listen.ts#L100-L106](../../../../packages/sdk/src/listen.ts#L100-L106) - the Bun upgrade path, which refuses before a socket exists"
  - "[code://packages/sdk/src/listen.ts#L203-L222](../../../../packages/sdk/src/listen.ts#L203-L222) - the Node `verifyClient` and `connection` pair, where the answer has to travel from one to the other"
  - "[code://packages/sdk/src/types/listen.ts#L38-L63](../../../../packages/sdk/src/types/listen.ts#L38-L63) - `ListenOptions`, which gains the question to ask about a token that is not the root's"
  - "[code://packages/sdk/src/types/host.ts#L403-L441](../../../../packages/sdk/src/types/host.ts#L403-L441) - `Connection.principal`, already the place a person lives"
  - "[code://packages/server/src/config.ts#L9-L61](../../../../packages/server/src/config.ts#L9-L61) - the config keys, which gain the identifier the host advertises"
  - "[code://packages/server/src/main.ts#L548-L560](../../../../packages/server/src/main.ts#L548-L560) - where `fileUsers` is built and handed to `createHost`"
  - https://www.rfc-editor.org/rfc/rfc9728.txt - `resource` is an https URL, `authorization_servers` is optional, and `resource_documentation` is the field for a page
  - "[file:///github/externals/vscode/src/vs/sessions/contrib/providers/remoteAgentHost/browser/remoteAgentHostActions.ts#L78-L127](file:///github/externals/vscode/src/vs/sessions/contrib/providers/remoteAgentHost/browser/remoteAgentHostActions.ts#L78-L127) - the Add Remote Agent Host prompt accepts `ws://host:port?tkn=TOKEN`, which is why a personal connection token is enough for VS Code"
  - "[file:///github/externals/vscode/src/vs/workbench/contrib/chat/browser/agentSessions/agentHost/agentHostAuth.ts#L362-L395](file:///github/externals/vscode/src/vs/workbench/contrib/chat/browser/agentSessions/agentHost/agentHostAuth.ts#L362-L395) - VS Code resolves a provider from `authorization_servers` and offers no field for a pasted secret, which is the client this plan is for"
---

## Goal

A person can reach this host as themselves without signing in through the protocol.
The connection token they present on the WebSocket is looked up in the user directory and becomes their principal before the first frame, so a client that can only carry a URL works with no plugin and no client change, and VS Code's Add Remote Agent Host prompt is the whole of the setup.
A client that speaks `authenticate` keeps working exactly as it does, because the two ways in stay distinct.
In the same change the host stops advertising an authorization server that does not exist: the documentation page moves to the field the standard provides for it, and the resource identifier becomes one the standard recognises.

## Reconnaissance

The files read and the patterns to reuse are the `refs` above, each with its note.

### Searches performed

- `rg -n "tkn" /github/externals/vscode/src` - VS Code carries a `connectionToken` from the Add Remote Agent Host prompt to a `?tkn=` query string in its node transports, so its transport already speaks this host's door.
- `rg -n "getOrActivateProviderIdForServer" /github/externals/vscode/src` - the client resolves a provider by matching `authorization_servers`, and `forceAuthenticationInteractively` runs a fixed GitHub Copilot dialog, so a host-issued secret has no route through it.
- `rg -n "options.users" packages/sdk/src/host.ts packages/server/src/main.ts` - the port is read in the gate, in `lent`, in `authenticate` and in `resourcesOf`, and it is built in one place in the daemon.
- `rg -n "protectedResources" /github/externals/agent-host-protocol/docs/specification/authentication.md` - discovery is per agent, `required` is about whether the agent can work, and `authenticate` is the token delivery.
- `grep -n "verify(" packages/sdk/src/host.ts` - `Users.verify` is called once, in `authenticate`, which is why a per-user connection token is a second caller and not a second implementation.

### Runtime path

```
client -> ws://host:port?tkn=<token>            -> listen.ts: root token, else the directory
       -> accept(peer, principal)               -> Connection.principal before the first frame
       -> any command                            -> the gate (unchanged), served or refused
       -> or authenticate(resource, token)       -> Users.verify (unchanged), for clients that speak it
```

### Gaps

- The advertised record names a documentation page as an authorization server and a non-https resource identifier, so a client can be sent to the wrong issuer and no client can trust the record.
- The connection token is one shared secret compared synchronously before the upgrade, so a person has no way to be known at the door.
- `accept` takes only a peer, so there is nowhere for a principal to arrive early.
- The documentation already claims that removal lands on the next command, which the code does not do.
- `Not found: a host-level protected resource - searched "protectedResources" in types/channels-root/state.ts and the authentication specification; discovery is per agent, so this host's own login is carried on every agent and makes each one read as required.`

## Decisions locked in

| # | Decision | Rationale / source |
| --- | --- | --- |
| 1 | [A connection token may carry a person, beside the one that only opens the door](../../../decisions/a-connection-token-may-carry-a-person.md) | The user, 2026-09-23: "for the current token we have.. it could be matched as ROOT login... if not matched with root, we can lookup for a user login", and "two distinct". |
| 2 | [The host advertises only what is true about how to sign in](../../../decisions/a-host-advertises-only-what-is-true.md) | The user, 2026-09-23: "puts a doc as a link is the worst thing I have seen you do", and "the issuer its spec... so I think its also need to be done". |

| What | Source | Task |
| --- | --- | --- |
| The shared connection token stays the door and confers no principal | The user, 2026-09-23: "we can keep the root login as today". | 02 |
| The two ways in stay distinct: the socket admits, `authenticate` answers the protocol | The user, 2026-09-23: "two distinct". | 02 |
| Revocation by the next command is out of scope; the prose is corrected to what the code does | The user, 2026-09-23: "we will see about the revocation after". | 04 |
| An issuer's token is not accepted at the door | `(defaulted: a client obtains one only after connecting, so there is nothing to present.)` | 02 |
| The `resource` identifier is the operator's, derived from the listen address otherwise | `(defaulted: RFC 9728 wants an https URL and the daemon has no other name to use.)` | 01 |
| The issuer option behind the same `Users` port is a later plan, not this one | scope, so this plan can stop at a record that is true rather than one that is complete | - |

## Proposed architecture

- **Data flow** - `listen` reads the presented token. The deployment's own token admits the socket with no principal. Otherwise `ListenOptions.identify` is asked, which the daemon wires to `users.verify`, and its answer travels to `accept` as the principal. The gate then reads `connection.principal` exactly as it does today.
- **Event flow** - unchanged. `authenticate` still attaches a principal, still arms the expiry timer, and still raises `auth/required` when a credential runs out.
- **State flow** - the record a `Users` port advertises is built once at construction, from the operator's identifier or one derived from the listen address. It carries `resource_documentation` and omits `authorization_servers`. Nothing is stored per connection that was not stored before.
- **Layer responsibilities** - packages/sdk: the record, the token resolution in `listen`, and the principal parameter on `accept` · packages/server: the identifier the daemon advertises and the `identify` wiring · test/: the door matrix and the record · docs: `docs/USERS.md` and the protocol note.
- **Source-of-truth files** - [`code://packages/sdk/src/users.ts`](../../../../packages/sdk/src/users.ts), [`code://packages/sdk/src/listen.ts`](../../../../packages/sdk/src/listen.ts), [`code://packages/sdk/src/host.ts`](../../../../packages/sdk/src/host.ts), [`code://packages/server/src/main.ts`](../../../../packages/server/src/main.ts).

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - The advertised record is true](task-01-the-record-is-true.md) | done | - |
| [02 - A connection token that resolves to a person](task-02-a-connection-token-that-resolves-to-a-person.md) | done | - |
| [03 - The daemon hands a person their URL](task-03-the-daemon-hands-a-person-their-url.md) | done | 02 |
| [04 - The prose and the handoff](task-04-the-prose-and-the-handoff.md) | done | 01, 02, 03 |

## Risks and tradeoffs

- A per-user secret in a URL can reach a log, and it is both the door and the identity. The mitigation is that the daemon's own connect URL is never printed on stdout (daemon/02), and a client that redacts `tkn` is relied on rather than trusted.
- A credential stored by a client under the old `ahpd://users` identifier no longer matches, so a person signs in once more. The mitigation is a line in the release notes and the fact that the identifier is read from root state rather than remembered by the client.
- Resolving a token before the upgrade makes the admission path asynchronous in three runtimes. The mitigation is one resolution carried to the connection rather than a second lookup per frame, and a test per runtime only where the runtime is available.
- The host's own login still rides on every agent and makes each read as required, because AHP has no host-level protected resource. This plan does not invent one; it records the gap and leaves the field truthful.
- A connection admitted by the shared token has no principal and is still refused by the gate, which is unchanged behaviour and is the reason the docs must name both ways in.

## Resume state

- **Done so far:** all four tasks, 2026-09-23. The record is true, the door resolves a person's own token before the first frame in all three runtimes, the daemon builds one directory and hands it to both doors, `ahpd user token --url` prints what a client pastes, and the prose says what the code does. See [implemented.md](implemented.md).
- **Superseded in part:** the door no longer resolves a person from their own token; it admits the socket and names nobody, and `trustToken` is the opt-out. See [host 13](../13-the-door-is-a-door/plan.md) and decision [the-door-is-a-door](../../../decisions/the-door-is-a-door.md). What this plan built - the record, `identify`, the derived identifier - is unchanged.
- **Next action:** none; the plan is built. The issuer option that gives `authorization_servers` a real value is `host/08`, and what this plan set aside is in [deferred.md](deferred.md).
- **Open questions:**
  1. What identifier does a daemon advertise when the operator names none? - answered: `https://<host>:<port>/`, derived by `signInIdentifier`, with the machine's own name standing in for a wildcard address and the port left out when it is `0`.
  2. Does the personal token replace a person's `authenticate` credential or duplicate it? - answered by decision 1: it is the same secret asked at a different door, and `authenticate` is unchanged.
- **Watch out for:** the listener asks through `ListenOptions.identify` and does not import the directory, because `packages/sdk` hands the host its ports. The deployment's token is compared first, so a host that never configured a directory behaves exactly as it did. A socket admitted by that token still has no principal, which is what keeps the gate meaningful for an operator holding only the door key.

## Final verification checklist

- [x] `pnpm test` green: 71 files, 917 tests, with the record, the door matrix and the daemon cases.
- [x] `pnpm typecheck`, `pnpm boundary` and `pnpm build` green.
- [x] A guarded host admits a person's own token and refuses a token that is nobody's.
- [x] The advertised record carries `resource_documentation` and no `authorization_servers`.
- [x] By hand: a real daemon with a real user file, two people connected at their own `?tkn=` URLs, `listSessions` served for both with no `authenticate`, and `sam` (member) refused `-32009 sam may not automation here` while `ana` (admin) reached the handler.
- [x] `plans/index.md` and [00-host.md](../00-host.md) updated.
