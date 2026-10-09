---
title: Forced and session-title modes
status: todo
depends: [task-01-the-host-declares-the-setting.md]
layer: sdk
refs:
  - "[code://packages/sdk/src/changes.ts#L687-L702](../../../../packages/sdk/src/changes.ts#L687-L702) - `words()`"
  - "[code://packages/sdk/src/changes.ts#L1069-L1111](../../../../packages/sdk/src/changes.ts#L1069-L1111) - `commit`"
  - "[code://packages/sdk/src/changes.ts#L750-L766](../../../../packages/sdk/src/changes.ts#L750-L766) - the `create-pr` commit"
---

## Objective

The three places that write words go through one function, and forced mode refuses when the person gave none.

## Files

- `UPDATE: packages/sdk/src/changes.ts` - one `wordsFor(kind, setting, given)` serves `commit`, the `create-pr` commit and `words()`.
- `UPDATE: packages/sdk/test/commit.test.ts` - forced refuses an empty message, and the session-title mode gives today's words.

## Steps

1. Move today's words for all three places into `wordsFor`.
2. Return the person's text when they gave one, in every mode.
3. Refuse in forced mode with an error that names the missing text.

## Validation

- Tests cover each place in both modes, with and without text from the person.
- The gates pass.

## Resume
