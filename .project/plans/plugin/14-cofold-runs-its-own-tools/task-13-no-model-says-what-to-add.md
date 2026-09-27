---
title: A turn with no model says to add "model" to the cofold configuration file
status: done
depends: []
layer: "agent-cofold"
refs:
  - "[code://packages/agent-cofold/src/agent.ts#L249-L250](../../../../packages/agent-cofold/src/agent.ts#L249-L250) - `connectionOf`'s error, which names the path and what to add to it"
  - "[code://packages/agent-cofold/src/config.ts#L45-L46](../../../../packages/agent-cofold/src/config.ts#L45-L46) - `harnessConfigPath`"
  - "[code://packages/agent-cofold/test/agent-cofold-turn.test.ts#L407-L434](../../../../packages/agent-cofold/test/agent-cofold-turn.test.ts#L407-L434) - the no-model turn test"
---

## Objective

With no model in the session settings, the plugin options or the cofold configuration file, the turn's error tells the person to add `"model"` to that file and names its path, per [A cofold turn with no model configured fails and says to add "model" to the cofold configuration file](../../../decisions/a-cofold-turn-with-no-model-fails-and-says-where-to-name-one.md).

## Files

- `UPDATE: packages/agent-cofold/src/agent.ts:249-250` - the message.
- `UPDATE: packages/agent-cofold/test/agent-cofold-turn.test.ts:427-428` - the assertions.

## Steps

1. Check first that the sentence reaches the person: the existing test sees it in the chat's actions, so it does today; record in *Resume* which action carries it.
2. Reword the `reference === undefined` error in `connectionOf` to say no model is configured and to add `"model"` (as `"<provider>/<model>"`) to `harness.path`, naming the path.
3. Leave the other `strict` error, a model naming an unknown provider, as it is.

## Validation

- The test asserts the chat's error contains `add "model"` and the configuration path under the test's `XDG_CONFIG_HOME` (`<home>/cofold/config.json`); it fails today, because the sentence says only `no model was chosen`.
- `node_modules/.bin/vitest run packages/agent-cofold/test/agent-cofold-turn.test.ts` green.

## Resume

The sentence reaches the person on the `chat/error` action, in `part.error.message`, which the test reads. Done.
