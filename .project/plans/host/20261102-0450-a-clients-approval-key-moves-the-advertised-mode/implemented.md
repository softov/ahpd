---
title: A client's approval key moves the advertised mode - implemented
date: 2026-11-02
refs:
  - git://4392a0fd
  - "[code://packages/sdk/test/conformance.test.ts](../../../../packages/sdk/test/conformance.test.ts)"
---

A client's `autoApprove` is held through the host as its `mode` is, and a mode neither name has is refused naming it.

## What was built

- [`code://packages/sdk/test/conformance.test.ts`](../../../../packages/sdk/test/conformance.test.ts) - a case after the continuation's case for `mode`.
- `autoApprove: assisted` is answered as `permissionMode: acceptEdits`, and a client subscribing afterwards is served it.
- `autoApprove: autopilot` is served as `bypassPermissions`.
- `mode: yolo` is refused naming `yolo`, and the served mode stays `bypassPermissions`.

## Verified

- On the continuation the conformance file passes whole, 27 tests.
- On main's source the case fails: the answer is `{ autoApprove: 'assisted' }`, where the continuation answers `{ permissionMode: 'acceptEdits' }`.

## Departures from the plan

- none.

## Left for later

- none.
