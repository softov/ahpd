---
title: prepare-pull-request offers Agent Merge
status: todo
depends:
  - task-03-the-four-agent-merge-tools.md
layer: "sdk"
refs:
  - "[code://packages/sdk/src/sessions/changes.ts#L1254-L1261](../../../../packages/sdk/src/sessions/changes.ts#L1254-L1261) - `agentMergeAvailable: false` and the refusal"
---

## Objective

`prepare-pull-request` answers `agentMergeAvailable: true` where the folder has a GitHub remote and a way to read it.
A create that asks for Agent Merge turns it on.

## Files

- `UPDATE: packages/sdk/src/sessions/changes.ts:1254-1261` - the answer and the create.
- `UPDATE: packages/sdk/test` - the cases.

## Steps

1. Answer `agentMergeAvailable: true` where task 01 can read the pull request.
2. Turn Agent Merge on for the folder when a create asks for it.
3. Keep the refusal, in its words, where it cannot run.

## Validation

- A folder with a GitHub remote offers it, and one without refuses it.
- `pnpm typecheck`, then the sdk suite.

## Resume

