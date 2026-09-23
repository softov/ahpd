---
title: A person signs in to the host, and a role decides what they may do
domain: host
status: active
priority: medium
created: 2026-09-23
revalidated: 2026-09-23
requires: []
changes: []
creates: []
decisions:
  - decisions/a-person-signs-in-through-authenticate.md
  - decisions/ahpd-keeps-its-own-user-directory.md
  - decisions/a-role-refuses-at-the-dispatch-boundary.md
refs:
  - "[code://packages/sdk/src/host.ts#L5118-L5185](../../../../packages/sdk/src/host.ts#L5118-L5185) - the `authenticate` handler, which holds a credential per connection and gains verification for one resource"
  - "[code://packages/sdk/src/host.ts#L2005-L2014](../../../../packages/sdk/src/host.ts#L2005-L2014) - `resourcesOf`, which already appends a host-owned resource to every agent for GitHub and is the pattern the login resource follows"
  - "[code://packages/sdk/src/host.ts#L2015-L2024](../../../../packages/sdk/src/host.ts#L2015-L2024) - `lent`, which spends any connection's token and must never spend a person's"
  - "[code://packages/sdk/src/host.ts#L4325-L4380](../../../../packages/sdk/src/host.ts#L4325-L4380) - the expiry timers and the `auth/required` notification, which already say a credential ran out"
  - "[code://packages/sdk/src/host.ts#L4130-L4140](../../../../packages/sdk/src/host.ts#L4130-L4140) - `metadataFor`, which turns a resource id into the RFC 9728 record an error carries"
  - "[code://packages/sdk/src/host.ts#L7170-L7186](../../../../packages/sdk/src/host.ts#L7170-L7186) - the single dispatch boundary, beside the `handshook` check, where the gate goes"
  - "[code://packages/sdk/src/host.ts#L4415-L4470](../../../../packages/sdk/src/host.ts#L4415-L4470) - `initialize`, which sets a self-asserted `clientId` and answers `initialSubscriptions` inline"
  - "[code://packages/sdk/src/host.ts#L4520-L4560](../../../../packages/sdk/src/host.ts#L4520-L4560) - `reconnect`, the second place a `clientId` is taken from a client"
  - "[code://packages/sdk/src/types/host.ts#L405-L441](../../../../packages/sdk/src/types/host.ts#L405-L441) - `Connection`, which gains the principal beside `tokens`"
  - "[code://packages/sdk/src/types/host.ts#L146](../../../../packages/sdk/src/types/host.ts#L146) - `HostOptions.github`, the optional host-level port `users` is modelled on"
  - "[code://packages/sdk/src/sessions.ts#L109](../../../../packages/sdk/src/sessions.ts#L109) - `fileSessions`, the shape a file-backed port takes in this SDK"
  - "[code://packages/sdk/src/listen.ts#L45-L70](../../../../packages/sdk/src/listen.ts#L45-L70) - the connection token and its constant-time compare, unchanged by this plan and reused for the token hash"
  - "[code://packages/server/src/main.ts#L440-L470](../../../../packages/server/src/main.ts#L440-L470) - where the ports are handed to `createHost`, and where `users` joins"
  - "[code://packages/server/src/config.ts](../../../../packages/server/src/config.ts) - the daemon config the user file sits beside"
  - "[code://docs/AHP.md](../../../../docs/AHP.md) - the compatibility table, whose `authenticate` row and error codes move"
  - "[code://packages/computer/src/plugin.ts#L72](../../../../packages/computer/src/plugin.ts#L72) - the `computer:` provider and the three host tools that make this a release blocker, not a nicety"
  - "[code://.project/decisions/client-writes-are-served-not-gated.md](../../../../.project/decisions/client-writes-are-served-not-gated.md) - the gate `host/04` removed, and the 2026-09-22 note saying the removal was too wide"
  - npm://@microsoft/agent-host-protocol@0.9.0 - `AhpErrorCodes.AuthRequired` (-32007), `PermissionDenied` (-32009), `AuthRequiredErrorData` and `PermissionDeniedErrorData`
  - file:///github/externals/agent-host-protocol/docs/specification/authentication.md - the flow, the error handling and the per-connection rule this follows
---

## Goal

A person signs in to a running `ahpd` with a credential of their own, and what they may do is decided by the roles on their record rather than by holding the daemon's one secret.
A daemon with no user file configured behaves exactly as it does today, so this is something an install turns on rather than something it inherits.

## Reconnaissance

The files read and the patterns to reuse are the `refs` above, each with its note.

### Searches performed

