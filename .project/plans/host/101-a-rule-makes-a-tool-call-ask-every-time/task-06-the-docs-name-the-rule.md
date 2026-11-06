---
title: The docs name the rule
status: done
depends: [task-02-claude-asks-for-a-matched-tool.md, task-03-acp-asks-for-a-matched-tool.md, task-04-pi-asks-for-a-matched-tool.md, task-05-cofold-asks-for-a-matched-tool.md]
layer: docs
refs:
  - "[code://docs/sdk/AHP.md#L195](../../../../docs/sdk/AHP.md#L195) - the keys the host acts on"
---

## Objective

The docs say what the rule does, who sets it, and where an ACP agent is out of its reach.

## Files

- `UPDATE: docs/sdk/AHP.md:195` - add `eligibleForAutoApproval` to the keys the host acts on.

## Steps

1. Add `eligibleForAutoApproval` to the list in `AHP.md`, and say that it needs `config:change`.
2. Say that a matched call asks in every backend and every mode, and offers no "always" option.
3. Say that an ACP agent's own tools are out of reach.
4. Set this task and the plan row to `implemented`.

## Validation

- `node /home/softov/.claude/skills/do-spec/scripts/lint-prose.mjs docs/sdk` prints nothing new.

## Resume

- **Done so far:** 2026-10-19. `docs/sdk/AHP.md` lists `eligibleForAutoApproval` among the keys the host acts on. A paragraph there says it is host-wide and needs `config:change`. It matches one tool or a server's `<server>/*`, asks in every backend and mode, refuses in `dontAsk`, and offers no "always". It also says the host cannot revoke an approval cofold remembered before the rule was set. An ACP agent's own tools are out of reach, so the rule reaches only the MCP tools the host serves it. The prose lint on `docs/sdk` shows the same findings as before. They are the em dashes at 183, 210, 245, 285, 301, 314, 324, 330 and 339, and the long lines at 195, 384 and 947.
- **Next action:** the final verification checklist, then a review.
- **Open questions:** none.
- **Watch out for:** `AHP.md` is hard-wrapped at 80 columns, so the new paragraph is wrapped to match.
