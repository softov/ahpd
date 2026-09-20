---
title: The stale prose matches the code again
domain: documentation
status: planned
priority: low
created: 2026-09-19
revalidated: 2026-09-19
requires: []
changes: []
creates: []
decisions:
  - decisions/stale-docs-are-corrected-in-one-task.md
refs:
  - code://packages/server/src/main.ts#L84-L133 - USAGE, whose `--path` row says a directory not named there is refused
  - code://packages/server/src/main.ts#L147-L156 - the parse comment that explains the fence the flag no longer is
  - code://docs/DAEMON.md#L33-L46 - the options table, which omits `--sessions`, `--wire` and `--version`
  - code://docs/DAEMON.md#L63-L79 - the section that already says `--path` "is not a fence"
  - code://docs/AGENT.md#L115-L124 - the controls row listing four setters that do not exist
  - code://packages/sdk/src/types/session.ts#L401 - `setConfig(key, value)`, the only control setter the `Session` interface declares
  - code://packages/sdk/src/host.ts#L4546-L4553 - the `resource*` comment that calls the write half unserved
  - code://packages/sdk/src/host.ts#L4837-L4905 - the write half that is served behind `needsWrite` and `-32009`
  - code://packages/sdk/src/host.ts#L5140-L5147 - the `source` comment that says it is not served
  - code://packages/sdk/src/host.ts#L5167-L5188 - the `fork` and `sideChat` handling the comment denies
  - code://packages/agent-claude/src/session.ts#L2190-L2208 - the six permission modes the backend accepts
  - code://packages/agent-claude/src/claude.ts#L125-L146 - the five permission modes the backend advertises
  - code://test/conformance.test.ts#L663-L667 - the assertion that pins the advertised enum
  - code://test/host.test.ts#L1747 - the assertion that the schema carries a working permission mode
  - git://24bb04c - the commit that removed the `--path` fence from resources, terminals, sessions and worktrees
  - code://.project/review/2026-09-19-upstream-pass-4.md#L83 - the six pre-existing drifts this plan corrects
  - code://.project/review/2026-09-19-upstream-pass-4.md#L82 - the detached-worktrees comment, a seventh drift that is not one of these six
  - npm://@anthropic-ai/claude-agent-sdk@^0.3.250 - `PermissionMode` has six members, so `dontAsk` is a real mode
---

## Goal

Six places where the repository's own prose contradicts its code stop contradicting it, in one documentation task with six steps, so a person who reads a file instead of the code is not misled about what the daemon refuses, what a session can be told, which flags exist, what the resource methods serve, whether a chat can be forked, or which permission modes the Claude backend takes.

## Reconnaissance

The files read and the patterns to reuse are the `refs` above, each with its note.

### Searches performed

- `grep -n "refused" packages/server/src/main.ts` - the `--path` row at 98 and the parse comment at 153 both still describe a fence, while `docs/DAEMON.md:74` says it is not one and `git://24bb04c` removed it.
- `grep -n "setModel\|setPermissionMode\|setEffort\|setOutputStyle" docs/AGENT.md packages/sdk/src/types/session.ts` - the four names appear only at `docs/AGENT.md:122`; `session.ts:401` declares `setConfig` and no such setters.
- `grep -n -- "--sessions\|--wire\|--version" docs/DAEMON.md packages/server/src/main.ts` - all three are in USAGE at 109, 113 and 120 and absent from the `docs/DAEMON.md` table at 35 to 46.
- `grep -n "is not served" packages/sdk/src/host.ts` - two comments, at 4549 and 5144, both contradicted by the served methods at 4837 to 4905 and 5167 to 5188.
- `grep -n "permissionMode" packages/agent-claude/src/claude.ts packages/agent-claude/src/session.ts` - `claude.ts:130` advertises five modes and `session.ts:2198` accepts six.
- `grep -n "dontAsk" packages/agent-claude/src packages/sdk/src` - nothing; the sixth mode is accepted but never advertised.

### Runtime path

```
a person reads USAGE or docs/DAEMON.md or docs/AGENT.md
  -> the prose names a refusal, a setter, a flag or a mode
  -> the code at the cited line does something else
  -> the person acts on the prose and the daemon refuses, ignores or offers less than promised
```

