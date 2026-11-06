---
title: A client sees the plugins and the connectors - implemented
date: 2026-11-05
refs:
  - git://bd101997 - the last commit that names it on main
---

A client sees the plugins and the connectors.

## What was built

- [01 - The manifest is read](task-01-the-manifest-is-read.md).
- [02 - A registration is checked against the contract](task-02-a-registration-is-checked.md).
- [03 - Every shipped plugin declares its contracts](task-03-shipped-plugins-declare-contracts.md).
- [04 - A client lists the plugins](task-04-a-client-lists-the-plugins.md).
- [05 - A plugin registers connector kinds](task-05-a-plugin-registers-connector-kinds.md).
- [06 - A collection keeps JSON records](task-06-a-collection-keeps-json-records.md).
- [07 - A client makes connectors](task-07-a-client-makes-connectors.md).
- [08 - A webhook endpoint is a connector](task-08-a-webhook-endpoint-is-a-connector.md).
- [09 - The docs say how plugins and connectors are seen](task-09-the-docs-say-how-it-is-seen.md).
- [10 - A plugin row says its version, its load and its options schema](task-10-a-plugin-row-says-what-loaded.md).
- [11 - A plugin command marks a restart for every client](task-11-a-plugin-command-marks-a-restart.md).
- [12 - Plugins and connectors have their own grants](task-12-plugins-and-connectors-have-grants.md).
- [13 - The docs say the new row fields and the grants](task-13-the-docs-say-the-row-and-grants.md).
- [14 - The restart mark is pushed to every client](task-14-a-restart-mark-is-pushed.md).
- [15 - Adapters and connectors are two channels](task-15-adapters-and-connectors-split.md).
- [16 - The docs say adapters, connectors and their grants](task-16-the-docs-say-adapters.md).

## Verified

- CI on #243 at e2d4588a, the code of main at 3f6e3da8, passed every check, Windows included.
- Each task file says what its cases check.

## Departures from the plan

- Each task's *Resume* section says what it found while it was built.

## Left for later

- none
