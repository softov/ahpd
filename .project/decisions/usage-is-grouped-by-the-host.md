---
title: Usage is summed by user, team and project on the host, over the records the reader may read
status: accepted
date: 2026-10-09
refs:
  - "[code://packages/sdk/src/types/usage.ts#L144-L164](../../packages/sdk/src/types/usage.ts#L144-L164) - the `Usage` port, `total`, `pools` and `records`"
---

## Context

A pool total counts one record under each pool it is charged to: its user, its team and its project.
Softov asked to see spending by user, by team, by project, or by any mix of the three.
Records are read 200 at a time, so a client cannot sum a busy month from them.

## Decision

The usage scheme answers a grouped read: the keys asked for (any of `user`, `team`, `project`) and a range, summed over each record once.
A record counts when the reader may read at least one pool it is charged to.
Source: Softov, 2026-10-09, asked "How should grouping by user, team and project work?" and answered "Host groups the records".

## Consequences

The `Usage` port gains a grouped total, which a plugin that replaces the store must answer.
A client draws a grouped view from one read, with no record cap.

## Options

- **The client groups the records it reads**: rejected. Records come capped at the newest 200, so a total is wrong on a busy month.
