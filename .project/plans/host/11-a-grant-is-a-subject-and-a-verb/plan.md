---
title: A grant is a subject and a verb
domain: host
status: built
priority: high
created: 2026-09-23
revalidated: 2026-09-23
requires:
  - plans/host/06-users-and-permissions/plan.md
changes: []
creates: []
decisions:
  - decisions/a-grant-is-a-subject-and-a-verb.md
refs:
  - "[code://packages/sdk/src/types/users.ts#L21-L32](../../../../packages/sdk/src/types/users.ts#L21-L32) - `Capability` and `Grant`, replaced by the grammar"
  - "[code://packages/sdk/src/users.ts#L21-L24](../../../../packages/sdk/src/users.ts#L21-L24) - the built-ins, and `principalOf`"
  - "[code://packages/sdk/src/users.ts#L120-L175](../../../../packages/sdk/src/users.ts#L120-L175) - the file reader, where a role's grants are checked"
  - "[code://packages/sdk/src/host.ts#L137-L226](../../../../packages/sdk/src/host.ts#L137-L226) - `NEEDS`, `UNGATED` and `dispatchNeeds`"
  - "[code://packages/sdk/src/host.ts#L4621-L4637](../../../../packages/sdk/src/host.ts#L4621-L4637) - `capabilityFor`"
  - "[code://packages/server/src/main.ts#L470-L500](../../../../packages/server/src/main.ts#L470-L500) - the `user` verbs"
  - https://www.rfc-editor.org/rfc/rfc6749#section-3.3 - what OAuth says about a scope string, which is one token and no grammar
---

## Goal

Permission is a subject and a verb, so an operator can grant looking without granting doing: a person who lists sessions and automations and cannot open a file, a shell, a session or an automation. The wildcard is available in either position, `admin` is everything for real, and a role that names nothing is refused instead of quietly granting nothing.

## Reconnaissance

The files read and the patterns to reuse are the `refs` above, each with its note.

### Searches performed

- `rg -n "Capability" packages test` - two declarations, one re-export and one test; the vocabulary is contained.
- `rg -n "\\.can\\(" packages test` - two call sites in the host, both gates, and the tests that assert the matrix.
- `rg -n "Grant" packages` - `NEEDS`, `dispatchNeeds`, `capabilityFor`, the role file and `principalOf`.
- `rg -n "scopes_supported" /github/externals/agent-host-protocol/types` - one optional field on the protected-resource record, an OAuth scope list, and no authorization vocabulary anywhere in AHP.

### Runtime path

```
a command -> the gate -> capabilityFor(method, params) -> file:read or computer:write or session:read
                       -> who.can(grant) -> the role's grants, with * matched in either position
                       -> served, -32007 when nobody, -32009 with the grant's own name when refused
```

### Gaps

- Six areas with one grant each cannot say "list but do not run".
- `read` is files, so nothing can grant looking at sessions without also granting file reads.
- `admin` is not everything: no wildcard exists, so even an admin names `read:computer`.
- `ahpd user add --role typo` is accepted and grants nothing.
- `Not found: an authorization section in AHP - searched "permission", "scope", "capabilit" in the specification; the protocol leaves authorization to the host.`

## Decisions locked in

| # | Decision | Rationale / source |
| --- | --- | --- |
| 1 | [A grant is a subject and a verb](../../../decisions/a-grant-is-a-subject-and-a-verb.md) | The user, 2026-09-23: "I cannot have something like automation:write, automation:read, *:read, *:write?", then "verbs after", and "follow conventions". |

| What | Source | Task |
| --- | --- | --- |
| Verbs are `read` and `write`, and the subject is the host's area or a plugin's scheme | decision 1 | 01 |
| `*` in either position, including `*:*` | decision 1 | 01 |
| No bare tokens: `read` becomes `file:read` | decision 1 | 01, 02 |
| `admin` is `*:*`, `member` keeps working, `guest` looks | decision 1 | 01, 02 |
| `user add` defaults to `guest` and refuses an unknown role | decision 1 | 02 |
| `user list` prints the grants it resolved | scope, so the file is not the only way to know | 02 |

## Proposed architecture

- **Data flow** - a role holds a list of `<subject>:<verb>` strings. `Principal.can` matches a needed grant exactly, or through `*:*`, `*:<verb>` or `<subject>:*`. The gate asks by subject and verb, which `NEEDS` says per method and `capabilityFor` turns into a scheme for resource methods.
- **Event flow** - unchanged. A refusal is still `-32007` for nobody and `-32009` for a role, and the message names the grant that was missing.
- **State flow** - unchanged. Roles are read from the file per question, as `host/10` made them.
- **Layer responsibilities** - packages/sdk: the grammar, the matcher, the built-ins, the file reader's grant check, and the three maps in the host · packages/server: the `guest` default and the resolved grants in `user list` · docs: `docs/USERS.md` · test: the matrix and the wildcards.
- **Source-of-truth files** - [`code://packages/sdk/src/types/users.ts`](../../../../packages/sdk/src/types/users.ts), [`code://packages/sdk/src/users.ts`](../../../../packages/sdk/src/users.ts), [`code://packages/sdk/src/host.ts`](../../../../packages/sdk/src/host.ts).

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - The grammar, the matcher and the gate](task-01-the-grammar-the-matcher-and-the-gate.md) | done | - |
| [02 - The daemon and the prose](task-02-the-daemon-and-the-prose.md) | done | 01 |

## Risks and tradeoffs

- Every role is rewritten at once, and a role left in the old spelling grants nothing. The mitigation is that a malformed grant is now reported when the file is read, instead of being silently inert.
- `admin` gaining `*:*` gives it a plugin's scheme, which the scheme-scoped decision was written to prevent. The mitigation is that `file:write` still confers nothing, so the rule an operator relies on survives; only naming the wildcard reaches a scheme.
- A subject is an open string so a plugin's scheme fits, which means a typo in the subject is a grant that matches nothing rather than a refusal. The mitigation is the same report as above, plus validation of the shape.
- `terminal:read` is watching output, and `terminal:write` includes typing into it. Two grants where one area was, and a role that names only the write half cannot read the screen it types into. Deliberate, and worth the doc line.

## Resume state

- **Done so far:** both tasks, 2026-09-23. The grammar, the matcher, the three maps, the built-ins, the `guest` default, role validation and the resolved grants in `user list`. See [implemented.md](implemented.md).
- **Next action:** none; the plan is built.
- **Open questions:**
  1. Are bare `read`/`write` kept as aliases? - answered by decision 1: no, one spelling.
  2. Does a wildcard reach a plugin's scheme? - answered: yes, and naming it is the opt-in.
- **Watch out for:** the scheme-scoped derivation is now only on the file pair, so a resource method on a plugin's scheme asks for `<scheme>:read` or `<scheme>:write` and nothing else does. `NEEDS` is still the staleness-tested table, so a new handler must be added there or the suite fails.

## Final verification checklist

- [x] `pnpm test`, `pnpm typecheck`, `pnpm boundary` and `pnpm build` green.
- [x] `guest` lists sessions and automations and is refused files, a shell, running an automation and creating a session.
- [x] `member` keeps everything it had, in the new spelling.
- [x] `*:read`, `session:*` and `*:*` each do what they say, and `file:write` still confers no scheme.
- [x] An unknown role is refused by `user add`, and `user list` prints resolved grants.
- [x] `plans/index.md`, `docs/USERS.md` and `HANDOFF.md` updated.
