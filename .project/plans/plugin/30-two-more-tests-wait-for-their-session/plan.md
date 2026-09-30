---
title: Two more tests wait for what their session is still doing
domain: plugin
status: planned
priority: high
created: 2026-09-29
revalidated: 2026-09-29
requires:
  - plans/plugin/28-a-closed-session-test-waits-for-its-run/plan.md
refs:
  - "[code://packages/agent-acp/test/agent-acp-ports.test.ts](../../../../packages/agent-acp/test/agent-acp-ports.test.ts) - `opens a shell the host owns...`: `ENOTEMPTY` in `afterEach`"
  - "[code://packages/agent-cofold/test/agent-cofold-fork.test.ts#L250](../../../../packages/agent-cofold/test/agent-cofold-fork.test.ts#L250) - `copies the kept turns with their records, not just their text`: `expected [] to deeply equal [ 'completed' ]`"
---

## Goal

The two tests stop failing about one run in three, so CI does not go red on an unrelated push.

## Reconnaissance

### Gaps

- The acp case removes its folder while something it started still writes there, the shape plugin/28 fixed.
- The cofold case reads a run's records before they are written.

## Decisions locked in

| What | Source | Task |
| --- | --- | --- |
| Test-only, the plugin/28 shape: each case waits on the writer's own completion, with a wall-clock limit that fails on its own message; no retries, no timeout changes | Softov, 2026-09-29, asked "Fix them now, the way plugin/28 did?": "Plan and build now" | 01, 02 |

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - The acp ports case waits for its shell](task-01-the-acp-ports-case-waits.md) | implemented | - |
| [02 - The cofold fork case waits for its records](task-02-the-cofold-fork-case-waits.md) | implemented | - |
| [03 - The daemon's-version case waits for the scripted docker](task-03-the-daemon-version-case-waits.md) | implemented | - |

## Resume state

- **Done so far:** planned 2026-09-29; tasks 01, 02 and 03 implemented 2026-09-29, test-only, awaiting review. The acp case's writer is the host's unawaited catalogue read, whose fixture server logs into the case's folder; the cofold case's writer is `Store.sessions.fork`, which writes the messages before the run records; the daemon's-version dev container case now waits on `answered` for its 2 docker calls, like its siblings.
- **Next action:** review of tasks 01, 02 and 03.
- **Open questions:** none.
- **Watch out for:** if the writer is product code with nothing to wait on, stop and report it.

## Final verification checklist

- [ ] 0 failures under load for each file; full `pnpm test` 3 times.
- [ ] `plans/index.md` updated.
