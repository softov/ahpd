---
title: ahpd speaks 1.0.0 and 0.9.0 - implemented
---

## What exists

- `@microsoft/agent-host-protocol` is `^1.0.0` in every package that names it, and `1.0.0` is in `minimumReleaseAgeExclude`.
- `initialize` (`packages/sdk/src/host.ts`) answers with `negotiateProtocolVersion`: the highest offered version compatible with `1.0.0` or `0.9.0`. No compatible version is `-32005` with `supportedVersions`; a malformed entry is `-32602` with the package's message.
- A nested host is accepted when it answers any version in `SUPPORTED_PROTOCOL_VERSIONS` (`packages/sdk/src/nested.ts`).
- The strict schema carries the package version it was built from; the wire test rebuilds a stale one, and `tools/validate.mjs` refuses one with exit 2.
- Tests offer `0.9.0`, which both packages speak; `docs/AHP.md` and `README.md` name `1.0.0` and `0.9.0`.

## Verified

- Handshake tests: `['1.0.0']`, `['0.9.0']`, both orders answer `1.0.0`; `['0.8.0']` and `['99.0.0']` are `-32005`; `['1.0']` and `[7]` are `-32602`.
- After rebasing onto `d947f09`: `pnpm exec tsc --noEmit`, `pnpm boundary`, `pnpm test` (173 files, 2634 tests) pass.

## Departures

- The tools read the package's manifest by walking up from `tools/` to `node_modules`, because the package exports no `./package.json` and `import.meta.resolve` is missing under vitest.
