---
title: The record-store provider is its own file, and people uses it
status: todo
depends: [task-01-the-value-readers-are-one-sdk-module.md]
layer: "sdk"
refs:
  - "[code://packages/sdk/src/people.ts#L54-L69](../../../../packages/sdk/src/people.ts#L54-L69) - `Records`"
  - "[code://packages/sdk/src/people.ts#L88-L101](../../../../packages/sdk/src/people.ts#L88-L101) - `bodyOf`"
  - "[code://packages/sdk/src/people.ts#L120-L130](../../../../packages/sdk/src/people.ts#L120-L130) - `asFile` and `moment`"
  - "[code://packages/sdk/src/people.ts#L300-L398](../../../../packages/sdk/src/people.ts#L300-L398) - `At` and `providerFor`"
  - "[code://packages/sdk/src/people.ts#L407-L408](../../../../packages/sdk/src/people.ts#L407-L408) - `peopleProviders`, which stays"
  - "[code://packages/computer/src/manifest.ts#L535-L536](../../../../packages/computer/src/manifest.ts#L535-L536) - `bodyText`, the decoder to share"
  - "[code://packages/sdk/test/people.test.ts](../../../../packages/sdk/test/people.test.ts) - people's provider cases"
---

## Objective

`packages/sdk/src/records.ts` holds the provider over `Records` and the parts computer and usage will take, and `people.ts` holds only its four `Records` and `peopleProviders`.

## Files

- `CREATE: packages/sdk/src/records.ts` - `Records` (people's, with `put(id, body, was?)`), `recordsProvider(scheme, records)`, `splitResource(uri, scheme)`, `absentResource(scheme, uri)`, `asFile(data)`, `bodyText(content)`, `jsonBody(content, what)`, `EPOCH`.
- `CREATE: packages/sdk/test/records.test.ts` - the helper's cases.
- `UPDATE: packages/sdk/src/people.ts` - `Records`, `bodyOf`, `asFile`, `moment`, `At` and `providerFor` removed; `peopleProviders` maps each scheme to `recordsProvider(what, records)`.
- `UPDATE: packages/sdk/src/index.ts` - export `splitResource`, `absentResource`, `asFile`, `bodyText` for computer; `Records` and `recordsProvider` stay internal.

## Steps

1. Move people's `providerFor` into `recordsProvider` word for word, `what` renamed `scheme`; `PeopleProvider`'s type becomes a `RecordsProvider` alias that people re-exports.
2. `splitResource` answers `{ id, leaf, query }` or throws `-32602` with `<uri> is not a <scheme>: URI`, the code host 58 task 06 settles; `query` is the text after `?`, empty for people and policy.
3. `jsonBody(content, what)` is people's `bodyOf` over `bodyText`, its two sentences unchanged.
4. `write` reads the row already there once and passes it to `put` as `was`, after the `createOnly` check, which reads the same row.

## Validation

- `records.test.ts`, a new helper's cases: `splitResource` for `x://`, `x://a`, `x://a/b`, `x://a?q=1` and `y://a`; `jsonBody` for `''`, `'{}'`, `'[]'`, `'nope'` and a base64 body; `asFile`'s shape.
- A pure refactor: `people.test.ts` and `users-gate-*.test.ts` stay green unchanged, every sentence included.
- `pnpm exec tsc --noEmit`, `pnpm test packages/sdk`.

## Resume
