---
title: A client's call content is held
domain: host
status: built
priority: low
created: 2026-11-02
revalidated: 2026-11-02
refs:
  - git://9d1cc04e - the commit of ahpd this plan was checked at
  - "[code://docs/sdk/AHP.md#L272](../../../../docs/sdk/AHP.md#L272) - the row for `chat/toolCallContentChanged`, which says this host holds none of it"
  - "[code://packages/sdk/src/host/chatactions.ts#L1864-L1888](../../../../packages/sdk/src/host/chatactions.ts#L1864-L1888) - the case, whose comment says the same"
  - "[code://packages/sdk/test/host-tools.test.ts#L1365-L1408](../../../../packages/sdk/test/host-tools.test.ts#L1365-L1408) - the client content case, whose comment says the same"
---

## Goal

The row, the case's comment and the test say what the host does with a client's call content.
The content goes to every client of the chat, and the chat's held state folds it, so a later subscriber is served it.

## Reconnaissance

The files read and the patterns to reuse are the `refs` in the frontmatter, each with its note.

### Searches performed

- `rg -n "holds none of it|rather than reduced" docs packages` - the row, the case's comment and the test's comment.
- `rg -n "ChatToolCallContentChanged" dist/types/channels-chat/reducer.js` in the installed protocol - the reducer finds the call by its turn and id.

### Runtime path

```
client: chat/toolCallContentChanged {turnId, toolCallId, content}
  -> host checks the call's contributor -> dispatch on the chat -> emit folds it into the held state
  -> a client subscribing afterwards is served the call with its content
```

### Gaps

- Three places say the host holds none of the content, and the held state folds it since c8a586a1.
- The test sends the action with no `turnId`, which the protocol declares, so the reducer finds no call.

## Answers

| What | Source | Task |
| --- | --- | --- |
| Every action the host sends goes through its channel's reducer into the held state | c8a586a1: "Every action goes through its channel's reducer in emit" | 01 |
| A call's action carries its turn | `ToolCallActionBase.turnId` in the installed protocol's types/channels-chat/actions.ts | 01 |

## Proposed architecture

- **Data flow** - unchanged; the row and the two comments are written from it.
- **Layer responsibilities** - docs, one comment and one test in the sdk.
- **Source-of-truth files** - [`code://docs/sdk/AHP.md`](../../../../docs/sdk/AHP.md)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - the row says the content is held](task-01-the-row-says-the-content-is-held.md) | done | - |

## Risks and tradeoffs

- none.

## Resume state

- **Done so far:** task 01, 2026-11-02; [implemented.md](implemented.md) says what was verified.
- **Next action:** none.
- **Open questions:** none.
- **Watch out for:** none.

## Final verification checklist

- [x] The row and both comments say the content is held.
- [x] The test sends `turnId` and reads the content back from a later subscribe.
