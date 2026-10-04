---
title: The catalogue answers at once, and a summary is sent only when it changes
domain: host
status: planned
priority: high
created: 2026-10-04
revalidated: 2026-10-04
requires: []
changes: []
creates: []
decisions:
  - decisions/claude-variants-share-one-listing-inside-the-plugin.md
refs:
  - "[code://packages/sdk/src/host/sessionmethods.ts#L402-L403](../../../../packages/sdk/src/host/sessionmethods.ts#L402-L403) - `listSessions` awaits `listNow` on every call"
  - "[code://packages/sdk/src/host/history.ts#L20](../../../../packages/sdk/src/host/history.ts#L20) - `LISTING_FRESH`, two seconds"
  - "[code://packages/sdk/src/host/history.ts#L123-L144](../../../../packages/sdk/src/host/history.ts#L123-L144) - `listed`, `listNow` and `catalogue`: a listing is rebuilt from scratch once it is two seconds old"
  - "[code://packages/sdk/src/host/history.ts#L145-L197](../../../../packages/sdk/src/host/history.ts#L145-L197) - `past` awaits `catalogue()` before it reads a transcript, and relists once more when the id is missing"
  - "[code://packages/sdk/src/host/catalogue.ts#L266-L425](../../../../packages/sdk/src/host/catalogue.ts#L266-L425) - `listing`: backend rows, the live rows, and the prune"
  - "[code://packages/sdk/src/host/catalogue.ts#L296-L315](../../../../packages/sdk/src/host/catalogue.ts#L296-L315) - each agent's `list` awaited one after another"
  - "[code://packages/sdk/src/host/catalogue.ts#L193-L197](../../../../packages/sdk/src/host/catalogue.ts#L193-L197) - `sessionAdded`"
  - "[code://packages/sdk/src/host/catalogue.ts#L219-L240](../../../../packages/sdk/src/host/catalogue.ts#L219-L240) - `summaryMoved` sends every mutable field on each call, changed or not"
  - "[code://packages/sdk/src/host/catalogue.ts#L454-L470](../../../../packages/sdk/src/host/catalogue.ts#L454-L470) - `readStored`, the listing the host already starts at boot"
  - "[code://packages/sdk/src/host.ts#L813](../../../../packages/sdk/src/host.ts#L813) - `readStored` is started once `createHost` has returned"
  - "[code://packages/sdk/src/host/lifecycle.ts#L369](../../../../packages/sdk/src/host/lifecycle.ts#L369) - `root/sessionRemoved` on a dispose"
  - "[code://packages/sdk/src/types/agent.ts#L474](../../../../packages/sdk/src/types/agent.ts#L474) - `Agent.list`, beside which `find` goes"
  - "[code://packages/agent-claude/src/plugin.ts#L189-L211](../../../../packages/agent-claude/src/plugin.ts#L189-L211) - every variant of one load shares `paths`, and `apply` registers one agent per variant"
  - "[code://packages/agent-claude/src/claude.ts#L411](../../../../packages/agent-claude/src/claude.ts#L411) - Claude's `list`, one `catalogue` per path"
  - "[code://packages/agent-claude/src/claude.ts#L435-L460](../../../../packages/agent-claude/src/claude.ts#L435-L460) - `transcript` and `subagents` list every path again to find a session's directory"
  - "[code://packages/agent-claude/src/catalog.ts#L23-L32](../../../../packages/agent-claude/src/catalog.ts#L23-L32) - `catalogue`, the SDK's `listSessions({ dir })` mapped to `Listed`"
  - "[code://packages/sdk/test/support/claude-sdk.ts](../../../../packages/sdk/test/support/claude-sdk.ts) - the fake SDK the tests list through"
  - npm://@anthropic-ai/claude-agent-sdk@0.3.278 - `listSessions({ dir })` reads every transcript under the project directory; `getSessionInfo(id, { dir })` reads one
---

## Goal

A client connecting to ahpd sees its session list in about the time `initialize` takes, opening a past session does not wait for every transcript on the machine to be read again, and the session list is told about a row only when something in that row changed.

## Reconnaissance

### Searches performed

- `rg -n "listNow|catalogue\(\)" packages/sdk/src` - `listSessions` calls `listNow`, and `past` calls `catalogue`, which calls `listNow` once the last listing is two seconds old.
- `rg -ln "summaryMoved\(" packages/sdk/src` - called from `facts.ts`, `spawn.ts`, `tooling.ts`, `actions.ts` and `chatactions.ts`, besides `catalogue.ts` itself.
- `rg -n "registerAgent|providers" packages/sdk/src/plugins.ts` - the host's `agents` map holds agents by provider and does not keep which plugin registered one, so the host cannot tell that two agents read the same store.
- `rg -n "catalogue\(served\)" packages/agent-claude/src` - `transcript` and `subagents` each run a full `listSessions` per path to find which path holds one id.
- `rg -n "getSessionInfo" packages/agent-claude/node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts` - the SDK answers one session's row without listing the rest.

