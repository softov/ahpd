---
title: A branch with a pull request offers none for a later edit
status: open
date: 2026-11-09
severity: minor
refs:
  - "[code://packages/sdk/src/sessions/changes.ts#L1747-L1756](../../packages/sdk/src/sessions/changes.ts#L1747-L1756) - the pull request pair is offered only while the branch has no request"
  - git://18ab9642d - the last commit that holds `pending/host-103-drawing-checks.md`, the check where this showed
---

## Symptom

Softov saw this on 2026-11-09 in ahpw, in a worktree session on `ahp-review`.

1. The agent edited a file, and Softov committed it and opened a pull request.
2. The agent edited the file again, and Softov committed it as `37c3fa6`.
3. The Changes tab showed "No changes." and offered no pull request.

Softov does not know yet whether this is a problem.

## Cause

Partly known.
`operations` offers `create-pr` and `prepare-pull-request` only while the branch has no request, as the reference host does.
The pair also needs changes in the working tree, so a clean tree after a commit offers none either.
After the first request, nothing is offered for the new commit.
Not checked: whether VS Code offers a push or an update of the request in this state, and whether `37c3fa6` reached the request.

## Impact

A person who keeps working on a branch after its pull request may not see how to send the new commits.

## Workaround

Push the branch from a terminal.

## Fix

No fix is chosen. Check what VS Code offers on a branch that has a pull request first.

- If VS Code offers a push, offer it too.
- If VS Code offers nothing, delete this file.
