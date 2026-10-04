---
title: The host's own surfaces are advertised with their operations, and a role grants an operation
domain: host
status: planned
priority: medium
created: 2026-10-03
revalidated: 2026-10-04
requires:
  - plans/host/44-ahpd-speaks-ahp-1-0-0-p1-ahpd-speaks-1-0-0-and-0-9-0/plan.md
  - plans/host/11-a-grant-is-a-subject-and-a-verb/plan.md
  - plans/host/36-people-are-resources-a-client-manages/plan.md
decisions:
  - decisions/a-grant-names-an-operation-and-read-and-write-are-its-groups.md
refs:
  - "[code://packages/sdk/src/host/gate.ts#L22-L96](../../../../packages/sdk/src/host/gate.ts#L22-L96) - `NEEDS`, method to `subject:read|write`"
  - "[code://packages/sdk/src/host/gate.ts#L108-L131](../../../../packages/sdk/src/host/gate.ts#L108-L131) - `UNGATED`, the handshake, `authenticate`, `subscribe`, `dispatchAction`"
  - "[code://packages/sdk/src/host/gate.ts#L159-L169](../../../../packages/sdk/src/host/gate.ts#L159-L169) - `dispatchNeeds`, a dispatch's grant by channel"
  - "[code://packages/sdk/src/host/gate.ts#L232-L242](../../../../packages/sdk/src/host/gate.ts#L232-L242) - `ACTION_HOMES`, one grant per action family"
  - "[code://packages/sdk/src/host/admission.ts#L35-L104](../../../../packages/sdk/src/host/admission.ts#L35-L104) - `capabilityFor`: `subscribe` by channel, `completions`, `invokeChangesetOperation`, and a resource method's scheme"
  - "[code://packages/sdk/src/host/actions.ts#L100-L125](../../../../packages/sdk/src/host/actions.ts#L100-L125) - the dispatch gate, which asks the strictest of the channel's and the family's grants"
  - "[code://packages/sdk/src/host/root.ts#L171-L186](../../../../packages/sdk/src/host/root.ts#L171-L186) - `advertisedSchemes`, the pattern the new advertisement copies, and its `operations` list named after the provider's methods (`read`, `write`)"
  - "[code://packages/sdk/src/host/root.ts#L204](../../../../packages/sdk/src/host/root.ts#L204) - `ahpd.resourceProviders` in root state `_meta`"
  - "[code://packages/sdk/src/host/handshake.ts#L262](../../../../packages/sdk/src/host/handshake.ts#L262) - `ahpd.resourceProviders` in `initialize`'s `_meta`"
  - "[code://packages/sdk/src/users.ts#L24-L88](../../../../packages/sdk/src/users.ts#L24-L88) - the built-in roles, `SUBJECTS`, `GRANT`, `LEGACY` and `holds`"
  - "[code://packages/sdk/src/types/users.ts#L21-L37](../../../../packages/sdk/src/types/users.ts#L21-L37) - `Verb` and `Grant`"
  - "[code://packages/sdk/src/people.ts#L236-L268](../../../../packages/sdk/src/people.ts#L236-L268) - the `role:` scheme, which writes a role's grants"
  - "[code://packages/server/src/commands/user.ts#L34-L41](../../../../packages/server/src/commands/user.ts#L34-L41) - `bounded`, which lets a person hand out only grants they hold"
  - "[code://packages/sdk/test/users-gate.test.ts#L140-L168](../../../../packages/sdk/test/users-gate.test.ts#L140-L168) - the staleness test: every served method is in `NEEDS` or `UNGATED`"
  - "[code://docs/USERS.md#L356-L401](../../../../docs/USERS.md#L356-L401) - the grants table a person reads"
  - file:///github/ahpapp/.project/plans/people/01-people-live-on-a-host-screen/plan.md - row "A role's grants are edited as subject plus read, write or `*` ... (defaulted: ahpd does not advertise its subject list)", the reader of this advertisement
  - npm://@microsoft/agent-host-protocol@1.0.0 - `CommandMap` (`src/types/common/messages.ts:162-194`, `moveChat` new) and `IS_CLIENT_DISPATCHABLE` (`src/types/action-origin.generated.ts:462`, 47 client actions, `chat/isReadChanged` new)
---

## Goal

A role can say what somebody may do one operation at a time: send a turn and not dispose of the session, edit an automation and not run it, type into a terminal and not open one.
The host advertises its own subjects with their operations, the way it already advertises a plugin's schemes, so a client can draw a role editor from what the host says.
Every role written today keeps its meaning.