- `rg -n "authenticate" packages/sdk/src/host.ts` - the handler exists, checks the resource against what was advertised, stores the token per connection, honours an empty token as a revoke and `expiresIn` as a lifetime, and states that it does not verify the token.
- `rg -rn "RpcError\(-32007|AUTH_REQUIRED" packages/` - nothing. `-32007` is discussed in a comment at `host.ts:5111` and never thrown, so the half of the specification that asks a client to sign in is unimplemented.
- `rg -rn "permission|authorize|mayWrite|grants" packages/server/src` - nothing but prose about the process's own permissions. There is no authorization anywhere in the daemon.
- `rg -n "protectedResources" packages/` - declared on `AgentInfo`, validated as an array, and appended to by `resourcesOf`, which already adds `options.github.resource` to every agent. A host-level resource on every agent is the established shape here, not an invention.
- `rg -n "root/agentsChanged|root/terminalsChanged" packages/sdk/src/host.ts` - dispatched from seven call sites through one `broadcast`, which is why root state cannot be filtered per connection.
- `grep -n "^        [a-zA-Z]*: async (params)" packages/sdk/src/host.ts` - twenty-nine handlers, all resolved at one place, which is why the gate is one place.

### Runtime path

```
client -> WebSocket with ?tkn=      -> listen.ts, one shared secret, unchanged
       -> initialize                -> handshook, clientId self-asserted, root snapshot returned
       -> reads protectedResources  -> finds the host's own record among the agents'
       -> authenticate(resource, token)
            resource is the host's  -> Users.verify(token) -> connection.principal
            anything else           -> held unverified, exactly as today
       -> any command               -> the gate at the dispatch boundary
            needs nothing           -> served
            needs a capability, no principal      -> -32007 with data.resources
            needs a capability, role lacks it     -> -32009 with no data.request
       -> expiry or empty token     -> principal detached, auth/required sent
```

### Gaps

- No principal exists. `Connection` carries `clientId`, which `initialize` and `reconnect` both take from the client's own params and never check, so it is a label and not an identity.
- No user directory, no roles and no CLI to manage either.
- `authenticate` verifies nothing, which is correct for a backend's credential and wrong for a person's.
- `-32007` is never thrown, so a client has no machine-readable way to be told to sign in.
- `lent` will hand any connection's token for a resource to the host's own work. A person's credential must be excluded from it or one user's sign-in becomes another's.
- `Not found: any per-connection view of a channel - searched "serverSeq", "broadcast" and "replayable" in packages/sdk/src/host.ts; the sequence and the replay buffer are one per host.`

## Decisions locked in

| # | Decision | Rationale / source |
| --- | --- | --- |
| 1 | [A person signs in through `authenticate`, not through the connection token](../../../decisions/a-person-signs-in-through-authenticate.md) | The user, 2026-09-23: asked where a user presents their credential and chose "authenticate on `ahp-root://`". |
| 2 | [`ahpd` keeps its own user directory](../../../decisions/ahpd-keeps-its-own-user-directory.md) | The user, 2026-09-23: asked who issues and verifies the credential and chose "ahpd's own directory". |
| 3 | [A role refuses at the dispatch boundary, and never hides root state](../../../decisions/a-role-refuses-at-the-dispatch-boundary.md) | (defaulted: `serverSeq` and the replay buffer are per host, so a filtered root state is corrected by the next broadcast). |

| What | Source | Task |
| --- | --- | --- |
| The connection token is untouched, keeps one shared secret, and stays the answer to whether a socket may exist | decision 1 | - |
| A daemon with no user file has no directory and every gate is inert | decision 2 | 01, 03 |
| A token is opaque and high entropy, stored as a SHA-256 hash and compared in constant time, never through a password hash | decision 2 | 01 |
| Verification happens for the host's own resource only; a backend's and an MCP server's credentials keep today's pass-through | decision 1 | 02 |
| Absent principal is `-32007` with `data.resources`; insufficient role is `-32009` with no `data.request` | decision 3 | 03 |
| Removing a user does not close their socket, because the connection token is a separate secret | decision 1 | - |
| A resource capability is scoped by the URI's scheme, so `write` on `file:` is not `write` on a plugin's scheme | `HANDOFF.md` pending step 9, "scope the gate, not restore it" | 03 |
| An identity provider, a pairing code for a phone, and `ahpc`/`ahpapp` sign-in are not in this plan | scope | - |
| Host tools invoked by a session's model are not gated here; this plan gates what a client asks for | scope, see *Risks* | - |

## Proposed architecture

