---
title: Usage is charged to the owner's, the team's and the project's pool
status: accepted
date: 2026-10-02
refs:
  - "[code://packages/sdk/src/types/usage.ts](../../packages/sdk/src/types/usage.ts) - `UsageBase.pools`, opaque keys"
  - "[code://packages/sdk/src/scopes.ts](../../packages/sdk/src/scopes.ts) - `Scope`, the team and project work is charged under"
---

## Context

The usage port keeps totals per pool and a record names the pools it is charged to; a record naming none is charged nowhere.
What a pool means was left to the policy plan, so until then a meter had nothing to name.

## Decision

A meter charges a record to up to three pools: its owner as written (`user:<id>`, `root:<host>`), `team:<team>` and `project:<team>:<project>` from the scope the work is charged under.
Each is named only when the record has it, so work with no owner and no scope is charged to no pool.
Source: Softov, 2026-10-02, asked "Which pools should an agent record name?": "Owner, team, project". The `project:<team>:<project>` spelling is (defaulted: a project name is only unique within its team, and `team:project` is how a membership already writes the pair).

## Consequences

Totals per person, team and project work before any policy exists, and policy rows match these names.
A project pool is told apart from a team pool by its prefix, never by counting colons.

## Options

- **No pools until the policy plan**: rejected, totals would stay empty until then.
