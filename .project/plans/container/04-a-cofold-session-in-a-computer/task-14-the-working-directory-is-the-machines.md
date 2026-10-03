---
title: The inner session works in the machine's directory
status: todo
depends: [task-07-the-inner-hosts-pipes-cannot-crash-the-daemon.md]
layer: "computer | sdk"
refs:
  - "[code://packages/sdk/src/nested.ts#L376-L381](../../../../packages/sdk/src/nested.ts#L376-L381) - `createSession` sends this host's path as the inner working directory"
  - "[code://packages/computer/src/plugin.ts#L210-L224](../../../../packages/computer/src/plugin.ts#L210-L224) - `within`, which maps a host path through the machine's mounts"
  - "[code://packages/computer/src/plugin.ts#L634-L646](../../../../packages/computer/src/plugin.ts#L634-L646) - `nestedHost`, which goes through `reach` and maps only the process `-w`"
  - "[code://packages/sdk/src/types/computers.ts#L38](../../../../packages/sdk/src/types/computers.ts#L38) - `NestedStart`"
---

## Objective

The inner session's working directory is the path inside the machine the session's folder is mounted at, so a mount `/srv/app:/workspaces/app` gives a session in `/srv/app/x` the inner directory `/workspaces/app/x`.

## Files

- `UPDATE: packages/sdk/src/types/computers.ts:38-143` - what `nested` answers.
- `UPDATE: packages/computer/src/plugin.ts:634-646` - `nestedHost`.
- `UPDATE: packages/sdk/src/nested.ts:376-381` and `:419` - `createSession` and `workingDirectories`.

## Steps

1. `nested` answers, beside the spawn, the inside path of `asked.cwd` as `within` maps it, or the machine's own working directory when no mount covers it.
2. The proxy creates the inner session with that path, and `workingDirectories()` answers the outer one to clients until the inner state says otherwise.
3. A dev container takes the same road: `reach` answers `docker exec` for it once container/03 task 18 lands, so `within` maps its folder like any other machine and nothing here is specific to dev containers.

## Validation

- `packages/sdk/test/nested-start.test.ts`: with the mount `/srv/app:/workspaces/app`, `nested('plain', { cwd: '/srv/app/x' })` answers `/workspaces/app/x` as the inside path.
- `packages/sdk/test/nested-proxy.test.ts`: the inner `createSession` a scripted host receives carries `file:///workspaces/app/x`; today it carries `file:///srv/app/x`.
- `node_modules/.bin/vitest run packages/sdk/test/nested-start.test.ts packages/sdk/test/nested-proxy.test.ts` passes.

## Resume
