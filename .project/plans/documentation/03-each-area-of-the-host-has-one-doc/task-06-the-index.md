---
title: The docs folder has an index
status: todo
depends: [task-01-authentication.md, task-02-host-and-automations.md, task-03-sessions-and-chats.md, task-04-terminals-and-tools.md, task-05-resources-and-usage.md]
layer: "docs"
refs:
  - "[code://.project/plans/documentation/00-documentation.md](../00-documentation.md) - the domain reference lists the docs"
---

## Objective

`docs/README.md` lists every doc with one line on what it covers, and the domain reference lists the same.

## Files

- `CREATE: docs/README.md`.
- `UPDATE: .project/plans/documentation/00-documentation.md` - its Contracts list every doc.
- `UPDATE: README.md` - links `docs/README.md`.

## Steps

1. Write one line per doc.
2. Update the domain reference and the root README.

## Validation

- Every file in `docs/` has a line, and every link resolves.

## Resume
