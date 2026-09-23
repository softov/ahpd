---
title: An issuer may be plain http on loopback
domain: host
status: built
priority: medium
created: 2026-09-23
revalidated: 2026-09-23
requires:
  - plans/host/08-an-issuer-behind-the-users-port/plan.md
changes: []
creates: []
decisions:
  - decisions/an-issuer-may-be-plain-http-on-loopback.md
refs:
  - "[code://packages/sdk/src/issuers.ts#L89-L115](../../../../packages/sdk/src/issuers.ts#L89-L115) - `isIssuerUrl` and the discovered endpoint's check"
  - "[code://packages/server/src/config.ts](../../../../packages/server/src/config.ts) - `namedIssuer`"
  - "[code://scripts/dev-issuer.mjs](../../../../scripts/dev-issuer.mjs) - the throwaway issuer this exists to make usable"
  - "[code://docs/USERS.md](../../../../docs/USERS.md) - where an operator reads how to try one"
---

## Goal

A local issuer over plain http works, because it is the case an operator actually has and nothing leaves the machine there. A remote issuer still needs TLS, and the `github` preset is unchanged.

## Reconnaissance

The files read and the patterns to reuse are the `refs` above, each with its note.

### Searches performed

- `rg -n "startsWith\\('https" packages/sdk/src packages/server/src` - two places enforced https, `namedIssuer` and the discovered `userinfo` endpoint, so both move together.
- `grep -n "issuer" docs/DAEMON.md docs/USERS.md` - the option is documented in both, and neither said what an operator should do to try one.

### Gaps

- A local issuer over http was refused at the configuration, before anything was fetched.
- A discovered `userinfo` endpoint over http was refused even on loopback.
- Nothing in the repository was an issuer, so trying the option meant standing one up first.

## Decisions locked in

| # | Decision | Rationale / source |
| --- | --- | --- |
| 1 | [An issuer may be plain http on loopback, and nowhere else](../../../decisions/an-issuer-may-be-plain-http-on-loopback.md) | The user, 2026-09-23: "how I can ran a issuer?", after asking for the loopback exception. |

| What | Source | Task |
| --- | --- | --- |
| `--resource` still requires https | decision 1 | 01 |
| A self-signed issuer is an environment matter, not an option | decision 1 | 01 |

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - Loopback over http, and an issuer to test with](task-01-loopback-over-http-and-an-issuer-to-test-with.md) | done | - |

## Risks and tradeoffs

- The loopback rule is a hole by design, and it is decided by the URL rather than by a flag, so there is nothing to leave switched on. The mitigation is that a remote http issuer is refused in two places.
- The dev issuer answers any token as its own subject. The mitigation is that it is a script under `scripts/`, documented as verifying nothing, and it binds loopback only.
- A discovered endpoint is checked again after discovery, so an issuer cannot name a remote http userinfo and get a token sent to it. That is why the check is in two places rather than one.

## Resume state

- **Done so far:** the task, 2026-09-23. Loopback is allowed over http in both places, `scripts/dev-issuer.mjs` runs a two-endpoint issuer, and the docs say how to try one. See [implemented.md](implemented.md).
- **Next action:** none; the plan is built.
- **Open questions:**
  1. Does the loopback rule cover a LAN address? - answered by decision 1: no, only `127.0.0.1`, `::1` and `localhost`.
- **Watch out for:** the check is `isIssuerUrl` in the SDK, used by the server's configuration and by `oidcIssuer`; a third caller should use it rather than re-testing the prefix.

## Final verification checklist

- [x] `pnpm test`, `pnpm typecheck` and `pnpm boundary` green.
- [x] A remote http issuer is refused by `namedIssuer`, and a discovered remote http `userinfo` is refused.
- [x] `http://127.0.0.1:9310`, `http://localhost:9310` and `http://[::1]:9310` are accepted.
- [x] By hand: `scripts/dev-issuer.mjs` plus a daemon on `--issuer http://127.0.0.1:9310`, and a `guest` signing in with the token `ana`.
- [x] `plans/index.md`, `docs/USERS.md`, `docs/DAEMON.md` and `HANDOFF.md` updated.
