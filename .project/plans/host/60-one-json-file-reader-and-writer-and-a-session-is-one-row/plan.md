---
title: JSON files are read and written through one helper, and the session store keeps one row per session
domain: host
status: built
priority: medium
created: 2026-10-05
revalidated: 2026-10-05
requires:
  - plans/host/58-private-files-refused-cursors-and-decoded-file-uris/plan.md
changes: []
creates: []
decisions: []
refs:
  - "[code://packages/sdk/src/sessions.ts#L236-L241](../../../../packages/sdk/src/sessions.ts#L236-L241) - the atomic write every store repeats: mkdir, `<file>.<pid>.tmp`, `0o600`, rename"
  - "[code://packages/sdk/src/policies.ts#L273-L291](../../../../packages/sdk/src/policies.ts#L273-L291) - a read: ENOENT is empty, another failure is said, not JSON is said, then a shape check"
  - "[code://packages/sdk/src/scheduled.ts#L278-L292](../../../../packages/sdk/src/scheduled.ts#L278-L292) - the same read, any read failure silent"
  - "[code://packages/sdk/src/users.ts#L540-L552](../../../../packages/sdk/src/users.ts#L540-L552) - the same read, where an empty file is `{}`"
  - "[code://packages/server/src/vault.ts#L31-L60](../../../../packages/server/src/vault.ts#L31-L60) - `readSaved`, which says only the errno code and a fixed sentence, never the parser's message, which would quote a secret"
  - "[code://packages/server/src/vault.ts#L102-L107](../../../../packages/server/src/vault.ts#L102-L107) - `writeSaved`"
  - "[code://packages/server/src/daemon.ts#L90-L122](../../../../packages/server/src/daemon.ts#L90-L122) - `running`, `recordIn`, `recorded`: a record that is not one is deleted"
  - "[code://packages/server/src/daemon.ts#L125-L144](../../../../packages/server/src/daemon.ts#L125-L144) - the sweeper, which depends on the `<file>.<pid>.tmp` name"
  - "[code://packages/server/src/install.ts#L137-L161](../../../../packages/server/src/install.ts#L137-L161) - `readEntry` and `writeEntry`, the one write that is not atomic"
  - "[code://packages/computer/src/owners.ts#L117-L171](../../../../packages/computer/src/owners.ts#L117-L171) - computer's read and atomic write"
  - "[code://packages/sdk/src/sessions.ts#L30-L99](../../../../packages/sdk/src/sessions.ts#L30-L99) - `memorySessions`: nine maps, `forget` and `prune` naming all nine"
  - "[code://packages/sdk/src/sessions.ts#L124-L137](../../../../packages/sdk/src/sessions.ts#L124-L137) - `Saved`, the row on disk"
  - "[code://packages/sdk/src/sessions.ts#L194-L220](../../../../packages/sdk/src/sessions.ts#L194-L220) - `rowOf`, a row rebuilt from nine getters"
  - "[code://packages/sdk/src/sessions.ts#L257-L329](../../../../packages/sdk/src/sessions.ts#L257-L329) - `load`, nine setters and the field-by-field checks"
  - "[code://packages/sdk/src/sessions.ts#L333-L352](../../../../packages/sdk/src/sessions.ts#L333-L352) - eleven setters wrapped in the same `heard`, `dirty`, `later` line"
  - "[code://packages/sdk/src/types/sessions.ts](../../../../packages/sdk/src/types/sessions.ts) - `SessionStore`, the port, which does not change"
  - "[code://packages/server/src/update.ts#L93-L130](../../../../packages/server/src/update.ts#L93-L130) - `readUpdate` and `refreshUpdate`, a copy of ahpc's `src/update.ts` kept in step, which this plan leaves alone"
---

## Goal

Every JSON file the daemon keeps is read through one helper that says what went wrong without wording it, and written through one helper that is atomic and owner-only by default, so a store can no longer forget the mode or the pid in its temp name.
The session store holds one row per session instead of nine maps that every path has to name in turn.
No file format, no plugin interface and no message a person reads changes.

## Reconnaissance

The files read and the patterns to reuse are the `refs` above, each with its note.

### Searches performed

- `rg -n "renameSync" packages/*/src` - atomic writes in `sessions.ts` (twice), `policies.ts`, `scheduled.ts`, `users.ts`, `computer/src/owners.ts`, `server/src/vault.ts`, `server/src/daemon.ts`; `server/src/install.ts:160` writes in place.
- `rg -n "JSON.parse\(readFileSync" packages/*/src` and the two-step reads - the readers listed in `refs`, plus `computer/src/parts.ts:137`, `agent-claude/src/mcp.ts:33`, `agent-cofold/src/config.ts:79` and `server/src/update.ts:95`.
- `rg -n "inner\.set" packages/sdk/src/sessions.ts` - eleven setters wrapped one per line, nine restored in `load`.
- `rg -n "code://packages/sdk/src/sessions.ts" .project/plans` - host 50 task 02 adds a tenth field (`chats`) to the same store.

### Runtime path

```
a store changes -> save() -> writeJsonAtomic(file, value) -> mkdir, <file>.<pid>.tmp at 0600, rename
a store starts -> readJsonObject(file) -> { ok, value } | { ok: false, kind, code } -> the store words its own message, or none
setFlags(id, 4) -> rows.get(id) patched -> dirty -> next tick -> the row written as it is
```

### Gaps

- Eight copies of the atomic write, two of which forgot the mode until host 58.
- About a dozen copies of the read, each wording failure differently, which is right, around the same four outcomes, which is the repetition.
- `memorySessions` names its nine maps in `forget` and `prune`, `rowOf` names nine getters, `load` nine setters, and the file store wraps eleven setters by hand; a tenth field touches all of them.

