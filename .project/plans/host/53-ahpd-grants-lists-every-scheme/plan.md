---
title: ahpd.grants lists every subject a role can name, the schemes included
domain: host
status: planned
priority: high
created: 2026-10-04
revalidated: 2026-10-04
requires:
  - plans/host/46-built-in-surfaces-are-advertised-for-role-control/plan.md
changes: []
creates: []
decisions:
  - decisions/a-grant-names-an-operation-and-read-and-write-are-its-groups.md
refs:
  - "[code://packages/sdk/src/host/root.ts#L173-L202](../../../../packages/sdk/src/host/root.ts#L173-L202) - `advertisedSchemes`, each registered scheme's `describe()`, root and the operations its provider implements"
  - "[code://packages/sdk/src/host/root.ts#L215-L234](../../../../packages/sdk/src/host/root.ts#L215-L234) - `advertisedGrants`, read off `OPERATIONS` only, so the eight built-in subjects and no scheme"
  - "[code://packages/sdk/src/users.ts#L76](../../../../packages/sdk/src/users.ts#L76) - `RESOURCE`, the operations and groups every subject outside the table takes"
  - "[code://packages/sdk/src/users.ts#L170-L183](../../../../packages/sdk/src/users.ts#L170-L183) - `operationsOf` and `groupOf`, which already answer a scheme from `RESOURCE`, so `user:read` covers `user:get` at the gate"
  - "[code://packages/sdk/src/host/handshake.ts#L268](../../../../packages/sdk/src/host/handshake.ts#L268) - `ahpd.grants` on `initialize`"
  - "[code://packages/sdk/src/host/root.ts#L253](../../../../packages/sdk/src/host/root.ts#L253) - `ahpd.grants` on root state"
  - "[code://packages/sdk/test/users-host.test.ts#L338-L360](../../../../packages/sdk/test/users-host.test.ts#L338-L360) - the test that reads `ahpd.grants` off the handshake"
  - "[code://docs/USERS.md#L369](../../../../docs/USERS.md#L369) - the grants table the advertisement mirrors"
  - "[code://docs/USERS.md#L517](../../../../docs/USERS.md#L517) - says a client reads a scheme's groups from `ahpd.grants.file`"
  - "[code://docs/PLUGINS.md#L308](../../../../docs/PLUGINS.md#L308) - the same, for a plugin's scheme"
  - file:///github/ahpapp/.project/plans/people/01-people-live-on-a-host-screen/plan.md - the role editor that reads this key
---

## Goal

A client building a role editor reads one key, `_meta['ahpd.grants']`, and finds every subject a role can name: the host's own eight and every resource scheme this host serves, `user`, `team`, `project`, `role`, `policy`, `usage` and a plugin's own, each with its title, its operations and its read and write groups.

## Reconnaissance

The files read and the patterns to reuse are the `refs` above, each with its note.

### Searches performed

- `rg -n "ahpd.grants" packages docs` - built in `advertisedGrants`, sent from `handshake.ts` and `root.ts`, read by four test files and named in `USERS.md`, `PLUGINS.md` and `COMPUTER.md`.
- `rg -n "operationsOf|groupOf|RESOURCE" packages/sdk/src/users.ts` - a scheme outside `OPERATIONS` already takes `RESOURCE`'s groups at the gate.

### Runtime path

```
resourceProviders (users directory, plugins) -> advertisedGrants -> initialize _meta / root state _meta -> ahpapp role editor
```

### Gaps

- `ahpd.grants` holds the eight subjects of `OPERATIONS` only; the schemes are in `ahpd.resourceProviders`, with operations and no groups, and only when a provider is registered.

## Decisions locked in

| # | Decision | Rationale / source |
| --- | --- | --- |
| 1 | [A grant names an operation, and read and write are its groups](../../../decisions/a-grant-names-an-operation-and-read-and-write-are-its-groups.md) | a scheme's groups are `RESOURCE`'s |

