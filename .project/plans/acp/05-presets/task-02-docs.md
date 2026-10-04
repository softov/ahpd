---
title: Docs
status: done
depends: [task-01-the-preset-table.md]
layer: "docs"
refs:
  - "[code://docs/PLUGINS.md#L750-L799](../../../../docs/PLUGINS.md#L750-L799) - the ACP section: the config example, the options table, and \"two specs with two commands are two backends\""
  - "[code://packages/agent-acp/README.md](../../../../packages/agent-acp/README.md) - the two-spec example and the options table"
---

## Objective

The docs show one `@ahpd/agent-acp` load with a `presets` map, list the shipped presets, and say `gemini --acp`.

## Files

- `UPDATE: docs/PLUGINS.md:750-799` - the config example becomes one load with `presets: { "copilot": {}, "codex": {} }`; the options table moves the per-agent options under `presets.<id>` and adds `base`, `name` and the `$secret` form of an `env` value; line 785's "Two specs with two commands are two backends" and the paragraph at 792-795 ("One spec is one server ... four configuration lines") are replaced by one saying each key is an agent of its own, with the shipped presets listed.
- `UPDATE: packages/agent-acp/README.md` - the same example, table and list; line 11's `gemini --experimental-acp` becomes `gemini --acp`.

## Steps

1. Say that a preset that cannot be resolved is skipped with a log line and the others register, and that a top-level per-agent option fails the load.
2. One sentence per line where the file is not wrapped; `docs/PLUGINS.md`'s ACP section is wrapped, so keep its wrapping. No em dash.

## Validation

- Read by hand against the code and the shipped table.

## Resume
