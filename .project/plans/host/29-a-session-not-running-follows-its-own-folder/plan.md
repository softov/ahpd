---
title: A session that is not running shows its own folder, and its changes follow git
domain: host
status: built
priority: high
created: 2026-09-29
revalidated: 2026-09-29
requires: []
refs:
  - "[code://packages/sdk/src/host.ts#L2744](../../../../packages/sdk/src/host.ts#L2744) - `inThere`: running sessions only"
  - "[code://packages/sdk/src/host.ts#L2764-L2773](../../../../packages/sdk/src/host.ts#L2764-L2773) - `watchedIn`, built on `inThere`"
  - "[code://packages/sdk/src/host.ts#L2806-L2845](../../../../packages/sdk/src/host.ts#L2806-L2845) - `refreshWatched`, which returns while `watchedIn` is false and tells only `inThere`"
  - "[code://packages/sdk/src/host.ts#L3470-L3480](../../../../packages/sdk/src/host.ts#L3470-L3480) - the catalogue keeps `wheres` under the row's own resource, `<provider>:/<id>`"
  - "[code://packages/sdk/src/host.ts#L5497](../../../../packages/sdk/src/host.ts#L5497) - the transcript snapshot reads `wheres` under `ahp-session:/<id>` and falls back to the host's folder"
---

## Goal

A session served from its transcript, with no agent running, names the folder it ran in, and a client watching its changeset is told when git moves there, as it is for a running session.

## Reconnaissance

The files read are the `refs` above, and Softov's capture of 2026-09-29 (`/tmp/ahpd-wire.jsonl`).

### Runtime path

```
ahpapp subscribes claude:/36bd... (not running) -> snapshot workingDirectories ['file:///github/ahpapp'] (fallback), project s2cmd
ahpapp subscribes claude:/36bd.../changeset/uncommitted -> 2 files in /github/s2cmd
git commit in /github/s2cmd -> watch fires -> refreshWatched: watchedIn('/github/s2cmd') false (inThere empty) -> nothing sent
reload -> subscribe again -> 0 files
```

### Gaps

- A session that is not running is in neither `inThere` nor `watchedIn`, so its changeset is never pushed.
- Its snapshot's `workingDirectories` misses `wheres` by key and names the host's folder.

## Decisions locked in

No decision records of its own; the choices below are scope.

| What | Source | Task |
| --- | --- | --- |
| A watched changeset of a session that is not running is re-read and told like a running one's | Softov's check 3, 2026-09-29: committed in the IDE, "nothing changed on ahpapp ui"; the wire shows no action sent | 01 |
| The transcript snapshot reads `wheres` by the session's own name (`nameOf(id)`) | Same check: the session named `/github/ahpapp` while it ran in `/github/s2cmd` | 02 |

## Proposed architecture

- **Data flow** - the sessions a directory's re-read tells are the running ones in it plus every catalogued session there with a changeset some connection watches; `dirOf` already resolves both through `wheres`.
- **Layer responsibilities** - sdk host only.
- **Source-of-truth files** - [`code://packages/sdk/src/host.ts`](../../../../packages/sdk/src/host.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - A watched changeset of a session not running follows git](task-01-a-session-not-running-follows-git.md) | done | - |
| [02 - A session not running names its own folder](task-02-a-session-not-running-names-its-folder.md) | done | - |

## Risks and tradeoffs

- `inThere` has other callers (`metaMoved`); widen only what the changeset path reads, or check each caller.

## Resume state

- **Done so far:** tasks 01 and 02 done 2026-09-29, checked by Softov in ahpapp; see [implemented.md](implemented.md).
- **Next action:** none.
- **Open questions:** none.
- **Watch out for:** a not-running session's URI is `<provider>:/<id>`, not `ahp-session:/<id>`; `nameOf` maps an id to it.

## Final verification checklist

- [x] A catalogued session, never started, subscribed to its uncommitted changeset: a commit in its folder sends `changeset/cleared` without a reload.
- [x] Its snapshot names the folder its row listed.
- [x] Softov's check 3 in ahpapp against the source daemon.
- [x] `pnpm typecheck`, `pnpm boundary`, full `pnpm test`.
