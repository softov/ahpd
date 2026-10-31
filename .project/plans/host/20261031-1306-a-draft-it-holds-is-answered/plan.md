---
title: A draft the chat already holds is answered
domain: host
status: built
priority: medium
created: 2026-10-31
revalidated: 2026-10-31
refs:
  - git://a20915fb - the commit of ahpd this plan was checked at
  - "[code://packages/sdk/src/host/chatactions.ts#L1391-L1398](../../../../packages/sdk/src/host/chatactions.ts#L1391-L1398) - a running chat's draft, handed to the backend and answered by nothing when it does not move"
  - "[code://packages/sdk/src/host/chatactions.ts#L427-L449](../../../../packages/sdk/src/host/chatactions.ts#L427-L449) - a draft for a session nothing is running for, said to every client whether or not it moved"
  - "[code://packages/agent-claude/src/session/turns.ts#L703-L705](../../../../packages/agent-claude/src/session/turns.ts#L703-L705) - the Claude backend says nothing for the draft it holds; cofold, ACP, bot and the examples keep the same guard"
  - "[code://packages/sdk/src/host/chatactions.ts#L241-L247](../../../../packages/sdk/src/host/chatactions.ts#L241-L247) - a flag that did not move, answered to its sender alone with `echoTo`, the pattern to copy"
  - "[code://packages/sdk/src/host/chatactions.ts#L1399-L1420](../../../../packages/sdk/src/host/chatactions.ts#L1399-L1420) - a pending message removal read against the chat's own state before the backend is asked, the pattern to copy"
  - "https://github.com/microsoft/agent-host-protocol/blob/v1.0.0/docs/guide/reconciliation.md#L23-L30 - a client holds its action until an envelope with its own origin, or a rejection, answers it"
  - "https://github.com/microsoft/agent-host-protocol/blob/v1.0.0/docs/specification/chat-channel.md - `chat/draftChanged`, and a client clearing the draft once its message is sent"
---

## Goal

A draft set to the one the chat already holds is answered to the client that sent it, and to nobody else.
It moves nothing, so it says nothing to the other clients, as a flag set to the value it has does not.

## Reconnaissance

The files read and the patterns to reuse are the `refs` in the frontmatter, each with its note.

### Searches performed

- `rg "draftChanged|setDraft" packages` - one handler for a running chat and one for a session nothing is running for; every backend's `setDraft` but pi's returns early on an unchanged draft and says nothing.
- `rg "chatState\(\)" packages/sdk/src/host/chatactions.ts` - the chat's state is read before a backend is asked, as for a pending message removal.

### Gaps

- A draft equal to the one a running chat holds is answered with nothing, so its sender holds it as pending; this happens whenever a client clears a draft it never synced, which the protocol tells it to do once its message is sent.
- A draft equal to the one held for a session nothing is running for is said to every client, which moves `serverSeq` for nothing.

## Answers

| What | Source | Task |
| --- | --- | --- |
| The draft is compared with the one the chat's state holds, before the backend is asked | the pending message removal reads the chat's own state the same way | 01 |
| An unchanged draft is answered with `echoTo`, to its sender alone | the flags: "Its sender is holding it all the same, so it is answered, to it alone" | 01 |
| A session nothing is running for compares with the draft this host keeps for it | the same answer, from the store that holds that draft | 01 |
| The backends keep their own guard | each backend's `setDraft` says nothing for the draft it holds, which stays true | - |

## Proposed architecture

- **Event flow** - a draft equal to the held one is answered with `echoTo`; any other goes to the backend, or to the host's own store, as before.
- **Layer responsibilities** - chatactions: compares and answers.
- **Source-of-truth files** - [`code://packages/sdk/src/host/chatactions.ts`](../../../../packages/sdk/src/host/chatactions.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - A draft the chat already holds is answered](task-01-a-draft-it-holds-is-answered.md) | done | - |

## Risks and tradeoffs

- none.

## Resume state

- **Done so far:** planned and built 2026-10-31. See [implemented.md](implemented.md).
- **Next action:** none.
- **Open questions:** none.
- **Watch out for:** none.

## Final verification checklist

- [x] Each new case fails on `a20915fb` for the reason it names, and passes after the change.
- [x] The touched suites pass.
- [x] `pnpm run typecheck` and `pnpm run boundary` report no errors.
