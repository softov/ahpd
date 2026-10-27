---
title: The docs and the changelog say what such a call shows
status: todo
depends: [task-01-a-bash-result-claude-saved-shows-its-terminal.md]
layer: "docs"
refs:
  - "[code://packages/agent-claude/README.md#L178-L186](../../../../packages/agent-claude/README.md#L178-L186) - the Supported section, which `docs/plugins/agent-claude.md` includes"
  - "[code://docs/sdk/AHP.md#L270](../../../../docs/sdk/AHP.md#L270) - the `chat/toolCallComplete` row"
  - "[code://docs/sdk/TERMINALS.md#L35-L45](../../../../docs/sdk/TERMINALS.md#L35-L45) - who opens a terminal"
  - "[code://CHANGELOG.md#L1-L5](../../../../CHANGELOG.md#L1-L5) - the head of the changelog and the 0.14.0 section"
---

## Objective

The agent-claude README, the sdk docs and the changelog say that a `Bash` result too large to send shows a terminal.

## Files

- `UPDATE: packages/agent-claude/README.md:178-186` - the Supported section says what such a call shows.
- `UPDATE: docs/sdk/AHP.md:270` - the `chat/toolCallComplete` row says what the content holds.
- `UPDATE: docs/sdk/TERMINALS.md:35-45` - who opens a terminal includes a backend's output terminal.
- `UPDATE: CHANGELOG.md:3-5` - a `0.14.1 - unreleased` section with a `### Claude` entry.

## Steps

1. Add a paragraph to the README's Supported section about the terminal on a saved `Bash` result.
2. Add what such a call's content holds to the `chat/toolCallComplete` row of `docs/sdk/AHP.md`.
3. Add the output terminal to the ways in of `docs/sdk/TERMINALS.md`.
4. Add `## 0.14.1 - unreleased` above `## 0.14.0`, with a `### Claude` subsection and one entry.

## Validation

- Each changed paragraph reads as first written, with no em dash and no double dash.
- Each new sentence says what the code does, checked against `savedoutput.ts`.

## Resume

