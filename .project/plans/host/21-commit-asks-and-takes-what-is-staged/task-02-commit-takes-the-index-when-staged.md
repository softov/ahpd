---
title: Commit takes the index when anything is staged
status: todo
depends: [task-01-a-row-says-what-is-staged.md]
layer: "sdk"
refs:
  - "[code://packages/sdk/src/changes.ts#L849-L904](../../../../packages/sdk/src/changes.ts#L849-L904) - the `commit` branch of `invoke`, in the draft's form"
  - "[code://packages/sdk/src/changes.ts#L121-L129](../../../../packages/sdk/src/changes.ts#L121-L129) - `COMMIT` and its description"
---

## Objective

`commit` on an `uncommitted` changeset commits the index as it is when the index holds any change, and stages everything with `add -A` and commits it all when it holds none, per decision [a-commit-takes-the-index-when-anything-is-staged](../../../decisions/a-commit-takes-the-index-when-anything-is-staged.md).

## Files

- `UPDATE: packages/sdk/src/changes.ts:849-904` - the two paths; the draft's `files` selection goes, its `message` stays.
- `UPDATE: packages/sdk/src/changes.ts:121-129` - `COMMIT.description` says it commits what is staged, or everything when nothing is.
- `UPDATE: packages/sdk/test/commit.test.ts` - the draft's selection cases go; the cases below replace them.

## Steps

1. At invoke, ask git whether the index differs from `HEAD` (`git diff --cached --quiet`, exit 1 when it does; in a repository with no commit yet, any staged entry counts).
2. If it does, run `git commit -m <message>` with no `add` and no paths.
3. If it does not, run `git add -A` and `git commit -m <message>`, as today.
4. `<message>` is `_meta['ahp.commit'].message` when a client sent one, else the session title's first line, else "Changes from an agent session", as the draft has it.
5. Remove `_meta['ahp.commit'].files` and everything that reads it.

## Validation

- `commit.test.ts`, in a scratch repository with `a.txt` modified and staged, `b.txt` modified and not staged, and `c.txt` untracked: commit, and `HEAD` holds only `a.txt`'s change, while `b.txt` and `c.txt` are still uncommitted.
  Today all three are committed.
- An `MM` file commits its staged half, and its unstaged half stays in the working tree.
- With nothing staged, all three are committed, untracked included.
- The draft's cases for the message and the session-title fallback pass.
- `node_modules/.bin/vitest run packages/sdk/test/commit.test.ts` green.

## Resume
