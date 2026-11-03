---
title: A restart refused after the second read of turns says --force to an AHP or HTTP caller
status: open
date: 2026-11-03
severity: minor
blocks: []
refs:
  - "[code://packages/server/src/commands/restart.ts#L466-L470](../../packages/server/src/commands/restart.ts#L466-L470) - `checkedRestart` reads the turns again and refuses with `busy(now)`"
  - "[code://packages/server/src/commands/restart.ts#L720-L729](../../packages/server/src/commands/restart.ts#L720-L729) - `servedRestart` refuses with `force: true` for a served caller"
  - "[code://packages/server/src/commands/restart.ts#L747-L762](../../packages/server/src/commands/restart.ts#L747-L762) - `restartMethod` answers every refusal as an internal error"
  - git://216ce3f2 - daemon/20261030-0635 added the restart method
  - git://77ba53f8 - main when the problem was read
---

## Symptom

Read from the code in the review of 2026-11-03, and not reproduced.
A client asks for a restart through AHP while no turn runs.
A turn starts before the second read of the turns.
The refusal tells the client to pass `--force`, a CLI flag.

## Cause

`servedRestart` names `force: true`, but `checkedRestart` calls `busy(now)` with the CLI wording.
Every refusal also reaches AHP as -32603, so a client tells them apart by the text only.

## Impact

A client that shows the refusal tells its user a flag the user cannot pass.

## Workaround

Send the restart again with `force: true`.

## Fix

- Pass the wording of the caller into `checkedRestart`.
- Answer a refusal with a conflict code, not -32603.
