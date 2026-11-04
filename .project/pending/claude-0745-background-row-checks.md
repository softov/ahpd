---
title: Check that a background row outlives its turn
plans:
  - plans/claude/20261104-0745-a-background-row-outlives-its-turn/plan.md
---

# Check that a background row outlives its turn

The plan's tests use a fake Claude feed. This check runs the real CLI on a live daemon.

## Steps

1. Restart your daemon after the plan merges.
2. Open a new Claude session, and send: `With your Bash tool, run "sleep 600" and "while true; do date; sleep 5; done" in the background, then end your turn.`
3. After the turn ends, check that two background rows show, each with its command.
4. Press the stop on the `sleep 600` row, and check that only that row goes.
5. Check that the loop's row stays, with its command.
6. Press the stop on the loop's row, and check that it goes.

## Reply
