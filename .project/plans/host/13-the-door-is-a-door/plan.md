---
title: The door is a door, and trusting the token is the opt-out
domain: host
status: built
priority: high
created: 2026-09-23
revalidated: 2026-09-23
requires:
  - plans/host/09-the-door-token-is-the-host/plan.md
changes: []
creates: []
decisions:
  - decisions/the-door-is-a-door.md
refs:
  - "[code://packages/sdk/src/listen.ts#L82-L124](../../../../packages/sdk/src/listen.ts#L82-L124) - `identityOf`, where a personal token stops naming the person"
  - "[code://packages/sdk/src/types/listen.ts#L74-L102](../../../../packages/sdk/src/types/listen.ts#L74-L102) - `Arrival`, `identify` and `root`"
  - "[code://packages/sdk/src/users.ts#L130-L155](../../../../packages/sdk/src/users.ts#L130-L155) - `FileUserOptions.trustToken`, the host-wide default"
  - "[code://packages/server/src/main.ts#L810-L830](../../../../packages/server/src/main.ts#L810-L830) - the daemon's `identify`, which passes the record only when it is trusted"
  - "[code://docs/USERS.md](../../../../docs/USERS.md) - the two layers this makes true"
---

## Goal

A personal connection token opens a socket and names nobody; `authenticate` authorizes every door; the deployment's token stays root; and a deployment that needs the token to be the authorization writes `trustToken`, per host or per record, because off is the default.

## Reconnaissance

The files read and the patterns to reuse are the `refs` above, each with its note.

### Searches performed

- `grep -rn "trusted\|trustToken" packages test` - there was no such name anywhere, so the opt-out is new vocabulary and its default is decided in one place per layer.
- `grep -rn "arrives as\|as themselves" docs README.md packages/*/README.md` - one stale passage in `docs/DAEMON.md`, plus the `USERS.md` table, which is the page this rewrites.
- `rg -n "identify" packages/sdk/src packages/server/src` - one caller per runtime in `listen.ts` and one in the daemon, so the arrival shape changes in four places and nowhere else.

### Gaps

- `identify` answered a `Principal` or nothing, so a token that opened the door could not also be admitted as nobody.
- `accept` had no way to say "root", and the gate had no way to read it.
- Nothing let a host or a record say the token is the authorization, so removing it from the door would have removed the only route the reference client has.
- The daemon's `user list` could not show which records were trusted.

## Decisions locked in

| # | Decision | Rationale / source |
| --- | --- | --- |
| 1 | [The door admits a socket and names nobody, and the deployment's token is still the host](../../../decisions/the-door-is-a-door.md) | The user, 2026-09-23: "Can we invert.. better security right?", and "the deployment token exempt: yes". |

| What | Source | Task |
| --- | --- | --- |
| `trustToken` is per host and per record, off by default | decision 1 | 01 |
| The deployment's token is never asked to authorize | decision 1 | 01 |
| A client that can only carry a URL is served by `trustToken`, not by the default | decision 1 | 01 |

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - The door admits, `authenticate` authorizes, and `trustToken` opts out](task-01-the-door-admits-and-the-token-may-be-trusted.md) | done | - |

## Risks and tradeoffs

- The default now refuses every gated command on a personal token until sign-in, so a client with no sign-in route needs `trustToken`.
  The mitigation is that the key is documented in both places, is per record as well as per host, and the daemon prints `trusted` in `user list`.
- `trustToken` is one flag that turns the door back into the authorization for everybody.
  The mitigation is that it is off unless written, so it is a visible line in a configuration rather than a default.
- A personal token still opens the socket, so an unauthenticated caller reads what the protocol serves without a principal.
  The mitigation is that the gate is the one place that answers commands, and the spec's own root state is not a command.
- The deployment's token bypasses all of it.
  That is deliberate and decided by `the-door-token-is-the-host`; the mitigation is that it is one secret, rotatable, and never printed by `user list`.

## Resume state

- **Done so far:** the task, 2026-09-23. The door names nobody, `authenticate` is the authorization, `trustToken` is the opt-out in both places, root is unchanged, and the docs and tests say so. See [implemented.md](implemented.md).
- **Next action:** none; the plan is built.
- **Open questions:**
  1. Is `trustToken` per person or per host? - answered by decision 1: both, and the record wins.
  2. Does the deployment's token need `trustToken` to be root? - answered by decision 1: no, it is root with or without it.
- **Watch out for:** `Arrival` distinguishes `{}` from `{ principal }` by the presence of the field, so an `identify` that returns a principal-less arrival admits a socket that is nobody. A new caller that means "refuse" must return `undefined`, not `{}`.

## Final verification checklist

- [x] `pnpm test`, `pnpm typecheck` and `pnpm boundary` green.
- [x] `test/listen-identity.test.ts` - a personal token is admitted as nobody, the deployment's token is root, and `{}` from `identify` is admitted while `undefined` is refused.
- [x] `test/users-gate.test.ts`, `test/users-host.test.ts`, `test/users-issuer.test.ts`, `test/users.test.ts` - the gate refuses `-32007` on a personal token before `authenticate`, `trusted` is per record and per host, and root is never asked.
- [x] `test/daemon.test.ts` - `--trust-token` and the `trustToken` key, and `user list` printing `trusted` or `sign-in`.
- [x] By hand: a daemon on the deployment token, on a personal token before and after `authenticate`, and with `--trust-token`. See [implemented.md](implemented.md).
- [x] `plans/index.md`, `docs/USERS.md`, `docs/DAEMON.md` and `working/HANDOFF.md` updated.
