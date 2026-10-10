---
title: The wire is the protocol's, and the wire test proves every frame against AHP 1.0.0 - implemented
date: 2026-10-09
refs:
  - "[code://packages/sdk/test/wire.test.ts](../../../../packages/sdk/test/wire.test.ts)"
---

The wire test checks every request, result and notification ahpd sends against the AHP 1.0.0 schema.
Results and actions have the protocol's shapes, and the root config schema is one a client can read.
Every `_meta` key ahpd invents is named `ahpd.<name>`.

## What was built

- [p1](../43-the-wire-is-the-protocols-p1-the-wire-test-checks-every-frame/implemented.md) - the wire test checks every frame.
- [p2](../43-the-wire-is-the-protocols-p2-results-and-actions-are-the-protocols/implemented.md) - results and actions are the protocol's shapes.
- [p3](../43-the-wire-is-the-protocols-p3-the-root-config-schema-conforms/implemented.md) - the root config schema conforms.
- [p4](../43-the-wire-is-the-protocols-p4-ahpds-own-meta-keys-say-ahpd/implemented.md) - ahpd's own `_meta` keys say `ahpd`.

## Verified

- Each child's implemented.md lists its tests and gate run.

## Departures from the plan

- None beyond those each child lists.

## Left for later

- ahpc run paging, and the `_meta` readers in ahpapp and ahpc, are those clients' own work.
