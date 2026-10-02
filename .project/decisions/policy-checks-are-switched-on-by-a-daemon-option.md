---
title: Policy checks are switched on by a daemon option, not by the first policy
status: accepted
date: 2026-10-02
refs:
  - "[code://packages/server/src/config.ts](../../packages/server/src/config.ts) - `UsageSetting`, the daemon's usage block an option sits beside"
  - "file:///github/ahp-review/prospect/ahp-user-rules.md - step 4: with no candidate policy, deny"
---

## Context

The rules deny anything no policy allows.
An existing host has no policies, and turning that rule on by itself would refuse every session.

## Decision

A daemon option switches policy checks on; with it off, which is the default, nothing is checked and every policy is only stored.
With it on, anything no active policy allows is denied, whether or not any policy exists yet; root and `*:*` are never checked.
Source: Softov, 2026-10-02, asked "The draft denies anything no policy allows. When does that start on an existing host?": "A daemon option".

## Consequences

An operator can write and review policies before they bind, and turns them on in one place.
A host switched on with no policies refuses everyone but root, which is what it was told.

## Options

- **On once a policy exists**: rejected, the first policy written would start refusing everything else at once.