## Decisions locked in

No decision file: every row below is either Softov's answer or a choice anyone would make.

| What | Source | Task |
| --- | --- | --- |
| Code repeated in more than one place is replaced by one shared helper, with no new dependency | Softov, 2026-10-05, asked which of the survey's findings become plans: all four | 01-06 |
| The reader answers an outcome (`missing`, `unreadable` with the errno code, `not-json`, `not-object`) and the raw error, and never a sentence; each caller words its own | Softov's brief for this plan, 2026-10-05 | 01, 02, 03, 04 |
| `vault.ts` keeps its fixed sentences and never says the parser's message or the read error's text | Softov's brief for this plan, 2026-10-05; [`code://packages/server/src/vault.ts#L38-L48`](../../../../packages/server/src/vault.ts#L38-L48) | 03 |
| The writer is atomic, `<file>.<pid>.tmp` then rename, and writes `0o600` unless told otherwise; a directory it makes takes a mode only when the caller passes one | Softov's brief for this plan, 2026-10-05; (defaulted: `sessions.ts` makes its folder `0o700`, the others take the umask) | 01 |
| The session store is one `Map<string, Row>`, `Row` being `Saved` without `version` and `id`; `SessionStore` and the file on disk do not change | the survey's item 4 and Softov's brief for this plan, 2026-10-05 | 05, 06 |
| `load` keeps checking each field on its own, as today | (defaulted: a row written by another version is read field by field, and one bad field must not lose the rest) | 06 |
| The shared writer always makes the folder before it writes, `daemon.ts` included | Softov, 2026-10-06, asked "always make the folder?": "Always, harmless" | 01 |
| `users.ts` checks for an empty file itself before parsing, and the shared reader keeps four outcomes | Softov, 2026-10-06, asked "through the shared reader, or as its own check?": "Caller checks" | 01 |

## Proposed architecture

- **Data flow** - a store reads with `readJson` or `readJsonObject` and words the outcome; it writes with `writeJsonAtomic(file, value, { mode?, dirMode? })`.
- **Event flow** - unchanged.
- **State flow** - `memorySessions` holds `rows: Map<string, Row>`; a getter reads a field, a setter patches the row and drops it when every field is empty; `fileSessions` writes `rows.get(id)` with `version` and `id` added.
- **Layer responsibilities** - sdk `jsonfile.ts` (new, exported): the reader and the writer · sdk `policies.ts`, `scheduled.ts`, `users.ts`, `sessions.ts`, server `vault.ts`, `daemon.ts`, `install.ts`, computer `owners.ts`: callers · sdk `sessions.ts`: the row.
- **Source-of-truth files** - [`code://packages/sdk/src/sessions.ts`](../../../../packages/sdk/src/sessions.ts), [`code://packages/server/src/vault.ts`](../../../../packages/server/src/vault.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - One JSON file reader and one atomic writer](task-01-one-json-file-reader-and-one-atomic-writer.md) | done | - |
| [02 - The sdk's stores read and write through them](task-02-the-sdks-stores-read-and-write-through-them.md) | done | 01 |
| [03 - The daemon's files read and write through them](task-03-the-daemons-files-read-and-write-through-them.md) | done | 01 |
| [04 - Computer's owner file reads and writes through them](task-04-computers-owner-file-reads-and-writes-through-them.md) | done | 01, host 59 task 05 |
| [05 - The memory session store keeps one row per session](task-05-the-memory-session-store-keeps-one-row-per-session.md) | done | - |
| [06 - The file session store reads and writes the row](task-06-the-file-session-store-reads-and-writes-the-row.md) | done | 01, 05 |

## Risks and tradeoffs

- The vault's wording stays as it is even after it uses the shared reader: the reader carries the raw error, and a builder who passes `reason(error)` into the vault's sentence would quote a secret; task 03's test holds that.
- The three coalescing timers (`sessions.ts:251`, a next-tick batch; `resources.ts:555`, a fixed window from the first event; `changes.ts:1208`, a trailing debounce) mean different things and stay three; task 06 keeps `later` as it is.
- `server/src/update.ts` is kept in step with ahpc's `src/update.ts` (`ideas/deliberate-duplication.md`), so its read and its non-atomic write stay as they are.
- `computer/src/parts.ts`, `agent-claude/src/mcp.ts` and `agent-cofold/src/config.ts` read files the person wrote, each with its own policy, and are not moved here; they can be later, over the same reader.
- Host 50 task 02 adds `chats` to the session store; whichever lands second adds it in the other's shape, and after task 05 that is one field on `Row` and one check in `load`.
- `install.ts`'s `writeEntry` becomes atomic, which a reader never notices; its mode stays `0o600`.
- Task 04 cannot land before host 59 raises computer's peer range, because computer reaches the helper only through `@ahpd/sdk`.

## Resume state

- **Done so far:** tasks 01-06 done; see [implemented.md](implemented.md).
- **Next action:** none.
- **Open questions:** none.
- **Watch out for:** `daemon.ts`'s sweeper reads the temp name, so the writer's name is exactly `<file>.<pid>.tmp`; `memorySessions` is exported and used directly by tests and embedders, so its methods keep their names and answers; `prune` today walks every map's keys, and after task 05 it walks `rows.keys()`, which must be the same set.

## Final verification checklist

- [x] `rg -n "renameSync" packages/sdk/src packages/server/src packages/computer/src` finds only `jsonfile.ts`, `daemon.ts`'s log rotation and `sessions.ts`'s migration rename.
- [x] `memorySessions` declares one `Map`.
- [x] `pnpm exec tsc --noEmit`, `pnpm boundary`, `pnpm test` pass.
- [x] `plans/index.md` updated.
