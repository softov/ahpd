---
title: The ahpd tools option can turn off the rule that a write needs a read first
status: done
depends: [task-06-tools-and-providers-use-cofolds-config.md, task-07-a-test-reads-before-it-writes.md, task-08-exports-and-docs.md]
layer: "agent-cofold"
refs:
  - "[code://packages/agent-cofold/src/capabilities.ts#L82-L111](../../../../packages/agent-cofold/src/capabilities.ts#L82-L111) - `toolsOf`, the loose reader of the `tools` option"
  - "[code://packages/agent-cofold/src/plugin.ts#L68-L88](../../../../packages/agent-cofold/src/plugin.ts#L68-L88) - the `tools` option's schema"
  - npm://@cofold/tools - the release Softov makes with `files: { requireRead: false }`; its range is set then
  - file:///github/cofold/.project/plans/tools/04-a-harness-can-turn-off-read-before-write/plan.md - the cofold plan that adds the option
---

## Objective

ahpd takes the `@cofold/tools` release that carries cofold tools 04, and `tools: { files: { requireRead: false } }` turns the rule off for a cofold session.
The rule stays on when the key is absent.

## Files

- `UPDATE: pnpm-workspace.yaml` - the two `overrides` entries for the packed tarballs go, and the supply-chain policy already names 0.4.0 and 0.2.1.
- `UPDATE: pnpm-lock.yaml` - the two versions resolved from the registry, with their integrals.
- `UPDATE: packages/agent-cofold/src/capabilities.ts:82-111` - `toolsOf` reads `files` as a boolean or `{ requireRead }`, for `strictTools: false`.
- `UPDATE: packages/agent-cofold/src/plugin.ts:68-88` - the loose schema takes the object form of `files`.
- `UPDATE: packages/agent-cofold/test/agent-cofold-tools.test.ts` - the cases for the option.
- `UPDATE: packages/agent-cofold/test/agent-cofold-options.test.ts` - the object form on both checks.
- `UPDATE: packages/agent-cofold/README.md` - the `requireRead` key in the tools table.

## Steps

1. Wait for Softov to release the cofold change from tools 04.
2. Set the `@cofold/tools` range to that release in both package files.
3. Run `pnpm install --no-frozen-lockfile` once.
4. Extend `toolsOf` and the loose schema to the object form of `files`.
5. Add a case: with `requireRead: false`, an edit of an unread file succeeds and reaches `onFileEdit`.
6. Add a case: with no `requireRead`, cofold refuses the same edit.
7. Add a case: `strictTools: false` reads the same key.
8. Document the key in the README.

## Validation

- The full gate in the plan's checklist passes.

## Resume

- `@cofold/tools` 0.4.0 and `@cofold/store-file` 0.2.1 are published, and the ranges were already `^0.4.0` and `^0.2.1`.
- The two `overrides` entries in `pnpm-workspace.yaml` are gone, so the lockfile resolves both from the registry.
- `pnpm install` rewrote `pnpm-lock.yaml` with the published integrals, and the `.cofold-pack` directory is deleted.
- The published 0.4.0 carries `requireRead`, which the installed `dist/files.js` and `dist/standard.js` show.
- The root `package.json` needed no change: task 01 had already set store-file to `^0.2.1`, and the root declares no `@cofold/tools`.
- `toolsOf` takes the object form of `files`, keeping a `requireRead` that is a boolean and dropping one that is not.
- A dropped `requireRead` is the rule on, because cofold's default for an absent key is `true`.
- `plugin.ts`'s loose `tools.files` is `['boolean', 'object']` with `requireRead`, like the `web` switch beside it.
- The `tools` option's description now names the read-first rule among what it decides.
- A case opens a session with `files: { requireRead: false }` and an edit of an unread file, which runs and reports `before` and `after`.
- The `requireRead`-absent refusal is task 07's own case, so step 6 needed no new one.
- A case in the options test loads the object form under both checks and refuses a `requireRead` that is not a boolean.
- The README says the key turns the rule off, and that the rule stays on when the key is absent.
- The agent-cofold suite is 15 files and 212 cases, all passing.
- The two intent-to-add index entries for the deleted tarballs stay, because `git reset` is denied in this mode; Softov clears them.
- Nothing is committed.
