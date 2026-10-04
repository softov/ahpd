---
title: Open plans cite the new files - implemented
date: 2026-10-04
refs:
  - git://ca6adcb
---

Every open plan that cited `host.ts` cites the file under `packages/sdk/src/host/` that now holds the code.

## What was built

- 32 open plan folders rewritten, each ref pointing at the new file and line range.

## Verified

- Every rewritten ref resolves, and its line range holds the symbol its note names.

## Departures from the plan

- None.

## Left for later

- Plans written after p11 (host/52, claude/17, documentation/02) were not rewritten and may cite `host.ts`.
