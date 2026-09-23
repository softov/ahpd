---
title: An issuer vouches for a person, and the directory still decides what they may do
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
  - decisions/an-issuer-answers-for-a-subject.md
  - decisions/the-issuer-option-takes-a-url-or-github.md
refs:
  - "[code://packages/sdk/src/users.ts#L29-L70](../../../../packages/sdk/src/users.ts#L29-L70) - `DEFAULT_RESOURCE`, `signInRecord` and `FileUserOptions`, where an issuer joins the record and the options"
  - "[code://packages/sdk/src/users.ts#L148-L175](../../../../packages/sdk/src/users.ts#L148-L175) - `verify`, which compares local hashes and is where the issuer is asked"
  - "[code://packages/sdk/src/types/users.ts#L43-L62](../../../../packages/sdk/src/types/users.ts#L43-L62) - `UserRecord`, whose `id` becomes the subject, and where `Issuer` belongs"
  - "[code://packages/sdk/src/types/users.ts#L64-L84](../../../../packages/sdk/src/types/users.ts#L64-L84) - `Principal`, unchanged by this plan"
  - "[code://packages/server/src/config.ts](../../../../packages/server/src/config.ts) - the `issuer` key and `signInIdentifier`, which the record composes with"
  - "[code://packages/server/src/main.ts#L542-L590](../../../../packages/server/src/main.ts#L542-L590) - where the directory is built and the record passed to it"
  - "[code://docs/USERS.md](../../../../docs/USERS.md) - the three ways in, which gain a fourth thing to say: where the credential came from"
  - https://www.rfc-editor.org/rfc/rfc8414 - issuer identifiers and the well-known metadata document an OpenID Connect issuer publishes
  - "[file:///github/externals/vscode/src/vs/workbench/contrib/chat/browser/agentSessions/agentHost/agentHostAuth.ts#L362-L395](file:///github/externals/vscode/src/vs/workbench/contrib/chat/browser/agentSessions/agentHost/agentHostAuth.ts#L362-L395) - the client that resolves a provider from `authorization_servers`, which is what an issuer makes work"
---

## Goal

A deployment can name an authorization server instead of minting every secret itself.
The host advertises that issuer in `authorization_servers`, a client obtains a token from it the way the protocol says, and the roles still come from the file an operator already edits.
GitHub works with no client change, an OpenID Connect issuer works where an enterprise has one, and a locally minted secret keeps working exactly as it does.

## Reconnaissance

The files read and the patterns to reuse are the `refs` above, each with its note.

### Searches performed

- `rg -n "authorization_servers" packages/sdk/src packages/server/src` - it is absent everywhere since plan 07, which is the field this plan fills.
- `rg -n "verify\(" packages/sdk/src/host.ts` - one caller, `authenticate`, which is why the issuer joins `Users.verify` and nothing else.
- `rg -n "fetch\(" packages/sdk/src` - `github.ts` already reaches the network from the SDK, so an issuer verifier is the same kind of thing in the same package.
- `rg -n "userinfo|openid-configuration" /github/externals/vscode/src` - the reference client does not consult either for agent resources; it matches installed providers, so the issuer identifier is the whole interface.

### Runtime path

```
client -> authenticate(resource, token)   -> Users.verify
                                             local hash first
                                             else Issuer.subject(token) -> a subject
                                             subject -> a record -> Principal
       -> any command                       -> the gate, on roles the file already held
```

### Gaps

- `authorization_servers` is omitted, so a client with no locally minted secret has nothing to resolve and no way in.
- There is no `Issuer` type and no verifier, and `Users.verify` has one way to answer.
- The daemon has no `issuer` key and no `--issuer` flag, so nothing can configure one.
- `Not found: a JWT verifier - searched "jwk", "jose", "id_token" in packages/; none, and this plan does not add one.`

## Decisions locked in

| # | Decision | Rationale / source |
| --- | --- | --- |
| 1 | [An issuer answers for a subject, and the directory still decides what they may do](../../../decisions/an-issuer-answers-for-a-subject.md) | `(defaulted: roles live in one file, and an issuer that returned a principal would put a second role table somewhere else.)` |
| 2 | [The issuer option names an OpenID Connect issuer by URL, with GitHub as a preset](../../../decisions/the-issuer-option-takes-a-url-or-github.md) | The user, 2026-09-23: "A issuer options seems more concise", and "the issuer its spec... need to be done". |

