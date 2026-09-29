---
title: The docs say what an approval offers on each backend
status: done
depends: [task-02-an-acp-agents-options-are-offered.md, task-03-claude-offers-always-allow.md, task-04-cofold-offers-allow-for-the-session.md]
layer: "docs"
refs:
  - "[code://docs/PLUGINS.md](../../../../docs/PLUGINS.md) - the backends' sections and the `Session` seam"
  - "[code://UPSTREAM.md](../../../../UPSTREAM.md) - the protocol features ahpd sends"
---

## Objective

`docs/PLUGINS.md` says that `confirm` receives the picked option and what each backend offers, and `UPSTREAM.md` ticks confirmation options.

## Files

- `UPDATE: docs/PLUGINS.md` - the `confirm` signature; one sentence per backend on its options; pi offers none.
- `UPDATE: UPSTREAM.md` - confirmation options and `selectedOptionId`.
- `UPDATE: packages/agent-acp/README.md`, `packages/agent-claude/README.md`, `packages/agent-cofold/README.md` - where each describes approvals.

## Steps

1. Match each file's existing style; no em dash.

## Validation

- Every sentence re-read against the code; every relative link resolves.

## Resume

Written.

- `docs/PLUGINS.md`: a new section, `A backend's approval options`, beside `A backend's worker chats`, with the `confirm(toolCallId, approved, optionId?)` signature, where options go, that the host keeps no approval, and one sentence each for Claude, ACP, cofold and pi.
The ACP section's permission paragraph is rewritten for the options it now offers and the once fallback, and the cofold section says what its approval offers.
- `docs/AGENT.md`: the `confirm` signature in both tables, and three sentences under `Being asked` on `options`, `optionId`, and saying `selectedOptionId` back on the echo.
AGENT.md was not in the task's Files; it holds the `Session` contract the task's objective describes, so it was changed with PLUGINS.md.
- `UPSTREAM.md`: a ticked item under Pass 4, `Approvals`, for confirmation options and `selectedOptionId`, pointing to VS Code's `sessionPermissions.ts` for the reference's single set.
There was no existing box for this, so one was added rather than ticked; review where it belongs.
- `packages/agent-acp/README.md`, `packages/agent-claude/README.md`, `packages/agent-cofold/README.md`: one paragraph or sentence each on what an approval offers.

New prose is one sentence per line; the ACP paragraph in PLUGINS.md was hard-wrapped and is now one sentence per line, as the sections around it written since are.
No em dash; no relative link was added.

Gates: `pnpm typecheck` clean; `pnpm boundary` clean; `pnpm test` 107 files, 1544 tests passed.
