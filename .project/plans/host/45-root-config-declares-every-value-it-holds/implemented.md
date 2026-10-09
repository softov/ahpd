---
title: The root config declares every value it holds, as VS Code's agent host declares it - implemented
date: 2026-10-09
refs:
  - "[code://packages/sdk/src/vscoderootconfig.ts](../../../../packages/sdk/src/vscoderootconfig.ts)"
  - "[code://packages/sdk/src/host/root.ts](../../../../packages/sdk/src/host/root.ts)"
  - "[code://packages/sdk/src/host/actions.ts](../../../../packages/sdk/src/host/actions.ts)"
  - "[code://packages/sdk/src/host/tooling.ts](../../../../packages/sdk/src/host/tooling.ts)"
---

Root `config.schema` declares the 42 keys VS Code pushes to a remote host.
Each has the property VS Code's agent host gives it, so a client can draw every value it reads back.
A pushed key that no schema declares is refused by name, and the rest of the push applies.
The compact artifact wording and the two title keys are gone, and every session runs under the deferred title strategy.

## What was built

- [`code://packages/sdk/src/vscoderootconfig.ts`](../../../../packages/sdk/src/vscoderootconfig.ts) - `vscodeRootProperties`, the 42 properties copied from VS Code `7516b04bc94`, each with its upstream symbol and line.
- [`code://packages/sdk/src/host/root.ts`](../../../../packages/sdk/src/host/root.ts) - `ROOT_CONFIG_SCHEMA` spreads those properties before `defaultShell` and `workspaceTrust`; `declaresConfigKey` answers for the host's keys and the daemon's.
- [`code://packages/sdk/src/host/actions.ts`](../../../../packages/sdk/src/host/actions.ts) - `root/configChanged` drops the undeclared keys and logs them; a push with no declared key left is rejected with their names.
- [`code://packages/sdk/src/host/tooling.ts`](../../../../packages/sdk/src/host/tooling.ts) - `strategyOf` answers `deferred` for every session; the compact wording, `compactPrompts` and `strategies` are removed.
- [`code://packages/sdk/src/tools/session.ts`](../../../../packages/sdk/src/tools/session.ts) - `rename_chat` is `deferLoading: true`.
- [`code://packages/sdk/test/fixtures/vscode-root-config.json`](../../../../packages/sdk/test/fixtures/vscode-root-config.json) - the connect patch `wire.test.ts` dispatches; the test fails on a value with no property.

## Verified

- The builder's gates passed with 263 files and 4612 tests.
- In the review worktree on main `385ab0e`: install, schema, build, typecheck and boundary pass, and the suite passes with 263 files and 4613 tests.
- `ahp-test-cases.test.ts` names the protocol's cases 127, 128 and 130 in `HOST_REFUSED`, as Softov decided.

## Departures from the plan

- host/70 task 05's own `globalAutoApproveEnabled` property is replaced by upstream's.
- `conformance.test.ts` pushes `telemetryLevel` where it pushed `githubEnterpriseUri`.
- `docs/HOST.md`, `gate.ts` and `types/host.ts` were rewritten where they named the removed keys; no task's Files named them.

## Left for later

- A VS Code release that pushes a new key has it refused until the next UPSTREAM.md pass declares it; the log line names the key.
