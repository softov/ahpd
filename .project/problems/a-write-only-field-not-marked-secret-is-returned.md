---
title: A writeOnly field that is not secret is returned unmasked in the connector record
status: open
date: 2026-11-03
severity: minor
blocks: []
refs:
  - "[code://packages/sdk/src/connectors/channel.ts#L372-L376](../../packages/sdk/src/connectors/channel.ts#L372-L376) - `connectorRow` spreads the whole record"
  - "[code://packages/sdk/src/channels/owners.ts#L144-L152](../../packages/sdk/src/channels/owners.ts#L144-L152) - `isSecret` and the top-level `secretFields`"
  - "[code://packages/sdk/src/plugins/validate.ts#L88-L110](../../packages/sdk/src/plugins/validate.ts#L88-L110) - the load warning walks nested fields"
  - git://cdc20f32 - plugin/20261029-2033 added the `secret` keyword
  - git://77ba53f8 - main when the problem was read
---

## Symptom

Read from the code in the review of 2026-11-03, and not reproduced.
An adapter field says `writeOnly: true` and `secret: false`.
A client lists the connectors, and the field's value is in the row.

## Cause

`secretFields` moves only a secret field into the vault.
A field that is `writeOnly` and not secret stays in the record, and `connectorRow` returns the record as it is.
Only the config mask hides such a field.
A nested `writeOnly` field gets the load warning, but `secretFields` reads top-level fields only.

## Impact

The plan's goal says a read never returns a `writeOnly` value, and this one does.

## Workaround

Mark such a field `secret: true`.

## Fix

- Mask every `writeOnly` field in `connectorRow`, as the config mask does.
- Make the warning and `secretFields` agree on nested fields.
