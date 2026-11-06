---
title: The spec says where a machine session's terminal runs
status: done
depends: [task-01-a-terminal-in-a-machine-runs-in-the-machine.md]
layer: docs
refs:
  - "[code://.project/specs/agent-backends.md#L126-L128](../../../../.project/specs/agent-backends.md#L126-L128) - \"`Start.terminals.open` opens a host terminal that a client can watch\""
  - "[code://docs/plugins/COMPUTERS.md#L127-L132](../../../../docs/plugins/COMPUTERS.md#L127-L132) - the backends that enter a machine, which say nothing of terminals"
---

## Objective

The spec and the computer docs say that a terminal an ACP agent in a machine asks for runs in the machine, and is still the host's terminal to list and watch.

## Files

- `UPDATE: .project/specs/agent-backends.md:126-128` - an `AND` line after line 128: for a session placed in a machine, the terminal's command runs in the machine through `computers.how`.
- `UPDATE: docs/plugins/COMPUTERS.md:127-132` - the ACP row says its terminals run in the machine too.

## Steps

1. Correct the spec in place, citing decision `an-acp-agents-terminal-in-a-machine-runs-in-the-machine`.
2. Add the sentence to the docs' ACP row.

## Validation

- `pnpm docs:build`, or the docs check the repository runs, passes.

## Resume

Implemented 2026-10-20, not reviewed.

- `.project/specs/agent-backends.md` names the decision in its frontmatter.
- Under "Start carries the host's files, shells and tools", two `AND` lines say a terminal in a machine runs there through `computers.how`.
- They also say that terminal stays the host's to list and watch.
- The reason is two sentences, and points at the decision.
- `docs/plugins/COMPUTERS.md` has the same two facts in its ACP row, with a link to the machine section.

Validation: `pnpm docs:build` passes after `pnpm -s build`, and the spec's prose lint is clean. The prose lint on the computer docs reports long sentences elsewhere in that file. None is in the row this task changed, because the linter skips a table row.

- **Next action:** none; this was the last task.
- **Open questions:** none.
- **Watch out for:** the row is long by nature of the table; keep new facts in new rows rather than folding them into it.
