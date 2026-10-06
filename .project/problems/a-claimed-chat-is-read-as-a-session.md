---
title: A chat a client named itself is read with session grants, not chat grants
status: open
refs:
  - "[code://packages/sdk/src/host/routing.ts#L353](../../packages/sdk/src/host/routing.ts#L353) - `channelKind` reports a claimed chat as `session`"
  - "[code://packages/sdk/src/host/gate.ts#L227-L229](../../packages/sdk/src/host/gate.ts#L227-L229) - `channelRead` answers `session:state` for it"
  - "[code://packages/sdk/test/users-gate-sessions.test.ts#L42](../../packages/sdk/test/users-gate-sessions.test.ts#L42) - the case that locks the `session:state` answer in"
---

A chat a client created under a name of its own, such as `peer:/two`, is gated as a session: a role holding only `session:state` reads its turns, and a role holding only `chat:turns` is refused.
A default or worker `ahp-chat:` chat correctly needs `chat:turns`.
Found in the 2026-10-06 review of host/30; it matters only for custom roles, since the built-in groups hold both.
Undecided: whether a claimed chat is a chat for the gate, which would change the test at line 42.
