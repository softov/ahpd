---
title: A removed team's keys work again when the team is added back
status: open
date: 2026-11-03
severity: major
blocks: []
refs:
  - "[code://packages/sdk/src/access/users.ts#L1649-L1656](../../packages/sdk/src/access/users.ts#L1649-L1656) - `removeTeam` removes the team and leaves its keys in the tokens file"
  - "[code://packages/sdk/src/access/users.ts#L1460-L1470](../../packages/sdk/src/access/users.ts#L1460-L1470) - `verifyTeamKey` checks only that the team is listed"
  - "[code://packages/sdk/src/access/users.ts#L1673-L1682](../../packages/sdk/src/access/users.ts#L1673-L1682) - removing a person drops the person's tokens, so an id added back has no old credentials"
  - git://2d622c94 - proxy/20261029-2014 added team keys
  - git://77ba53f8 - main when the problem was read
---

## Symptom

Read from the code in the review of 2026-11-03, and not reproduced.
An operator mints a proxy key for team `ops`, then removes the team.
The key is refused.
The operator adds a team named `ops` again, and the old key opens the proxy again.

## Cause

`removeTeam` writes the users file without the team, and does not touch the tokens file.
`verifyTeamKey` finds the key record and accepts it when its team id is listed.

## Impact

A key that the operator thinks is gone comes back.
Whoever still holds it can charge calls to the new team.

## Workaround

Revoke a team's keys before the team is removed.

## Fix

- In `removeTeam`, drop the tokens whose `team` is the id, as `remove` does for a person, and add a test.
