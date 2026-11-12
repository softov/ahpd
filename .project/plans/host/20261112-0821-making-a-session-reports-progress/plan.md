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
| Progress is sent only for a create that makes a machine; a create with no machine sends none, as VS Code's host | Softov, 2026-11-12: "Only while making a machine" | 01 |
| The steps said are `Pulling <image>`, `Making the machine`, `Seeding the checkout` and `Starting the agent` | `(defaulted: the four waits seen in the Windows check)` | 01, 02 |
| No total is sent, so a client shows the words and no share | `(defaulted: the host cannot know the steps ahead)` | 01 |

## Proposed architecture

- **Data flow** - `createSession` reads `progressToken`, and gives the create a `progress(message)` function that broadcasts `root/progress`.
- **Layer responsibilities** - sdk: the token, the broadcast and `Starting the agent` · computer: the steps of making a machine.
- **Source-of-truth files** - [`code://packages/sdk/src/types/computers.ts`](../../../../packages/sdk/src/types/computers.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - The host says each step of a create](task-01-the-host-says-each-step-of-a-create.md) | implemented | - |
| [02 - The docker runtime says its steps](task-02-the-docker-runtime-says-its-steps.md) | implemented | 01 |

## Risks and tradeoffs

- A client that sends no token gets no progress, as today.
- The last progress carries `progress` equal to `total` only at the answer, so ahpc clears its line.

## Resume state

- **Done so far:** both tasks implemented, 2026-11-12. A `createSession` with a `progressToken` and a machine source says each step through `root/progress`. It closes with `progress` equal to `total` on every path, a refusal before the claim included. A create with no token, or with no machine, says nothing. The docker runtime says `Pulling <image>` when the image is absent, then `Making the machine` and `Seeding the checkout`. The host says `Starting the agent`. The plugin's `run` wrapper carries `progress` to the router, which is where it was lost. The tests are written, and `pnpm exec tsc -p tsconfig.json --noEmit` passes. The vitest suites are left to Softov, per the session's rules.
- **Next action:** review and merge the PR, then ahpc's `cli/20261112-0821-create-session-waits-on-progress`, which must keep its timeout for a create with no machine.
- **Open questions:** none.
- **Watch out for:** a `createSession` for a session the host already holds answers at once, before anything is made. When it names a machine source, it closes the progress at once, with no step before it. The devcontainer route reports only `Starting the agent`, because a devcontainer build has no image, run or seed step of its own.

## Final verification checklist

- [ ] A `createSession` with a token in a `disposable:` machine gets one `root/progress` for each step.
- [ ] A `createSession` with no token behaves as today.
- [ ] `pnpm typecheck` and the sdk and computer suites pass.
