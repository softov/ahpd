---
title: A long session compacts itself before it fills the model
status: todo
depends: [task-02-a-turn-runs-on-the-providers-model-with-its-price.md]
layer: "agent-cofold, docs"
refs:
  - "[code://packages/agent-cofold/src/turnagent.ts#L178-L222](../../../../packages/agent-cofold/src/turnagent.ts#L178-L222) - the `createAgent` call, with no `context`"
  - "[code://packages/agent-cofold/src/agent.ts#L27-L84](../../../../packages/agent-cofold/src/agent.ts#L27-L84) - `CofoldOptions`, which gains the option"
  - "[code://packages/agent-cofold/src/plugin.ts#L51-L89](../../../../packages/agent-cofold/src/plugin.ts#L51-L89) - `optionsSchema`"
  - "[code://packages/agent-cofold/README.md#L58-L76](../../../../packages/agent-cofold/README.md#L58-L76) - the options table"
  - "[code://docs/PLUGINS.md#L616-L630](../../../../docs/PLUGINS.md#L616-L630) - the cofold options table in the plugin guide"
  - npm://@cofold/agents@0.1.2 - `ContextOptions`: `maxTokens` default 32000, `autoCompactTokens` absent means never, must be positive
  - file:///github/cofold/packages/papo/src/agent.ts - `AUTO_COMPACT_AT = 0.8` and `context: { maxTokens, autoCompactTokens }`
---

## Objective

Every cofold turn is built with a `context` whose `autoCompactTokens` is set, so cofold summarizes the history before a model step that would go over it.
The point is the plugin option `autoCompactTokens` when it is set, but never above 80% of the model's listed `contextTokens`, or of 32000 when the list gives none; unset, it is that 80%.

## Files

- `UPDATE: packages/agent-cofold/src/agent.ts:27-84` - `CofoldOptions.autoCompactTokens?: number`, with a comment saying what it is and its cap.
- `UPDATE: packages/agent-cofold/src/plugin.ts:51-89` - `autoCompactTokens: { type: 'integer', minimum: 1, description: ... }` in `optionsSchema`.
- `UPDATE: packages/agent-cofold/src/turnagent.ts:178-222` - `context` on `createAgent`.
- `UPDATE: packages/agent-cofold/README.md:58-76` - a row: `autoCompactTokens` | 80% of the model's listed context, or of 32000 | the estimated history size at which a session compacts, never above that 80%.
- `UPDATE: docs/PLUGINS.md:616-630` - the same row, one sentence.
- `UPDATE: packages/agent-cofold/test/agent-cofold-turn.test.ts` or a new `agent-cofold-compact.test.ts` - the cases below.

## Steps

1. Write the cases first and see them fail.
2. Add `export const AUTO_COMPACT_AT = 0.8` and `export const DEFAULT_CONTEXT_TOKENS = 32000` to `turnagent.ts`, papo's share and cofold's default.
3. In `agentOf`, `maxTokens` is the listed `contextTokens` of the model in force when task 02's `infoOf` has it and it is a positive number, else `DEFAULT_CONTEXT_TOKENS`; with a caller-passed `adapter`, no catalogue is read, so it is `DEFAULT_CONTEXT_TOKENS`.
4. `cap = Math.floor(maxTokens * AUTO_COMPACT_AT)`, and `autoCompactTokens = options.autoCompactTokens === undefined ? cap : Math.min(options.autoCompactTokens, cap)`.
5. Pass `context: { maxTokens, autoCompactTokens }`; leave `limits` out, so cofold's defaults stand.
6. Add the option to the schema, the README table and `docs/PLUGINS.md`.

## Validation

- Written first, failing today because no turn compacts, over a memory store and `createFakeModel`, reading the `autoCompactTokens` the built agent holds (`agent.context`) and whether a summary step runs:
  - unset, with a listed model whose `contextTokens` is 10000: the point is 8000, and a history estimated just above it runs a summary step and leaves a `source: 'summary'` message with a non-empty `summarizes`.
  - set to 5000 with the same model: the point is 5000.
  - set to 9000 with the same model: the point is capped at 8000.
  - unset, with no listed context (no catalogue, or an `adapter`): the point is 25600; set to 30000, it is 25600 too.
  - a short session runs no summary step.
- A case in `agent-cofold-plugin.test.ts`: loading the plugin with `autoCompactTokens: 0` or `"x"` is refused by the loader's options check from [plugin 26](../26-a-plugin-declares-its-options-schema/plan.md), and `4000` loads.
- `pnpm exec tsc --noEmit`, `pnpm test packages/agent-cofold`.

## Resume
