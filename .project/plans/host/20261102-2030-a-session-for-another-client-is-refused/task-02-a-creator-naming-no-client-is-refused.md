---
title: A creator naming no client is refused
status: done
depends: [task-01-a-creator-naming-another-client-is-refused.md]
layer: host
refs:
  - "[code://packages/sdk/src/host/sessionmethods.ts#L959-L975](../../../../packages/sdk/src/host/sessionmethods.ts#L959-L975) - the creator's check"
  - "[code://packages/sdk/test/presence.test.ts#L392-L403](../../../../packages/sdk/test/presence.test.ts#L392-L403) - the case that reads a filled id"
---

## Objective

A `createSession` whose `activeClient` names no `clientId` is refused as one naming another client is.
Nothing is claimed or made for it.

## Files

- `UPDATE: packages/sdk/src/host/sessionmethods.ts:959-975` - the check refuses an entry whose `clientId` is not the connection's, absent included.
- `UPDATE: packages/sdk/src/host/sessionmethods.ts:1045-1060` - the entry's comment drops the filled id.
- `UPDATE: packages/sdk/test/presence.test.ts:392-403` - the creator's entry names its client, and a new case refuses one naming none.
- `UPDATE: packages/sdk/test/presence.test.ts:644-690` - the creators name their client.
- `UPDATE: packages/sdk/test/host-remote-session.test.ts:133-152` - the helper's creator names its client.
- `UPDATE: docs/sdk/AHP.md` - the `createSession` row.

## Steps

1. Compare the entry's `clientId` with the connection's whatever it holds, as the reference host does.
2. Drop the sentence on a filled id.
3. Name the client in each case that sends a creator's entry.
4. Add the case that sends an entry with no `clientId`.
5. Describe the refusal in the `createSession` row.

## Validation

- `packages/sdk/test/presence.test.ts`: the new case fails on `7e87e7da` and passes after.
- The presence and remote session test files pass.
- `pnpm run typecheck` is clean.

## Resume

Built 2026-11-02.

- On `7e87e7da`'s sources the new case fails: the session is made with the connection's id filled in.
- Presence's held-as-sent case, its two other creators and the remote session helper name the connection's id.
