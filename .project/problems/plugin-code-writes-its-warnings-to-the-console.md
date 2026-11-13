---
title: Plugin code writes its warnings to the console, not to the daemon's log
status: open
date: 2026-11-13
severity: minor
blocks: []
refs:
  - git://970d952e7 - main when the problem was read
  - "[code://packages/activepieces/src/files.ts#L256-L259](../../packages/activepieces/src/files.ts#L256-L259) - a file a piece cannot fetch: the stack goes to the console, and the piece gets `null`"
  - "[code://packages/activepieces/src/engine.ts#L334](../../packages/activepieces/src/engine.ts#L334)"
  - "[code://packages/agent-claude/src/session/query.ts#L896-L906](../../packages/agent-claude/src/session/query.ts#L896-L906) - the context breakdown, three lines"
  - "[code://packages/agent-claude/src/session/turns.ts#L329](../../packages/agent-claude/src/session/turns.ts#L329)"
  - "[code://packages/agent-claude/src/session/config.ts#L167](../../packages/agent-claude/src/session/config.ts#L167)"
  - "[code://packages/agent-pi/src/session.ts#L1091](../../packages/agent-pi/src/session.ts#L1091) - `options.log` is used for the same kind of line at L1078"
  - "[code://packages/agent-pi/src/tools.ts#L95](../../packages/agent-pi/src/tools.ts#L95)"
  - "[code://packages/sdk/src/repo/worktrees.ts#L242](../../packages/sdk/src/repo/worktrees.ts#L242)"
  - "[code://packages/sdk/src/host/tooling.ts#L1421-L1424](../../packages/sdk/src/host/tooling.ts#L1421-L1424)"
---

## Symptom

Fourteen lines in `packages/*/src` write with `console.warn` or `console.error`, in activepieces, agent-claude, agent-pi and the sdk.
In a detached daemon they land in `daemon.log` as bare lines, with no time and no level. The test daemon's log of 2026-11-13 holds five of `@ahpd/agent-claude: the context breakdown took too long; it is left out`.
In every CI run, activepieces prints a whole `TypeError: fetch failed` stack when a test hands a piece a file URL with a bad port.

## Cause

Each package has a logger in reach and does not use it there:

- agent-claude and agent-pi take `log` in their options from `host.log`. agent-pi uses it two lines before one of its `console.warn` calls.
- activepieces runs inside its plugin, which has `host.log`.
- The sdk host has its own log.

## Impact

- A level filter and a time are missing for these lines, so a person who reads `daemon.log` cannot place them.
- A file URL a piece cannot fetch becomes `null` for the piece, and the person never learns why.

## Workaround

None.

## Fix

- Send each line through the logger its package has, at `warn`, or `error` for the activepieces stack.
- Give a piece a refusal that names the URL and the reason, in place of `null`.
- Add a check that fails on `console.` in `packages/*/src`, apart from the server's own command output.
