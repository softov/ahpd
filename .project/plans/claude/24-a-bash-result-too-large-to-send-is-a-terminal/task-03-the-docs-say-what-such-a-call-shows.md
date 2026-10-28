---
title: The docs and the changelog say what such a call shows
status: done
depends: [task-01-a-bash-result-claude-saved-shows-its-terminal.md]
layer: "docs"
refs:
  - "[code://packages/agent-claude/README.md#L178-L186](../../../../packages/agent-claude/README.md#L178-L186) - the Supported section, which `docs/plugins/agent-claude.md` includes"
  - "[code://docs/sdk/AHP.md#L270](../../../../docs/sdk/AHP.md#L270) - the `chat/toolCallComplete` row"
  - "[code://CHANGELOG.md#L1-L13](../../../../CHANGELOG.md#L1-L13) - the head of the changelog and the 0.14.1 section"
---

## Objective

The agent-claude README, the sdk docs and the changelog say that a `Bash` result too large to send shows a terminal.

## Files

- `UPDATE: packages/agent-claude/README.md:178-186` - the Supported section says what such a call shows.
- `UPDATE: docs/sdk/AHP.md:270` - the `chat/toolCallComplete` row says what the content holds.
- `UPDATE: CHANGELOG.md:5-13` - a `### Claude` entry in the `0.14.1 - unreleased` section.

## Steps

1. Add a paragraph to the README's Supported section about the terminal on a saved `Bash` result.
2. Add what such a call's content holds to the `chat/toolCallComplete` row of `docs/sdk/AHP.md`.
3. Add a `### Claude` subsection with one entry to `## 0.14.1 - unreleased`.

## Validation

- Each changed paragraph reads as first written, with no em dash and no double dash.
- Each new sentence says what the code does, checked against `savedoutput.ts`.

## Resume

- **Done:** 2026-10-27.
  The README's Supported section has a paragraph on the terminal, how long it lasts and what gets none.
  The `chat/toolCallComplete` row of `docs/sdk/AHP.md` says what such a call's content holds.
  `docs/sdk/TERMINALS.md` already says what the host keeps for a backend, from host 126.
