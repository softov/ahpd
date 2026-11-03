---
title: A config key moves as its schema says - implemented
date: 2026-11-02
refs:
  - git://f85b073b - the last change
  - "[code://packages/sdk/src/host/chatactions.ts](../../../../packages/sdk/src/host/chatactions.ts)"
  - "[code://packages/sdk/src/host/common.ts](../../../../packages/sdk/src/host/common.ts)"
  - "[code://packages/sdk/src/access/commandautoapprover.ts](../../../../packages/sdk/src/access/commandautoapprover.ts)"
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
`sensitiveEditLocations` is the host's key on every session, and a redirect into one of its locations asks.

## What was built

- [`code://packages/sdk/src/host/chatactions.ts`](../../../../packages/sdk/src/host/chatactions.ts) - a declared key without `sessionMutable: true` is a fixed key.
- [`code://packages/sdk/src/host/sessionconfig.ts`](../../../../packages/sdk/src/host/sessionconfig.ts) - `runningSchema` shows each such key as a read-only chip.
- [`code://packages/agent-claude/src/session/config.ts`](../../../../packages/agent-claude/src/session/config.ts) - `setConfig` takes declared keys and the model alone.
- [`code://packages/agent-claude/src/session/turns.ts`](../../../../packages/agent-claude/src/session/turns.ts) - a turn's level goes to the CLI, and the session's comes back after it.
- [`code://packages/agent-pi/src/session.ts`](../../../../packages/agent-pi/src/session.ts) - a refused rewind is logged.
- [`code://packages/sdk/src/host/common.ts`](../../../../packages/sdk/src/host/common.ts) - `HOSTS_TAKEN`, the property of `sensitiveEditLocations`.
- [`code://packages/sdk/src/host/sessionconfig.ts`](../../../../packages/sdk/src/host/sessionconfig.ts) - every session's schema declares it, and a snapshot says its value back.
- [`code://packages/sdk/src/host/lifecycle.ts`](../../../../packages/sdk/src/host/lifecycle.ts) - `backendsOwn` keeps it from a backend's start.
- [`code://packages/sdk/src/access/commandautoapprover.ts`](../../../../packages/sdk/src/access/commandautoapprover.ts) - `writeAllowed` refuses a redirect into a location.

## Verified

- Each new or changed case fails on `89ebe4d5`'s sources and passes with the change.
- They are two in `session-fixed-key.test.ts`, one in `conformance.test.ts`, one in `host-harness.test.ts` and two in agent-pi.
- Task 05's two cases fail on `65132a70`'s sources and pass with the change: the redirect was approved, and the key was refused.
- `example.test.ts` moved with the behavior: the echo backend's form lists the host's key beside `voice`.
- The sdk, agent-claude, agent-pi and agent-cofold test files pass, each timeout under load passing alone.
- `pnpm run typecheck` and `pnpm run boundary` report no errors.

## Departures from the plan

- None.

## Left for later

- F7, X10 and pi R35 keep their own checks: cofold takes any declared key, and the nested proxy refuses only `sessionMutable: false`.
- The host refuses each other declared key first, so neither check meets one on a running session.
- CT8 is unchanged: a change is answered before the SDK takes it, as the reference host says a change before its agent takes it.
- The host's `getAutoApproval` answers a command line or a tool's name, so a location keeps a redirect asking.
- A write tool asks as its backend decides, as the reference host leaves Claude's modes to its SDK.
