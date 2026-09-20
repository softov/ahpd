---
title: The window shows facio an approvals mode and a thinking level, and both arrive
status: done
depends: []
layer: packages/agent-facio
refs:
  - code://packages/agent-facio/src/agent.ts - the mode and effort properties, and the effort in `modelOf`
  - code://packages/agent-facio/src/session.ts - `agentOf`, which builds the policy from the mode per turn
  - code://packages/agent-claude/src/claude.ts#L126-L196 - the properties, labels and scopes mirrored
  - file:///github/facio/packages/agents/src/policy/modes.ts - `policyOf`, now in the harness
  - file:///github/facio/packages/papo/src/agent.ts - the call site that moved to the core's mapping
  - code://.project/decisions/permission-modes-live-in-the-harness.md - the mode set and the two host facts
  - code://test/agent-facio-modes.test.ts - the cases
---

## Objective

A facio backend advertises `permissionMode` and `effortLevel`, a session that picks one gets the policy or the reasoning request it names, and papo's four modes keep their exact meaning through the move of the mapping into `@facio/agents`.

## Files

- `CREATE: /github/facio/packages/agents/src/policy/modes.ts` - `policyOf` and the effects rule its modes share.
- `UPDATE: /github/facio/packages/agents/src/types/policy.ts` - `PermissionMode` and `PermissionModeRules`.
- `UPDATE: /github/facio/packages/agents/src/index.ts` - export the function and its types.
- `CREATE: /github/facio/packages/agents/src/policy/modes.test.ts` - every mode's decision.
- `UPDATE: /github/facio/packages/papo/src/agent.ts` - drop the local mapping, pass `inside` and `isEdit` to the core's.
- `UPDATE: /github/facio/packages/papo/src/index.ts` - re-export `policyOf` from the core.
- `UPDATE: packages/agent-facio/src/agent.ts` - the two schema properties, and the effort in `modelOf`.
- `UPDATE: packages/agent-facio/src/session.ts` - the policy from the mode in `agentOf`.
- `CREATE: test/agent-facio-modes.test.ts` - the cases below.
- `UPDATE: docs/PLUGINS.md` - what the two settings are and what each value means.

## Steps

1. In `/github/facio`, add `PermissionMode` (six values) and `PermissionModeRules` (`inside(path)`, `isEdit(tool)`) to `types/policy.ts`, and `policyOf(mode, rules)` to `policy/modes.ts`: `default` asks on writes, destruction or network, `acceptEdits` allows an in-workspace edit through `isEdit` and otherwise falls to that rule, `plan` denies a write or a destruction, `auto` is `DEFAULT_DECIDE`, `bypassPermissions` allows, `dontAsk` turns the rule's own ask into a denial.
2. Export both and papo's own `EDITS` set as the injected predicate, then delete papo's local `policyOf`, `byEffects` and `EDITS`, re-exporting the core's `policyOf` from papo's index so its public surface does not move.
3. In `packages/agent-facio/src/agent.ts`, add `permissionMode` to the schema when `options.policy` is undefined, with the six values, the Claude labels and a one-line description of each in facio's words, and `effortLevel` when `options.adapter` is undefined, with `off`/`low`/`medium`/`high`.
4. Read `settings.effortLevel` in `modelOf` and pass `params: { reasoning: { effort } }` with `features: { reasoning: true }` for a level that is not `off`, and nothing at all for `off` or an unknown value.
5. In `packages/agent-facio/src/session.ts`, build the policy in `agentOf` from `values.permissionMode` when the plugin passed none, with `inside` resolving under the session's working directory and `isEdit` true for a tool that declares `writes`.
6. Name both settings in `docs/PLUGINS.md` under the session settings, with the six modes and four levels.

## Validation

- `packages/agents/src/policy/modes.test.ts`: each mode against a reading, a writing, a network and a destructive tool; `acceptEdits` inside and outside; `dontAsk` denying what `default` would ask.
- `test/agent-facio-modes.test.ts`:
  - the schema carries `permissionMode` with six values, labels and `scope: 'session'`, and `effortLevel` with four and `scope: 'chat'`.
  - no `permissionMode` when the plugin passed a `policy`, and no `effortLevel` with an `adapter`.
  - `bypassPermissions` runs a writing tool that `default` asks about, `plan` refuses it, `dontAsk` refuses it, and `acceptEdits` runs it inside the working directory while asking outside.
  - `effortLevel: 'high'` puts `reasoning_effort: 'high'` in the request body and `off` leaves it out.
- `packages/papo`'s own tests still pass, since its four modes and edit set are unchanged.
- `pnpm test`, `pnpm typecheck` and `pnpm boundary` green in both repositories.

## Resume

Done 2026-09-20.
`/github/facio`: `PermissionMode` (six values) and `PermissionModeRules` (`inside(path)`, `isEdit(tool)`) are in `packages/agents/src/types/policy.ts`, `policyOf` is in `packages/agents/src/policy/modes.ts` and exported from the package, and `modes.test.ts` asserts every mode against a reading, a writing, a network and a destructive tool plus the two refusals' wording.
papo deleted its local `policyOf`/`byEffects`, keeps `EDITS` as the injected `isEdit` and `resolveWithin` as the injected `inside`, and its index re-exports the core's `policyOf` so its surface does not move.
`packages/agent-facio`: the schema carries `permissionMode` (six values, the window's labels, `scope: 'session'`, `default: 'auto'`) only when the plugin configured no `policy`, and `effortLevel` (`off`/`low`/`medium`/`high`, `scope: 'chat'`, `default: 'off'`) only when no `adapter` was passed; `modelOf` turns a level into `params.reasoning.effort` with `features.reasoning: true`; `agentOf` builds the turn's policy from `permissionMode`, with `isEdit` true for a tool that declares `writes` and `inside` resolving under the session's working directory.
The default mode is `auto`, which is `DEFAULT_DECIDE`, so a session that chooses no mode keeps exactly the policy it had before this change.
`test/agent-facio-modes.test.ts` is seven cases: the two properties with their scopes and labels, their absence when a policy or an adapter takes over, `auto`/undefined/`bypassPermissions` running a write, `default` asking and `plan`/`dontAsk` refusing, `acceptEdits` inside against outside, the level mapping, and `reasoning_effort` in the request body for a chosen level and nothing for `off`.
Verified: `packages/agents` built and 214 tests passed, the nine facio test files in ahpd 67 passed, the full ahpd suite 798 passed with the one file below excluded, `pnpm typecheck` green except that file, `pnpm boundary` green.
Departures from the plan: the default mode is `auto` rather than `default`, because `default` is the harness's stricter rule that asks about writes and the network, and starting there would have changed every existing facio session; `modeOf` falls back to `auto` for an unknown value a direct caller sets.
Not verified here: papo's own build and tests. `tsc -p packages/papo` cannot run in this environment because `@textui/chat` and `@facio/config` do not resolve (pre-existing, no `node_modules/@facio` and no `packages/config/dist`); the only errors it reports are those missing modules and their cascades, none in `packages/papo/src/agent.ts`.
Also not mine in the working tree: another session is editing `packages/agent-facio/src/mapping.ts` and `test/agent-facio-turn.test.ts`; the latter has an in-progress type error at line 185, which is why the full-tree typecheck is not clean and that test file is excluded from the counts above.
