---
title: An agents channel case hears two changes where it expects one
status: open
date: 2026-11-13
severity: minor
refs:
  - "[code://packages/sdk/test/agents-channel.test.ts#L491-L506](../../packages/sdk/test/agents-channel.test.ts#L491-L506) - \"sends one root/agentsChanged with the new agent\""
  - "[code://packages/sdk/src/host/catalogue.ts#L1150-L1171](../../packages/sdk/src/host/catalogue.ts#L1150-L1171) - a probe's models and `publishAgentInfos`, which each send `root/agentsChanged`"
---

## Symptom

The case fails in `windows (1/4)` on main, in run 43331759178, with `expected [ { …(2) }, { …(2) } ] to have a length of 1 but got 2`.
It passes on Linux.

## Cause

Unknown.
The case waits for the first `root/agentsChanged`, then 20 ms, and expects no second one.
The host sends `root/agentsChanged` again when the agent list differs from the last one it sent. A probe that answers the new agent's models is one such change. When that answer comes after the first change and inside 20 ms, the case hears two.

## Impact

A Windows CI job on main fails at random. If the second change is a duplicate, a client draws the agent list twice.

## Workaround

None. Running the job again is not a fix.

## Fix

- Log the two changes the case hears, and find which part of the host sends the second one.
- If the second one carries the models, the case expects it. If it is a duplicate, the host sends one.
