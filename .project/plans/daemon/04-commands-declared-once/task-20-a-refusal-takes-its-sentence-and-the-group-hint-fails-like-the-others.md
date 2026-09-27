---
title: A refusal takes only its sentence, and the group hint fails like every other failure
status: todo
depends: [task-15-a-bare-verb-names-its-sub-commands.md, task-16-handlers-fail-by-throwing.md]
layer: "server"
refs:
  - "[code://packages/server/src/commands/options.ts#L87](../../../../packages/server/src/commands/options.ts#L87) - `refuse`, whose `_surface` is ignored"
  - "[code://packages/server/src/commands/plugin.ts#L86](../../../../packages/server/src/commands/plugin.ts#L86) - a caller passing `context.surface`"
  - "[code://packages/server/src/commands/user.ts#L57-L82](../../../../packages/server/src/commands/user.ts#L57-L82) - three more callers"
  - "[code://packages/server/src/commands/user.ts#L135](../../../../packages/server/src/commands/user.ts#L135) - the last caller"
  - "[code://packages/server/src/main.ts#L168-L178](../../../../packages/server/src/main.ts#L168-L178) - the group hint, written with no `ahpd: ` and as prose under `--json`"
---

## Objective

`refuse` takes the sentence and nothing else, and `ahpd plugin` and `ahpd user` fail the way every other failure does: one `ahpd: ` line on stderr and exit 2, whatever the output mode.

## Files

- `UPDATE: packages/server/src/commands/options.ts:87` - `refuse(message)`, or its callers call `stop` and `refuse` goes.
- `UPDATE: packages/server/src/commands/plugin.ts:86`, `packages/server/src/commands/user.ts:57,66,82,135` - the callers.
- `UPDATE: packages/server/src/main.ts:168-178` - the group hint.
- `UPDATE: packages/server/test/server-cli.test.ts` - the task 15 cases.

## Steps

1. Drop the surface parameter: keep `refuse` only if it says something `stop` does not; otherwise the callers call `stop` and `refuse` is removed.
2. Write the group hint through the same path a thrown `stop` takes, so its `ahpd: ` prefix and exit code 2 are the ones `runEntry` gives any usage failure. A JSON shape for failures is later work, kept in `.project/ideas/failures-have-a-json-shape.md`.

## Validation

- `grep -rn "refuse(context.surface" packages/server/src` finds nothing.
- `packages/server/test/server-cli.test.ts`, the task 15 cases: stderr is `ahpd: plugin takes list, install or remove.`, exit 2, nothing on stdout; the same with `--json`.
- `node_modules/.bin/vitest run packages/server/test` green, and `pnpm typecheck` green.

## Resume

Stopped at step 2, on a fork this task does not decide: the Validation wants the group hint, under `--json`, to carry "the JSON shape a usage error has (read `runEntry` for it)", and that shape does not exist. `runEntry` in `@cofold/terminal` 0.2.0 writes every failure as one prose line, `ahpd: <sentence>` on stderr, whatever the output mode; `--json` selects only how a success is rendered. `ahpd --json --nope` and `ahpd --json plugin` both answer `ahpd: ...` prose on stderr, exit 2, and nothing on stdout, so there is no JSON failure to copy.

Which way:

1. Give the hint the failure every other failure has: one `ahpd: plugin takes list, install or remove.` line on stderr and exit 2, with the `--json` clause dropped from this task.
2. Add a JSON failure shape to the program, which is a `@cofold/terminal` release and a change to every failure, not only the group hint.

The rest of the task is decided by its own step 1: `refuse` is `(_surface, message) => stop(message)`, so it says nothing `stop` does not, and its five callers will call `stop`; they still call `refuse` today.

Decided 2026-09-26: Softov chose option 1 now and option 2 later ("one... and another latter"); option 2 is `.project/ideas/failures-have-a-json-shape.md`.
