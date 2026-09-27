---
title: The docs say what commit does
status: todo
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
