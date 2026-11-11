---
title: A plugin that fails to start says so, not when ahpd started
domain: plugin
status: planned
priority: low
created: 2026-11-11
revalidated: 2026-11-11
requires: []
changes: []
creates: []
refs:
  - git://89cfcd7ad - the commit of ahpd this plan was checked at, and the last one that holds `problems/a-plugin-enabled-later-that-fails-says-when-ahpd-started.md`
  - "[code://packages/server/src/applyplugins.ts#L102-L112](../../../../packages/server/src/applyplugins.ts#L102-L112) - `eventFailed`, which says `when ahpd started` for every `listening` throw"
  - "[code://packages/server/test/plugin-live.test.ts#L630-L640](../../../../packages/server/test/plugin-live.test.ts#L630-L640) - the case that reads the alert's text"
---

## Goal

A plugin whose `listening` handler throws gets an alert that is true whenever it started.
Today the alert says "This plugin failed when ahpd started", also for a plugin enabled while the daemon runs.

## Reconnaissance

The files read and the patterns to reuse are the `refs` in the frontmatter, each with its note.

### Searches performed

- `rg "This plugin failed" packages docs` - the text is in `applyplugins.ts` and one test only, and in no catalog.

### Runtime path

```
listening raised at start or at an enable -> handler throws -> eventFailed -> set.alert(text)
```

### Gaps

- The text names the daemon's start for every `listening` throw.

## Answers

| What | Source | Task |
| --- | --- | --- |
| The `listening` alert says "This plugin failed to start, and the ahpd log has the details." | the problem's second candidate, "say when it started, which is true in both cases" | 01 |
| The `stopping` alert keeps its words | `(defaulted: the problem names only the listening text)` | 01 |

## Proposed architecture

- **Data flow** - one string in `eventFailed`.
- **Layer responsibilities** - server only.
- **Source-of-truth files** - [`code://packages/server/src/applyplugins.ts`](../../../../packages/server/src/applyplugins.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - The alert says the plugin failed to start](task-01-the-alert-says-the-plugin-failed-to-start.md) | implemented | - |

## Risks and tradeoffs

- A client that matched the old text breaks - none is known, and the alert's `ref` is the stable key.

## Resume state

- **Done so far:** task 01 implemented, 2026-11-11; see [implemented.md](implemented.md).
- **Next action:** Softov reviews the PR. The plan closes as `built` on his word.
- **Open questions:** none.
- **Watch out for:** the problem also asks whether a `stopping` alert stays on an unloaded plugin. That stays open, in [deferred.md](deferred.md).

## Final verification checklist

- [x] The `listening` alert reads "This plugin failed to start, and the ahpd log has the details."
- [x] `pnpm typecheck` and the server suite pass.
