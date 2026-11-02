---
title: The plans' prose is in the linter's limits - implemented
date: 2026-11-02
refs:
  - git://00752670
---

The 72 plan files #183 merged pass the repository's prose linter.

## What was built

- 63 hits in 19 files, each split where its clauses part: 62 long sentences and one passive step.
- The plans of the customization switch, the MCP start and stop, every-answered, cofold's answers and the state change said to every subscriber.

## Verified

- `node .agents/skills/do-spec/scripts/lint-prose.mjs` over the 72 files exits 0.
- Before the change the same run reported 63 hits in 19 files.

## Departures from the plan

- none.

## Left for later

- none.
