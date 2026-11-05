---
title: Agent kinds on their own channel - implemented
date: 2026-11-04
refs:
  - git://9717e173
  - "[code://packages/sdk/src/agents/engines.ts](../../../../packages/sdk/src/agents/engines.ts)"
  - "[code://packages/sdk/src/agents/channel.ts](../../../../packages/sdk/src/agents/channel.ts)"
---

A client lists the engines a host serves on `x-ahpd-engines://`, with the form and the templates of each. An agent record names its engine, and an engine row shows its plugin's icon.

## What was built

- [`code://packages/sdk/src/agents/engines.ts`](../../../../packages/sdk/src/agents/engines.ts) - the engines channel, which task 01 built as the agent kinds channel and task 03 renamed.
- [`code://packages/sdk/src/agents/channel.ts`](../../../../packages/sdk/src/agents/channel.ts) - an agent record names its `engine`, and a record with no engine is unavailable.
- `registerEngine` in each agent plugin, and `engine` in `ahpd configure` and the record migration.

## Verified

- #90 and #91 merged with CI green.
- Softov ran `host-123-engines-checks.md` on 2026-11-04, and it passed.

## Departures from the plan

- None.
