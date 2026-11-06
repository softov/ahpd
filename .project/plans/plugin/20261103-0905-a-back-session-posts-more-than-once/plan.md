---
title: A back session posts more than once
domain: plugin
status: built
priority: high
created: 2026-11-03
revalidated: 2026-11-03
requires:
  - plans/plugin/20261103-0158-a-bot-chat-follows-its-back-session/plan.md
refs:
  - git://fc982631 - the commit of ahpd this plan was checked at
  - "[code://packages/bot/src/wake.ts#L539-L550](../../../../packages/bot/src/wake.ts#L539-L550) - `posted`, which removes the session from `answering` and ends the main turn with `reply`"
  - "[code://packages/bot/src/wake.ts#L553-L580](../../../../packages/bot/src/wake.ts#L553-L580) - `finished`, which ends the main turn as `mainTurnPostMessageAbsent` says"
  - "[code://packages/bot/src/wake.ts#L112-L121](../../../../packages/bot/src/wake.ts#L112-L121) - `Answering`, the main turn one back session answers"
  - "[code://packages/bot/src/wake.ts#L630](../../../../packages/bot/src/wake.ts#L630) - `woken` writes a new `Answering` on each message, a steer included"
  - "[code://packages/bot/src/chat.ts#L162-L217](../../../../packages/bot/src/chat.ts#L162-L217) - `TurnHandle`, which has no call that adds an answer and keeps the turn open"
  - "[code://packages/bot/src/chat.ts#L726-L790](../../../../packages/bot/src/chat.ts#L726-L790) - `finish`, which completes the subagent call only when `answered` is true"
  - "[code://packages/bot/src/chat.ts#L799-L820](../../../../packages/bot/src/chat.ts#L799-L820) - `reply` and `end` on the handle"
  - "[code://packages/bot/src/chat.ts#L374-L386](../../../../packages/bot/src/chat.ts#L374-L386) - the `:steer`, `:steer2` ids, the pattern for a second part of one kind"
  - "[code://packages/bot/src/post.ts#L41-L48](../../../../packages/bot/src/post.ts#L41-L48) - `POST_INSTRUCTION` and the tool description, which say to post once"
  - "[code://packages/bot/src/plugin.ts#L740-L766](../../../../packages/bot/src/plugin.ts#L740-L766) - `ended`, which calls `finished` on the back turn's `turn_end`"
---

## Goal

A back session can call `post_message` more than once in one turn, and each call reaches the person in the main chat.
The main turn waits on the back session as on a subagent.
It stays open while the back turn runs, and it ends when the back turn ends.

## Reconnaissance

The files read and the patterns to reuse are the `refs` in the frontmatter, each with its note.

### Fault

On 2026-11-03 a back session called `post_message` twice in one turn.
The first call answered "Posted to the main chat.".
The second call answered "There is no main chat waiting on this session, so there is nothing to post to.".

### Runtime path

```
post_message -> wake.posted -> answering.delete(back session) -> handle.reply(text) -> finish: main turn complete
second post_message -> wake.posted -> answering has no entry -> false -> "There is no main chat waiting"
back turn_end -> ended -> wake.finished -> answering has no entry -> nothing
```

### Gaps

- `TurnHandle` has no call that adds a response part to the open turn and keeps it open.
- `Answering` does not record that the back session posted.
- `finish` cancels the subagent call when the turn ends with `end`, because `answered` is false.

## Answers

| What | Source | Task |
| --- | --- | --- |
| A back session can post more than once in one turn | Softov, 2026-11-03: "bot consumes biding after first mcp__ahp__post_message" | 01 |
| Each post adds its text to the open main turn, and the turn stays open | (defaulted: the main turn shows the back session as a subagent call, and a subagent call is open while its turn runs) | 01 |
| The main turn ends when the back turn ends | (defaulted: `turn_end` of the back session already ends the main turn through `finished`) | 01 |
| A back turn that posted ends its main turn with no more text, and the subagent call completes | (defaulted: the posts are the answer, and the last words are usually the same text again) | 01 |
| `mainTurnPostMessageAbsent` applies only to a back turn that did not post | (defaulted: its name says the case it is for) | 01 |
| A steer into the open main turn keeps the record that the back session posted | (defaulted: a steer goes into the same main turn) | 01 |
| Each post is one markdown part, with the ids `<turn>:reply`, `<turn>:reply2` and on | (defaulted: the `:steer`, `:steer2` ids in `chat.ts`) | 01 |
| A back turn that fails after a post fails the main turn, and the posts stay in it | (defaulted: a failed send ends as failed, as before) | 01 |
| The instruction and the tool description say that each call posts, and the turn ends with the back turn | (defaulted: the text tells the model the rule it runs under) | 01 |

## Proposed architecture

- **Data flow** - each post goes from the tool to the wake, then to the open main turn as one markdown part.
- **Event flow** - `post_message` adds a part. `turn_end` of the back session ends the main turn.
- **State flow** - `Answering` stays in the map until the back turn ends, and records `posted`.
- **Layer responsibilities** - `chat.ts`: `say` on the handle · `wake.ts`: `posted` and `finished` · `post.ts`: the text the model reads.
- **Source-of-truth files** - [`code://packages/bot/src/wake.ts`](../../../../packages/bot/src/wake.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - posts add to the open main turn](task-01-posts-add-to-the-open-main-turn.md) | done | - |

## Risks and tradeoffs

- A message queued in the main chat now waits until the back turn ends, not until the first post. A steer still goes into the open turn at once.
- A back session that posts and then works for a long time keeps the main turn open for that time.

## Resume state

- **Done so far:** [task-01-posts-add-to-the-open-main-turn.md](task-01-posts-add-to-the-open-main-turn.md) is implemented, with its cases in the bot package tests.
- **Next action:** none. The plan is built, and `implemented.md` says what exists.
- **Open questions:** none.
- **Watch out for:** never use ports 5180 or 37537.

## Final verification checklist

- [x] A back turn that calls `post_message` twice shows both texts in one main turn, and the main turn ends when the back turn ends.
- [x] The subagent call in that main turn completes.
- [x] `pnpm --filter @ahpd/bot test` passes, run alone.
- [x] `pnpm typecheck` and `pnpm boundary` pass.