## Reconnaissance

The files read and the patterns to reuse are the `refs` above, each with its note.

### Searches performed

- `rg -n "'[a-z]+:(read|write)'" packages/sdk/src packages/server/src` - grants are asked in `NEEDS`, `ACTION_HOMES`, `dispatchNeeds`, `capabilityFor`, `seesConfig`, `usage.ts`, and the server commands' `scopes` and `bounded`.
- Live, 2026-10-03: `_meta['ahpd.resourceProviders']` lists `user`, `team`, `project`, `role`, `policy`, `usage` with `read`, `list`, `resolve`, and `computer` with `write` and `delete` as well; nothing lists `session`, `chat`, `terminal`, `automation`, `file`, `config`, `diagnostics` or `container`.
- `rg -n "resourceProviders|grants" /github/ahpapp/src` - ahpapp reads `ahpd.resourceProviders` (`src/computers.ts:18`) and has no role editor yet; its people/01 plan offers subjects it guesses.
- `IS_CLIENT_DISPATCHABLE` in the 1.0.0 package - 47 actions a client may dispatch.

### Runtime path

```
request -> capabilityFor(method, params) -> Grant[] -> principal.can(grant) -> holds(roles' grants, grant)
dispatchAction -> ACTION_HOMES[family].needs + dispatchNeeds(channel) -> principal.can
initialize / root state -> _meta['ahpd.resourceProviders'] (schemes only)
```

### Gaps

- `Verb` is `read | write`, so no grant can name less than a whole half of a subject.
- No advertisement of the host's own subjects.
- `Not found: a table from client action to grant finer than its family - searched "ACTION_HOMES|dispatchNeeds" in packages/sdk/src/host.`

## Decisions locked in

| Decision | Source |
| --- | --- |
| [A grant names a subject and one of its operations, and read and write are groups of those operations](../../../decisions/a-grant-names-an-operation-and-read-and-write-are-its-groups.md) | Softov, 2026-10-03, "Per-operation grants" |

| What | Source | Task |
| --- | --- | --- |
| Each built-in subject is advertised with its operations; a role grants `subject:operation`; `read` and `write` stay as groups so existing roles keep working | Softov, 2026-10-03, asked "how are the built-in AHP surfaces (sessions, chats, terminals, automations, files, config) advertised for role control?": "Per-operation grants" | 01, 02, 03 |
| `chat` is a subject of its own, and `session:read`/`session:write` cover `chat:read`/`chat:write` | (defaulted: Softov's question names chats beside sessions, and the cover keeps every role that wrote `session:write` able to send turns) | 01 |
| Every gated method and every client-dispatchable action needs one operation, from the table in task 02 | the request, 2026-10-03 | 02 |
| The subjects, operations and groups are one table in `users.ts`, which the gate, the grant check and the advertisement all read | (defaulted: three readers of one fact) | 01 |
| The advertisement is `_meta['ahpd.grants']` on `initialize` and on root state, one entry per built-in subject `{ title, description, operations, groups: { read, write } }`, built by one function beside `advertisedSchemes` | (defaulted: the mirror of `ahpd.resourceProviders`, in the same two places, built the same way) | 03 |
| A plugin scheme and the people schemes keep being advertised in `ahpd.resourceProviders`; their grants take the resource operations (`get`, `list`, `resolve`, `watch`, `put`, `delete`, `mkdir`, `move`, `copy`, `request`) with `file`'s groups | (defaulted: the same resource methods carry them, so they share `file`'s operations) | 01, 02 |
| The operation names are task 02's table as written, with the rename in the next row | Softov, 2026-10-03, approved task 02's operation table as written with one change, in answer to "Confirm the table before task 02, since a name is permanent once a role holds it" | 02 |
| `read` and `write` are only ever group names, on every subject (`file`, the people schemes, a plugin's scheme); the one-resource operations are `get` (`resourceRead`) and `put` (`resourceWrite`), and no subject has an operation named `read` or `write` | Softov, 2026-10-03, asked "`user:read` would mean both the whole read group and only "read one record". Rename the one-record operation so read/write only ever mean the groups?": "Rename to get" | 01, 02 |
| `ahpd.resourceProviders`' `operations` use the same words, `get` and `put` for a provider's `read` and `write`, so a role editor maps an advertised operation to a grant one to one; this is a client-visible rename, and ahpapp's computer screen reads `write` today | Softov, 2026-10-03, asked "`user:read` would mean both the whole read group and only "read one record". Rename the one-record operation so read/write only ever mean the groups?": "Rename to get" | 03, 04 |
| A role file holding `file:read`, `user:write` or any other group grant keeps its meaning and nothing migrates; no role can name the old one-resource `read` or `write` operation, because none existed before this plan | Softov, 2026-10-03, asked "`user:read` would mean both the whole read group and only "read one record". Rename the one-record operation so read/write only ever mean the groups?": "Rename to get" | 01 |
| Asking whether somebody holds a group is answered by the group or a wildcard, not by holding each operation in it | (defaulted: `bounded` asks about groups when a role is handed out, and the simplest answer cannot widen) | 01 |
| A role's grant on a built-in subject must name one of its operations, a group or `*`; on any other subject any operation word is taken | (defaulted: a plugin may not be loaded when the role is written) | 01 |
| The server's commands keep their group grants (`config:read`, `config:write`, `user:write`, ...) | (defaulted: they are the daemon's commands, not AHP surfaces, and a group still gates them) | 02 |

