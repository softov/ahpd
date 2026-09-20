---
title: The facio backend offers a permission mode and a thinking level - implemented
date: 2026-09-20
refs:
  - git://d6526b9
  - code://packages/agent-facio/src/agent.ts
  - code://packages/agent-facio/src/session.ts
  - code://packages/agent-facio/src/config.ts
  - file:///github/facio/packages/agents/src/policy/modes.ts
  - file:///github/facio/packages/agents/src/types/policy.ts
  - file:///github/facio/packages/papo/src/agent.ts
  - code://test/agent-facio-modes.test.ts
  - code://docs/PLUGINS.md
---

A facio session now shows the two controls a Claude session shows: an approvals mode and a thinking level, and both arrive where they are supposed to.
The mode becomes the run's policy, so `plan` really refuses a change and `default` really asks before one; the level becomes the model request's `reasoning_effort`, so a chosen level is sent and `off` sends nothing.
The mapping a mode stands for now lives in the harness rather than in the terminal program, so the CLI and the bridge decide approvals the same way.

## What was built

- `file:///github/facio/packages/agents/src/policy/modes.ts` - `policyOf(mode, rules)`, the six modes as the decision a run takes when no rule matches: `default` asks on writes, destruction or the network, `acceptEdits` lets an in-workspace edit through, `plan` denies a change outright, `auto` is `DEFAULT_DECIDE`, `bypassPermissions` allows everything, `dontAsk` turns the mode's own ask into a denial.
- `file:///github/facio/packages/agents/src/types/policy.ts` - `PermissionMode` and `PermissionModeRules`, the two host facts a mode needs: `inside(path)` and `isEdit(tool)`.
- `file:///github/facio/packages/papo/src/agent.ts` - the local mapping deleted, the core's called with papo's own edit set and `resolveWithin`; `src/index.ts` re-exports `policyOf` so its surface does not move.
- `code://packages/agent-facio/src/agent.ts` - `permissionMode` in the schema when no `policy` was configured, `effortLevel` when no `adapter` was, and `modelOf` turning a level into `params.reasoning.effort` with `features.reasoning: true`.
- `code://packages/agent-facio/src/session.ts` - `agentOf` builds the turn's policy from `permissionMode`, with an edit being a tool that declares `writes` and the workspace boundary resolved under the session's directory.
- `code://docs/PLUGINS.md` - the two session settings, the six modes and the four levels.

## Verified

- `file:///github/facio/packages/agents/src/policy/modes.test.ts` - six cases: every mode against a reading, a writing, a network and a destructive tool, `acceptEdits` inside against outside, and the wording of a `plan` and a `dontAsk` refusal.
- `code://test/agent-facio-modes.test.ts` - seven cases: the two properties with their scopes, values and labels; their absence when a policy or an adapter takes over; `auto`, no mode at all and `bypassPermissions` running a write; `default` asking and `plan`/`dontAsk` refusing; `acceptEdits` writing inside the working directory and asking outside it; the level mapping; and `reasoning_effort` in the request body for a chosen level and nothing for `off`.
- facio's `packages/agents`: built, typechecked and 214 tests passed.
- ahpd: the nine facio test files 67 passed; the full suite 798 passed; `node scripts/boundary.mjs` green.
- Not run: a daemon against a real OpenRouter with a level set, which needs a key; the request body is asserted with a stubbed endpoint in the OpenAI-compatible shape.

## Departures from the plan

- The default mode is `auto`, not `default`. `default` is the harness's stricter rule that asks about writes and the network, so starting there would have changed the policy of every existing facio session; `auto` is `DEFAULT_DECIDE`, which is exactly what an unconfigured session had.
- `modeOf` answers `auto` for a value the schema does not carry, because a caller of the exported `facioSession` is not the host and its settings were not validated.
- The decision's mode set and the `inside`/`isEdit` seam are as recorded; the four modes papo uses kept their exact behaviour, which is what its own call site now asks for.

## Left for later

- papo's configuration still offers its four modes only; `plan` and `auto` are in the core's union and can be added to that program's enum whenever it wants them - see [deferred.md](deferred.md).
- papo's own build and test suite could not run in this environment: `@textui/chat` and `@facio/config` do not resolve here, which is pre-existing and unrelated to the move; `agent.ts` itself reports no error.
- The facio-side change is uncommitted working-tree work in `/github/facio`, which the user owns.
