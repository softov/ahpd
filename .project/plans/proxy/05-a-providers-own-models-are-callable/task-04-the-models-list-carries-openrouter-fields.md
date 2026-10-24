---
title: The models list carries OpenRouter's fields
status: implemented
depends: [task-03-a-fetched-model-is-callable.md]
layer: "server"
refs:
  - "[code://packages/server/src/proxy/dialects.ts#L328](../../../../packages/server/src/proxy/dialects.ts#L328) - `modelList`, which sends the names and their fields"
  - "[code://packages/server/src/proxy/listener.ts#L727-L791](../../../../packages/server/src/proxy/listener.ts#L727-L791) - the models handler"
  - https://openrouter.ai/docs/api-reference/list-available-models - `name`, `context_length`, `pricing` and `total_count`
---

## Objective

`GET /models` lists the table's names and the fetched names that a caller may use.
Each model carries `name`, `context_length` and `pricing` when they are known, and the list carries `total_count`.

## Files

- `UPDATE: packages/server/src/proxy/dialects.ts` - `modelList` takes models with their fields, and adds `total_count`.
- `UPDATE: packages/server/src/proxy/listener.ts` - the models handler adds the fetched names and the fields of each name.
- `UPDATE: packages/server/test/proxy-listener.test.ts` - the fields, the file price, the fetched names and the policy filter.

## Steps

1. Make `modelList` take `{ id, name?, context_length?, pricing? }` for each model.
2. Add the three fields to each entry of both shapes, and leave out a field that is not known.
3. Add `total_count` at the top of both shapes.
4. For a table name, take the fields of its first entry's first usable connector, from that connector's list.
5. Write a file price as `pricing`, divided by one million and written as a string.
6. Let the file price win over the fetched `pricing`.
7. Add each fetched name of each connector the caller may use, as `<prefix>/<id>`.
8. List a fetched name once, from the first tier that serves it, and leave out a name the table holds.
9. Leave out each name that the caller's policy refuses.
10. Test the fields on a table name, a file price that wins, fetched names, and a policy that removes some.

## Validation

- `proxy-listener.test.ts` passes.
- The gate passes: `pnpm -s typecheck && pnpm -s build && pnpm -s boundary && pnpm -s test`.

## Resume

- **Done so far:** `modelList` takes the models, and writes `name`, `context_length` and `pricing` on each entry of both shapes when known. It adds `total_count` at the top. The models handler lists the table's names in the file's order. Then it adds each model the catalog holds as `<prefix>/<id>`, sorted and once. A name the table holds is never added again. A name is listed from its first candidate, so its fields come from the first connector the call would go to. A price in the file wins, divided by one million into a string. A name a policy refuses is left out for that caller. `proxy-listener.test.ts` covers the fields, the file price, a fetched name listed once, the policy filter and the Anthropic shape.
- **Next action:** none for this task.
- **Open questions:** none.
- **Watch out for:** the file price is written with `perToken`, which never uses exponent form, so `5` per million is `"0.000005"`.