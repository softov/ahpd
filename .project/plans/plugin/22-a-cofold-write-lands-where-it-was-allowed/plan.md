---
title: A cofold write lands on the file its check allowed, and not on one that changed since it was read
domain: plugin
status: draft
priority: medium
created: 2026-09-27
revalidated: 2026-09-27
requires:
  - plans/plugin/14-cofold-runs-its-own-tools/plan.md
changes: []
creates: []
decisions: []
refs:
  - "[code://packages/agent-cofold/src/session.ts#L37-L51](../../../../packages/agent-cofold/src/session.ts#L37-L51) - `insideDirectory`, the check a write is allowed by"
  - "[code://packages/agent-cofold/src/session.ts#L446](../../../../packages/agent-cofold/src/session.ts#L446) - where the harness is given it"
  - file:///github/cofold/packages/tools/src/files.ts - `write_file` and `edit_file` resolve the path lexically with `resolveWithin(...).absolute` and write it with `writeFile`, which follows every link at the moment of the write
  - file:///github/cofold/packages/tools/src/paths.ts - `resolveWithin`, which judges real paths at the moment of the check
  - npm://@cofold/tools@^0.1.1 - the release ahpd takes, whose tools this plan changes
  - https://nodejs.org/api/fs.html#file-open-constants - `O_NOFOLLOW` exists; `fs` has no `openat`, so a walk relative to a directory descriptor is not available
---

## Goal

A write or an edit a cofold session makes lands on the file the permission check judged, even when another process swaps a symlink between the check and the write.
A write to a file that changed since the session read it is refused rather than overwriting what changed, so the model reads it again first.

## Reconnaissance

The files read and the patterns to reuse are the `refs` above, each with its note.

### Searches performed

- `rg "resolveWithin|writeFile|readText" /github/cofold/packages/tools/src` - the check is `resolveWithin`, and the file tools write through `writeFile` on the lexical path.
- `rg "resolveWithin|insideDirectory" packages/agent-cofold/src` - ahpd's check is the same resolver, called before the tool runs.

### Runtime path

```
model tool call -> ahpd permission check (insideDirectory, real paths now) -> cofold write_file / edit_file -> writeFile(lexical path, follows links then)
```

### Gaps

- Nothing ties the file written to the file checked: a link replaced between the two is followed where it points at the write.
- `edit_file` reads and writes in one call with an await between, and `write_file` replaces a file whether or not the session ever read it.
- Not found: any record in cofold's tools of what a session read, or when - searched `mtime`, `stale`, `lastRead` in `/github/cofold/packages/tools/src`.

## Decisions locked in

| What | Source | Task |
| --- | --- | --- |
| The swapped-symlink window from plugin/14's Risks becomes a plan of its own, and plugin/14 closes as planned. | Softov, 2026-09-27, asked where the TOCTOU task goes: "New plugin plan". | - |
| The candidates are opening then re-checking, opening by descriptor, and refusing a write when the file changed since it was read; which of them is decided in task 01. | Softov, 2026-09-27, asked how cofold's tools should close the window: "Open or recheck... also its possible to invalidate the write if the file was read and changed between the process?". | 01 |

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - The way cofold's tools close the window is chosen](task-01-the-approach-is-chosen.md) | todo | - |

## Risks and tradeoffs

- The change is in `@cofold/tools`, so it is a cofold release through its `release.yml`, approved by Softov, and then an ahpd dependency bump.
- A stale-read refusal changes what a model sees: a write it used to make now fails with a sentence telling it to read first.

## Resume state

- **Done so far:** nothing; drafted 2026-09-27 from plugin/14's Risks.
- **Next action:** [task-01-the-approach-is-chosen.md](task-01-the-approach-is-chosen.md).
- **Open questions:**
  1. Which of the three candidates, alone or together - task 01 asks.
- **Watch out for:** Node's `fs` has `O_NOFOLLOW` but no `openat`, so "open by descriptor" can refuse a link only at the last name, not walk the path from the workspace one name at a time.

## Final verification checklist

- [ ] A case in cofold's tools swaps a link between the check and the write and the write does not land outside.
- [ ] A case in cofold's tools changes a file after `read_file` and the next `edit_file` or `write_file` is refused, if task 01 chooses it.
- [ ] ahpd takes the cofold release, and `pnpm test` is green.
- [ ] `plans/index.md` updated.
