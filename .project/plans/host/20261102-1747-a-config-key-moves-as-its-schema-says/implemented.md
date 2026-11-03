---
title: A config key moves as its schema says - implemented
date: 2026-11-02
refs:
  - git://f86b9301 - the last change
  - "[code://packages/sdk/src/host/chatactions.ts](../../../../packages/sdk/src/host/chatactions.ts)"
  - "[code://packages/agent-claude/src/session/config.ts](../../../../packages/agent-claude/src/session/config.ts)"
  - "[code://packages/agent-claude/src/session/turns.ts](../../../../packages/agent-claude/src/session/turns.ts)"
  - "[code://packages/agent-pi/src/session.ts](../../../../packages/agent-pi/src/session.ts)"
---

A session's config moves only where its schema lets it.
Once a chat has a turn, a key that does not say `sessionMutable: true` is refused.
Before the first turn, such a key starts the backend again with the new value.
Claude takes the keys its schema declares and refuses `autoApprove` and `mode`.
A turn's thinking level moves the CLI's effort for that turn, and the session's config stays.
A cut pi refuses is a log line, and the session runs on.

## What was built

- [`code://packages/sdk/src/host/chatactions.ts`](../../../../packages/sdk/src/host/chatactions.ts) - a declared key without `sessionMutable: true` is a fixed key.
- [`code://packages/sdk/src/host/sessionconfig.ts`](../../../../packages/sdk/src/host/sessionconfig.ts) - `runningSchema` shows each such key as a read-only chip.
- [`code://packages/agent-claude/src/session/config.ts`](../../../../packages/agent-claude/src/session/config.ts) - `setConfig` takes declared keys and the model alone.
- [`code://packages/agent-claude/src/session/turns.ts`](../../../../packages/agent-claude/src/session/turns.ts) - a turn's level goes to the CLI, and the session's comes back after it.
- [`code://packages/agent-pi/src/session.ts`](../../../../packages/agent-pi/src/session.ts) - a refused rewind is logged.

## Verified

- Each new or changed case fails on `89ebe4d5`'s sources and passes with the change.
- They are two in `session-fixed-key.test.ts`, one in `conformance.test.ts`, one in `host-harness.test.ts` and two in agent-pi.
- The sdk, agent-claude, agent-pi and agent-cofold test files pass, each timeout under load passing alone.
- `pnpm run typecheck` and `pnpm run boundary` report no errors.

## Departures from the plan

- None.

## Left for later

- F7, X10 and pi R35 keep their own checks: cofold takes any declared key, and the nested proxy refuses only `sessionMutable: false`.
- The host refuses each other declared key first, so neither check meets one on a running session.
- CT8 is unchanged: a change is answered before the SDK takes it, as the reference host says a change before its agent takes it.
- Found beside E14, not a label: the workbench's chat sends `sensitiveEditLocations` before each turn when a person's settings name hook or agent folders.
- Its sources are [agentHostSessionHandler.ts#L2273-L2286](https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/workbench/contrib/chat/browser/agentSessions/agentHost/agentHostSessionHandler.ts#L2273-L2286) and its L7605-L7617.
- The reference host takes it, as it takes any key it does not write itself ([agentService.ts#L13563-L13606](https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/agentService.ts#L13563-L13606)).
- Claude refuses it as a key it does not take, before this change and after it; `UPSTREAM.md` lists the key as not yet carried.