| What | Source | Task |
| --- | --- | --- |
| `ahpd.grants` also lists every registered resource scheme, so a role editor reads one key | Softov, 2026-10-04, asked "Should `ahpd.grants` also list the resource schemes (user, team, project, role, membership, policy, and plugin schemes), so a role editor reads one key?" | 01 |
| A scheme's entry carries the `title` and `description` its provider's `describe()` gives, else the scheme name; `operations` are the ones `ahpd.resourceProviders` advertises for it; `groups` are `RESOURCE`'s, kept to those operations | (defaulted: one shape for every entry, and the gate's own groups) | 01 |
| A description is passed through as `OPERATIONS` or the provider's `describe()` wrote it, with the two sentences the `chat` and `file` entries used to append removed; a client shows these to a person, so each is one short plain sentence about the subject and nothing about groups, history or how the host works | Softov, 2026-10-04, asked "descriptions in ahpd.grants are shown to people in a UI, so they are one short plain sentence about what the subject is. Remove the sentences appended to the chat and file descriptions and pass every description through as it is." | 01 |
| A built-in subject wins over a scheme of the same name, so `file` keeps its table entry | (defaulted: the gate answers `file` from `OPERATIONS`) | 01 |
| `ahpd.resourceProviders` stays as it is, for a scheme's root and what its provider says of itself | (defaulted: nothing that reads it today changes) | 01 |
| The docs say a client reads every subject from `ahpd.grants`, and drop "read a scheme's groups from `ahpd.grants.file`" | follows row 1 | 02 |

## Proposed architecture

- **Data flow** - `advertisedGrants` merges `OPERATIONS` with one entry per `options.resourceProviders` scheme the table does not hold.
- **Event flow** - none; both `_meta` blocks already call `advertisedGrants`.
- **State flow** - computed per call, so a scheme a plugin registers is listed on the next handshake and root state.
- **Layer responsibilities** - sdk: the merge and its tests · docs: `USERS.md`, `PLUGINS.md`.
- **Source-of-truth files** - [`code://packages/sdk/src/host/root.ts`](../../../../packages/sdk/src/host/root.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - ahpd.grants holds every scheme](task-01-ahpd-grants-holds-every-scheme.md) | implemented | - |
| [02 - The docs read one key](task-02-the-docs-read-one-key.md) | implemented | 01 |

## Risks and tradeoffs

- Tests that compare a whole `_meta` now see a key that varies with the providers registered - they already strip `ahpd.grants`, and the handshake test asserts the schemes it registers.
- A scheme and a built-in subject sharing a name would be listed once; only `file` does today.

## Resume state

- **Done so far:** tasks 01 and 02, implemented 2026-10-04 and uncommitted in `build/agents/9e279e09`: `schemeOperations` at module scope in `root.ts` with `advertisedSchemes` and the new `schemeGrants` both reading it, `advertisedGrants` the eight of `OPERATIONS` plus one entry per registered scheme, and the descriptions passed through with the `chat` and `file` suffixes removed.
- **Next action:** Softov's review, which moves the tasks from `implemented` to `done` and updates `plans/index.md`.
- **Open questions:** none.
- **Watch out for:** ahpapp's people/01 role editor reads this key; tell its session the schemes moved in once this lands. `docs/COMPUTER.md` was changed as well as the two files task 02 names, because it sent a client to the `file` entry for a scheme's groups too.

## Final verification checklist

- [x] With a users directory, `initialize` and root state carry `ahpd.grants` entries for `user`, `team`, `project`, `role` and `policy`, each with operations and groups.
- [x] A plugin's scheme (`notes:` in a fixture) is listed with the operations its provider implements.
- [x] Without any resource provider, `ahpd.grants` is the eight built-in subjects, as before.
- [x] `pnpm exec tsc --noEmit`, `pnpm boundary`, `pnpm test` pass.
- [ ] `plans/index.md` updated.

