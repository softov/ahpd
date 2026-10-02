---
title: A session two harnesses both list is listed once, under the harness it runs on
domain: host
status: built
priority: high
created: 2026-10-02
revalidated: 2026-10-02
requires:
  - plans/claude/12-a-second-claude-runs-on-another-endpoint/plan.md
changes: []
creates: []
decisions:
  - decisions/a-listed-session-belongs-to-the-provider-the-host-recorded.md
refs:
  - "[code://packages/sdk/src/host.ts#L3897-L3940](../../../../packages/sdk/src/host.ts#L3897-L3940) - `listing()`, which publishes every agent's rows as `<provider>:/<id>`"
  - "[code://packages/sdk/src/host.ts#L6339-L6366](../../../../packages/sdk/src/host.ts#L6339-L6366) - `openSession`, where a new session's owner and config are kept"
  - "[code://packages/sdk/src/types/sessions.ts](../../../../packages/sdk/src/types/sessions.ts) - `SessionStore`, what the host keeps per session"
  - "[code://packages/sdk/src/sessions.ts](../../../../packages/sdk/src/sessions.ts) - the memory and file stores, `version: 1`"
  - "[code://packages/agent-claude/src/claude.ts#L438](../../../../packages/agent-claude/src/claude.ts#L438) - Claude's `list()`, every transcript under `~/.claude/projects`"
  - "[code://packages/agent-claude/src/session.ts#L2310](../../../../packages/agent-claude/src/session.ts#L2310) - Claude keeps the host's id when it is a UUID, else picks its own"
---

## Goal

With Claude loaded twice (claude/12), each session appears once, under the harness it was created or last resumed on, and opening it resumes it on that harness's endpoint.

## Reconnaissance

### Runtime path

```
listing() -> for each agent: agent.list() -> every row as <provider>:/<id> (names/owners keyed by id, last writer wins)
```

### Gaps

- Two harnesses reading one store list every session twice, and `names.set(row.id, ...)` points the id at whichever listed last.
- The session store keeps flags, config, scope, owner, artifacts and titles per session, but not the provider.

## Decisions locked in

| What | Source | Task |
| --- | --- | --- |
| [A listed session belongs to the provider the host recorded, else the first loaded harness that lists it](../../../decisions/a-listed-session-belongs-to-the-provider-the-host-recorded.md) | Softov, 2026-10-02 | 01, 02 |

| What | Source | Task |
| --- | --- | --- |
| The provider is recorded when a session is created or resumed, and at a turn's end against the agent's own id once it names one | (defaulted: a listed row carries the agent's id, which can differ from the host's) | 01 |
| A recorded provider that is not loaded falls back as an unrecorded one does | the decision | 02 |
| Listing never writes the store | (defaulted: a list is a read; a session is recorded when it runs) | 02 |
| The file store reads a version 1 file with no providers as having none recorded | (defaulted: an upgrade must not drop sessions) | 01 |

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - The store records a session's provider](task-01-the-store-records-the-provider.md) | done | - |
| [02 - The listing gives each id to one harness](task-02-the-listing-gives-each-id-to-one-harness.md) | done | 01 |

## Resume state

- **Done so far:** both tasks; see [implemented.md](implemented.md).
- **Next action:** none.
- **Open questions:** none.

## Final verification checklist

- [x] Two agents listing one id give one row, under the recorded provider.
- [x] An unrecorded id, and one whose recorded provider is not loaded, is listed under the first loaded agent that lists it.
- [x] A session created on the second harness and listed after a restart is under the second harness, and opening it resumes there.
- [x] `plans/index.md` updated.
