---
title: gitGuard is fetch or open
status: todo
depends: []
layer: "computer"
refs:
  - "[code://packages/computer/src/plugin.ts#L119-L123](../../../../packages/computer/src/plugin.ts#L119-L123) - the schema row"
  - "[code://packages/computer/src/plugin.ts#L225-L226](../../../../packages/computer/src/plugin.ts#L225-L226) - where a profile's `gitGuard` is read"
  - "[code://packages/computer/src/plugin.ts#L379-L388](../../../../packages/computer/src/plugin.ts#L379-L388) - the two answers a profile may give"
  - "[code://packages/computer/src/manifest.ts#L162-L167](../../../../packages/computer/src/manifest.ts#L162-L167) - `Profile.gitGuard`"
---

## Objective

A profile's `gitGuard` is `fetch`, the default, or `open`; `bind` is still accepted and read as `fetch`, with one line at load naming the profile (decision 1).

## Files

- `UPDATE: packages/computer/src/gitdir.ts` - `GitGuard` is `'fetch' | 'open'`, with its doc saying what each is now.
- `UPDATE: packages/computer/src/manifest.ts:162-167` - `Profile.gitGuard` and its doc.
- `UPDATE: packages/computer/src/plugin.ts:119-123` - the schema lists `fetch` and `open`, `fetch` when absent; `bind` stays in the enum so an existing file loads.
- `UPDATE: packages/computer/src/plugin.ts:225-226` - `bind` read as `fetch`, logged once: `profiles.<key>.gitGuard is bind, which is now fetch: the machine commits in a git directory of its own`.
- `UPDATE: packages/computer/src/plugin.ts:379-388` - the answers check takes three values for `gitGuard`.
- `UPDATE: packages/computer/test/computer-plugin.test.ts` - the cases below.

## Steps

1. Failing case first: a profile with `gitGuard: "fetch"` is refused at load today.
2. Change the type, the schema, the reading and the check.
3. `withGit` passes `fetch` where it passed `bind`; nothing else changes in this task.

## Validation

- `computer-plugin.test.ts`: `fetch` loads; absent reads as `fetch`; `bind` loads as `fetch` and logs the line once; `open` is unchanged; `closed` is refused naming the three.
- `npx tsc -b` clean; `npx vitest run packages/computer/test/computer-plugin.test.ts` passes.

## Resume
