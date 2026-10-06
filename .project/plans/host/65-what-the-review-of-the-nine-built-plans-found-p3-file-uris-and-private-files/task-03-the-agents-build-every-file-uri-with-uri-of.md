---
title: The agents build every file URI with uriOf
status: todo
depends: [task-02-the-sdk-builds-every-file-uri-with-uri-of.md]
layer: "agent-claude, agent-pi, agent-acp, agent-cofold"
refs:
  - "[code://packages/agent-claude/src/session.ts#L152](../../../../packages/agent-claude/src/session.ts#L152) - `workingDirectories`, unencoded, also at 163 and 209"
  - "[code://packages/agent-pi/src/session.ts#L966](../../../../packages/agent-pi/src/session.ts#L966) - the same, also at 975"
  - "[code://packages/agent-acp/src/session.ts#L184](../../../../packages/agent-acp/src/session.ts#L184) - the same, also at 194"
  - "[code://packages/agent-cofold/src/session.ts#L249](../../../../packages/agent-cofold/src/session.ts#L249) - the same, also at 259"
---

## Objective

Every `file:` URI an agent sends is the sdk's `uriOf(path)`, so the host reads back the folder the agent works in.

## Files

- `UPDATE: packages/agent-claude/src/session.ts:152,163,209`, `packages/agent-claude/src/catalog.ts:30`, `packages/agent-claude/src/session/customizations.ts:55,198` - `uriOf`.
- `UPDATE: packages/agent-pi/src/session.ts:966,975`, `packages/agent-pi/src/catalog.ts:172,185` - `uriOf`.
- `UPDATE: packages/agent-acp/src/session.ts:184,194`, `packages/agent-acp/src/catalog.ts:83,101`, `packages/agent-acp/src/mapping.ts:299` - `uriOf`.
- `UPDATE: packages/agent-cofold/src/session.ts:249,259`, `packages/agent-cofold/src/agent.ts:763` - `uriOf`.
- `UPDATE: packages/agent-*/package.json` - the sdk peer range is the version that exports `uriOf`.
- Today each is `` `file://${dir}` ``: a Claude session in `~/src/C#/app` reports `file:///home/u/src/C#/app`, the host reads `~/src/C`, and `lifecycle.ts:731` restarts it there.
- `UPDATE: packages/agent-claude/test/`, `packages/agent-pi/test/`, `packages/agent-acp/test/`, `packages/agent-cofold/test/` - one case each, below.

## Steps

1. Failing case first, per agent: a session started in a folder named `C#` with a space in it reports `workingDirectories` equal to `[uriOf(folder)]`. Each fails today.
2. Replace each builder one for one; `agent-claude/src/input.ts:186` encodes on its own and is left.
3. `rg -n '\`file://\$\{' packages/agent-*/src` finds only `input.ts:186`.

## Validation

- Each agent's case fails on `e1c4ccc` and passes after.
- `pnpm exec vitest run packages/agent-claude packages/agent-pi packages/agent-acp packages/agent-cofold`, `pnpm boundary`.

## Resume
