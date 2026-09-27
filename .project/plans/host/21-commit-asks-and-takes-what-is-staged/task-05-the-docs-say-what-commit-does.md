---
title: The docs say what commit does
status: implemented
depends: [task-04-staging-elsewhere-reaches-the-changeset.md]
layer: "docs"
refs:
  - "[code://docs/AHP.md#L640-L658](../../../../docs/AHP.md#L640-L658) - the changeset operations, with the draft's paragraphs on staging and `ahp.commit`"
---

## Objective

`docs/AHP.md` says that Commit asks first and names what it takes, that it commits what is staged when anything is and everything otherwise, that rows carry `_meta.staged` and `_meta.unstaged`, and that `_meta['ahp.commit'].message` replaces the subject.

## Files

- `UPDATE: docs/AHP.md:640-658` - the draft's two paragraphs, rewritten to match tasks 01 to 04; the file set goes.

## Steps

1. Rewrite the draft's paragraph on `ahp.commit` without `files`, and add the index rule and the confirmation.
2. Say that VS Code shows no staging in the session view, and that staging in its Source Control is what Commit then takes.
3. Match the file's own wrapping.

## Validation

- Every statement matches the code as tasks 01 to 04 left it, read side by side.
- No em dash in the changed lines.

## Resume

Implemented 2026-09-27. `docs/AHP.md` now says Commit takes the index when it holds anything and the whole working tree when it holds nothing, that it carries a `confirmation` naming the subject line and what it takes and is re-declared when either moves, that a row carries `_meta.staged` and `_meta.unstaged` and a staged rename is one row, that VS Code shows no staging in its session view so a person stages in its Source Control, and that `_meta['ahp.commit'].message` replaces the subject. The `files` set is gone, and the four refresh triggers are described.

This task's Validation is the plan's read side by side and names no test, so there was no case to watch fail. No em dash is in the changed lines.
