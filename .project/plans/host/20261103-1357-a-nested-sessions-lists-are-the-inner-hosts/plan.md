---
title: A nested session's lists are the inner host's
domain: host
status: built
priority: high
created: 2026-11-03
revalidated: 2026-11-03
refs:
  - git://c97d8459 - the commit of ahpd this plan was checked at
  - git://273af282 - the change that kept the inner lists back, so that a nested session names only channels the outer host serves
  - "https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/common/relayTransport.ts#L48-L55 - a relay forwards a remote host's messages both ways"
  - "https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/missionControl/missionControlSessionMirror.ts#L227-L228 - a mirror enqueues the source host's own envelopes for a session's chat and changeset channels"
  - "[code://packages/sdk/src/sessions/nested.ts#L104-L105](../../../../packages/sdk/src/sessions/nested.ts#L104-L105) - `OUTER_OWN`, the inner lists the proxy drops"
  - "[code://packages/sdk/src/sessions/nested.ts#L985-L990](../../../../packages/sdk/src/sessions/nested.ts#L985-L990) - `served` drops them, and the lead chat's catalogue actions"
  - "[code://packages/sdk/src/sessions/nested.ts#L1369-L1388](../../../../packages/sdk/src/sessions/nested.ts#L1369-L1388) - the proxy's state leaves out the inner lists"
  - "[code://packages/sdk/src/sessions/nested.ts#L698-L744](../../../../packages/sdk/src/sessions/nested.ts#L698-L744) - an inner terminal relayed into a channel the outer host serves, the pattern reused here"
  - "[code://packages/sdk/src/host/snapshots.ts#L165](../../../../packages/sdk/src/host/snapshots.ts#L165) - a running session's state takes the folder's changesets"
  - "[code://packages/sdk/src/host/snapshots.ts#L198](../../../../packages/sdk/src/host/snapshots.ts#L198) - a chat's state takes this host's canvases"
  - "[code://packages/sdk/src/host/catalogue.ts#L1476-L1500](../../../../packages/sdk/src/host/catalogue.ts#L1476-L1500) - `chatMoved`, which says a chat's row from the chat's state"
  - "[code://packages/sdk/src/host/catalogue.ts#L711-L722](../../../../packages/sdk/src/host/catalogue.ts#L711-L722) - `factsMoved`, which says the folder's changesets on a running session"
  - "[code://packages/sdk/src/host/facts.ts#L404-L408](../../../../packages/sdk/src/host/facts.ts#L404-L408) - a folder's refresh says its changesets on each session in it"
  - ".project/plans/host/20261101-1641-every-backend-says-its-state-by-actions/plan.md - the row this plan replaces: the outer host alone says a nested session's changesets, canvases and lead chat's row"
---

## Goal

The host a nested session runs in says the session's changesets, its chat's canvases and its lead chat's row.
The proxy relays them under the names it serves them by out here.
It serves each changeset and canvas the session names out here as it serves the session and its chat.
The outer host lays none of its own on the session.

## Reconnaissance

The files read and the patterns to reuse are the `refs` in the frontmatter, each with its note.

### Searches performed

- The ledger's follow-up section names the VS Code designs searched for one host presenting another host's session.
  These are the remote agent hosts, the dev container relay, Mission Control's mirror and publisher, peer chats and the remote-session router.
- VS Code at `a4e689ae`: relayTransport.ts and missionControlSessionMirror.ts, read again for what each relays.
- `OUTER_OWN`, `changesetsOf`, `canvases.listOf`, `chatMoved` and `factsMoved` in `packages/sdk/src/host` and `packages/sdk/src/sessions`.
- The spec at `v1.0.0`: the changeset and canvas channels' actions and commands.

### What VS Code does

- A relay forwards the remote host's messages both ways, and the client reads the session from that host.
- A mirror enqueues the source host's own envelopes for the session, its chat channels and its changeset channels.
- In each design the host running a session is the one producer of its state.