- **Data flow** - a `Users` port answers `verify(token)` with a `Principal` or nothing. `authenticate` calls it for one resource id and hangs the result on the `Connection`. The gate reads `connection.principal` and a static map from method to capability, and either serves or throws.
- **Event flow** - unchanged except at the edges: `authenticated` still fires on a successful push, and the existing `expire`/`auth/required` path additionally detaches the principal when the host's own resource runs out.
- **State flow** - the directory is a file the host reads through the port and never caches beyond a record's lifetime; the principal lives on the `Connection` and dies with the socket, which is what the specification requires of authentication status.
- **Layer responsibilities** - packages/sdk: the `Users` and `Principal` types, `fileUsers`, the advertised resource, the verification branch in `authenticate`, and the gate · packages/server: the config key, the wiring into `createHost`, and the `ahpd user` verbs · test/: the directory, the verification, the gate matrix and the proof that an unconfigured daemon is unchanged · docs: `docs/AHP.md`, `README.md` and a new `docs/USERS.md`.
- **Source-of-truth files** - [`code://packages/sdk/src/host.ts`](../../../../packages/sdk/src/host.ts), [`code://packages/sdk/src/types/host.ts`](../../../../packages/sdk/src/types/host.ts), [`code://packages/server/src/config.ts`](../../../../packages/server/src/config.ts).

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - A user directory the daemon owns](task-01-a-user-directory-the-daemon-owns.md) | done | - |
| [02 - The host advertises itself and verifies a person's token](task-02-the-host-verifies-a-person.md) | done | 01 |
| [03 - One gate decides every command](task-03-one-gate-decides-every-command.md) | done | 02 |
| [04 - The docs, and a daemon nobody configured](task-04-the-docs-and-the-default.md) | done | 03 |
| [05 - A client preference is the connection's, not the host's](task-05-a-client-preference-is-not-host-state.md) | todo | 03 |

## Risks and tradeoffs

- A read-only role produces the same `NoPermissions` dialog in VS Code that `host/04` removed, because that client maps `-32009` that way. The mitigation is that roles are opt-in, the default role writes, and the refusal carries no `data.request`, so a client that reads the field correctly stops rather than retries.
- Two secrets are now needed on a phone for a multi-user daemon, which is real friction. The mitigation is that the third deployment shape drops the connection token entirely and lets the credential be the only one; a pairing code is left for later.
- Removing a user does not disconnect them. They keep the connection token, so they can still open a socket and read root state, and only a rotation of that token locks them out. This is stated rather than fixed.
- Root state is readable before anybody signs in: the agent list, a session count, the root config and any open terminal's title. It cannot be hidden without per-connection sequencing, and it is named in decision 3 rather than worked around.
- Neither `ahpc` nor `ahpapp` can sign in yet, so a directory is usable only from a client that learns the flow. That is cross-repo work this plan does not do and must not pretend to.
- **This plan does not close `HANDOFF.md`'s pending step 9 on its own, and must not be read as doing so.** That blocker is `@ahpd/computer`'s three host tools, which a session's *model* invokes; nothing here sits on that path, because a tool call is not a client command and never reaches the dispatch boundary. What this plan contributes is the half that is a client command: a scheme-scoped resource capability, so a write to a plugin's scheme is opt-in per role. The tool half needs its own answer, which the user said on 2026-09-22 they would plan.
- A capability map keyed by method name goes stale silently when a handler is renamed. The mitigation is a test that asserts every key of `handlers` appears in the map, so an unmapped method fails the suite rather than being served.

## Resume state

- **Done so far:** tasks 01 to 04, 2026-09-23, and the review that followed. `Users` and `fileUsers`, the host's own sign-in resource, verification in `authenticate`, the gate at the dispatch boundary with a scheme-scoped capability, the four `ahpd user` verbs, `docs/USERS.md` and the document moves. See [implemented.md](implemented.md).
  The review found two holes and both were fixed the same day. `dispatchAction` is a notification and never reaches the boundary, so it is now gated at the top of `applyDispatch` by the channel it names; left open it was arbitrary command execution, because root state hands every open terminal's URI to anybody who completes a handshake. And `defaultShell` was reachable with `write` alone although it names the binary a backend's terminal runs, so setting it now needs `terminal`.
- **Next action:** [task-05-a-client-preference-is-not-host-state.md](task-05-a-client-preference-is-not-host-state.md). The `defaultShell` rule is a patch on a design fault the host's own comment describes: these are a person's preferences kept in one record shared by every connection, so on a multi-user daemon the last client to connect sets everybody's shell. Task 05 replaces the rule with the per-connection preference. Pending step 9's tool half is still untouched and is not this plan's.
- **Open questions:**
  1. What `resource` id does the host advertise for itself? - answered: `ahpd://users`, on `Users.resource`, so a deployment can name another.
  2. Do roles carry capabilities directly, or names that map to capability sets? - answered: a role is a name whose grants live in the same file, with `admin` and `member` built in.
  3. Whose preference does a backend's terminal use, when it has a session and no connection? - open, and task 05 does not start without an answer; its three candidates are in that file.
  4. Should this plan precede the pending step 9 plan? - answered: it did. The gate is the boundary that plan will refuse against, and the scheme-scoped capability is the half of it that is a client command.
- **Watch out for:** `lent` skips the host's own resource explicitly, and `authenticate` must keep passing a backend's token through unverified; the suite has a case for each, and both are things a later change could quietly undo.

## Final verification checklist

- [x] `pnpm test` green: 70 files, 892 tests, with the directory, verification, gate matrix and unconfigured-daemon cases.
- [x] `pnpm typecheck`, `pnpm boundary` and `pnpm build` green.
- [ ] The suite passes with every `packages/*/dist` moved aside, which is the order CI uses. Not run in this session; CI runs it.
- [ ] By hand: the real daemon with a user file, a good token, a bad token, a `-32007`, a `-32009`, and the same daemon with no file. The CLI verbs were driven by hand; the daemon against a directory was not.
- [x] `plans/index.md` and [00-host.md](../00-host.md) updated.
