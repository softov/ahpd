---
title: The queued message a command waits as answers its client
status: todo
depends: []
layer: host
refs:
  - "[code://packages/sdk/src/host.ts#L763-L799](../../../../packages/sdk/src/host.ts#L763-L799) - where an action finds the client's dispatch it answers"
  - "https://github.com/microsoft/vscode/blob/3a2421399905c0c044dade3048a797d1e9ba33d4/src/vs/platform/agentHost/common/state/agentSubscription.ts#L547-L563 - the reference client applies the envelope's own action to its pending one's `clientSeq`"
---

## Objective

A `!command` a client sends as a turn while another turn runs is answered by the `chat/pendingMessageSet` the backend holds it as, with the client's origin, and by nothing else.

## Files

- `UPDATE: packages/sdk/src/host.ts:763-799` - a queued message finds the client's turn start of its id when nothing is owed under its own kind, and the owed record is let go of under the key it was found by.
- `UPDATE: packages/sdk/test/host-terminals.test.ts` - a Claude command typed during a turn is answered by its queued message once; the queued command's case waits for the turn that took its message.
- `UPDATE: packages/agent-acp/test/agent-acp-turn.test.ts` - the same for an ACP command.
- `UPDATE: docs/sdk/TERMINALS.md` - a command sent during a turn waits as a queued message, which answers its client.
- `UPDATE: docs/sdk/AHP.md` - the `chat/turnStarted` row says the same.

## Steps

1. Write the cases and run them on `90e5eb5f` to see the queued message go out with no origin.
2. Find the owed turn under a queued message's id, and let it go.

## Validation

- The new cases fail on `90e5eb5f` and pass after the change.
- `host-terminals`, `echo-origin`, `host-senders`, `host-local-turns`, the agent-claude and the agent-acp suites pass.
- `pnpm run typecheck` and `pnpm run boundary` report no errors.

## Resume
