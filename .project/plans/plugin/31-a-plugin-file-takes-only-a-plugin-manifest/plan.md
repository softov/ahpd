---
title: A plugin file takes the nearest manifest only when it is a plugin's
domain: plugin
status: active
priority: low
created: 2026-09-30
revalidated: 2026-09-30
requires: []
refs:
  - "[code://packages/server/src/plugins.ts#L68-L78](../../../../packages/server/src/plugins.ts#L68-L78) - `nearestManifest`, which walks up to any `package.json`"
  - "[code://packages/server/src/plugins.ts#L344](../../../../packages/server/src/plugins.ts#L344) - `loadOne` reads that manifest for a file spec"
  - "[code://packages/server/src/plugins.ts#L597](../../../../packages/server/src/plugins.ts#L597) - the listing does the same"
  - "[code://packages/server/test/fixtures/plugin-throws/index.ts](../../../../packages/server/test/fixtures/plugin-throws/index.ts) - a file spec with no manifest, logged as `@ahpd/server`"
---

## Goal

A plugin given as a file with no `package.json` of its own is named by its module and checked against no other package's manifest, while a file inside a plugin package, such as the dev specs `./packages/agent-claude/src/index.ts`, still takes that package's.

## Reconnaissance

The files read are the `refs` above.

### Gaps

- `nearestManifest` takes the first `package.json` above the file, whichever package it is, so `plugin-throws/index.ts` loads as `@ahpd/server` and is checked against the server's `sdkRange` and `entry`.

## Decisions locked in

| What | Source | Task |
| --- | --- | --- |
| The walk takes the nearest `package.json` only when it has an `ahpd` field; otherwise the spec has no manifest and is named by its module's `name` export, or its file name | Softov, 2026-09-30, asked which fix for the open problem: "Only an ahpd manifest" | 01 |
| A file spec with no manifest lists under its file name (the listing does not import it) and loads under its module's `name` export, so the two may differ; accepted as it is | Softov, 2026-10-03, plan review: the listing/load name difference is accepted | 01 |

## Proposed architecture

- **Layer responsibilities** - server only.
- **Source-of-truth files** - [`code://packages/server/src/plugins.ts`](../../../../packages/server/src/plugins.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - Only a plugin's manifest is taken](task-01-only-a-plugins-manifest-is-taken.md) | done | - |

## Risks and tradeoffs

- A private plugin package with no `ahpd` field, loaded by a file spec, loses its manifest's checks; `plugin install` already refuses such a package.

## Resume state

- **Done so far:** task 01 implemented on main (5221af7), awaiting review.
- **Next action:** Softov's review; the close-out (`implemented.md`, `status: built`) waits on it.
- **Open questions:** none.
- **Watch out for:** the load and the listing must agree; both call `nearestManifest`.

## Final verification checklist

- [ ] `plugin-throws/index.ts` logs its own name, not `@ahpd/server`.
- [ ] The dev config's `./packages/agent-claude/src/index.ts` still loads as `@ahpd/agent-claude`.
- [ ] `pnpm typecheck`, `pnpm boundary`, full `pnpm test`.
- [ ] `plans/index.md` updated.
