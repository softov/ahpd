---
title: An operation says when it applies
created: 2026-11-11
refs:
  - "[code://packages/sdk/src/types/kinds.ts#L44-L65](../../packages/sdk/src/types/kinds.ts#L44-L65) - `KindOperation`, where a condition would go"
  - https://code.visualstudio.com/api/references/when-clause-contexts - VS Code's `when` clauses, which a client evaluates
---

An operation could carry a condition on a record's fields, such as `enabled == false`, as a VS Code menu item carries a `when` clause.
A client would evaluate it, and a kind could declare an operation without code that decides where it applies.
Softov asked on 2026-11-11 to keep it for later support, and chose for now that each record lists the operations it offers.
That change is the plan [plugin/20261112-0145-a-record-lists-the-operations-it-offers](../plans/plugin/20261112-0145-a-record-lists-the-operations-it-offers/plan.md).