## Proposed architecture

- **Data flow** - `OPERATIONS` (users.ts) -> `holds` expands a held group or wildcard -> `NEEDS` and `ACTION_NEEDS` name operations -> the gate asks `can(subject:operation)`.
- **Event flow** - unchanged: a refusal names the operation it needed, `-32009` for a request and `rejectionReason` for a dispatch.
- **State flow** - roles in the `users` file are unchanged; a new role may hold operations.
- **Layer responsibilities** - sdk: the table, the gate, the advertisement · server: the `role:` write validation through `isGrant`, `bounded` unchanged · docs: USERS.md.
- **Source-of-truth files** - [`code://packages/sdk/src/users.ts`](../../../../packages/sdk/src/users.ts), [`code://packages/sdk/src/host/gate.ts`](../../../../packages/sdk/src/host/gate.ts), [`code://packages/sdk/src/host/admission.ts`](../../../../packages/sdk/src/host/admission.ts), [`code://packages/sdk/src/host/actions.ts`](../../../../packages/sdk/src/host/actions.ts), [`code://packages/sdk/src/host/root.ts`](../../../../packages/sdk/src/host/root.ts), [`code://packages/sdk/src/host/handshake.ts`](../../../../packages/sdk/src/host/handshake.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - Operations and their groups are one table, and a grant names either](task-01-operations-and-groups-are-one-table.md) | todo | - |
| [02 - Every gated method and client action needs one operation](task-02-every-method-and-action-needs-one-operation.md) | todo | 01 |
| [03 - The host advertises its subjects in `ahpd.grants`](task-03-the-host-advertises-its-subjects.md) | todo | 01 |
| [04 - Roles and the docs speak in operations](task-04-roles-and-docs-speak-in-operations.md) | todo | 02, 03 |

## Risks and tradeoffs

- Two spellings reach one operation (`session:create` and `session:write`); the advertisement lists the groups so a client can show which a role already covers.
- The operation names are ahpd's; AHP names none. Renaming one later breaks the roles that use it, so the names are settled before task 02 lands.
- `file:write` cannot be split from `file:delete` by a role that wants only one and still uses the group; that role names the operations instead.
- ahpapp's computer screen asks `has(entry, 'write')` of `ahpd.resourceProviders` (`/github/ahpapp/src/components/ComputerDetail.tsx:296`), so it stops offering edits against a host with task 03 until it reads `put`; Softov, 2026-10-03, asked "After the rename the list says 'put'. How do we keep it working?": "softov-c6 makes ahpapp accept put", before task 03 ships.

## Resume state

- **Done so far:** nothing.
- **Next action:** [task-01-operations-and-groups-are-one-table.md](task-01-operations-and-groups-are-one-table.md).
- **Open questions:** none.
- **Watch out for:** `subscribe` and `completions` ask for two grants today (the channel as spelt and as resolved); keep both, each now an operation. `invokeChangesetOperation` keeps its `file:write` beside `session:changes`. `ahpd.grants` is a new `_meta` key, so host/43 p1 task 04's census must list it.

## Final verification checklist

- [ ] Every role in `docs/USERS.md` and every built-in role answers the same on every method and action as before (the matrix test in task 02).
- [ ] A role holding only `chat:send` can send a turn and cannot dispose of the session.
- [ ] `initialize` and root state carry `ahpd.grants` with every built-in subject.
- [ ] No subject in `OPERATIONS` has an operation named `read` or `write`, and `ahpd.resourceProviders` lists `get` and `put` where it listed `read` and `write`.
- [ ] `pnpm exec tsc --noEmit` and `pnpm test` pass.
- [ ] `plans/index.md` updated.
