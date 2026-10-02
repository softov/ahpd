---
title: A policy row, checked on the way in, and the policies port
status: todo
depends: []
layer: "sdk"
refs:
  - "[code://packages/sdk/src/usage.ts](../../../../packages/sdk/src/usage.ts) - `fileUsage`, the file store in the config folder this one is written beside"
  - "[code://packages/sdk/src/automations.ts](../../../../packages/sdk/src/automations.ts) - `memoryAutomations`, the in-memory store this one is the shape of"
  - "[code://packages/sdk/src/scheduled.ts#L179-L205](../../../../packages/sdk/src/scheduled.ts#L179-L205) - `save`, the write-beside-and-rename a file store here uses"
  - "[code://packages/sdk/src/types/usage.ts](../../../../packages/sdk/src/types/usage.ts) - the `Usage` port, whose shape the `Policies` port follows"
  - "[code://packages/sdk/src/types/host.ts#L209-L225](../../../../packages/sdk/src/types/host.ts#L209-L225) - `usage` and `usagePer` in `HostOptions`, beside which `policies` is added"
  - "[code://packages/sdk/src/types/plugin.ts#L31-L44](../../../../packages/sdk/src/types/plugin.ts#L31-L44) - `PortKey`, the closed set of `set` registrations"
  - "[code://packages/sdk/src/types/plugin.ts#L232-L239](../../../../packages/sdk/src/types/plugin.ts#L232-L239) - `registerUsage`, the declaration `registerPolicies` is written beside"
  - "[code://packages/sdk/src/plugins.ts#L30-L33](../../../../packages/sdk/src/plugins.ts#L30-L33) - `PORT_KEYS`, the runtime half of the same union"
  - "[code://packages/sdk/src/plugins.ts#L373-L395](../../../../packages/sdk/src/plugins.ts#L373-L395) - the `register*` methods of `pluginHost`"
  - "[code://packages/sdk/src/validate.ts#L126-L166](../../../../packages/sdk/src/validate.ts#L126-L166) - `PORT_MEMBERS` and `PORT_METHOD`, the tables that must name the new key"
  - "[code://packages/sdk/src/index.ts#L53-L67](../../../../packages/sdk/src/index.ts#L53-L67) - where `fileUsage` and `peopleProviders` are exported"
  - "[code://packages/sdk/src/types/index.ts](../../../../packages/sdk/src/types/index.ts) - the type barrel `index.ts` re-exports with `export type *`"
  - "[code://docs/PLUGINS.md#L87](../../../../docs/PLUGINS.md#L87) - the registration table a client reads before writing a plugin"
  - "file:///github/ahp-review/prospect/ahp-user-rules.md - the row shape, the measures by kind and the limits this task validates and stores"
---

## Objective

`@ahpd/sdk` exports the policy row, a validation that refuses a row the rules draft would not recognise, and a `Policies` port with two implementations: `filePolicies`, which keeps every row in one `policies.json`, and `memoryPolicies`, which holds them for the life of the process.
A row written through the port comes back exactly as it was written, and nothing here decides anything: `HostOptions` carries the port, `registerPolicies` contributes it, and no code in this task reads a row to allow or refuse a call.

## Files

- `CREATE: packages/sdk/src/types/policies.ts` - `PolicyKind` (`model`, `agent`, `computer`), `PolicyEffect` (`allow`, `deny`), `PolicyScope` (`all`, `user:<id>`, `team:<id>`, `project:<team>:<project>`), `PolicyMatch` (one list per value type: `model`, `proxy`, `agent`, `computer`), `PolicyLimit` (`amount`, `measure`, `period`, `pool`), `Policy` (the row: `id`, `scope`, `kind`, `effect`, `match`, `limits`, optional `pool` and `cap`, `from`, `until`), `Measure`, `Period` and the `Policies` port (`list`, `get`, `put`, `remove`).
- `CREATE: packages/sdk/src/policies.ts` - `filePolicies(options)`, `memoryPolicies()` and the validation both use, exported so the scheme and `decide` can name a row they were handed rather than a body.
- `UPDATE: packages/sdk/src/types/host.ts:209-225` - `policies?: Policies` in `HostOptions`, beside `usage` and `usagePer`.
- `UPDATE: packages/sdk/src/types/plugin.ts:31-44`, `packages/sdk/src/plugins.ts:30-33`, `packages/sdk/src/validate.ts:126-166` - `'policies'` in `PortKey`, in `PORT_KEYS`, and in `PORT_MEMBERS` and `PORT_METHOD`; the last two are `Record<PortKey, ...>`, so nothing compiles until the key is in them.
- `UPDATE: packages/sdk/src/types/plugin.ts:232-239`, `packages/sdk/src/plugins.ts:395` - `registerPolicies(policies, when?)` beside `registerUsage`.
- `UPDATE: packages/sdk/src/index.ts:53-67` - `filePolicies`, `memoryPolicies` and the check; `UPDATE: packages/sdk/src/types/index.ts` - the row types and `Policies`, which reach the surface through the barrel's `export type *`.
- `UPDATE: docs/PLUGINS.md:87` - the `registerPolicies` row of the registration table, and a short section on what a plugin's store has to answer.

