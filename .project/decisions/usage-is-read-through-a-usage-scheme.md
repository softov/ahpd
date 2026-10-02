---
title: Usage is read through a usage resource scheme, totals and records, and a person reads their own pools without a grant
status: accepted
date: 2026-10-02
refs:
  - "[code://packages/sdk/src/types/usage.ts](../../packages/sdk/src/types/usage.ts) - the `Usage` port, `record` and `total`"
  - "[code://packages/sdk/src/types/resources.ts](../../packages/sdk/src/types/resources.ts) - `ResourceProvider` and `SchemeDescription`, the shape `computer:` and the people schemes take"
---

## Context

Usage is recorded (usage/01-03) and nothing reads it back.
ahpapp already lists and reads `computer:` and, after host/36, the people schemes through the resource calls and their `_meta` advertisement.

## Decision

Usage is a `usage:` resource scheme guarded by a `usage` grant subject (`usage:read`).
It serves each pool's totals and the records charged to it.
A signed-in person reads, without `usage:read`, their own `user:` pool and the `team:` and `project:` pools they are a member of; anything else needs the grant.
Source: Softov, 2026-10-02, asked "How should usage/04 serve usage to a client such as ahpapp?": "A `usage:` resource scheme"; asked "what should the `usage:` scheme serve?": "Totals and records"; asked "which pools can a signed-in person read without a `usage:read` grant?": "Own, teams and projects".

## Consequences

ahpapp reads usage with the resource path it already has, and the CLI and `/api` read the same provider.
The `Usage` port gains a way to read records back, which a plugin that replaces the store must answer.

## Options

- **Commands only (`ahpd usage`, `/api`)**: rejected, ahpapp has no `/api` client.
- **Totals only**: rejected, a turn or a stretch could not be traced.
- **Own pool only, or grants only**: rejected, a person could not see what their team has left.
