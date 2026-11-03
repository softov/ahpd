---
title: A tool result is said as the client sent it
domain: host
status: planned
priority: medium
created: 2026-11-03
revalidated: 2026-11-03
refs:
  - git://cde4dd6c - the commit of ahpd this plan was checked at
  - "[code://packages/sdk/src/host/chatactions.ts#L2123-L2138](../../../../packages/sdk/src/host/chatactions.ts#L2123-L2138) - the comment on `chat/toolCallComplete`, which says the harness's completion answers the client"
  - "[code://packages/sdk/src/host/chatactions.ts#L2179-L2190](../../../../packages/sdk/src/host/chatactions.ts#L2179-L2190) - the client's own action, said once the backend takes it"
  - "[code://packages/sdk/src/host.ts#L886-L901](../../../../packages/sdk/src/host.ts#L886-L901) - `answeredBy`, whose comment names a result owed under a call"
  - "[code://packages/sdk/src/host.ts#L1045-L1059](../../../../packages/sdk/src/host.ts#L1045-L1059) - the harness's later completion of a completed call, dropped"
  - "[code://packages/sdk/src/host.ts#L806-L829](../../../../packages/sdk/src/host.ts#L806-L829) - `owed`, which holds a turn begun and a message queued"
---

## Goal

The comments on a client's tool result say what the code does.
The client's own action answers the client, and nothing is owed under the call.

## Reconnaissance

The files read and the patterns to reuse are the `refs` in the frontmatter, each with its note.

### Searches performed

- `rg -n "owed to it under the call" packages/sdk/src` - the result's comment says the harness's completion answers the client.
- `rg -n "result twice" packages/sdk/src/host.ts` - `answeredBy`'s comment names a result owed under a call.
- `rg -n "owedUnder" packages/sdk/src/host.ts` - `owed` holds `chat/turnStarted` and `chat/pendingMessageSet` alone.

### Gaps

- Two comments describe an owed tool result the code no longer keeps.

## Answers

| What | Source | Task |
| --- | --- | --- |
| The client's own `chat/toolCallComplete` is said once the backend takes it, and the harness's later completion of the call is dropped | [`code://packages/sdk/src/host/chatactions.ts`](../../../../packages/sdk/src/host/chatactions.ts); [`code://packages/sdk/src/host.ts`](../../../../packages/sdk/src/host.ts) | 01 |
| `owed` holds a turn begun and a message queued, by channel, kind and what each names | [`code://packages/sdk/src/host.ts`](../../../../packages/sdk/src/host.ts) | 01 |
| No behavior moves, so no case changes | `(defaulted: a comment is not behavior)` | - |

## Proposed architecture

- **Layer responsibilities** - sdk: two comments.
- **Source-of-truth files** - [`code://packages/sdk/src/host/chatactions.ts`](../../../../packages/sdk/src/host/chatactions.ts), [`code://packages/sdk/src/host.ts`](../../../../packages/sdk/src/host.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - The comments say what answers a result](task-01-the-comments-say-what-answers-a-result.md) | todo | - |

## Risks and tradeoffs

- None.

## Resume state

- **Done so far:** nothing.
- **Next action:** task 01.
- **Open questions:** none.
- **Watch out for:** nothing.

## Final verification checklist

- [ ] `pnpm run typecheck` and `pnpm run boundary` report no errors, and the prose lint is clean.
