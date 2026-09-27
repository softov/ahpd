---
title: The docs say how to stage
status: implemented
depends: [task-02-stage-and-unstage-a-file-or-folder.md]
layer: "docs"
refs:
  - "[code://docs/AHP.md#L640-L664](../../../../docs/AHP.md#L640-L664) - the changeset operations and staging paragraphs"
---

## Objective

`docs/AHP.md` says that a person stages from the session with `stage` and `unstage`, on a file or a folder, the session's folder meaning everything, and that VS Code's Source Control and `git add` in a terminal work too.

## Files

- `UPDATE: docs/AHP.md:640-664` - the staging paragraph.

## Steps

1. Replace "VS Code shows no staging in its session view, so a person stages in its Source Control" with what is true after task 02: both buttons on every row in VS Code, a folder from a client that sends one, and the other ways to stage.
2. Say that a target above the session's folder is refused, for every resource-scoped operation.
3. Match the file's own wrapping.

## Validation

- Every sentence read against the code after tasks 01 and 02.
- No em dash in the changed lines.

## Resume

Implemented 2026-09-27. `docs/AHP.md` now lists `stage` and `unstage` with the other operations, and the staging paragraph says a person stages and unstages from the session, that the two take a file or a folder with the session's own folder meaning everything under it, that VS Code draws both buttons on every row, that a folder comes from a client that sends one such as ahpapp, that `git add` in a terminal and VS Code's Source Control work too, and that a target above the session's folder is refused for every resource-scoped operation.

This task changes prose only, so there was no test to watch fail. Every sentence is read against `changes.ts` after tasks 01 and 02, the added lines are wrapped at 80, and no changed line holds an em dash.
