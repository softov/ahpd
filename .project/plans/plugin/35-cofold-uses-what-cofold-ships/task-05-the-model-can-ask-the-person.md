---
title: The model can ask the person a question
status: done
depends: []
layer: "agent-cofold"
refs:
  - "[code://packages/agent-cofold/src/turnagent.ts#L178-L191](../../../../packages/agent-cofold/src/turnagent.ts#L178-L191) - `tools: cofoldTools(ctx.offered, relay)` and the taken names passed to `capabilitiesOf`"
  - "[code://packages/agent-cofold/src/capabilities.ts#L76-L91](../../../../packages/agent-cofold/src/capabilities.ts#L76-L91) - `withoutTaken`, the rule this task follows"
  - "[code://packages/agent-cofold/src/mapping.ts#L486-L503](../../../../packages/agent-cofold/src/mapping.ts#L486-L503) - `input.requested` becomes a `chatInput` entry"
  - "[code://packages/agent-cofold/src/pauses.ts#L247-L257](../../../../packages/agent-cofold/src/pauses.ts#L247-L257) - `answer`, the way back to the run"
  - "[code://packages/agent-cofold/test/agent-cofold-approval.test.ts#L159-L172](../../../../packages/agent-cofold/test/agent-cofold-approval.test.ts#L159-L172) - a host tool named `ask_user`"
  - npm://@cofold/agents@0.1.2 - `createAskUserTool()`, named `ask_user`, `effects: {}`, pauses with `pauseForInput`; cofold refuses two tools of one name
---

## Objective

Every cofold session offers the model cofold's own `ask_user` tool, its questions reach the client as the same `chatInput` entry a host tool's questions do, and an offered host or client tool already named `ask_user` keeps the name and cofold's is left out.

## Files

- `UPDATE: packages/agent-cofold/src/turnagent.ts:178-191` - the ask tool in `tools`.
- `UPDATE: packages/agent-cofold/test/agent-cofold-approval.test.ts` - the cases below.

## Steps

1. Write the cases first and see them fail.
2. In `agentOf`, `tools` is `[...(taken.has('ask_user') ? [] : [createAskUserTool()]), ...cofoldTools(ctx.offered, relay)]`, with `taken` the set of `ctx.offered` names that `capabilitiesOf` is already given; build that set once and pass it to both.
3. Read the name from the created tool rather than writing `'ask_user'` twice.
4. Nothing in `mapping.ts` or `pauses.ts` changes: the run's `input.requested` is already mapped and answered.

## Validation

- In `agent-cofold-approval.test.ts`, written first:
  - with no host tools, a fake model that calls `ask_user` with one question raises a `chatInput` entry carrying that question; answering it through the host's input path resumes the run, and the tool result the model reads holds the answer. Fails today with an unknown tool.
  - declining it resumes the run with the declined result.
  - with the existing host `asker` tool registered as `ask_user`, the turn runs without `invalid_options` and the host tool's `run` is the one called.
- `pnpm exec tsc --noEmit`, `pnpm test packages/agent-cofold`.

## Resume
