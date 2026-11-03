---
title: A nested session's own bits are the inner host's
domain: host
status: built
priority: high
created: 2026-11-03
revalidated: 2026-11-03
refs:
  - git://3945964a - the commit of ahpd this plan was checked at
  - "https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/common/relayTransport.ts#L48-L55 - a relay forwards a client's messages to the host running the session"
  - "https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/missionControl/missionControlSessionMirror.ts#L227-L228 - a mirror carries the running host's own envelopes for the session"
  - "[code://.project/plans/host/20261103-1357-a-nested-sessions-lists-are-the-inner-hosts/task-02-the-lead-chats-bits-are-the-inner-hosts.md](../20261103-1357-a-nested-sessions-lists-are-the-inner-hosts/task-02-the-lead-chats-bits-are-the-inner-hosts.md) - the task that carried the lead chat's bits inside, and left the session's with this host"
  - "[code://packages/sdk/src/host/actions.ts#L892-L960](../../../../packages/sdk/src/host/actions.ts#L892-L960) - a client's session read and archive, kept by this host"
  - "[code://packages/sdk/src/host/spawn.ts#L1328-L1354](../../../../packages/sdk/src/host/spawn.ts#L1328-L1354) - the lead chat's relayed bits, and this host's own session read after a relayed chat read"
  - "[code://packages/sdk/src/host/spawn.ts#L1559-L1579](../../../../packages/sdk/src/host/spawn.ts#L1559-L1579) - a turn's end, which marks the session unread here"
  - "[code://packages/sdk/src/host/merged.ts#L197-L210](../../../../packages/sdk/src/host/merged.ts#L197-L210) - the archive of a session whose pull requests are merged"
  - "[code://packages/sdk/src/sessions/nested.ts#L1007-L1039](../../../../packages/sdk/src/sessions/nested.ts#L1007-L1039) - the proxy relays the inner session's actions, its bits among them"
---

## Goal

A session nested in a machine has its own read and archived bits from the host inside.
A client's read or archive of the session goes there, and that host answers the client.
The bits it says are the session's here, said once, and this host moves none of them itself.

## Reconnaissance

The files read and the patterns to reuse are the `refs` in the frontmatter, each with its note.

### Searches performed

- `session/isReadChanged`, `session/isArchivedChanged`, `sessionFlag` and `kept.setFlags` in `packages/sdk/src`.
- What the proxy relays from the inner session's channel, in `nested.ts`.
- `flag` and `ownBit` in `spawn.ts` and `chatactions.ts`, from the lead chat's task.

### What the sources say

- VS Code's relay forwards a client's message to the host that runs the session.
- Its mirror carries that host's own envelopes, so the host running a session is the one producer of its state.

### What ahpd does

- The lead chat's bits go inside through `Session.flag`, and are kept here as the host inside says them.
- A client's read or archive of the session is kept here, and never reaches the host inside.
- This host marks the session unread at a turn's end, and reads it after a relayed chat read.
- This host archives a session whose pull requests are merged.
- The proxy relays the inner session's own bits out as well, so every client hears each move twice.
- The catalogue row reads this host's bits while the session's state reduces both.

### Gaps

- A nested session's bits have two producers, and its clients hear each move twice.

## Answers

| What | Source | Task |
| --- | --- | --- |
| A client's read and archive of a nested session go to the host inside, which answers it | [relayTransport.ts#L48-L55](https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/common/relayTransport.ts#L48-L55) | 01 |
| The bits the host inside says are the session's here, through the one road that keeps a session's bits | [missionControlSessionMirror.ts#L227-L228](https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/missionControl/missionControlSessionMirror.ts#L227-L228) | 01 |
| This host moves none of a nested session's bits at a turn's end or a chat's read, which the host inside moves | the same two lines | 01 |
| This host's archive of a merged session goes inside for a nested one | the same two lines | 01 |
| `Session.flag` names which it carries, the chat's or the session's | the lead chat's task, which added it for the chat | 01 |

## Proposed architecture

- **Data flow** - a client's session bit goes through the lead chat's `flag` with `session`, and the proxy carries it inside.
- **State flow** - a relayed session bit goes through `sessionFlag`, under the client's origin where it answers one.
- **Layer responsibilities** - sdk: `Session.flag`, the client's session flag, the relay's session bits, the turn's end, the merged archive, the proxy.
- **Source-of-truth files** - [`code://packages/sdk/src/host/spawn.ts`](../../../../packages/sdk/src/host/spawn.ts), [`code://packages/sdk/src/host/actions.ts`](../../../../packages/sdk/src/host/actions.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - The session's bits go inside](task-01-the-sessions-bits-go-inside.md) | done | - |

## Risks and tradeoffs

- A nested session nothing runs keeps the bits it last heard, and takes a client's read there, as any session asleep does.

## Resume state

- **Done so far:** task 01, 2026-11-03.
- **Next action:** none; see [implemented.md](implemented.md).
- **Open questions:** none.
- **Watch out for:** the archive's housekeeping in `sessionFlag`, which a relayed archive goes through too.

## Final verification checklist

- [x] The new case fails on `3945964a`'s sources and passes after the change.
- [x] The nested proxy's test file passes.
- [x] `pnpm run typecheck` and `pnpm run boundary` report no errors, and the prose lint is clean.
