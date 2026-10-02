---
title: A plugin loaded more than once is keyed by its provider in root config
status: superseded
superseded-by: decisions/a-plugin-loads-once-and-each-preset-is-a-variant.md
date: 2026-10-02
refs:
  - "[code://packages/server/src/rootconfig.ts](../../packages/server/src/rootconfig.ts) - `plugins.<name>`, one key per `plugins` entry"
---

## Context

Root config carries each `plugins` entry as the key `plugins.<name>`.
One module can be loaded twice with different options, as `@ahpd/agent-claude` is for `claude` and `claude-openrouter`, and the two entries then share a key: the answer shows one and a write edits the other.

## Decision

A plugin loaded once stays `plugins.<name>`.
When a name repeats, each of its entries is keyed `plugins.<name>#<provider>`, from the entry's `provider` option, and a repeated entry with no `provider` is refused at start, since its agents would clash anyway.
Source: Softov, 2026-10-02, asked "How should a plugin loaded more than once be keyed?": "By provider when repeated".

## Consequences

A key can change from `plugins.<name>` to `plugins.<name>#<provider>` when a second entry of the same module is added.
The key names something a person recognises in a form, and survives the list being reordered.

## Options

- By position, `plugins.<n>`: a key changes whenever the list is reordered or an entry is removed.
- Leave repeated names out of root config: the two Claude entries could only be edited in the file.
