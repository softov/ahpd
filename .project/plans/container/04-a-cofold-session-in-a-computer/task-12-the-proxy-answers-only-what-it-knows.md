---
title: The proxy answers only what it knows
status: todo
depends: [task-10-inner-chat-uris-are-rewritten.md]
layer: "sdk | test"
refs:
  - "[code://packages/sdk/src/nested.ts#L464-L510](../../../../packages/sdk/src/nested.ts#L464-L510) - the members that answer `true` whatever happened"
  - "[code://packages/sdk/src/nested.ts#L1-L22](../../../../packages/sdk/src/nested.ts#L1-L22) - the module comment, which says what the proxy forwards"
  - "[code://test/nested-proxy.test.ts#L174-L228](../../../../test/nested-proxy.test.ts#L174-L228) - the permission test, an input request answered with `confirm`"
---

## Objective

Every `Session` member the proxy has reports the inner session's real answer, the rest are absent so the host refuses them, and the module comment lists what the proxy does not carry, per [the decision](../../../decisions/the-nested-proxy-leaves-out-what-it-cannot-forward.md).

## Files

- `UPDATE: packages/sdk/src/nested.ts:464-505` - `steer`, `resume`, `setAnswer`, `setConfig`, `setCustomizationEnabled`, `startMcpServer`, `stopMcpServer`.
- `UPDATE: packages/sdk/src/nested.ts:1-22` - the module comment.
- `UPDATE: test/nested-proxy.test.ts:174-228` - the permission case.

## Steps

1. `steer` answers from the mirrored chat whether a turn is running; `resume` whether the last turn failed; `setAnswer` whether that input request is open. Each dispatches only when it answers `true`.
2. `setConfig` refuses, with a sentence, a key the inner session's mirrored config schema does not have, and a key the schema marks as not changeable while the session runs.
3. `setCustomizationEnabled`, `startMcpServer` and `stopMcpServer` answer `false` for an id the mirrored inner state does not hold.
4. Remove any other member that cannot report the inner answer.
5. The module comment lists the `Start` fields the proxy does not carry and why, as documentation of what it is: `forkAt`, `rewindAt` and `context` (no `forkPoint` or `endPoint`, so the host never asks), `credentials` (the machine gets its keys as the agent's machine needs, [decision](../../../decisions/cofold-config-reaches-a-machine-at-a-fixed-target.md)), `tools`, `instructions` and `subagent` (host-side seams the inner host has its own of), `additional`, `terminals` and `resources` (this host's paths and stores, not the machine's). `resume` is task 11.
6. Replace the permission case with the tool-confirmation flow: the inner backend emits `chat/toolCallStart` and a `chat/toolCallReady` that asks for confirmation, the outer `confirm` answers it, and the inner backend's `confirm` sees the call id. Add a case for `answer` on a real `chat/inputRequested`.

## Validation

- `test/nested-proxy.test.ts`:
  - `steer` with no turn running answers `false` and dispatches nothing; today `true`;
  - `setConfig('nonsense', 1)` answers a sentence; today `true`;
  - `startMcpServer('missing')` answers `false`; today `true`;
  - the tool-confirmation and `answer` cases above.
- `node_modules/.bin/vitest run test/nested-proxy.test.ts` passes.

## Resume