| What | Source | Task |
| --- | --- | --- |
| The local hash is tried first, so a minted secret is checked exactly as it was | decision 1 | 01 |
| An unreachable issuer answers "nobody" and never throws | decision 1 | 01 |
| A discovered `userinfo` endpoint must be https | decision 2 | 01 |
| Roles from issuer claims or groups are not in this plan | scope | - |
| A JWT verified locally against a key set is not in this plan | decision 2 | - |
| The record carries the issuer as `authorization_servers` and its scopes | decision 2 | 01, 02 |

## Proposed architecture

- **Data flow** - `fileUsers` gains an `issuer`. `verify(token)` compares the local hashes, and when none matched it asks `issuer.subject(token)` for a subject and looks that up as a record's `id`. The record's roles are resolved the way they always were.
- **Event flow** - unchanged. The principal is attached by `authenticate`, expires by its timer, and is raised as `auth/required` exactly as before.
- **State flow** - the advertised record gains `authorization_servers` and `scopes_supported` when an issuer is configured. OpenID Connect metadata is discovered once and cached on success.
- **Layer responsibilities** - packages/sdk: the `Issuer` type, `githubIssuer` and `oidcIssuer`, and the branch in `fileUsers.verify` · packages/server: the `issuer` key, the `--issuer` flag and the record · test/: the verifier against a fake fetch · docs: `docs/USERS.md` and `docs/DAEMON.md`.
- **Source-of-truth files** - [`code://packages/sdk/src/users.ts`](../../../../packages/sdk/src/users.ts), [`code://packages/sdk/src/types/users.ts`](../../../../packages/sdk/src/types/users.ts), [`code://packages/server/src/main.ts`](../../../../packages/server/src/main.ts).

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - An issuer answers for a subject](task-01-an-issuer-answers-for-a-subject.md) | done | - |
| [02 - The daemon names one](task-02-the-daemon-names-one.md) | done | 01 |
| [03 - The prose](task-03-the-prose.md) | done | 01, 02 |

## Risks and tradeoffs

- A token is sent to whatever `userinfo` endpoint the issuer's metadata names. The mitigation is that the endpoint must be https and the issuer is a configured value, not one taken from a request.
- An unreachable issuer is indistinguishable from a bad token to a client. The mitigation is the documented sentence and the `-32007` the protocol already has for "sign in again".
- Every sign-in attempt with no local match costs a network call. The mitigation is that it is per attempt and not per command, and a local secret short-circuits it.
- A deployment that configures an issuer while still having records with no local token should expect those people to sign in through the issuer, which is stated rather than detected.

## Resume state

- **Done so far:** all three tasks, 2026-09-23. An issuer answers for a subject, the file still holds the roles, the daemon names one with `--issuer github` or an https URL, and the record carries `authorization_servers` and `scopes_supported` when it does. See [implemented.md](implemented.md).
- **Next action:** none; the plan is built. What it set aside is in [deferred.md](deferred.md), and the protocol gap it works around is in `research/a-host-level-protected-resource.md`.
- **Open questions:**
  1. Which issuer does a deployment name first? - answered by decision 2: `github` is a preset and a URL is an OpenID Connect issuer.
  2. Does an issuer replace the local secrets? - answered by decision 1: it joins them, and the local hash is tried first, so the issuer is never asked for a minted secret.
- **Watch out for:** `verify` is also reached by the connection-token path, and the door calls it before the socket exists. The issuer therefore never answers at the door for a record with no local secret, which is a real limit rather than an oversight; it is in `deferred.md` and in `docs/USERS.md`.

## Final verification checklist

- [x] `pnpm test` green: 72 files, 929 tests, with the issuer cases.
- [x] `pnpm typecheck`, `pnpm boundary` and `pnpm build` green.
- [x] A GitHub-shaped token resolves to a record's id against a fake fetch, and an unknown subject does not.
- [x] A locally minted secret still verifies with an issuer configured, and the issuer is never asked for it.
- [x] The advertised record carries `authorization_servers` and `scopes_supported`.
- [x] By hand: a daemon with `--issuer github` advertised `https://github.com/login/oauth`, refused a token GitHub answered 401 for with `-32007`, and still served a minted secret.
- [x] `plans/index.md`, [00-host.md](../00-host.md) and `HANDOFF.md` updated.
