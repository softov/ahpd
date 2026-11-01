---
title: Claude says its state by actions
status: todo
depends: []
layer: "agent-claude, sdk host"
refs:
  - "[code://packages/agent-claude/src/session/turns.ts](../../../../packages/agent-claude/src/session/turns.ts) - `runCommand`, a person's `!` command"
  - "[code://packages/agent-claude/src/session/config.ts](../../../../packages/agent-claude/src/session/config.ts) - `setConfig`, where `mode` and `autoApprove` are taken"
  - "[code://packages/agent-claude/src/session.ts](../../../../packages/agent-claude/src/session.ts) - the session state and `close`"
  - "[code://packages/agent-claude/src/session/servers.ts](../../../../packages/agent-claude/src/session/servers.ts) - `laid`, which says the customization list"
  - "[code://packages/agent-claude/src/session/customizations.ts](../../../../packages/agent-claude/src/session/customizations.ts) - a prompt's entry"
  - "[code://packages/sdk/src/host/chatactions.ts](../../../../packages/sdk/src/host/chatactions.ts) - the echo of a config key a backend took"
  - "[code://packages/sdk/src/types/session.ts](../../../../packages/sdk/src/types/session.ts) - `Session.setConfig`"
---

## Objective

Every change a Claude session makes that a client can see goes out as its action.
Its state carries no field a type does not declare.

## Files

- `UPDATE: packages/agent-claude/src/session/turns.ts:520-532` - a failed `!` command ends its turn complete and marks nothing failed.
- `UPDATE: packages/sdk/src/types/session.ts:764-779` - `setConfig` may answer the values it took, under its own keys.
- `UPDATE: packages/sdk/src/host/chatactions.ts:1051-1062` - the echo and the store carry the values the backend took.
- `UPDATE: packages/agent-claude/src/session/config.ts:247-302` - `mode` and `autoApprove` are answered as the `permissionMode` taken.
- `UPDATE: packages/agent-claude/src/session.ts:206-325` - `error` leaves the session state; a stop says each held entry removed and its running turn cancelled.
- `UPDATE: packages/agent-claude/src/session/servers.ts:92-108` - a list that moved is said, an empty one included.
- `UPDATE: packages/agent-claude/src/session/customizations.ts:278-288` - a prompt's hint goes under `_meta['ahpd.argumentHint']`.
- `UPDATE: packages/sdk/src/host/sessionmethods.ts:728-745` - the hint is read where the protocol lets a prompt carry one.
- `UPDATE: docs/sdk/AGENT.md:193-215` - what `setConfig` answers.

## Steps

1. End a failed `!` command's turn `complete`, as its action says, with the failure on its call.
2. Let `setConfig` answer the values it took, and have the host echo and keep those.
3. Answer `mode` and `autoApprove` with the `permissionMode` they took.
4. Remove `error` from the session state.
5. On a stop, say each entry the session holds removed, and end its running turn cancelled.
6. Say the customization list whenever it moved.
7. Put a prompt's argument hint under `_meta['ahpd.argumentHint']`, and read it there.
8. Run the Claude suites and the sdk suites that drive Claude.

## Validation

- A test of each change fails before it, for the reason the change names, and passes after it.
- `pnpm exec vitest run packages/agent-claude/test` and the sdk suites that drive Claude pass.

## Resume

<Empty until started.>
