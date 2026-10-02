---
title: The policy: scheme and the policy grant
status: done
depends: [task-01-the-policy-row-and-the-policies-port.md]
layer: "sdk"
refs:
  - "[code://packages/sdk/src/people.ts](../../../../packages/sdk/src/people.ts) - `peopleProviders`, the four schemes a client lists and edits, which this one is written as"
  - "[code://packages/sdk/src/users.ts#L40-L46](../../../../packages/sdk/src/users.ts#L40-L46) - `SUBJECTS`, where `policy` joins as a grant subject"
  - "[code://packages/sdk/src/host.ts#L6865-L6886](../../../../packages/sdk/src/host.ts#L6865-L6886) - `capabilityFor`, which asks for `<scheme>:<verb>` from the URI, so `policy:read` and `policy:write` need nothing here"
  - "[code://packages/sdk/src/host.ts#L5733-L5748](../../../../packages/sdk/src/host.ts#L5733-L5748) - `advertisedSchemes`, where a scheme is announced on the handshake with what it implements"
  - "[code://packages/sdk/src/types/resources.ts](../../../../packages/sdk/src/types/resources.ts) - `ResourceProvider` and `SchemeDescription`, the interface the four providers narrow"
  - "code://packages/sdk/src/policies.ts - the `Policies` port and its validation, written by task 01, which this scheme is another door onto"
  - "[code://docs/USERS.md#L354-L398](../../../../docs/USERS.md#L354-L398) - the subject and verb table, where `policy` is a row"
  - "[code://docs/USERS.md#L439-L474](../../../../docs/USERS.md#L439-L474) - \"People as resources\", the section that says how a scheme of this host's own behaves"
  - "file:///github/ahp-review/prospect/ahp-user-rules.md - the row a client writes, and the store `policies.json` holds"
---

## Objective

A client edits policies the way it edits people: the host serves `policy:` as a resource scheme over the `Policies` port, and the grant for it is `policy:read` to list and read and `policy:write` to write and remove, both of the same form the four people schemes use.
Nothing in this task decides anything: a policy written here is stored and read back, and the switch that makes any of it bind is task 04.

## Files

- `CREATE: packages/sdk/src/policy.ts` - `policyProviders(store: Policies): Record<string, PolicyProvider>`, written as `peopleProviders` is: one `Records` seam over the port, the same `split` and `absent` and the same `list` / `resolve` / `read` / `write` / `remove`, with the scheme's own `title`, `description` and `manifest` so a client can draw the screen before it has asked for anything. The name is the pair `users.ts` and `people.ts` make, with `policies.ts` and `policy.ts` beside them.
- `UPDATE: packages/sdk/src/users.ts:40-46` - `'policy'` in `SUBJECTS`, beside `user`, `team`, `project` and `role`.
- `UPDATE: packages/sdk/src/index.ts:53-67` - `policyProviders` and the `PolicyProvider` type.
- `UPDATE: docs/USERS.md:363-375` - the `policy` row of the subject and verb table; `UPDATE: docs/USERS.md:439-474` - a short section beside \"People as resources\" saying that `policy://<id>` is one row and what its body carries.

## Steps

1. Write `policy.ts` in the shape `people.ts` uses, not a new shape: `SCHEMES = ['policy'] as const`, a `PolicyProvider` interface narrowing `ResourceProvider` to the members all of these have, a `Records` seam whose `ids`, `find`, `put` and `drop` are the four `Policies` calls, and a `providerFor` whose `split` takes `policy://<id>` and refuses anything else with `-32609`. The people file carries a `Records` seam because one `Users` port serves four different records; a `Policies` port serves one kind, so keep `Records` and the provider as they are and let the seam be the port, without inventing a second layer of indirection.
2. Answer `list('policy://')` with one `Entry` per row in the order the store lists them, and refuse a listing of anything under a record. `resolve` answers the root as a directory and a row as a file whose `size` is the body that would be written, with no etag, as `people.ts` says why.
3. Answer `read` with the row as indented JSON and `contentType: 'application/json'`. Answer `write` on `policy://<id>` by handing the body to `checkPolicy` and the row it answers to `put`, so a body the port would refuse is refused here with the same sentence, and honour `createOnly` as the people providers do. Answer `remove` with `drop`, refusing an id nothing holds with `-32008`.
4. Refuse `write` to `policy://` and to anything under a record, with the sentences `people.ts` uses for a record written whole: a policy is one record, and the plan's second table settles what it holds.
5. Write the manifest as the four do: `type: 'object'` with a `properties` entry per field of the row, each a line of text (`scope`, `kind`, `effect`, `from`, `until`, and the optional `pool`) or a list (`match` as a list per value type, `limits` as a list of objects), and the id named in the description because the URI is the id. A client that reads a row and writes the same body back must not have changed it, so a field the body omits is the one the row already had.
6. Add `'policy'` to `SUBJECTS` and nothing else in the host: `capabilityFor` reads the grant out of the URI's scheme, so `policy://` asks for `policy:read` and `policy:write` on its own, and `ownRecord` stays a `user:` exception.
7. Export from `index.ts`. The daemon passes `policyProviders(policies)` under `resourceProviders` in task 04, beside the store and the switch; nothing serves the scheme until then.

## Validation

- `CREATE: packages/sdk/test/policy-scheme.test.ts`, written as `packages/sdk/test/people.test.ts` is: the root lists every row and nothing under a record; a read answers the row as JSON; a write makes a row and a second write edits it; a body naming no `match` keeps the one the row had; a body that is not a row is refused with `-32602`; a write with `createOnly` onto an id that is there is refused with `-32010`; a removal takes the row out and a second removal is `-32008`; a URI in another scheme's name is `-32609`.
- The same file, on a host: `policy` is advertised on the handshake under `ahpd.resourceProviders` with its operations, and a role holding `policy:read` alone may list and read and is refused `-32009` on a write, with nothing written; a role holding neither is refused on both. That is `people.test.ts`'s "asks each scheme for the subject that is its name", with `policy` in the list.
- `pnpm exec vitest run packages/sdk/test/policy-scheme.test.ts packages/sdk/test/people.test.ts`
- `pnpm typecheck`, `pnpm boundary`
- By hand: `pnpm exec vitest run packages/sdk/test/users-gate.test.ts` still passes, which is the test that a method is in `NEEDS` or `UNGATED`, and the subject list is the only list a plugin reads for what a role may hold.
