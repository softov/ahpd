---
title: ahpd's workspace check follows a dangling symlink, through cofold's own resolver
status: done
depends: [task-07-ahpd-inside-follows-symlinks.md, task-08-ahpd-takes-the-cofold-releases.md]
layer: "agent-cofold"
refs:
  - "[code://packages/agent-cofold/src/session.ts#L50-L51](../../../../packages/agent-cofold/src/session.ts#L50-L51) - `insideDirectory`, which is cofold's own `resolveWithin`"
  - "[code://packages/agent-cofold/src/session.ts#L446](../../../../packages/agent-cofold/src/session.ts#L446) - `inside`, the predicate the harness is given"
  - npm://@cofold/tools@^0.1 - `resolveWithin(workspace, path)`, which follows a dangling link with `readlinkSync`
  - "[code://packages/agent-cofold/test/agent-cofold-tools.test.ts#L547-L597](../../../../packages/agent-cofold/test/agent-cofold-tools.test.ts#L547-L597) - the mode table, `ROWS`"
---

## Objective

Under `acceptEdits`, a `write_file` through a symlink in the workspace whose target is outside it and does not exist yet asks first, and ahpd's workspace check is `@cofold/tools`' `resolveWithin`, the one cofold's own tools use.

## Files

- `UPDATE: packages/agent-cofold/src/session.ts:50-51` - `insideDirectory` calls `resolveWithin`.
- `UPDATE: packages/agent-cofold/src/session.ts:446` - `inside`.
- `UPDATE: packages/agent-cofold/test/agent-cofold-tools.test.ts:579-586` - a dangling-link row.

## Steps

1. Replace `realPathOf`, `existingRealPath` and the body of `insideDirectory` with `resolveWithin(where, path).inside`, keeping whatever fallback `resolveWithin` gives for a workspace that cannot be resolved; read its source in `node_modules/@cofold/tools/dist/paths.js` first and write in the Resume what it does for a missing workspace and a relative link.
2. Keep one comment on the predicate saying what it answers; drop the ones that describe the removed resolution.
3. Add a row to `ROWS`: `symlinkSync(join(away, 'new.txt'), join(ws, 'dl'))` with `away/new.txt` absent, `write_file { path: 'dl' }` under `acceptEdits`, expected `ask`.

## Validation

- The new row fails on today's `insideDirectory` (the reviewer saw `run`) and passes after.
- The task 07 symlink row still asks, and every other row keeps its answer.
- `node_modules/.bin/vitest run packages/agent-cofold` green.

## Resume

Seen to fail: the new `ROWS` row, "an edit through a dangling symlink whose target is outside", answered `run` under `acceptEdits` on the hand-written resolution, and `ask` after the change. The whole `packages/agent-cofold` suite is green, including the task 07 symlink row.

Done: `insideDirectory` is `resolveWithin(workspace, path).inside`; `namedInside`, `existingRealPath` and `realPathOf` are gone, along with the `realpathSync` import and the `node:path` names they used.

What `resolveWithin` does, read in `packages/agent-cofold/node_modules/@cofold/tools/dist/paths.js`: a relative link is resolved against its own directory (`resolve(dirname(path), target)`), a link whose target is missing is followed with `readlinkSync` up to 40 hops, and a path that does not exist is resolved by its nearest existing ancestor with the missing names appended. Its `realPath` never answers nothing, so there is no fallback to keep: a workspace that does not exist is judged by the part of it that does.

Files in this task named `node_modules/@cofold/tools/dist/paths.js`; the package is linked under `packages/agent-cofold/node_modules`.
