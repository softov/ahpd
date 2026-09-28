---
title: A changes URI opens in a client that normalises it - implemented
date: 2026-09-28
refs:
  - git://1d00d3f
  - "[code://packages/sdk/src/changes.ts](../../../../packages/sdk/src/changes.ts) - `beforeUri`, `capturedUri`, `partsOf` and `sideOf`"
  - "[code://packages/sdk/src/host.ts](../../../../packages/sdk/src/host.ts) - `isRootChannel`"
---

Every side of a diff ahpd serves opens in VS Code as it does in a client that sends a URI back verbatim, and `ahp-root:` is taken as the root channel.

## What was built

- [`code://packages/sdk/src/changes.ts`](../../../../packages/sdk/src/changes.ts) - `ahp-git://head/<path>` and `ahp-edit://turn/<base64url session>/<turn>/<phase>/<path>` with percent-encoded segments, read by their parsed and decoded parts; the older `ahp-edit://<encoded session>/...` form is still read.
- [`code://packages/sdk/src/host.ts`](../../../../packages/sdk/src/host.ts) - `isRootChannel` takes `ahp-root://` and `ahp-root:` everywhere the host compared a channel to the root, and `initialize` answers an initial subscription under the spelling the client sent.

## Verified

- `packages/sdk/test/changes-uris.test.ts` carries a normaliser ported from VS Code's `uri.ts`, checks it against VS Code's outputs, and reads every minted side after it; the failing-first cases failed before their fix.
- Task 04 pinned that a `file:` target is read decoded and one outside the directory is refused; host/21's `pathIn` already did it.
- `pnpm test` 105 files, 1449 tests; `pnpm typecheck` and `pnpm boundary` green.
- Reviewed by Softov on 2026-09-28.

## Departures from the plan

- Task 04 changed no code; it pinned behaviour host/21 had already built.

## Left for later

- The normaliser in the test is a port of VS Code's `uri.ts`; it is checked again only if VS Code changes it.
