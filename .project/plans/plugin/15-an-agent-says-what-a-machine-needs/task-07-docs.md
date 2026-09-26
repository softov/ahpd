---
title: Docs
status: implemented
depends: [task-04-agents-kept-to-their-machines.md, task-05-claude-declares.md, task-06-cofold-declares.md]
layer: "docs"
refs:
  - "[code://docs/COMPUTER.md](../../../../docs/COMPUTER.md) - the profile example"
---

## Objective

`docs/COMPUTER.md` shows a profile with `agents` instead of mounts, what each agent needs, how to override a need, and the shared-folder warning.

## Files

- `UPDATE: docs/COMPUTER.md`

## Steps

1. Replace the `versions/2.1.267` example.
2. Add the warning: one `~/.claude` is one sign-in for every session on the host.

## Validation

- The example, pasted into a config, makes a working machine.

## Resume

Done 2026-09-26. `docs/COMPUTER.md` shows a profile with `agents: ["claude"]` and the three needs it brings, how to point a need elsewhere in the profile or once in the plugin options, the order the values are taken in, the same-path `folder` and why it matters for Claude's history, the `ahpd.agents` label with the picker filter and the refusal, and the shared `~/.claude` warning. The `versions/2.1.267` example and the hand-written mount list are gone.

Found: the create body may name `folder` only with `bodyMounts`, so the security section names it beside `mounts`.
