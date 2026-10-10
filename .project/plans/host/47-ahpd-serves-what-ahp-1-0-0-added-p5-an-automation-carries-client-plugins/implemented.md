---
title: An automation carries the client plugins its template names - implemented
date: 2026-10-09
refs:
  - "[code://packages/sdk/src/clientplugins.ts](../../../../packages/sdk/src/clientplugins.ts)"
  - "[code://packages/sdk/src/host/actions.ts](../../../../packages/sdk/src/host/actions.ts)"
  - "[code://packages/sdk/src/host/automations.ts](../../../../packages/sdk/src/host/automations.ts)"
---

An automation's template can name client plugins, and every run of it loads them with nobody connected.
The host copies each plugin from the client when the automation is saved, and refuses the whole write if a copy fails.
A host with no client plugins directory does not advertise `customizations` and refuses a template that names any.

## What was built

- [`code://packages/sdk/src/clientplugins.ts`](../../../../packages/sdk/src/clientplugins.ts) - `capture`, `spare` and `prune`; copies live at `<dir>/automations/<sha256 of uri and nonce>`, outside the LRU order.
- A capture holds each copy it makes back from `prune` until its write is stored or refused, and answers `HeldCopies` with a `release`.
- [`code://packages/sdk/src/host/actions.ts`](../../../../packages/sdk/src/host/actions.ts) - the refusal, the capture before the store, and a prune after a write and after a removal.
- [`code://packages/sdk/src/host/automations.ts`](../../../../packages/sdk/src/host/automations.ts) - a run sets an `Automation` active client on its session and waits for the plugins to settle.
- [`code://packages/sdk/src/host/handshake.ts`](../../../../packages/sdk/src/host/handshake.ts) - `customizations: {}` in the automation capabilities, only beside the port.
- [`code://packages/sdk/src/automations.ts`](../../../../packages/sdk/src/automations.ts) and [`code://packages/sdk/src/scheduled.ts`](../../../../packages/sdk/src/scheduled.ts) - the copies on the entry and the run, kept across a restart.
- [`code://packages/sdk/src/types/index.ts`](../../../../packages/sdk/src/types/index.ts) - exports `CapturedPlugin`, `HeldCopies` and `TemplatePlugin`, which the public port and store signatures use.
- [`code://docs/AHP.md`](../../../../docs/AHP.md) - the capability, the two automation rows and the `Automation` client.

## Verified

- In the review worktree on main `b6e61e5`: install, schema, build, typecheck and boundary pass, and the suite passes 4701 tests in 265 files.
- `automations.test.ts` covers the capture, the reuse of an unchanged copy, a new nonce, a failed read and a duplicate id.
- It also covers a run's session, the prune, and a prune while another capture is still open.
- `scheduled.test.ts` covers the copies across a restart and a malformed stored row.

## Departures from the plan

- The review added the three type exports, in a file no task named.
- The review added the hold on a capture in progress, by Softov's answer of 2026-10-09.
- `tooling.ts` exports `pluginsSettled` beside host/77's `deniedMcpServers`.

## Left for later

- A template plugin with no `nonce` is not copied again when its content changes, where VS Code reuses the earlier entry's copy.
