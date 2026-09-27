---
title: The tool section in PLUGINS.md and the agent-cofold README are one sentence per line again
status: implemented
depends: [task-19-the-close-is-true.md]
layer: "docs"
refs:
  - "[code://docs/PLUGINS.md#L407-L450](../../../../docs/PLUGINS.md#L407-L450) - the tool section, one sentence per line"
  - "[code://packages/agent-cofold/README.md#L51-L71](../../../../packages/agent-cofold/README.md#L51-L71) - the README's tool section, the same"
  - git://c6677ba - the section as one sentence per line, before it was joined
---

## Objective

The cofold tool section of `docs/PLUGINS.md` and `packages/agent-cofold/README.md` are one sentence per line, as `c6677ba` wrote them, with the wording they have now.

## Files

- `UPDATE: docs/PLUGINS.md:407-450` - the line breaks.
- `UPDATE: packages/agent-cofold/README.md` - every paragraph joined by task 19 step 3.

## Steps

1. Break each paragraph after each sentence; change no word, and leave tables and lists as they are.
2. Leave the rest of `docs/PLUGINS.md`, which is wrapped at 80, as it is.
3. If a ref in another plan points into these lines, leave it: task 19's Resume already records that those refs move with this section.

## Validation

- `git diff --word-diff` on both files shows no word changed, only line breaks.
- Every line in the section holds one sentence, read through.
- No em dash in the changed lines.

## Resume

Implemented 2026-09-27. Each paragraph in the tool section of `docs/PLUGINS.md` and `packages/agent-cofold/README.md` is broken after each sentence; tables, code blocks and lists are untouched, and the rest of `docs/PLUGINS.md` keeps its 80-column wrap.

The check run instead of a failing test, since this task changes no code: `git diff -U0` on both files, and a whitespace-normalized comparison of each file against `HEAD`, which is identical for both, so no word changed. No line added holds an em dash, and each line of the section reads as one sentence.
