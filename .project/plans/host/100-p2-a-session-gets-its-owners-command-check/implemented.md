---
title: A session gets its owner's command check - implemented
date: 2026-11-05
refs:
  - git://00ababd4 - the last commit that names it on main
---

A session gets its owner's command check.

## What was built

- [01 - The check reads the owner's connection](task-01-the-check-reads-the-owners-connection.md).
- [02 - The daemon setting picks the default rules](task-02-a-daemon-setting-picks-default-rules.md).
- [03 - A pushed regex rule needs config:change](task-03-a-pushed-regex-rule-needs-config-change.md).

## Verified

- CI on #243 at e2d4588a, the code of main at 3f6e3da8, passed every check, Windows included.
- Each task file says what its cases check.

## Departures from the plan

- Each task's *Resume* section says what it found while it was built.

## Left for later

- none
