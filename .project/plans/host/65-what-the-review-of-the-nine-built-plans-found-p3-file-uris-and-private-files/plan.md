---
title: A file URI keeps every character of its path, and every temp file is private and swept
domain: host
status: planned
priority: high
created: 2026-10-06
revalidated: 2026-10-06
requires:
  - plans/host/65-what-the-review-of-the-nine-built-plans-found/plan.md
  - plans/host/58-private-files-refused-cursors-and-decoded-file-uris/plan.md
refs:
  - "[code://packages/sdk/src/fileuri.ts#L49-L79](../../../../packages/sdk/src/fileuri.ts#L49-L79) - `localPath` and `uriOf`"
  - "[code://packages/sdk/src/index.ts#L37](../../../../packages/sdk/src/index.ts#L37) - what the sdk exports; neither `localPath` nor `uriOf`"
  - "[code://packages/sdk/src/host/sessionmethods.ts#L907](../../../../packages/sdk/src/host/sessionmethods.ts#L907) - `localPath` of an unencoded `file://${dir}`"
  - "[code://packages/sdk/src/host/lifecycle.ts#L731](../../../../packages/sdk/src/host/lifecycle.ts#L731) - a session's directory read back from its working directories"
  - "[code://packages/sdk/src/host/changesets.ts#L40](../../../../packages/sdk/src/host/changesets.ts#L40) - the changeset's directory, the same way"
  - "[code://packages/sdk/src/host/chatactions.ts#L183](../../../../packages/sdk/src/host/chatactions.ts#L183) - and a chat's"
  - "[code://packages/agent-claude/src/session.ts#L152](../../../../packages/agent-claude/src/session.ts#L152) - an agent building `file://${cwd}`"
  - "[code://packages/server/src/daemon.ts#L124-L144](../../../../packages/server/src/daemon.ts#L124-L144) - `TEMP` and `sweepTemps`, `daemon.json` only"
  - "[code://packages/sdk/src/users.ts#L676-L695](../../../../packages/sdk/src/users.ts#L676-L695) - the users file's temp, whose comment says the sweeper knows it"
  - "[code://packages/sdk/src/policies.ts#L320-L331](../../../../packages/sdk/src/policies.ts#L320-L331) - the policies file's temp"
  - "[code://packages/sdk/src/scheduled.ts#L196-L206](../../../../packages/sdk/src/scheduled.ts#L196-L206) - the automations file's temp"
  - "[code://packages/sdk/test/users.test.ts#L536-L547](../../../../packages/sdk/test/users.test.ts#L536-L547) - the case `implemented.md` reads as two writers at once"
---

## Goal

A folder whose name holds `#` or `?` is the same folder on both sides of the wire, so no command runs in a shorter path.
Every `file:` URI the host and its agents send is built one way, the temp files beside the users, policies and automations files are private and cleared, and host/58's record says what was built.

## Reconnaissance

The files read and the patterns to reuse are the `refs` above, each with its note.

### Searches performed

- `rg -n '\`file://\$\{' packages/*/src` - in the sdk: `terminals.ts:250`, `changes.ts:498,613,673,948`, `nested.ts:336`, `debuglogs.ts:92,98`, `host/vscodemethods.ts:166,287`, `host/sessionmethods.ts:907`, `host/lifecycle.ts:517`, `host/handshake.ts:201`, `host/facts.ts:72,172`, `host/spawn.ts:766`, `host/snapshots.ts:385`; in the agents: `agent-claude/src/session.ts:152,163,209`, `agent-claude/src/catalog.ts:30`, `agent-claude/src/session/customizations.ts:55,198`, `agent-pi/src/session.ts:966,975`, `agent-pi/src/catalog.ts:172,185`, `agent-acp/src/session.ts:184,194`, `agent-acp/src/catalog.ts:83,101`, `agent-acp/src/mapping.ts:299`, `agent-cofold/src/session.ts:249,259`, `agent-cofold/src/agent.ts:763`. `agent-claude/src/input.ts:186` encodes on its own and is left.
- `node -e "require('url').fileURLToPath('file:///home/u/src/C#/app')"` - `/home/u/src/C`.
- `rg -n "\.tmp" packages/sdk/src packages/server/src/daemon.ts` - three writers name `<file>.<pid>.tmp`; the sweeper matches `daemon.json.<pid>.tmp` only.

### Gaps

- `localPath` drops a `#...` or `?...` part, and an unencoded builder puts a literal `#` in the URI, so `~/src/C#/app` is read as `~/src/C` and commands run there (findings D1, D2).
- The users, policies and automations temp files of a dead process stay forever (D3).
- A temp file left with mode `0644` keeps it through the next write and the rename (D4).
- host/58's `implemented.md` says every URI written is encoded, and that a test shows two writers at once leave the file whole (D2, D5).

## Decisions locked in

| What | Source | Task |
| --- | --- | --- |
| A literal `#` or `?` in a `file:` URI is part of the path | `(defaulted: no client sends a query or a fragment on a file URI the host reads as a folder, and dropping it names another folder)` | 01 |
| Every builder of a `file:` URI, in the sdk and in the agents, is `uriOf`; the sdk exports `localPath` and `uriOf` | host/58 task 05 step 2, and the review | 02, 03 |
| The sweeper clears `<file>.<pid>.tmp` beside every file the daemon writes that way, rather than the claim being narrowed | `(defaulted: the comment in users.ts already relies on it)` | 04 |
| A temp file is removed before it is written, so `mode` applies | `(defaulted: unlink then create, the one way the mode is the one asked for)` | 05 |

## Proposed architecture

- **Layer responsibilities** - sdk: 01, 02, 05 · agent-claude, agent-pi, agent-acp, agent-cofold: 03 · server: 04 · `.project`: 06.
- **Source-of-truth files** - [`code://packages/sdk/src/fileuri.ts`](../../../../packages/sdk/src/fileuri.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - localPath keeps a # and a ?](task-01-localpath-keeps-a-hash-and-a-question-mark.md) | todo | - |
| [02 - The sdk builds every file URI with uriOf](task-02-the-sdk-builds-every-file-uri-with-uri-of.md) | todo | 01 |
| [03 - The agents build every file URI with uriOf](task-03-the-agents-build-every-file-uri-with-uri-of.md) | todo | 02 |
| [04 - Every temp file of a dead writer is swept](task-04-every-temp-file-of-a-dead-writer-is-swept.md) | todo | - |
| [05 - A temp file is private even when one was left](task-05-a-temp-file-is-private-even-when-one-was-left.md) | todo | - |
| [06 - host/58's record says what was built](task-06-host-58s-record-says-what-was-built.md) | todo | 02, 03 |

## Risks and tradeoffs

- This child spans the sdk and four agents, for one replacement per builder; it is one child because one plan per agent would be four one-line plans.
- Task 03 makes the agents import from the sdk a symbol a `>=0.9` sdk does not export; their sdk range moves with it.
- A key compared against a URI (`changes.ts:948` deletes `file://${path}` from a reviewed set) must be built the same way as the key it was stored under, or the delete misses.

## Resume state

- **Done so far:** nothing.
- **Next action:** [task-01-localpath-keeps-a-hash-and-a-question-mark.md](task-01-localpath-keeps-a-hash-and-a-question-mark.md).
- **Open questions:** none.
- **Watch out for:** `rg -n '\`file://\$\{' packages/*/src` finds only `agent-claude/src/input.ts:186` when task 03 is done.

## Final verification checklist

- [ ] Each task's case fails on the code before it and passes after.
- [ ] `pnpm typecheck`, `pnpm boundary`, `pnpm test` pass.
- [ ] `plans/index.md` updated.
