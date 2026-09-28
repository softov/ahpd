---
title: A changeset source says when its watch is armed, and the host re-reads then
status: accepted
date: 2026-09-28
refs:
  - "[code://packages/sdk/src/types/changes.ts#L276-L284](../../packages/sdk/src/types/changes.ts#L276-L284) - `ChangesetSource.watch`, which returns only a stop function"
  - "[code://packages/sdk/src/changes.ts#L1184-L1300](../../packages/sdk/src/changes.ts#L1184-L1300) - `gitChanges` arms its watchers after three `git` runs"
  - "[code://packages/sdk/src/host.ts#L2844-L2856](../../packages/sdk/src/host.ts#L2844-L2856) - `startWatchingDir`"
---

## Context

A git watch is armed only after `git rev-parse` twice and `git symbolic-ref` have answered.
Anything that moves the repository between the first read of a changeset and that moment is missed until some other trigger fires.
The tests met this as a flake; a person committing right after opening a session meets it as a stale changeset.

## Decision

The stop function `ChangesetSource.watch` returns may carry `ready`, a promise that resolves once the source's watchers are armed.
`gitChanges` resolves it after its last watcher is opened.
The host re-reads the directory once when `ready` resolves, through the same coalesced re-read every other trigger uses.
A source without `ready` is treated as it is today.

Source: Softov, 2026-09-28, asked "How should the changes-refresh tests know the host is done: watch armed, and the refresh loop idle?", asked which was more correct, then answered "Source ready + re-read".

## Consequences

The window between the first read and the watch is closed for real use, not only for tests.
The host gains no API that only tests call; a test knows the refresh loop is idle from the source it passes in.

## Options

- **The host exposes idle.** A host method reporting a directory's re-read and watch state; public API only tests would call, and the host still could not know a watch is armed without the source saying so.
- **Test-side only.** A probe file proves the watch is armed; the gap stays in the product.
