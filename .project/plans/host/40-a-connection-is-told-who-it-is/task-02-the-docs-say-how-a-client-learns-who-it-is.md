---
title: The docs say how a client learns who it is
status: done
depends: [task-01-initialize-and-sign-in-say-who.md]
layer: "docs"
refs:
  - "[code://docs/USERS.md](../../../../docs/USERS.md) - the people-as-resources section and the own-record rule"
---

## Objective

`docs/USERS.md` says that a client reads `_meta['ahpd.principal']` from `initialize` and from the root state snapshot, takes the snapshot again after it signs in, and reads the rest from `user://<id>`.

## Files

- `UPDATE: docs/USERS.md` - the paragraph on a person's own `user://<id>` names the key, its two spellings and when it is absent.

## Steps

1. Add the paragraph beside the own-record rule, one sentence per line, no em dash.

## Validation

- Read the section by hand: the key, `user:<id>`, `root:<host>`, absent with no users directory, and taking the root snapshot again after a sign-in are all said.

## Resume