Measured 2026-10-04 by Softov from his ahpapp session, read-only, against dev-01 (`ws://200.11.121.81:37537`):

- `listSessions` takes 48.6 s for 162 sessions (137 KB), and `initialize` answers in 0.3 s.
- The protocol SDK marks a host connected only once `listSessions` answers, so clients show "connecting" for about 49 s.
- One build session sent about 28 `root/sessionSummaryChanged` a second, about 1.1 KB each, and of 225 in a row about 210 were byte-identical to the one before; what did change was mostly `activity`.

Measured the same day on this machine's daemon:

- With two build sessions the daemon sat at 3.1 to 3.7 GB RSS and 110 to 118 % CPU.
- `listSessions` from ahpc timed out at 30 s, and so did a prompt client's `subscribe`.
- With four builds the daemon grew from 400 MB to 4.4 GB in 55 minutes and the kernel OOM killer ended it.
- It held about 970 open file descriptors, nearly all Claude transcripts under `~/.claude/projects` (838 MB on disk: 483 under `-github-ahpd`, 385 under `-github-ahpc`, 77 under `-github-ahpapp`).
- Whether the memory is parsed transcripts, the `history` cache of every opened transcript, or the event flood is not measured.

### Runtime path

```
listSessions -> listNow -> listing -> for each agent: await agent.list()
  -> claude, claude-openrouter, claude-openrouter-build, ... each: listSessions({ dir }) per path, the same files
  -> rows + live rows -> prune -> answer

subscribe to a past session -> past(id) -> catalogue() (relists when older than 2 s) -> owner.transcript(id)
  -> Claude: listSessions({ dir }) per path again, to find the path -> getSessionMessages

any change to a live session -> summaryMoved(uri) -> root/sessionSummaryChanged with every mutable field, changed or not
```

### Gaps

- A listing is never kept, so every `listSessions` and nearly every open pays for reading every transcript.
- Agents are listed one after another, and every Claude variant reads the same projects directory again.
- `summaryMoved` has no memory of what it sent.
- Claude's `transcript` and `subagents` list to find one session's directory.
- `Not found: a backend change signal on Agent - searched "watch", "changed", "onList" in packages/sdk/src/types/agent.ts.`

## Decisions locked in

| Decision | Task |
| --- | --- |
| [Claude variants share one listing inside the plugin](../../../decisions/claude-variants-share-one-listing-inside-the-plugin.md) | 02 |

