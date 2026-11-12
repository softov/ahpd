---
title: The docs say what a record offers
status: todo
depends: [task-02-agents-serve-an-operations-list.md, task-03-connectors-serve-an-operations-list.md]
layer: "docs"
refs:
  - "[code://docs/plugins/PLUGINS.md](../../../../docs/plugins/PLUGINS.md) - where `x-ahpd/invokeOperation` is documented"
  - "[code://docs/updates/v0_15.md](../../../../docs/updates/v0_15.md) - the release notes"
---

## Objective

The docs say that each record lists the operations it offers, and which channels serve an operations list.

## Files

- `UPDATE: docs/plugins/PLUGINS.md` - a record's `operations`, the kind's function, and the agents and connectors lists.
- `UPDATE: docs/updates/v0_15.md` - one line on what a client now reads.

## Steps

1. Add the record's `operations` field where `PLUGINS.md` describes `x-ahpd/invokeOperation`.
2. Say how a kind declares which records offer its own operation.
3. Name the four channels that serve an operations list.
4. Add the line to `v0_15.md`.

## Validation

- Read the page against tasks 01 to 03.

## Resume

