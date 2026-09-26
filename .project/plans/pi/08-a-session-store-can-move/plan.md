---
title: A pi session store can move between hosts
domain: pi
status: dropped
priority: low
created: 2026-09-26
revalidated: 2026-09-26
requires: []
changes: []
creates: []
decisions: []
refs:
  - "[code://packages/agent-pi/src/backend.ts#L98-L107](../../../../packages/agent-pi/src/backend.ts#L98-L107) - a resume is found by pi's session id, through `findById(cwd, id, sessionDir)`"
  - "[code://packages/agent-pi/src/types.ts#L37-L44](../../../../packages/agent-pi/src/types.ts#L37-L44) - `sessionDir`, pi's own `~/.pi` when left out"
  - "[code://packages/agent-pi/src/catalog.ts#L51-L56](../../../../packages/agent-pi/src/catalog.ts#L51-L56) - `stateFile` looks the file up the same way"
  - npm://@earendil-works/pi-coding-agent@^0.87.1 - `SessionManager.findById` and `open` in `dist/core/session-manager.d.ts`; with no `sessionDir`, pi's default store is keyed by the encoded working directory
---

## Goal

A pi session resumes after its session store was copied to another host or another path.

## Reconnaissance

The files read and the patterns to reuse are the `refs` above, each with its note.

### Searches performed

- `rg -n "resume|findById|sessionFile" packages/agent-pi/src` - the handle this backend keeps is pi's session id, never a file path; the file is looked up on each resume.

### Runtime path

```
host resume id -> openPi -> resumeOrCreate -> SessionManager.findById(cwd, id, sessionDir) -> open(found)
```

### Gaps

- With `sessionDir` set, the lookup is by id inside that directory, so a store moved with its directory already resumes.
- With `sessionDir` left out, pi's default store is keyed by the working directory's path, so a session moved to a host where the project sits at another path is not found, and a new conversation starts.

## Decisions locked in

| What | Source | Task |
| --- | --- | --- |
| Resolve the session file relative to `sessionDir`, so a session store can move between hosts | Softov, 2026-09-26: "Optional, low: resolve the session file relative to `sessionDir` so a session store can move between hosts" | 01 |

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - A moved store still resumes](task-01-a-moved-store-still-resumes.md) | dropped | - |

## Risks and tradeoffs

- The handle is already an id and not an absolute path, so most of what this item guards against does not happen here; what is left is the default store under a different project path.

## Resume state

- **Done so far:** nothing; dropped by Softov on 2026-09-26, answering whether it is still wanted.
- **Next action:** none.
- **Open questions:** none.
- **Watch out for:** a fallback search across every project's sessions reads more than one directory's files; bound it to the id's file name pattern.

## Final verification checklist

- [ ] A session copied under a different project path resumes with its history.
- [ ] `pnpm test`, `pnpm typecheck` green.
- [ ] `plans/index.md` updated.
