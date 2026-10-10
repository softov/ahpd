---
title: Forced and session-title modes
status: done
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

- **Implemented** 2026-10-09 on `build/agents/016ab0b2`, uncommitted.
- `packages/sdk/src/changes.ts:789-820` is `wordsFor(kind, setting, given)`, the one function the three places that write words go through: the commit operation (1253), the commit `create-pr` makes of a dirty tree (912) and the pull request's own words (942). `words()` became `wordsFromSession(kind, given)`, and `asMessage` carries a body when there is one.
- The person's own text wins in every mode. With no setting, the words are what this host wrote before the key existed: the session title for a commit, and the session title with the branch's commits for a pull request.
- `forced` throws `A commit message is required.` for a commit with nothing typed, before anything is staged. A pull request is the other way round: its form is how the person gives the text, so an empty form is left for `create-pr` to refuse at the point the request is actually opened.
- `packages/sdk/test/commit.test.ts` is 30 tests; the four new ones are forced refusing an empty message with the tree left exactly as it was, forced still taking a typed one, the session title with no setting at all, and `session-title` saying nothing about a fallback.
- **Departure 1.** The `create-pr` commit no longer has a rule of its own. It goes through `wordsFor('commit', ...)` with `Changes on ${branch}` as its fallback, so the setting is honoured there too - the plan's watch-out. Under `session-title` the words are what they were.
- **Departure 2.** The pull request's precedence moved. A form that carried a title is used and the setting is not asked at all, where before the port's title, then the form's, then `words()` each had a turn. A form title of spaces now falls through to the setting rather than opening a request under a blank title. The refusal of a form with no title is unchanged and still fires before anything is committed (`changes.ts:888-892`). A second one at 949 covers the case where no form carried a title and the setting wrote none either, which is forced mode with an empty form.
- Gates: `node tools/schema.mjs`, `pnpm build`, `pnpm typecheck` and `pnpm boundary` pass.
