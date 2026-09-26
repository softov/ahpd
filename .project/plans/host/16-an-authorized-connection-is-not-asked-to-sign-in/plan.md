---
title: A connection that is already authorized is not asked to sign in
domain: host
status: built
priority: high
created: 2026-09-25
revalidated: 2026-09-25
requires:
  - plans/host/13-the-door-is-a-door/plan.md
changes: []
creates: []
decisions:
  - decisions/an-authorized-connection-is-told-sign-in-is-not-required.md
refs:
  - "[code://packages/sdk/src/host.ts#L2219-L2226](../../../../packages/sdk/src/host.ts#L2219-L2226) - `resourcesOf`, where the host's sign-in resource joins every agent's list"
  - "[code://packages/sdk/src/host.ts#L2706](../../../../packages/sdk/src/host.ts#L2706) - `descriptors`, the one builder of `agents`"
  - "[code://packages/sdk/src/host.ts#L4092-L4124](../../../../packages/sdk/src/host.ts#L4092-L4124) - `rootState`, which already takes a per-connection overlay for `config`"
  - "[code://packages/sdk/src/host.ts#L4219-L4222](../../../../packages/sdk/src/host.ts#L4219-L4222) - `snapshotOf` for the root, called from four places with the connection's config"
  - "[code://packages/sdk/src/host.ts#L1352-L1362](../../../../packages/sdk/src/host.ts#L1352-L1362) - `broadcast`, which takes a `per` function for a per-connection payload"
  - "[code://packages/sdk/src/host.ts#L1368-L1395](../../../../packages/sdk/src/host.ts#L1368-L1395) - `seenBy`, the one place an action envelope is rewritten for a connection; already used by the live, reconnect and subscribe replay paths for `root/configChanged`"
  - "[code://packages/sdk/src/host.ts#L1585-L1605](../../../../packages/sdk/src/host.ts#L1585-L1605) - `dispatch`, one envelope and one replay entry per action"
  - "[code://packages/sdk/src/host.ts#L5128-L5135](../../../../packages/sdk/src/host.ts#L5128-L5135) - the reconnect replay, which maps held envelopes through `seenBy`"
  - "[code://packages/sdk/src/host.ts#L4668-L4681](../../../../packages/sdk/src/host.ts#L4668-L4681) - `accept`, where `principal` and `root` land on the connection"
  - "[code://test/users-host.test.ts](../../../../test/users-host.test.ts) - reads `protectedResources` off the root snapshot, the pattern the new cases follow"
  - "[code://test/conformance.test.ts](../../../../test/conformance.test.ts) - pins one echo per dispatch, which this must keep"
  - https://github.com/microsoft/vscode/blob/832cf23c588/src/vs/workbench/contrib/chat/browser/agentSessions/agentHost/agentHostAuth.ts#L47-L60 - the client-side check this answers
---

## Goal

A client connected with the deployment's token, or already signed in, can create a session without being asked to sign in.
Today VS Code refuses on its own side because every agent says the host's sign-in is required, even to a connection the host already treats as root.

## Reconnaissance

The files read and the patterns to reuse are the `refs` above, each with its note.

### Searches performed

- `grep -n "descriptors()" packages/sdk/src/host.ts` - three callers: `rootState` and two `root/agentsChanged` dispatches (L1793, L1880).
- `grep -n "snapshotOf(" packages/sdk/src/host.ts` - four callers (subscribe, initialize, reconnect snapshot, resubscribe), all of which have the connection.
- `grep -rn "modelRequiresAgentAuthentication" /github/externals/vscode/src` - one caller, `_ensureRequiredAuthentication`, reading `agents` from the root state.

### Runtime path

```
accept(peer, principal, root) -> subscribe/initialize -> snapshotOf(ROOT) -> rootState.agents[].protectedResources
dispatch(root/agentsChanged) -> broadcast(per = seenBy) -> seenBy passes it through unchanged
reconnect / subscribe -> replay mapped through seenBy
VS Code -> _ensureRequiredAuthentication -> required !== false -> "Authentication is required"
```

### Gaps

- The root state's `agents` has no per-connection view; only `config` does.
- `seenBy` rewrites only `root/configChanged`; `root/agentsChanged` passes through it unchanged.
- No test reads `required` on the sign-in resource from a root connection.

## Decisions locked in

| # | Decision | Rationale / source |
| --- | --- | --- |
| 1 | [A connection that is already authorized is told the host's sign-in is not required](../../../decisions/an-authorized-connection-is-told-sign-in-is-not-required.md) | The user, 2026-09-25, after VS Code refused on the deployment token: "Real fix: tell a token (root) connection that the users resource is required: false." |

| What | Source | Task |
| --- | --- | --- |
| "Authorized" is `connection.root === true` or `connection.principal !== undefined`, read at delivery | decision 1 | 01 |
| Only the resource whose `resource` equals `loginId()` is rewritten | decision 1 | 01 |
| The rewrite happens at delivery, never in `descriptors` or the replay buffer, so `serverSeq` and the envelope count are untouched | `(defaulted: keeps the one-echo-per-dispatch constraint)` | 01 |
| No fresh `root/agentsChanged` is sent when a connection signs in | `(defaulted: VS Code only reads it at session creation, and a signed-in client already holds a token)` | 01 |

## Proposed architecture

- **Data flow** - one function, `agentsFor(connection, agents)`, returns the list with the sign-in resource's `required` set to `false` when the connection is authorized, and the list unchanged otherwise or when there is no users directory.
- **Event flow** - `snapshotOf` applies it to `state.agents` for the root channel. `seenBy` gains a `root/agentsChanged` branch that applies it to `action.agents`; the live broadcast and both replay paths already go through `seenBy`, so nothing else changes there.
- **State flow** - nothing stored changes; `descriptors()` and `replayable` stay canonical.
- **Layer responsibilities** - `@ahpd/sdk`: all of it. `@ahpd/server`: nothing.
- **Source-of-truth files** - [`code://packages/sdk/src/host.ts`](../../../../packages/sdk/src/host.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - The root state tells an authorized connection sign-in is not required](task-01-the-view-per-connection.md) | done | - |
| [02 - Checked in VS Code, and written down](task-02-vscode-and-docs.md) | done | 01 |

## Risks and tradeoffs

- A future path that sends `agents` without going through the three delivery points leaks `required: true` again. The test in task 01 covers snapshot, live and replay so a new path shows up as a missing case.
- `broadcast` gains a channel check on a hot path. It is one string comparison for non-root channels.
- A client that caches the root state across a sign-out keeps `false`. Sign-out already drops the principal, so the next command is refused with `-32007` and the client learns it that way.

## Resume state

- **Done so far:** every task done; see [implemented.md](implemented.md).
- **Next action:** none.
- **Open questions:** none.
- **Watch out for:** `rootState` is also where `config` is overlaid per connection, and `seenBy` is where envelopes are; the `agents` rewrite lives in those two places and in `agentsFor`, and nowhere else.

## Final verification checklist

- [x] `pnpm test`, `pnpm typecheck` and `pnpm boundary` green.
- [x] A root connection and a personal-token connection read different `required` from the same host, in the snapshot, live `root/agentsChanged` and replay.
- [x] `test/conformance.test.ts` unchanged and green.
- [x] VS Code on the deployment token creates a session on a host with `users` set and the issuer down.
- [x] `plans/index.md`, `docs/USERS.md` and `working/HANDOFF.md` updated.
