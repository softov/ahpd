---
title: A collection keeps JSON records
status: done
depends: []
layer: "sdk, server"
refs:
  - "[code://packages/sdk/src/types/records.ts#L31-L50](../../../../packages/sdk/src/types/records.ts#L31-L50) - `CollectionOptions`, which gets `format`"
  - "[code://packages/server/src/records.ts#L118-L175](../../../../packages/server/src/records.ts#L118-L175) - `fileRecords`, which writes only `.md`"
---

## Objective

A collection opened with `format: "json"` keeps record `<id>` at `<name>/<id>.json`.
A Markdown collection is unchanged.

## Files

- `UPDATE: packages/sdk/src/types/records.ts:31-50` - add `format?: "md" | "json"` to `CollectionOptions`.
- `UPDATE: packages/server/src/records.ts:118-175` - read, write, list and watch `.json` files for a JSON collection.
- `UPDATE: packages/server/test/records.test.ts` - the cases below.

## Steps

1. Add `format` to `CollectionOptions`, with `md` as the default.
2. In `fileRecords`, choose the suffix from `format` in `fileOf` and `idsHere`.
3. Write a JSON record as pretty JSON with a final newline.
4. Read a JSON record with `JSON.parse`, and report a file that does not parse.
5. Skip the `.json` to `.md` migration for a JSON collection.
6. Refuse `body` and `file` on a JSON collection.
7. Run the records tests, and set this task and the plan row to `done`.

## Validation

- `records.test.ts`: a JSON collection writes `<id>.json`, and a new store reads it back.
- `records.test.ts`: a person's edit of a `.json` file reaches a watcher.
- `records.test.ts`: a JSON collection does not turn a `.json` file into `.md`.
- `pnpm -s build`, `pnpm -s typecheck` and `pnpm -s boundary` pass.

## Resume

Implemented. `CollectionOptions` gained `format?: 'md' | 'json'`, documented as `md` unless `json` is named. In `fileRecords`, a `format: 'json'` collection keeps record `<id>` at `<name>/<id>.json`; `fileOf` and `idsHere` take their suffix from the format, and the folder watch matches `.json` where a Markdown collection matches `.md`. A JSON record is written as `JSON.stringify(record, null, 2)` plus a final newline at mode `0600` through the store's existing temporary-and-rename write, and read back with `JSON.parse` behind a try/catch. A file that does not parse, or that is not a JSON object, is reported through `onProblem` naming the file, and the collection keeps the record it had. The `<id>.json`-to-`<id>.md` migration runs only for a Markdown collection with no `file`, so a JSON collection never renames a file it reads. `collection()` refuses `body` and `file` on a JSON collection, with a message naming which one and why.

Departures and choices the task left open, all written into the code:

- The refusal happens when the collection is opened, not on each `put`, because a JSON collection's shape is fixed by the format and the first call to use it is the open.
- The JSON read and write live in two small local helpers, `jsonRecord` and `recordJson`, beside the existing exported `recordFile` and `readRecordFile`, which stay Markdown-only and unchanged; the test file keeps writing its JSON fixtures with `JSON.stringify`.
- The module and `fileRecords` docstrings now say the store keeps Markdown or JSON files, and the migration comment says why a JSON collection has none.

Validation: `packages/server/test/records.test.ts` gained five cases under `a collection that keeps JSON records` - a put writes pretty JSON with a final newline at `0600` and a new store reads it back by `get`, `list` and `find`; a hand edit of a `.json` file reaches a watcher as `updated`; a `.json` file is not turned into `.md` or `.json.migrated`; a file that does not parse is reported by name and the record from before stays; and `body` and `file` are both refused. All 24 cases pass. `pnpm -s build`, `pnpm -s typecheck` and `pnpm -s boundary` pass. The wire fixture was not modified by the run.

Files, for the commit `plugin/53 task 06: a collection keeps JSON records`: `packages/sdk/src/types/records.ts`, `packages/server/src/records.ts`, `packages/server/test/records.test.ts`, this task file, and the task-06 row in `plan.md`. The work is uncommitted.

**Next action:** task 07, which opens this collection as `connectors` with `format: 'json'`.
**Open questions:** none.
