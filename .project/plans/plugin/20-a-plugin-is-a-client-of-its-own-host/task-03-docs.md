---
title: The plugin docs describe connect and grants
status: done
depends: [task-02-the-connection-is-the-plugins-principal.md]
layer: "docs"
refs:
  - "[code://docs/PLUGINS.md#L307-L322](../../../../docs/PLUGINS.md#L307-L322) - Read-only context, beside which `connect` is described"
  - "[code://docs/PLUGINS.md#L465-L496](../../../../docs/PLUGINS.md#L465-L496) - the configuration entry, which gains `grants`"
---

## Objective

`docs/PLUGINS.md` says how a plugin acts on sessions, when it may connect, and what `grants` it needs.

## Files

- `UPDATE: docs/PLUGINS.md:307-322` - a short section on `connect()`, with a ten-line example that starts a session.
- `UPDATE: docs/PLUGINS.md:465-496` - `grants` in the object form, and that none is the default.

## Steps

1. One sentence per line, and link decision `a-grant-is-a-subject-and-a-verb` for the grammar.

## Validation

- The example runs against a daemon by hand.

## Resume

- `docs/PLUGINS.md` gains `### A plugin is a client of its own host`, placed directly after `### Read-only context` and before `### Starting a session as an owner`, which is where the ref's own note puts it - "Read-only context, beside which `connect` is described". It says why a plugin arrives as a client, what `connect()` answers, that it is asked for from `listening` or later (and throws a sentence during `apply`), that the daemon closes every connection at `stopping`, and that the connection is served as `plugin:<name>`. Its example is ten lines: `initialize`, `createSession`, `subscribe` and a `dispatchAction` carrying `chat/turnStarted`, which is the shape the fixture and `plugin-end-to-end.test.ts` both use.
- The `## Naming a plugin` configuration example gains a third entry, `{ "name": "@ahpd/bot", "grants": ["session:write"] }`, and a paragraph after it says what `grants` is, that each one is `<subject>:<operation>`, that none is the default, and that a grant naming no operation is dropped where the plugin is loaded with the daemon saying which line it was.
- **Departure 1.** Both ref line ranges had moved. `#L307-L322` is now `### A contributed setting can be a question`'s example, so the placement follows the ref's note rather than its numbers; `#L465-L496` is now `### Writing a usage record` through `### What a policies store has to answer`, while the note says "the configuration entry, which gains `grants`", which is `## Naming a plugin` (now `#L629-L644`). Neither range covered what its note names at the plan's own `revalidated: 2026-10-04` either, so both were followed by their notes rather than their numbers.
- **Departure 2.** The Step names decision `a-grant-is-a-subject-and-a-verb` for the grammar, and that decision is `superseded` by `a-grant-names-an-operation-and-read-and-write-are-its-groups`. The link goes to the accepted one, which is the decision `docs/PLUGINS.md` already cites for the same grammar at the resource-provider section.
- **Departure 3.** The new section is written one sentence per line, per this task's Step; the paragraph added inside the wrapped `## Naming a plugin` section is wrapped to match its neighbours.
- Not verified by hand: this task's Validation is "the example runs against a daemon by hand", and no daemon was run here. The three commands the example uses are the ones the fixture exercises end to end in `plugin-connect.test.ts`, and its provider is `claude`, which is the one `### Starting a session as an owner`'s example names above it.
