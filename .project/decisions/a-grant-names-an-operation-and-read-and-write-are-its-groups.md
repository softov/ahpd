---
title: A grant names a subject and one of its operations, and read and write are groups of those operations
status: accepted
date: 2026-10-03
supersedes: decisions/a-grant-is-a-subject-and-a-verb.md
refs:
  - "[code://packages/sdk/src/host.ts#L171-L249](../../packages/sdk/src/host.ts#L171-L249) - `NEEDS`, one `subject:read` or `subject:write` per method"
  - "[code://packages/sdk/src/host.ts#L358-L367](../../packages/sdk/src/host.ts#L358-L367) - `ACTION_HOMES`, one grant per family of client action"
  - "[code://packages/sdk/src/users.ts#L59-L88](../../packages/sdk/src/users.ts#L59-L88) - `GRANT`, which takes only `read`, `write` or `*`, and `holds`"
  - "[code://packages/sdk/src/host.ts#L6306-L6321](../../packages/sdk/src/host.ts#L6306-L6321) - `advertisedSchemes`, a plugin scheme's operations already on the wire, named after the provider's methods"
  - file:///github/ahpapp/.project/plans/people/01-people-live-on-a-host-screen/plan.md - the role editor offers subjects it guesses, because ahpd advertises none
---

## Context

A grant is `<subject>:<verb>` with two verbs, so a role that may send a turn may also dispose of the session, and a role that may edit an automation may also run it.
A plugin's scheme is advertised with its operations (`read`, `list`, `resolve`, `write`, `delete`, ...), and the host's own subjects are advertised with nothing, so a client building a role editor has no list to offer.

## Decision

A grant is `<subject>:<operation>`.
Each built-in subject (`session`, `chat`, `terminal`, `automation`, `file`, `config`, `diagnostics`, `container`) has a fixed list of operations, and every gated method and every client-dispatchable action needs one of them.
`read` and `write` are groups of a subject's operations, so `session:write` still covers everything it covered, and every existing role means what it meant.
`read` and `write` are only ever group names, on every subject: no subject has an operation of either name.
A resource subject (`file`, the people schemes, a plugin's scheme) has the operations `get`, `list`, `resolve` and `watch` in `read`, and `put`, `delete`, `mkdir`, `move`, `copy` and `request` in `write`, where `get` is `resourceRead` and `put` is `resourceWrite`.
`ahpd.resourceProviders` advertises a scheme's operations in the same words, so an advertised operation is the operation a role grants.
A chat lives in a session, so `session:read` and `session:write` also cover `chat`'s groups of the same name, which is what they covered before chats had a subject.
`*` still stands in either position.
The subjects, their operations and their groups are advertised to clients.

Source: Softov, 2026-10-03, asked "how are the built-in AHP surfaces (sessions, chats, terminals, automations, files, config) advertised for role control?": "Per-operation grants".
`chat` as a subject of its own, and the session groups covering it, is `(defaulted: the question names chats beside sessions)`.
`get` and `put` in place of a one-resource `read` and `write`: Softov, 2026-10-03, asked "`user:read` would mean both the whole read group and only "read one record". Rename the one-record operation so read/write only ever mean the groups?": "Rename to get".

## Consequences

A role can let somebody send turns and not dispose of sessions, or edit automations and not run them.
The gate reads a table from method or action to operation instead of a table to a verb, and a test fails when a method or a protocol action has no row.
A client draws a role editor from the advertisement rather than from a list it keeps.
Two spellings now reach one operation, the operation and its group; that is the price of keeping every existing role.
A grant never has to be read in context to know whether it names a group: `user:read` is always the group, and `user:get` reads one record.
`ahpd.resourceProviders` changes `read` and `write` to `get` and `put` in its `operations`, which a client reading it must follow.

## Options

- **Keep `read` and `write` only, and advertise the subjects**: a role editor gets its list, and still cannot say "send but not dispose".
- **Operations only, rewrite every role**: no groups, and every `users` file breaks on upgrade.
- **Keep `read` and `write` as one-resource operations inside groups of the same name**: `user:read` would mean the group in a role and one operation in the advertisement.
- **Grant by method name**: rejected again for the reason the replaced decision gave, a renamed handler would move who may call it.
