---
title: Making a session reports its progress
domain: host
status: planned
priority: high
created: 2026-11-12
revalidated: 2026-11-12
requires: []
changes: []
creates: []
refs:
  - git://b4ad32951 - the commit of ahpd this plan was checked at
  - "[code://packages/sdk/src/host/sessionmethods.ts#L1253](../../../../packages/sdk/src/host/sessionmethods.ts#L1253) - `createSession`, which never reads the `progressToken` a client sends"
  - "[code://packages/sdk/src/host/vscodemethods.ts#L556-L571](../../../../packages/sdk/src/host/vscodemethods.ts#L556-L571) - the one `root/progress` this host sends today, for a debug-log collection: the pattern to copy"
  - "[code://packages/sdk/src/machines/computers.ts#L77-L80](../../../../packages/sdk/src/machines/computers.ts#L77-L80) - where the host asks the port to make a machine for a session"
  - "[code://packages/sdk/src/types/computers.ts#L476-L489](../../../../packages/sdk/src/types/computers.ts#L476-L489) - `create`, the port verb that makes the machine"
  - "[code://packages/computer/src/plugin.ts#L2164](../../../../packages/computer/src/plugin.ts#L2164) - the plugin's `create` for a `disposable:` source"
  - "[code://packages/computer/src/runtime.ts#L3326](../../../../packages/computer/src/runtime.ts#L3326) - `docker run`, then the git seed at 3335"
  - https://github.com/microsoft/agent-host-protocol/blob/v1.0.0/types/channels-root - `root/progress` against a request's `progressToken`
---

## Goal

A client that makes a session in a new machine sees what the host is doing while it waits.
Today `createSession` is silent until it answers, and on Docker Desktop that takes about 38 s.
ahpc then stops at its 30 s limit, as the [Windows check](../../../pending/windows-machine-paths-checks.md) shows.
With progress, ahpc's plan `cli/20261112-0821-create-session-waits-on-progress` waits for as long as progress comes.

## Reconnaissance

The files read and the patterns to reuse are the `refs` in the frontmatter, each with its note.

### Searches performed

- `rg "root/progress|progressToken" packages/sdk/src packages/server/src packages/computer/src` - only the debug-log collection sends progress.
- `rg "'disposable:'" packages/computer/src` - the plugin's `create` reads the source at `plugin.ts:2164`.

### Runtime path

```
createSession(progressToken) -> lifecycle create -> computers.create(MachineSource) -> plugin create -> runtime run, seed -> agent start -> answer
```

### Gaps

- `MachineSource` has no way to report a step.
- `createSession` does not pass its token on.

## Answers

| What | Source | Task |
| --- | --- | --- |
| ahpd sends `root/progress` against the `createSession` token at each step of making a machine, and ahpc waits while progress comes | Softov, 2026-11-12: "ahpd reports, ahpc waits" | 01, 02 |
| The steps said are `Pulling <image>`, `Making the machine`, `Seeding the checkout` and `Starting the agent` | `(defaulted: the four waits seen in the Windows check)` | 01, 02 |
| No total is sent, so a client shows the words and no share | `(defaulted: the host cannot know the steps ahead)` | 01 |

## Proposed architecture

- **Data flow** - `createSession` reads `progressToken`, and gives the create a `progress(message)` function that broadcasts `root/progress`.
- **Layer responsibilities** - sdk: the token, the broadcast and `Starting the agent` · computer: the steps of making a machine.
- **Source-of-truth files** - [`code://packages/sdk/src/types/computers.ts`](../../../../packages/sdk/src/types/computers.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - The host says each step of a create](task-01-the-host-says-each-step-of-a-create.md) | todo | - |
| [02 - The docker runtime says its steps](task-02-the-docker-runtime-says-its-steps.md) | todo | 01 |

## Risks and tradeoffs

- A client that sends no token gets no progress, as today.
- The last progress carries `progress` equal to `total` only at the answer, so ahpc clears its line.

## Resume state

- **Done so far:** nothing.
- **Next action:** [task-01-the-host-says-each-step-of-a-create.md](task-01-the-host-says-each-step-of-a-create.md).
- **Open questions:** none.
- **Watch out for:** a `createSession` for a session the host already holds answers at once, before anything is made.

## Final verification checklist

- [ ] A `createSession` with a token in a `disposable:` machine gets one `root/progress` for each step.
- [ ] A `createSession` with no token behaves as today.
- [ ] `pnpm typecheck` and the sdk and computer suites pass.
