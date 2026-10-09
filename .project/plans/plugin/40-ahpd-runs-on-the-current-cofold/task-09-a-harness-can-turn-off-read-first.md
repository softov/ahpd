---
title: The ahpd tools option can turn off the rule that a write needs a read first
status: todo
depends: [task-06-tools-and-providers-use-cofolds-config.md, task-07-a-test-reads-before-it-writes.md, task-08-exports-and-docs.md]
layer: "agent-cofold"
refs:
  - "[code://packages/agent-cofold/src/capabilities.ts#L120-L172](../../../../packages/agent-cofold/src/capabilities.ts#L120-L172) - `toolsOf`, the loose reader of the `tools` option"
  - "[code://packages/agent-cofold/src/plugin.ts#L66-L82](../../../../packages/agent-cofold/src/plugin.ts#L66-L82) - the `tools` option's schema"
  - npm://@cofold/tools - the release Softov makes with `files: { requireRead: false }`; its range is set then
  - file:///github/cofold/.project/plans/tools/04-a-harness-can-turn-off-read-before-write/plan.md - the cofold plan that adds the option
---

## Objective

ahpd takes the `@cofold/tools` release that carries cofold tools 04, and `tools: { files: { requireRead: false } }` turns the rule off for a cofold session.
The rule stays on when the key is absent.

## Files

- `UPDATE: package.json:34-36` - the `@cofold/tools` range to the release Softov makes.
- `UPDATE: packages/agent-cofold/package.json:66-69` - the `@cofold/tools` range to the release Softov makes.
- `UPDATE: pnpm-lock.yaml` - the resolved version.
- `UPDATE: packages/agent-cofold/src/capabilities.ts:120-172` - `toolsOf` reads `files` as a boolean or `{ requireRead }`, for `strictTools: false`.
- `UPDATE: packages/agent-cofold/src/plugin.ts:66-82` - the loose schema takes the object form of `files`.
- `UPDATE: packages/agent-cofold/test/agent-cofold-tools.test.ts` - the cases for the option.
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

- Tasks 01-08 run on tools 0.3.0, and cofold tests its change against them.
