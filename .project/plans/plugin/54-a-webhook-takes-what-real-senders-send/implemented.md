---
title: A webhook takes what real senders send - implemented
date: 2026-11-05
refs:
  - git://baf76f10 - the last commit that names it on main
---

A webhook takes what real senders send.

## What was built

- [01 - A plugin trigger is checked on save and at a fire](task-01-plugin-trigger-checked-on-save-and-fire.md).
- [02 - References and owners are checked, and a plugin runs one automation](task-02-references-owners-and-run-automation.md).
- [03 - A webhook reads any body and starts its target](task-03-a-webhook-reads-any-body.md).
- [04 - A webhook checks each sender's proof](task-04-a-webhook-checks-each-senders-proof.md).
- [05 - A webhook answers the senders' handshakes](task-05-a-webhook-answers-handshakes.md).
- [06 - A bot connector works with its defaults](task-06-a-bot-connector-works-by-default.md).
- [07 - The docs say what a webhook takes](task-07-the-docs-say-what-a-webhook-takes.md).

## Verified

- CI on #243 at e2d4588a, the code of main at 3f6e3da8, passed every check, Windows included.
- Each task file says what its cases check.

## Departures from the plan

- Each task's *Resume* section says what it found while it was built.

## Left for later

- none
