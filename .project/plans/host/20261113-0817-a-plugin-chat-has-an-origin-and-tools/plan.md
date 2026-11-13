---
title: A plugin's chat has an origin, an interactivity and tools
domain: host
status: planned
priority: medium
created: 2026-11-13
revalidated: 2026-11-13
requires:
  - plans/host/107-a-chat-is-served-by-a-backend-of-its-own/plan.md
changes:
  - specs/sessions-and-chats.md
  - specs/plugin-contract.md
creates: []
refs:
  - git://6418b8521 - the commit of ahpd this plan was checked at
  - "[code://packages/sdk/src/types/plugin.ts#L168-L204](../../../../packages/sdk/src/types/plugin.ts#L168-L204) - `ChatRequest`: `provider`, `model`, `config`, `title`, `prompt`"
  - "[code://packages/sdk/src/plugins/validate.ts#L614-L650](../../../../packages/sdk/src/plugins/validate.ts#L614-L650) - the check of a `startChat` request, which gets the new fields"
  - "[code://packages/sdk/src/host/tooling.ts#L1917-L1995](../../../../packages/sdk/src/host/tooling.ts#L1917-L1995) - `openChat`, the road of `startChat`, which applies them"
  - "[code://packages/sdk/src/host/sessionmethods.ts#L1705-L1712](../../../../packages/sdk/src/host/sessionmethods.ts#L1705-L1712) - a client's chat writes its origin to `madeFrom` before it opens: the pattern to copy"
  - "[code://packages/sdk/src/host/chatrecord.ts#L116](../../../../packages/sdk/src/host/chatrecord.ts#L116) - a restart reads a chat's origin back from its record"
  - "[code://packages/sdk/src/host/catalogue.ts#L244-L268](../../../../packages/sdk/src/host/catalogue.ts#L244-L268) - `chatSummary` writes `interactivity: 'full'` for a chat with no state"
  - "[code://packages/sdk/src/host/spawn.ts#L661-L690](../../../../packages/sdk/src/host/spawn.ts#L661-L690) - a worker chat: `tool` origin, `read-only`, the shape a plugin's chat copies"
  - "[code://packages/sdk/src/host/spawn.ts#L1280-L1289](../../../../packages/sdk/src/host/spawn.ts#L1280-L1289) - `boundTools`, the tools a chat's backend is started with"
  - "[code://packages/sdk/src/host/chatactions.ts#L473-L495](../../../../packages/sdk/src/host/chatactions.ts#L473-L495) - a client's turn, queued message and resume in a worker chat are refused"
  - https://github.com/microsoft/agent-host-protocol/blob/2c37a04f/types/channels-chat/state.ts - `ChatOrigin`, and `ChatInteractivity` with the values `full`, `read-only`, `hidden`
---

## Goal

A plugin that opens a chat can say three things about it: its origin, how a person may use it, and its host tools.
The bot needs this to run its Back as a chat of the Front's session, tied to the Front's `subagent` call and offered `post_message`.
Today a plugin's chat is always `full`, has a `user` origin, and gets only the session's tools.

## Reconnaissance

The files read and the patterns to reuse are the `refs` in the frontmatter, each with its note.

### Searches performed

- `rg -n "startChat" packages/sdk/src` - one road, `openChat` in `tooling.ts`, for a tool call and a plugin.
- `rg -n "madeFrom.set" packages/sdk/src/host` - a client's `createChat` and a changeset write a chat's origin; `openChat` does not.
- `rg -n "interactivity" packages/sdk/src/host` - workers write `read-only`; `chatSummary` writes `full`; `chatactions.ts:1795` reads `readOnly`.

### Runtime path

```
plugin startChat(session, ChatRequest) -> validate.ts -> openChat -> madeFrom + interactivity + chat tools -> spawn -> session/chatAdded -> client
client chat/turnStarted | chat/pendingMessageSet | chat/turnResume on a read-only chat -> chatactions -> refused
```

### Gaps

- `ChatRequest` has no `origin`, `interactivity` or `tools`.
- `openChat` writes no origin, so the chat's summary says `user`.
- `chatSummary` answers `full` for a chat with no state, whatever the chat is.
- A client's turn, queued message and resume are refused only in a worker chat, not in every `read-only` chat.
- `Not found: tools kept for one chat - searched "boundTools", "asked.tools" in packages/sdk/src/host.` Tools are kept for a session.

## Answers

| What | Source | Task |
| --- | --- | --- |
| A Back is a chat of the Front's session | Softov, 2026-11-13, "2 + 3 seen reasonable" | 01 |
| `ChatRequest` gets `origin` and `tools` | Softov, 2026-11-13, chose "Tool origin, as a subagent"; the Back is offered `post_message` | 01 |
| `ChatRequest` gets `interactivity` too, though the bot's Back is `full` | Softov, 2026-11-13, chose "Add it anyway" | 01 |
| A `tool` origin names a chat of the same session | Softov, 2026-11-13, chose "Same session only" | 01 |
| `tools` names only host tools the plugin registered | Softov, 2026-11-13, chose "Only its own tools" | 01 |
| A `read-only` chat refuses a client's turn, queued message and resume, as a worker chat does | Softov, 2026-11-13, "Add it anyway", with the worker chat's rule at `chatactions.ts:492` | 02 |
| The resume check that compares with `readOnly` is fixed on its own | Softov, 2026-11-13, chose "Its own problem file" | - |

## Proposed architecture

- **Data flow** - `ChatRequest.origin` goes to `madeFrom` before the chat opens, so the record and the summary carry it. `interactivity` goes to the chat's state and its summary. `tools` joins what `boundTools` answers for that chat.
- **Event flow** - `session/chatAdded` carries the origin and the interactivity, as for a worker.
- **State flow** - the chat record keeps the origin, the interactivity and the tools, so a restart opens the chat the same.
- **Layer responsibilities** - `packages/sdk/src/types`: the fields · `packages/sdk/src/plugins/validate.ts`: their check · `packages/sdk/src/host`: applying them.
- **Source-of-truth files** - [`code://packages/sdk/src/host/tooling.ts`](../../../../packages/sdk/src/host/tooling.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - a-chat-request-names-origin-and-tools](task-01-a-chat-request-names-origin-and-tools.md) | implemented | - |
| [02 - a-read-only-chat-takes-no-turn](task-02-a-read-only-chat-takes-no-turn.md) | implemented | 01 |

## Risks and tradeoffs

- A plugin could name a call it did not make - the host checks that the origin's chat is in the session.
- Chat tools are a new thing to keep per chat - they are kept in the chat record beside the origin, not in a second store.

## Resume state

- **Done so far:** tasks 01 and 02 are `implemented`, waiting for review.
- **Next action:** Softov's review.
- **Open questions:** none.
- **Watch out for:** the protocol's value is `read-only`; `readOnly` is the refusal code in `chatactions.ts`, not an interactivity.
- **Watch out for:** a plugin cannot queue into its own `read-only` chat over its client connection. The bot's Back is `full`, so no plugin does that yet.

## Final verification checklist

- [ ] A plugin opens a `read-only` chat with a `tool` origin and the tool `post_message`, and a client sees all three in `session/chatAdded`.
- [ ] After a restart the chat has the same origin, interactivity and tools.
- [ ] In a `read-only` plugin chat, the host refuses a client's turn, queued message and resume.
- [ ] `pnpm typecheck` and the `packages/sdk` tests pass.