### Gaps

- All six were checked against the code they describe, and each is real; the review's line numbers were confirmed and are used here.
- The permission-mode mismatch is the one fix that may be code rather than prose, and it is corrected by making the advertised list and the accepted list agree.
- `Not found: a test that reads USAGE or a document - searched "USAGE" and "DAEMON.md" in test/; the documents are checked by reading them against the code.`
- The detached-worktrees comment at `host.ts:4095-4104` is a seventh drift the decision's Context names and the review keeps at line 82; it is not one of these six and is left to the next pass rather than folded in silently.

## Decisions locked in

| # | Decision | Rationale / source |
| --- | --- | --- |
| 1 | [The stale documentation is corrected in one task, not left to the next pass](../../../decisions/stale-docs-are-corrected-in-one-task.md) | Softov, asked 2026-09-19: "Fix them all as one small documentation task." |

| What | Source | Task |
| --- | --- | --- |
| All six corrections are one task with six steps and it does not grow a seventh finding silently | decision 1, Consequences | 01 |
| The permission-mode mismatch is fixed by making the advertised list and the accepted list agree, not by documenting the difference away | decision 1, Decision | 01 |
| `dontAsk` is the advertised side of that fix, because the SDK's `PermissionMode` has six members and `session.ts` already passes it to `setPermissionMode` | `npm://@anthropic-ai/claude-agent-sdk@^0.3.250` and `code://packages/agent-claude/src/session.ts#L2198` | 01 |
| The detached-worktrees comment is not one of the six and is left to the next pass | `code://.project/review/2026-09-19-upstream-pass-4.md#L82` | - |
| Each step confirms its line before editing and uses the real one when a line has moved | `(defaulted: the review was written on 2026-09-19 and a later edit can shift a line)` | 01 |

## Proposed architecture

- **Data flow** - none; this is prose and one enum changed to match the code beside it.
- **Event flow** - none.
- **State flow** - none.
- **Layer responsibilities** - packages/server/src/main.ts: `USAGE` and its parse comment · docs/AGENT.md: the controls row · docs/DAEMON.md: the options table · packages/sdk/src/host.ts: two method comments · packages/agent-claude/src/claude.ts and session.ts: the advertised and accepted permission modes, which must end equal.
- **Source-of-truth files** - `code://packages/server/src/main.ts`, `code://docs/DAEMON.md`, `code://packages/agent-claude/src/claude.ts`.

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - Correct the stale prose](task-01-correct-the-stale-prose.md) | todo | - |

## Risks and tradeoffs

- A line number may have moved since the review, so every step reads the site first and cites the line it actually edits.
- The permission-mode fix changes the advertised enum, which `test/conformance.test.ts:665` and `test/host.test.ts:1747` assert on, so the tests move with the code in the same change.
- The documents have no test, so the checklist greps for the removed claims rather than trusting a green suite.
- One task carrying six unrelated edits is the decision's shape, so a seventh finding met while editing is recorded in the plan and not fixed here.

## Resume state

- **Done so far:** nothing; the plan and its task file were written 2026-09-19.
- **Next action:** [task-01-correct-the-stale-prose.md](task-01-correct-the-stale-prose.md).
- **Open questions:**
  1. Is the permission-mode fix prose or code? - proposed: code, advertise `dontAsk` and make both lists six.
- **Watch out for:** the six are unrelated and are six steps; do not merge them, and do not fold the detached-worktrees comment in as a seventh.

## Final verification checklist

- [ ] `grep -n "is refused\|refused rather than served" packages/server/src/main.ts` returns no `--path` claim.
- [ ] `docs/DAEMON.md`'s options table names `--sessions`, `--wire` and `--version`.
- [ ] `docs/AGENT.md` lists only `setConfig` among the control setters it names.
- [ ] The `resource*` comment and the `source` comment say what the code serves.
- [ ] `claude.ts` and `session.ts` agree on six permission modes and the two test assertions match.
- [ ] `pnpm test` green; `pnpm typecheck` and `pnpm boundary` green.
- [ ] `plans/index.md` updated.
