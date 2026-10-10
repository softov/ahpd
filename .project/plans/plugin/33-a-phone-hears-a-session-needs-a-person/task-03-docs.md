---
title: The push plugin is documented
status: done
depends:
  - task-02-a-waiting-session-is-sent.md
layer: "docs"
refs:
  - "[code://docs/PLUGINS.md#L373-L432](../../../../docs/PLUGINS.md#L373-L432) - the Events section, which gains a consumer"
---

## Objective

A person can install `@ahpd/push`, and a client author knows how to register a device.

## Files

- `CREATE: packages/push/README.md` - install, options, what a notification says, that a device hears only the sessions its client created or opened, where devices are kept.
- `UPDATE: docs/PLUGINS.md` - one line under Events naming `@ahpd/push` as a consumer of `input_needed_set`, and the `push:` scheme beside `computer:`.

## Steps

1. Write the README from the package's real options.
2. Add the lines to `docs/PLUGINS.md`.

## Validation

- Every option the README names exists in `plugin.ts`.

## Resume

- **Done:** implemented 2026-10-09. `packages/push/README.md` is written from the package's real options: the badges and the two halves, `ahpd plugin install @ahpd/push`, a configuration entry with both options set, an options table (`title`, default the daemon's name; `accessToken`, none), the `push:` scheme as a table of the five commands with their refusals, what a notification says, which sessions a device hears, and where the devices are kept. `docs/PLUGINS.md` gains two paragraphs - one under Events naming `@ahpd/push` as a consumer of `input_needed_set` and `input_needed_removed`, and one in the third worked example putting `push:` beside `computer:` as a scheme that exists to be written to.
- **Beyond the task's Files:** `packages/push/src/provider.ts` - the two descriptions of `lang` said it is "the language a notification is worded in", which is not true: the sender words every notification in English and nothing reads `lang`. Both now say the language is kept with the device and notifications are worded in English. A schema description that a README must contradict is a description that is wrong, so correcting it is part of writing the documentation honestly. No behaviour changed.
- **Validation:** every option the README names is in `plugin.ts` - `title` and `accessToken`, and nothing else is named.
- **Gates:** documentation only, so no gate covers it beyond the full run; the README names no option that `optionsSchema` does not declare.
- **Next action:** the plan's four tasks are all `implemented`. Nothing is `done`, so the plan stays `status: active` and `implemented.md` is not written - do-spec closes a plan only when every task is `done` or `dropped`, and a review sets that.
- **Open questions:** none.
- **Watch out for:** the README says `lang` is kept and unused, which is a statement about today's sender; a later task that words a notification per device makes that line stale and it should be rewritten then.
