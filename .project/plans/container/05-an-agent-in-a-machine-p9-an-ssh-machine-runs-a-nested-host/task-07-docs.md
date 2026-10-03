---
title: The docs say how a box is listed as an ssh machine
status: todo
depends: [task-06-dev86-runs-a-session.md]
layer: "docs"
refs:
  - "[code://docs/COMPUTER.md](../../../../docs/COMPUTER.md) - the operator's page"
---

## Objective

`docs/COMPUTER.md` says how to list a box, what it needs installed, how an id names its runtime, that every session there runs nested, and what an ssh machine cannot do.

## Files

- `UPDATE: docs/COMPUTER.md` - an "ssh machines" section.
- `UPDATE: .project/plans/container/00-container.md` - several runtimes, and ssh among them.

## Steps

1. The option, one example, the id, a policy glob for one runtime.
2. What the box needs: ahpd at the same version, its plugins, its own model credentials until p12.

## Validation

- Every option named exists in `optionsSchema`.

## Resume
