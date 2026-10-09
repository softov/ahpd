---
title: The usage list shows the pools that were charged, limited to the ones the reader may read
status: accepted
date: 2026-10-09
refs:
  - "[code://packages/sdk/src/usage.ts#L542-L543](../../packages/sdk/src/usage.ts#L542-L543) - `visible`, the pools a listing answers"
  - "[code://packages/sdk/src/scopes.ts#L125-L131](../../packages/sdk/src/scopes.ts#L125-L131) - `poolsFor`, the pools a person reads without `usage:read`"
---

## Context

The root reader's list was every pool with a record, and another reader's list was built from their memberships.
The same work showed as different rows to root and to the person who did it.
A `team:*` membership was crossed with every project of the install, so a person saw empty pools for projects they never worked in.

## Decision

A listing of `usage://` answers the pools the store has records for, limited to the pools the reader may read.
A pool nothing was charged to is not listed, for root or for anyone else.
Which pools a reader may read is unchanged: their own `user:` pool, their teams' and their projects' pools, or every pool with `usage:read`.
Source: Softov, 2026-10-09, asked "Which pools should the usage list show?" and answered "Charged and readable".

## Consequences

Root and a member see the same row for the same pool.
A team or project that spent nothing has no row until its first record.
`poolsFor` stays the read rule and is no longer the list.

## Options

- **Every readable pool, empty ones too**: rejected. Root would list every team and project, and a member's list fills with rows of zero.