## Steps

1. Write `types/policies.ts` as the row the plan's second table names, with `match` as one list per value type rather than a list of strings: the plan settles that values of one type are alternatives and values of different types must all hold, and a record of lists is what says that without a reader parsing prefixes. `limits` is a list of `{ amount, measure, period, pool }` as the plan's second table spells it, and a limit's `pool` is `shared` or `each` while the row's own `pool` is the name rows share a total under. Say that in the file's header, because the two are different things under one word.
2. Write the `Policies` port as `Usage` is written: promises, a `list` that answers every row, and a `get`, `put` and `remove` by id. An id is unique across the store, not per scope, because `policy://<id>` is one address (task 02).
3. Write the validation in `policies.ts` as `checkPolicy(body)`, answering the `Policy` it holds or throwing an `RpcError(-32602)` naming what is wrong, the way `people.ts` refuses a body. Both stores call it, and task 02's scheme calls it before the port does. It checks, for the row the plan's second table names: a non-empty `id`; a `scope` that is `all` or has the prefix its form requires, and a `project:` scope with a team and a project on either side of the second colon; a `kind` of the three; an `effect` of the two; a `match` that names no unknown type and takes only the types its kind takes (`model` rows `model` and `proxy`, `agent` rows `agent`, `model` and `computer`, `computer` rows `computer`); every limit's `measure` against the measures of the kind, its `period` against `day`, `week`, `month` and `total`, and its `amount` as a finite number that is not negative; and `from` before `until` where both are named. It stores `pool` and `cap` as written and does not read them, since enforcing a limit is policy/02.
4. Accept a `from` or `until` only as an ISO 8601 instant or a bare `YYYY-MM-DD` day, and store a bare `from` as the start of that day in UTC and a bare `until` as the end of it, so the window a check reads is the one a person wrote and the two spellings cannot disagree. The end of the day for `until` is the last open question in the plan's Resume state and this step depends on it: written the other way, a window written `until: 2026-10-31` would stop at midnight and the last day it names would be the one it does not apply.
5. Write `filePolicies({ file, onProblem })` over the pattern `fileUsage` follows and the shape `scheduled.ts` writes: the file holds `{ version: 1, policies: [...] }`, a write goes to a temporary beside the file and is renamed into place, and a file that is missing is a first run. Read once at construction, and validate each row as it is read, reporting a row that is not one and keeping the rest, so one bad line does not lose every other policy. Refuse a `put` whose id is already held by a different row.
6. Write `memoryPolicies()` over the same port and the same validation, as `memoryAutomations` is a half store that happens to hold everything: `memoryPolicies` is the whole store, and it goes when the process does. Both stores are one function over one `held` map, so a case holds for both.
7. Add `policies` to `PortKey`, `PORT_KEYS`, `PORT_MEMBERS` (every member a function) and `PORT_METHOD` (`registerPolicies`), and write `registerPolicies` in `pluginHost` as `setPort('policies', 'registerPolicies', policies, when)`, beside `registerUsage`.
8. Export from `index.ts` and the type barrel. Do not register the store with the daemon here: the daemon gives the port a file store in task 04, beside the switch that decides whether anything is read from it.

## Validation

- `CREATE: packages/sdk/test/policies.test.ts`, holding the row and the two stores: a row of each kind is accepted exactly as the plan's second table writes it, `limits` and all, and read back from a reopened file store unchanged; a body that is not a JSON object, or a JSON object that is not a row, is refused with `-32602` naming the field; a `model` row with an `agent:` value, an `agent` row with a `proxy:` value, a `computer` row with a `model:` value, a `limit` whose measure is not of the kind (`hours` on a `model` row, `usd` on a `computer` row), an unknown period, a negative amount, a `from` after its `until` and an empty `id` are each refused and named; two rows may not share an id; a `policies.json` holding one row that is not a policy is reported through `onProblem` and its other rows are kept; the memory store answers the same cases and holds nothing on disk.
- `packages/sdk/test/plugin-fold.test.ts`, extended: a plugin contributing `policies` is folded like every other port, and `registerPolicies(..., 'replace')` takes the daemon's over.
- `pnpm exec vitest run packages/sdk/test/policies.test.ts packages/sdk/test/plugin-fold.test.ts`
- `pnpm typecheck`, `pnpm boundary`
- By hand: nothing in this task refuses a session or a turn. A host built with the port and no check reads it and nothing else.

## Resume

Nothing done yet.
