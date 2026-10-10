---
title: Every backend titles a session from the first line, up to 80
status: done
depends: []
layer: "sdk, agent-acp, agent-cofold, agent-pi"
refs:
  - "[code://packages/agent-pi/src/session.ts#L66-L70](../../../../packages/agent-pi/src/session.ts#L66-L70) - `titleFrom`, the rule that becomes the sdk's"
  - "[code://packages/agent-pi/src/session.ts#L819-L823](../../../../packages/agent-pi/src/session.ts#L819-L823) - its call"
  - "[code://packages/agent-pi/src/catalog.ts#L192-L196](../../../../packages/agent-pi/src/catalog.ts#L192-L196) - `firstLine`, the copy"
  - "[code://packages/agent-acp/src/session/queue.ts#L42-L46](../../../../packages/agent-acp/src/session/queue.ts#L42-L46) - a command's title"
  - "[code://packages/agent-acp/src/session/queue.ts#L159-L164](../../../../packages/agent-acp/src/session/queue.ts#L159-L164) - a message's title"
  - "[code://packages/agent-cofold/src/turns.ts#L49-L53](../../../../packages/agent-cofold/src/turns.ts#L49-L53) - cofold's title"
  - "[code://packages/agent-cofold/src/agent.ts#L100-L111](../../../../packages/agent-cofold/src/agent.ts#L100-L111) - cofold's catalogue row title, `titleOf`: whitespace folded, cut at 200"
  - "[code://packages/agent-claude/src/session.ts#L56](../../../../packages/agent-claude/src/session.ts#L56) - a seeded session's title, open question 1"
---

## Objective

`titleFrom(text, fallback, max = 80)` is exported from `@ahpd/sdk`, and acp, cofold and pi title an untitled session with the first non-blank line of its first message, cut at 80 characters.

## Files

- `UPDATE: packages/sdk/src/catalog.ts` - `titleFrom`, pi's body with the fallback as a parameter.
- `UPDATE: packages/sdk/src/index.ts:76` - exported.
- `UPDATE: packages/sdk/test/session-kit.test.ts` - the helper's cases.
- `UPDATE: packages/agent-pi/src/session.ts:66-70,819-823`, `catalog.ts:192-196` - both use `titleFrom(text, UNTITLED)`; `firstLine` goes.
- `UPDATE: packages/agent-acp/src/session/queue.ts:43,160` - `titleFrom(command, UNTITLED)` and `titleFrom(text, UNTITLED)`.
- `UPDATE: packages/agent-cofold/src/turns.ts:50` - `titleFrom(text, 'Cofold session')`.
- `UPDATE: packages/agent-cofold/src/agent.ts:100-111` - `titleOf` goes; `list` titles a row with `titleFrom(textOf(first), record.sessionId)`, so the catalogue row and the live title agree.
- `UPDATE: packages/agent-acp/test/agent-acp-turn.test.ts`, `packages/agent-cofold/test/agent-cofold-turn.test.ts` - the cases below.

## Steps

1. Apply the rule in the plan's second table.
2. The guard around each call (`ctx.title === UNTITLED && text !== ''`) stays; a message of only blank lines answers the fallback, so the title does not change and the `session/titleChanged` is skipped when the answer equals the current title.
3. Claude's seed title goes through `titleFrom(seedText, 'New session')` too.
4. A title the agent gives the session (acp's `session_info_update`, claude's `retitle`, pi's `session_info_changed`, and cofold's if it has one) replaces the derived one, and none replaces a name a person gave; acp's `ctx.renamed` guard is the pattern, and a backend without it gains it.

## Validation

- `session-kit.test.ts`, a new helper's cases: `'\n  hello\nworld'` is `hello`; a 100-character line is cut at 80; `'  \n '` is the fallback.
- Written first and seen failing (today the title is the first 60 characters with the newline): in each of acp and cofold, a first message `'Fix the build\nand the tests'` titles the session `Fix the build`, and a 70-character one-line message keeps all 70.
- Written first: cofold's `list()` row for a session whose first message is `'Fix the build\nand the tests'` is titled `Fix the build`, the same title the live session got; today it is the whole text with the newline folded, up to 200.
- pi's existing title tests stay green unchanged.
- Written first where it fails today: in each backend, a title the agent gives after the first message replaces the derived one, and after a person renames the session, a title the agent gives is not applied.
- `pnpm exec tsc --noEmit`, `pnpm test`.

## Resume

- **Implemented** 2026-10-10 on `build/agents/167a4a60`.
- `titleFrom(text, fallback, max = 80)` is in `packages/sdk/src/catalog.ts`.
- It answers the first non-blank line, trimmed, cut at `max`.
- A text with no line in it answers the fallback.
- pi's `session.ts` and `catalog.ts` both call it, and its local `firstLine` is gone.
- pi's fallback is the `UNTITLED` constant, now exported from `types.ts`.
- acp's two title sites in `session/queue.ts` and cofold's two in `turns.ts` call it with their own fallback.
- cofold's `titleOf` in `agent.ts` is gone, so its catalogue row and its live title are the same `titleFrom`.
- claude's seeded title and its two derived-title sites call it with the fallback `New session`.
- The plan's `rg -n "slice\(0, 60\)"` finds nothing in any agent package.
- The guard around each derived title is unchanged, so only a session nobody has named is titled.
- A name a person gave is never replaced.
- acp and pi keep a `renamed` flag; claude and cofold keep the fallback-title guard.
- That guard is where an agent-given title replaces the derived one.
- New cases: acp's first-line and 70-character titles, its agent title replacing the derived one, and a person's name surviving the agent's.
- More cases: cofold's first-line title, its 70-character title, and its catalogue row agreeing with the live session.
- pi's person's name survives `session_info_changed`.
- pi's existing title tests are unchanged.
- Gates: `pnpm install`, `node tools/schema.mjs`, `pnpm build`, `pnpm typecheck` and `pnpm boundary` all pass.
- The full suite passes 4869 of 4870 tests over 272 files.
- The one failure is `changes-refresh.test.ts`, the load flake, which passes 29 of 29 alone.
