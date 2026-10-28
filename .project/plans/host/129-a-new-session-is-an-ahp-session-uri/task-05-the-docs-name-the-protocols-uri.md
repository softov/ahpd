---
title: The docs name the protocol's URI
status: todo
depends: [task-02-a-new-session-is-held-as-ahp-session.md, task-03-a-listed-session-is-named-from-its-row.md, task-04-no-provider-is-read-from-a-scheme.md]
layer: "docs"
refs:
  - "[code://docs/sdk/SESSIONS.md#L18](../../../../docs/sdk/SESSIONS.md#L18) - the held name, and the decision it cites"
  - "[code://docs/sdk/AHP.md#L589-L632](../../../../docs/sdk/AHP.md#L589-L632) - \"Session URIs\""
  - "[code://UPSTREAM.md#L7](../../../../UPSTREAM.md#L7) - Pass 7, with its \"Other host changes\" list"
  - "[code://CHANGELOG.md#L5](../../../../CHANGELOG.md#L5) - `0.14.1 - unreleased`"
---

## Objective

The docs say that a new session is `ahp-session:/<uuid>`, that an existing session keeps its name, and that the provider is on the summary.
`UPSTREAM.md` lists `bd64649be19`, and the changelog tells a client what changed.

## Files

- `UPDATE: docs/sdk/SESSIONS.md:18` - how a session is named, in the three cases of the plan.
- `UPDATE: docs/sdk/AHP.md:589-632` - "Session URIs" gives the protocol's name and VS Code since `bd64649be19` as the reason, and keeps the alias part.
- `UPDATE: UPSTREAM.md` - an item under Pass 7 "Other host changes" for `bd64649be19`, ticked by this plan.
- `UPDATE: CHANGELOG.md` - an entry under "Upgrading" in `0.14.1 - unreleased`.
- `UPDATE: .project/specs/sessions-and-chats.md` - a section on how a session is named.

## Steps

1. Change the sentence in `SESSIONS.md` to name the three cases, and link the new decision.
2. Change "Session URIs" in `AHP.md` to say why the old reason no longer holds.
3. Add the `UPSTREAM.md` item with `bd64649be19` and the files this plan changed.
4. Add the changelog entry: a client reads the provider from the summary, not from the scheme.
5. Add the spec section in the WHEN and THEN form of the spec.
6. Run `node .agents/skills/do-spec/scripts/lint-prose.mjs` on the spec.

## Validation

- `rg -n "<provider>:/<id>" docs` finds only the old-name case.
- The lint script reports nothing on the spec.

## Resume
