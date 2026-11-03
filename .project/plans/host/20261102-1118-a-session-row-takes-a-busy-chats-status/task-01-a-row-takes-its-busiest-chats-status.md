---
title: A row takes its busiest chat's status
status: done
depends: []
layer: host
refs:
  - "[code://packages/sdk/src/host/catalogue.ts#L454-L482](../../../../packages/sdk/src/host/catalogue.ts#L454-L482) - `drivingOf`"
  - "[code://packages/sdk/test/subagent-chat.test.ts#L808-L847](../../../../packages/sdk/test/subagent-chat.test.ts#L808-L847) - the rows of a session with a busy worker or a busy second chat"
---

## Objective

`drivingOf` promotes a chat that needs input, then a chat that runs, over the default chat's bits, and promotes no error.

## Files

- `UPDATE: packages/sdk/src/host/catalogue.ts:454-482` - `drivingOf` by VS Code's aggregate, with its comment and source.
- `UPDATE: packages/sdk/test/subagent-chat.test.ts:808-847` - a row with a busy worker or a busy second chat reads running.
- `UPDATE: packages/sdk/test/host-catalogue.test.ts` - a failed peer chat leaves the row at the default chat's bits.
- `UPDATE: docs/sdk/SESSIONS.md:50-60` - how a session of several chats reads its status.

## Steps

1. Write `drivingOf` from `_aggregateChatSummaries`.
2. Change the tests of a busy worker and a busy second chat to read running.
3. Add a case of a failed peer chat under an idle default chat.
4. Say the rule in `SESSIONS.md`.

## Validation

- `packages/sdk/test/subagent-chat.test.ts` and `packages/sdk/test/host-catalogue.test.ts`: each changed or new case fails on `6e6d1ca8` and passes after.
- The sdk files that read a row's status pass.
- `pnpm run typecheck` is clean.

## Resume

Built 2026-11-02 in `ba28a312`.

- `drivingOf` returns `InputNeeded` with the asking chat's activity, else `InProgress` with the running chat's, else the base chat's bits and activity.
- The two `subagent-chat.test.ts` cases of an idle default chat beside a busy worker or second chat now read running, and their names say so.
- The new `host-catalogue.test.ts` case runs a second chat to an error and reads the session's row idle and the chat's own row in error.
- `SESSIONS.md` says the rule under the table of status bits.
