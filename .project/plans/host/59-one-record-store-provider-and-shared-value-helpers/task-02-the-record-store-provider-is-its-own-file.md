---
title: The record-store provider is its own file, and people uses it
status: done
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

`packages/sdk/src/records.ts` holds `RecordsProvider` (people's `PeopleProvider`, which people now aliases), `Records` with `put(id, body, was?)`, `At`, `splitResource`, `absentResource`, `asFile`, `bodyText`, `jsonBody` and `EPOCH`, and `recordsProvider(scheme, records)`, which is people's `providerFor` moved word for word with `what` renamed `scheme`. `packages/sdk/test/records.test.ts` is the new file's cases (8): the split's four shapes and its two refusals, `jsonBody` for an object, an empty body, a base64 body, a list and `nope`, and `asFile`'s shape.

`people.ts` is 248 lines: the four `Records` (`people`, `named`, `roles`), `textOf`, `listOf`, `said`, `line`, `lines` and `SCHEMES` stay, and `peopleProviders` maps each scheme through `recordsFor(directory, what)` into `recordsProvider`. `PeopleProvider` is now `export type PeopleProvider = RecordsProvider`. Gone from the file: the old `Records` interface, `PeopleProvider`'s member list, `bodyOf`, `asFile`, `moment`, `At` and `providerFor`, and with them the `types/resources.js` import. `index.ts` exports `absentResource`, `asFile`, `bodyText` and `splitResource` beside the value readers; `Records` and `recordsProvider` stay unexported, as the task says.

Two things worth knowing for the tasks after this one:

- `splitResource` reads the query out of every URI, so a `user://ana?x=1` that used to be an id of `ana?x=1` and answered `-32008` now reads the record `ana` and ignores what it asked. No test covers that URI and step 2 asks for the query to be split out, so it is the step's decision rather than a silence; people and policy read nothing from `query`.
- `write` reads the row once into `was`, checks `createOnly` against it and hands it to `put`. People's three `Records` still read the row again inside their own `put`, which is what they did before - the third argument is for policy, which merges the row it is handed.

Gates: `pnpm exec tsc -p packages/sdk --noEmit` clean, `npx vitest run packages/sdk --maxWorkers=2 --testTimeout=10000` 124 files and 2421 tests passed, `people.test.ts` unchanged and green, every sentence included.
