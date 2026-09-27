---
title: cofold follows a link's target one name at a time, released by Softov
status: todo
depends: [task-14-inside-follows-a-dangling-link.md]
layer: "cofold tools"
refs:
  - file:///github/cofold/packages/tools/src/paths.ts - `realPath`, which follows a link with `resolve(dirname(path), target)` and so collapses `..` before the kernel would
  - "[code://packages/agent-cofold/test/agent-cofold-tools.test.ts#L517-L570](../../../../packages/agent-cofold/test/agent-cofold-tools.test.ts#L517-L570) - `ROWS`, the mode table"
  - "[code://docs/PLUGINS.md#L409-L417](../../../../docs/PLUGINS.md#L409-L417) - the symlink sentence"
---

## Objective

In `@cofold/tools`, `resolveWithin` judges a link whose relative target has `..` after a symlinked directory where the kernel would put it, so `sublink -> /away/sub` with `trick -> sublink/../esc2.txt` is outside the workspace; ahpd takes the release, and its mode table asks for a write to `trick` under `acceptEdits`.

## Files

- `UPDATE: /github/cofold/packages/tools/src/paths.ts` - a link's target is walked one name at a time: `..` takes the real parent of what is resolved so far, and each other name is realpath'd or, when missing, read with `readlinkSync` and walked in turn.
- `UPDATE: /github/cofold/packages/tools/src/paths.test.ts` - the case below.
- `UPDATE: packages/agent-cofold/package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml` - the release.
- `UPDATE: packages/agent-cofold/test/agent-cofold-tools.test.ts` - the row.

## Steps

1. In `/github/cofold/packages/tools`, walk each link target by components as above, keeping the hop limit.
2. The cofold tree holds other uncommitted work (daemon/04 task 17 in `packages/commands`); change only `packages/tools`, and commit nothing there without Softov's approval.
3. Stop when cofold's tests are green and ask Softov to publish through `release.yml`; do not tag or publish.
4. After the release: move `@cofold/tools` to it, `pnpm install --no-frozen-lockfile --store-dir /tmp/pnpm-store` once, the version in `minimumReleaseAgeExclude` if young, and add the `trick` row to `ROWS` expecting `ask`.

## Validation

- cofold `paths.test.ts`: with `ws/sublink -> <away>/sub` and `ws/trick -> sublink/../esc2.txt`, `resolveWithin(ws, 'trick').inside` is `false`. Today it is `true`.
- cofold's own run for `packages/tools` green.
- In ahpd after the release: the `trick` row answers `ask`; `node_modules/.bin/vitest run packages/agent-cofold` green.

## Resume
