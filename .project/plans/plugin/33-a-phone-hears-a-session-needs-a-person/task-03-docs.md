---
title: The push plugin is documented
status: todo
depends:
  - task-02-a-waiting-session-is-sent.md
layer: "docs"
refs:
  - "[code://docs/PLUGINS.md#L241-L300](../../../../docs/PLUGINS.md#L241-L300) - the Events section, which gains a consumer"
---

## Objective

A person can install `@ahpd/push`, and a client author knows how to register a device.

## Files

- `CREATE: packages/push/README.md` - install, options, what a notification says, where devices are kept.
- `UPDATE: docs/PLUGINS.md` - one line under Events naming `@ahpd/push` as a consumer of `input_needed_set`, and the `push:` scheme beside `computer:`.

## Steps

1. Write the README from the package's real options.
2. Add the lines to `docs/PLUGINS.md`.

## Validation

- Every option the README names exists in `plugin.ts`.

## Resume
