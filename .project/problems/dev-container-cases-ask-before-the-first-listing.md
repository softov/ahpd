---
title: Dev container cases ask for a machine before the first listing has answered
status: open
date: 2026-11-13
severity: minor
refs:
  - "[code://packages/computer/test/computer-devcontainer.test.ts#L117-L136](../../packages/computer/test/computer-devcontainer.test.ts#L117-L136) - `answered`, and the listing that loading the plugin starts and nothing awaits"
  - "[code://packages/computer/test/computer-devcontainer.test.ts#L1587-L1606](../../packages/computer/test/computer-devcontainer.test.ts#L1587-L1606) - \"refuses a command in a container that is not running, with the daemon's sentence\""
  - "[code://packages/computer/test/computer-devcontainer.test.ts#L1824-L1840](../../packages/computer/test/computer-devcontainer.test.ts#L1824-L1840) - \"reads the kept probe back after a restart, and runs no probe for it\""
  - "[code://packages/computer/test/computer-devcontainer.test.ts#L1877-L1891](../../packages/computer/test/computer-devcontainer.test.ts#L1877-L1891) - \"omits the dev container row for a URI it cannot read a folder from, and keeps the others\""
  - "[code://packages/computer/test/computer-devcontainer.test.ts#L567](../../packages/computer/test/computer-devcontainer.test.ts#L567) - \"offers the session folder's dev container, and not once one exists\""
---

## Symptom

Four cases in `computer-devcontainer.test.ts` fail at random in `windows (1/4)`, and pass when the job runs again on the same commit.

| Case | Runs | What it said |
| --- | --- | --- |
| refuses a command in a container that is not running | 42845504002, main; 42984895620 | `expected 'There is no computer called stopped.'` to contain the daemon's sentence |
| reads the kept probe back after a restart | 42727088464, main | `expected 'There is no computer called box.' to contain 'exit 0'` |
| omits the dev container row for a URI it cannot read a folder from | 42792267768; 43114109287, main | `expected [ '' ] to deeply equal [ '', 'computer://held' ]` |
| offers the session folder's dev container | 43026502133 | `the scripted docker never finished 3 calls ... 2 recorded` |

They pass on Linux.

## Cause

Loading the plugin starts a `docker ps` listing that nothing awaits, as the comment on `answered` says.
In the first three cases, the tool or the picker asks for a machine before that listing answers. So the machine is not known yet.
On Windows each call of the scripted Docker is a new Node process, so the listing is slower there.
The fourth case waited the whole `WAIT_MS` for its third Docker call. Why the call was late is unknown.

## Impact

A Windows CI job fails at random, and blocks a merge until it runs again.

## Workaround

None. Running the job again is not a fix.

## Fix

- Wait in each case until the first listing has answered, with `answered`, before the case asks for a machine.
- Or let a load answer when its first listing has answered, if the plugin should not take a request before that.
