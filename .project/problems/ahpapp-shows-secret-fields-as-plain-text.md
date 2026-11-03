---
title: ahpapp shows a first-party secret field as plain text
status: open
date: 2026-11-03
severity: minor
blocks: []
refs:
  - file:///github/ahpapp/src/components/SchemaForm.tsx - line 269 sets `secureTextEntry` from `writeOnly` only
  - "[code://packages/sdk/src/channels/owners.ts#L144](../../packages/sdk/src/channels/owners.ts#L144) - `isSecret` reads `secret` as well as `writeOnly`"
  - git://cdc20f32 - plugin/20261029-2033 moved first-party fields to `secret: true`
  - git://77ba53f8 - main when the problem was read
---

## Symptom

Read from the code in the review of 2026-11-03, and not reproduced.
A user edits a first-party connector in ahpapp.
A field with `secret: true` shows what is typed in plain text.

## Cause

ahpapp's `SchemaForm` hides input only for `writeOnly`.
First-party fields now say `secret: true`, and ahpw already reads it.

## Impact

A token or a password shows on the screen while it is typed.
The plan named this risk.

## Workaround

None.

## Fix

- In ahpapp, set `secureTextEntry` when the field says `secret: true` or `writeOnly: true`.