| What | Source | Task |
| --- | --- | --- |
| A `root/sessionSummaryChanged` whose `changes` equal the last one sent for that session is not sent; the last sent is kept per session and forgotten when the session is removed | Softov's report, 2026-10-04 | 01 |
| A session's last sent is also forgotten on `root/sessionAdded`, so the first move after it always goes out | (defaulted: the added row is a whole row, and the next partial has nothing to equal) | 01 |
| `summaryMoved` keeps sending every mutable field when anything changed, as [`code://packages/sdk/src/host/catalogue.ts#L205-L210`](../../../../packages/sdk/src/host/catalogue.ts#L205-L210) says | (defaulted: unchanged wire shape, and clients already apply it) | 01 |
| The catalogue asks every agent at once, and folds the answers in the order the agents were loaded, so the first agent to list an id is the same one it is today | Softov's report, 2026-10-04; the order is [`code://packages/sdk/src/host/catalogue.ts#L294-L295`](../../../../packages/sdk/src/host/catalogue.ts#L294-L295) | 02 |
| The catalogue is held: `listSessions` answers from it at once, and a refresh runs in the background, its changes going out as `root/sessionAdded`, `root/sessionRemoved` and `root/sessionSummaryChanged` | Softov's report, 2026-10-04 | 03 |
| The first `listSessions` after start waits for the first listing, which is the one `readStored` already starts at boot | Softov's report, 2026-10-04; [`code://packages/sdk/src/host.ts#L813`](../../../../packages/sdk/src/host.ts#L813) | 03 |
| The held catalogue holds the backend rows only; the rows of sessions this host is running are built on each answer, as `listing` builds them today | (defaulted: a live row moves every second and is cheap to build) | 03 |
| One refresh runs at a time, and a caller that wants one while one runs shares it | (defaulted: two listings of the same files at once is the cost this plan removes) | 03 |
| Opening a past session reads its row from the held catalogue, and when the row is missing asks the agents for that one id through an optional `Agent.find(id)`, the recorded provider first | Softov's report, 2026-10-04 | 04 |
| An agent with no `find` has a missing row answered by the running refresh, or by one it starts | (defaulted: pi, cofold and ACP keep finding a session written after the last listing) | 04 |
| Claude's `transcript`, `subagents` and `find` locate a session with `getSessionInfo(id, { dir })` per path rather than a listing | (defaulted: the SDK reads one file for it) | 04 |
| `LISTING_FRESH` goes | Softov's report, 2026-10-04, "if nothing needs it"; nothing does once `past` reads the held catalogue | 04 |
| The memory is not changed on a guess: task 05 measures it, and what it finds is a plan of its own | Softov's report, 2026-10-04 | 05 |
| dev02 refuses ahpapp with -32005 No protocol version in common because its ahpd predates protocol 1.0.0; updating ahpd on dev02 fixes it, and it is not this plan's work | Softov's report, 2026-10-04 | - |

## Proposed architecture

- **Data flow** - `history.ts` holds `rows`, the backend rows of the last finished listing, and `refreshing`, the listing running now; `listSessions` answers `rows` plus the live rows, or waits for the first listing when there is none yet; `past` reads `rows`, then `find`.
- **Event flow** - a refresh compares its rows with the held ones by resource and broadcasts `root/sessionAdded` for a new row, `root/sessionRemoved` for a row gone, and a moved row through the same last-sent check `summaryMoved` uses; rows of sessions this host is running are left to `summaryMoved`.
- **State flow** - `lastSent` in `catalogue.ts`, per session URI; `rows` and `refreshing` in `history.ts`; nothing persisted.
- **Layer responsibilities** - sdk `host/catalogue.ts`: the parallel listing, the last-sent check, the row diff · sdk `host/history.ts`: the held catalogue and the refresh · sdk `types/agent.ts`: `find` · agent-claude: the shared listing and `getSessionInfo` lookups.
- **Source-of-truth files** - [`code://packages/sdk/src/host/catalogue.ts`](../../../../packages/sdk/src/host/catalogue.ts), [`code://packages/sdk/src/host/history.ts`](../../../../packages/sdk/src/host/history.ts), [`code://packages/agent-claude/src/plugin.ts`](../../../../packages/agent-claude/src/plugin.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - A summary that did not change is not sent](task-01-a-summary-that-did-not-change-is-not-sent.md) | todo | - |
| [02 - Agents are listed at once, and Claude's variants read their store once](task-02-agents-are-listed-at-once-and-once-per-store.md) | todo | - |
| [03 - The catalogue is held, and a refresh sends what moved](task-03-the-catalogue-is-held.md) | todo | 01, 02 |
| [04 - Opening a past session reads the held row](task-04-opening-a-past-session-reads-the-held-row.md) | todo | 03 |
| [05 - Measured before and after, by hand](task-05-measured-before-and-after.md) | todo | 01, 02, 03, 04 |

## Risks and tradeoffs

- A held catalogue is a step behind the disk: a session written by a Claude Code in a terminal shows up after the next refresh, as a `root/sessionAdded`, and not in the answer that started that refresh.
- Tests that write a row into the fake SDK and call `listSessions` expect it in that answer; task 03 gives them a way to wait for the refresh rather than weakening what they check.
- The prune in `listing` runs on every refresh as it runs on every listing today, so a refresh that forgets a row is the same forget as now, now followed by a `root/sessionRemoved`.
- The shared Claude listing is right only while every variant of one load reads the same `paths` and the same `CLAUDE_CONFIG_DIR`; the decision says what breaks it.
- Host 44 p3 adds a session's chats to its row and to `summaryMoved`, so the last-sent check compares them too; equal chats lists stay unsent, which is the point.
- The memory and the open file descriptors may not move with this plan at all; task 05 says so with numbers rather than this plan claiming it.

## Resume state

- **Done so far:** nothing.
- **Next action:** [task-01-a-summary-that-did-not-change-is-not-sent.md](task-01-a-summary-that-did-not-change-is-not-sent.md), then [task-02-agents-are-listed-at-once-and-once-per-store.md](task-02-agents-are-listed-at-once-and-once-per-store.md); ask question 1 before task 03.
- **Open questions:**
  1. What starts a refresh of the held catalogue? The `Agent` type has no change signal, so it is one of: each `listSessions` starts one in the background when none runs; a timer; or host events (a session created, disposed, or a turn ended) - proposed: each `listSessions` starts one when none runs, and nothing else, because a client that connects is the one that wants the list current, the single flight bounds the cost to one listing at a time, and a session this host creates already goes out as `root/sessionAdded` without one.
- **Watch out for:** `listing` has side effects (`names`, `owners`, `wheres`, `births`, `moves`, the prune), so a refresh is a call to it and not a copy of it; `summaryMoved` is called for listed rows too, which have no `Held` and send `status` and `changes` only.

## Final verification checklist

- [ ] `listSessions` on a started host answers without calling any agent's `list`.
- [ ] A build session's flood is down to the events whose fields changed.
- [ ] Opening a past session calls no agent's `list`.
- [ ] Task 05's numbers are in its Resume, before and after, on this machine and on dev-01.
- [ ] `pnpm exec tsc --noEmit`, `pnpm boundary`, `pnpm test` pass.
- [ ] `plans/index.md` updated.
