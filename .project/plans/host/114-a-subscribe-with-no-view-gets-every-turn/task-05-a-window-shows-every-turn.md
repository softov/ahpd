---
title: A window shows every turn
status: done
depends:
  - task-03-claudes-chat-state-holds-every-turn.md
layer: docs
refs:
  - "[code://.project/pending/host-114-turn-cut-checks.md](../../../../.project/pending/host-114-turn-cut-checks.md) - the check by hand from task 01"
---

## Objective

The check by hand has a section for the build with the fix.
Softov's reply says that a VS Code 1.143 window shows the first message of a long session.

## Files

- `UPDATE: .project/pending/host-114-turn-cut-checks.md` - a section "After the fix", with the same steps on the branch that holds tasks 02 and 03.

## Steps

1. Add the section "After the fix" to `pending/host-114-turn-cut-checks.md`, after the merge of tasks 02 and 03.
2. In that section, tell Softov to restart the daemon onto the build with the fix.
3. Repeat the two sections of the check, and expect the first message of the session both times.
4. Ask for the bytes of each snapshot, to compare with the numbers from task 01.
5. Ask Softov to run the section, and write the reply in the Resume below.
6. If the reply is a pass, tick the matching line in the plan's final checklist.
7. Set this task and its plan row to `implemented`.

## Validation

- The Resume holds Softov's reply.
- The reply names the first message shown and the bytes of each snapshot.

## Resume

Done 2026-10-28, except for the reply. `pending/host-114-turn-cut-checks.md` has an "After the fix" section. It says to check out this branch, install, build and restart the daemon, and then repeat both sections of the check. It asks for the first message the window shows, and for the turns, cursor and bytes of each snapshot. Softov's reply is not in yet: this session has no VS Code window, and the question could not be put to him here. The line in the plan's final checklist that names the window stays unticked until the reply says which message it shows.