### What ahpd does

- The proxy drops the inner host's changeset and canvas lists, and its catalogue actions about the lead chat.
- The outer host lists its own folder's changesets on the nested session, and its own canvases on the chat.
- It says the lead chat's row from the chat it holds.
- The inner changeset and canvas channels are reached by no client out here.

### Runtime path

```
inner session/changesetsChanged, chat/canvasesChanged, session/chatUpdated -> pump -> served -> dropped
subscribe <session>/changeset/<scope> -> changesetAt -> the outer folder's changeset
```

### Gaps

- A nested session's changesets are the outer folder's, which the machine's own git does not share.
- A canvas the host inside opens is never listed or served out here.
- The outer host is a second producer of the session's state.

## Answers

| What | Source | Task |
| --- | --- | --- |
| The host inside says the nested session's changesets, its chat's changesets and canvases, and its lead chat's row; the proxy relays them under the outer names | [missionControlSessionMirror.ts#L227-L228](https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/missionControl/missionControlSessionMirror.ts#L227-L228); [relayTransport.ts#L48-L55](https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/common/relayTransport.ts#L48-L55); the ledger's follow-up searches | 01 |
| The proxy serves each changeset and canvas of the host inside out here: a subscribe answered from there, its actions relayed, a review and an operation carried in | the same sources; the proxy's relay of an inner terminal, [nested.ts#L698-L744](../../../../packages/sdk/src/sessions/nested.ts#L698-L744) | 01 |
| A nested session names only channels the outer host serves, which the relay keeps | git://273af282 | 01 |
| The outer host lays no changesets of its own on the session's state, its record or its watched changesets, and no canvases on its chat | the first row: one producer | 01 |
| A plugin out here opening a canvas on a nested chat is refused | the first row: one producer | 01 |
| The read and archived bits of the lead chat's row stay the outer host's, laid on the status the host inside says, as on the chat's state | the backends' plan's row "A nested chat's status is the activity the inner host's reducer gave it" | 01 |
| A changeset of a nested session nothing runs is refused | (defaulted: its host there answers it once the session runs) | 01 |
| The lists the clients out here were told at a start are said again where the host inside holds others | the proxy's own rule for the title and the turns, [nested.ts#L1258-L1276](../../../../packages/sdk/src/sessions/nested.ts#L1258-L1276) | 01 |

## Proposed architecture

- **Data flow** - the proxy relays the inner lists and rows, and a relayed channel's actions go through `Start.emitOn`.
- **State flow** - the proxy keeps each relayed channel's state, reduced with the protocol's reducer, as it keeps the session's and the chat's.
- **Layer responsibilities** - sdk sessions: the relay in the proxy, behind `Session.channel`.
  sdk host: `relayedChannel` and `relaysChangesets` in the changesets area, and this host's own lists held back.
  A subscribe, a review and an operation on a relayed channel go to the backend.
- **Source-of-truth files** - [`code://packages/sdk/src/sessions/nested.ts`](../../../../packages/sdk/src/sessions/nested.ts), [`code://packages/sdk/src/host/changesets.ts`](../../../../packages/sdk/src/host/changesets.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - The proxy relays the inner lists](task-01-the-proxy-relays-the-inner-lists.md) | done | - |

## Risks and tradeoffs

- A client out here sees a nested session's changesets only while the session runs.
- The read and archived bits of a nested chat are the outer host's alone.
  The host inside never hears a client mark the chat read.

## Resume state

- **Done so far:** task 01, 2026-11-03.
- **Next action:** none; see [implemented.md](implemented.md).
- **Open questions:** none.
- **Watch out for:** a relayed channel a client still watches when the host inside opens again.

## Final verification checklist

- [x] Each new case fails on `c97d8459`'s sources and passes after the change.
- [x] The touched files' test files pass, one file at a time.
- [x] `pnpm run typecheck` and `pnpm run boundary` report no errors, and the prose lint is clean.
