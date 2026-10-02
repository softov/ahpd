---
title: The host serves user, team, project and role as schemes
status: todo
depends: [task-01-subjects.md]
layer: "sdk"
refs:
  - "[code://packages/sdk/src/types/resources.ts#L214-L238](../../../../packages/sdk/src/types/resources.ts#L214-L238) - `SchemeDescription`, `ResourceProvider`"
  - "[code://packages/computer/src/plugin.ts#L366](../../../../packages/computer/src/plugin.ts#L366) - the `computer:` provider to mirror"
---

## Objective

`user://`, `team://`, `project://` and `role://` list, read, create, edit and remove through the users directory, each advertised with its create form.

## Files

- `CREATE: packages/sdk/src/people.ts` - `peopleProviders(users)`, one provider per scheme, each with `describe()`.
- `UPDATE: packages/sdk/src/types/users.ts` - any `Users` call a provider needs that the port lacks.
- `UPDATE: packages/server/src/commands/run.ts` - the daemon registers them when it has a users directory.

## Steps

1. `list` on a scheme's root answers one entry per record; `read` answers the record as JSON, never a token.
2. A write to the root creates from the advertised `manifest`; a write to a record's URI edits it; `remove` deletes it, refused while something names it, as the commands refuse.
3. The host checks `<scheme>:read` and `<scheme>:write` as it does any scheme grant.

## Validation

- `packages/sdk/test/people.test.ts`: each scheme listed, read, created, edited and removed; a removal of a team a membership names refused; no token in any answer.
- `packages/sdk/test/session-scope.test.ts` or a host test: the four appear in `_meta` `ahpd.resourceProviders` with their operations.

## Resume
