---
title: post_message runs without asking
status: done
depends: [task-04-post-message-ends-the-main-turn.md]
layer: "packages/sdk, packages/agent-claude, packages/bot"
refs:
  - "[code://packages/sdk/src/types/host.ts#L677-L713](../../../../packages/sdk/src/types/host.ts#L677-L713) - `HostTool`, with `effects` and `optIn` as the pattern for a new field"
  - "[code://packages/sdk/src/types/agent.ts#L79-L90](../../../../packages/sdk/src/types/agent.ts#L79-L90) - `BoundTool`, which carries `effects` to a backend"
  - "[code://packages/sdk/src/host/tooling.ts#L1771](../../../../packages/sdk/src/host/tooling.ts#L1771) - the bind copies `effects` onto the bound tool"
  - "[code://packages/agent-claude/src/session/asking.ts#L174-L193](../../../../packages/agent-claude/src/session/asking.ts#L174-L193) - `settled` and `canUseTool`, which ask a person about a tool that no list names"
  - "[code://packages/bot/src/post.ts#L39-L79](../../../../packages/bot/src/post.ts#L39-L79) - `post_message`, which replies only to the main chat that woke the calling session"
---

## Objective

A host tool can say that it runs without a person's confirmation.
`post_message` says so, because the reply is the back session's own work.
A deny list still wins over the flag.

`post_message` already replies only to the main chat that woke the calling session.
The host gives the caller's session in `at.session`, and the input names no chat.
A session that no wake started has nothing to post to, so it cannot reply as another bot.

## Files

- `UPDATE: packages/sdk/src/types/host.ts` - add `confirm?: boolean` to `HostTool`, where `false` runs the tool without asking.
- `UPDATE: packages/sdk/src/types/agent.ts` - carry `confirm` on `BoundTool`.
- `UPDATE: packages/sdk/src/host/tooling.ts` - the bind copies `confirm` as it copies `effects`.
- `UPDATE: packages/agent-claude/src/session/asking.ts` - `canUseTool` allows a bound host tool with `confirm: false`, unless the deny list names it.
- `UPDATE: packages/bot/src/post.ts` - `post_message` sets `confirm: false`.
- `UPDATE: packages/bot/test/bot-post.test.ts` - the tool sets the flag.
- `CREATE: packages/agent-claude/test/host-tool-confirm.test.ts` - a tool with the flag runs without a question, and a denied one is still refused.

## Steps

1. Add `confirm?: boolean` to `HostTool`, and document that `false` runs the tool without a person's confirmation.
2. Carry `confirm` on `BoundTool`, and copy it in the bind beside `effects`.
3. In `canUseTool`, answer `allow` for an offered host tool with `confirm: false`, after the deny check.
4. Set `confirm: false` on `post_message`.
5. Read how `agent-acp`, `agent-pi` and `agent-cofold` ask about a host tool.
6. Honour the flag in each backend that asks, or report that it does not ask.

## Validation

- `host-tool-confirm.test.ts`: test that a tool with `confirm: false` runs with no `input_needed_set`.
- `host-tool-confirm.test.ts`: test that a deny list refuses the same tool.
- `bot-post.test.ts`: test that `post_message` sets `confirm: false`.
- By hand: a bot's back session in the default permission mode posts with no approval.
- The gates pass: build, typecheck, boundary, schema and vitest.
