---
title: The stale prose matches the code again - implemented
date: 2026-09-20
refs:
  - code://packages/server/src/main.ts
  - code://docs/DAEMON.md
  - code://docs/AGENT.md
  - code://packages/sdk/src/host.ts
  - code://packages/agent-claude/src/claude.ts
  - code://packages/agent-claude/src/session.ts
  - code://test/conformance.test.ts
  - code://test/host.test.ts
  - code://test/fixtures/wire.jsonl
---

Six places where this repository's own prose contradicted its code now agree, and the Claude backend advertises the sixth permission mode it already accepted, so a person who reads a file instead of the code is no longer misled about what the daemon refuses, which flags exist, what the resource methods serve, whether a chat can be forked, or which permission modes the Claude backend takes.

## What was built

- `code://packages/server/src/main.ts` - the `--path` USAGE row says the first path is the default and the catalogue is the union, and the parse comment keeps only why a second `--path` exists.
- `code://docs/DAEMON.md` - the options table gained `--sessions <where>`, `--wire <file>` and `--version, -v`, in the USAGE order.
- `code://docs/AGENT.md` - the controls row names `setConfig(key, value)` and `settings()` and drops the four setters that do not exist on `Session`.
- `code://packages/sdk/src/host.ts` - the `resource*` comment says both halves are served and the write half is gated by a `resourceRequest` grant answering `-32009`; the `source` comment says a `fork` and a `sideChat` are accepted.
- `code://packages/agent-claude/src/claude.ts` - the advertised `permissionMode` enum, labels and descriptions carry `dontAsk`, and the comment beside it says six values.
- `code://packages/agent-claude/src/session.ts` - the two comments that counted four or five permission modes now say six; the accepted list at line 2264 already carried `dontAsk`.
- `code://test/conformance.test.ts` - the full enum assertion expects the six modes and the test name says six.
- `code://test/host.test.ts` - the schema assertion names `dontAsk` as the working mode.
- `code://test/fixtures/wire.jsonl` - rewritten by `test/wire.test.ts` and carries the six-mode enum in both recorded schemas.

## Verified

- The six checklist greps: no `--path` refusal claim in `main.ts`; the three new rows in `docs/DAEMON.md`; no `setModel`, `setPermissionMode`, `setEffort` or `setOutputStyle` in `docs/AGENT.md`; no `is not served` on the two corrected comments; `dontAsk` in `claude.ts`, `session.ts`, `test/conformance.test.ts` and `test/host.test.ts`.
- `pnpm test` green: 36 files, 641 tests.
- `pnpm typecheck` and `pnpm boundary` green.

## Departures from the plan

- Every cited line had moved since the plan was written, so each edit was made against the line read at the time, as the risk note anticipated; the permission-mode comments now sit at `claude.ts:109`/`123` and `session.ts:401`/`2260`.
- `session.ts:401` said the backend advertises "its own four values", which the plan did not name; it was corrected to six because it is the same count as the "five values" comment the step names, and leaving it would have created a fresh stale claim in the step's own subject.
- `test/host.test.ts:1753` asserted `toContain('plan')`; it now asserts `toContain('dontAsk')`, which is the assertion the plan says moves with the enum.
- `test/fixtures/wire.jsonl` moved with the enum as a generated output of `test/wire.test.ts`; the plan did not list it, and it is a recording rather than a seventh finding.

## Left for later

- `docs/AGENT.md`'s "Config keys" section still says `permissionMode`, `model`, `effortLevel` and `outputStyle` "have setters of their own", which reads as the four setters the controls row just dropped; it is the same drift the task scoped to the controls row and no step names it, so it is left rather than folded in.
- The detached-worktrees comment is the plan's recorded seventh drift and is untouched.
