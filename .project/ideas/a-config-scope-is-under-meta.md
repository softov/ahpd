---
title: A config property's scope is under _meta
created: 2026-11-02
refs:
  - "[code://packages/agent-claude/src/claude.ts#L321](../../packages/agent-claude/src/claude.ts#L321) - Claude's effort option sets `scope: 'chat'`"
  - "[code://packages/agent-cofold/src/agent.ts#L545](../../packages/agent-cofold/src/agent.ts#L545) - cofold's effort option sets `scope: 'chat'`"
  - "[code://packages/sdk/src/host/chatactions.ts#L1086](../../packages/sdk/src/host/chatactions.ts#L1086) - the host reads `scope` to keep a value to one chat"
  - "[code://packages/sdk/src/host/sessionmethods.ts#L726-L738](../../packages/sdk/src/host/sessionmethods.ts#L726-L738) - the slash menu reads `_meta['ahpd.argumentHint']`, the same move for a prompt's hint"
  - git://4e6d5cb8 - the review of MayCXC's branch that found it, merged in #185
---

The effort option of agent-claude and agent-cofold puts `scope: 'chat'` on a config property, and the protocol's types do not declare `scope`.
So the state those backends build still carries a field the protocol does not have, which plan host/20261101-1641 set out to remove.
The host reads `scope` to keep a value to one chat, so the field cannot simply go.
It can move under `_meta['ahpd.scope']`, as a prompt's argument hint moved under `_meta['ahpd.argumentHint']`.
