---
title: The six files move into tools
status: todo
depends: []
layer: "sdk"
refs:
  - "[code://packages/sdk/src/index.ts#L41-L53](../../../../packages/sdk/src/index.ts#L41-L53) - the exports to repoint"
  - "[code://packages/agent-acp/test/agent-acp-usage.test.ts#L4](../../../../packages/agent-acp/test/agent-acp-usage.test.ts#L4) - the one import by path outside the sdk"
---

## Objective

The six files are in `packages/sdk/src/tools/`, and every import, comment and open `.project` ref names the new path.

## Files

- `MOVE: packages/sdk/src/tools.ts` to `packages/sdk/src/tools/index.ts`.
- `MOVE: packages/sdk/src/sessiontools.ts` to `packages/sdk/src/tools/session.ts`.
- `MOVE: packages/sdk/src/artifacttools.ts` to `packages/sdk/src/tools/artifacts.ts`.
- `MOVE: packages/sdk/src/toolserver.ts` to `packages/sdk/src/tools/server.ts`.
- `MOVE: packages/sdk/src/clientcalls.ts` to `packages/sdk/src/tools/clientcalls.ts`.
- `MOVE: packages/sdk/src/mcpcontent.ts` to `packages/sdk/src/tools/mcpcontent.ts`.
- `UPDATE:` every importer in `packages/sdk/src` and `packages/sdk/test`, and `packages/agent-acp/test/agent-acp-usage.test.ts`.
- `UPDATE: packages/agent-pi/src/session.ts` and `packages/agent-cofold/src/turnagent.ts` - the comment that names `clientcalls.ts`.
- `UPDATE: UPSTREAM.md` - the paths it names.
- `UPDATE: .project/plans/host/00-host.md`, the two accepted decisions, and the open plans and tasks that name an old path.

## Steps

1. Move each file with `git mv`.
2. Fix the relative imports inside the moved files.
3. Fix every importer. Find them with `rg "(artifacttools|sessiontools|toolserver|tools|clientcalls|mcpcontent)\.js'" packages`.
4. Fix the docs and the open `.project` refs. Find them with `rg "sdk/src/(artifacttools|sessiontools|toolserver|tools|clientcalls|mcpcontent)\.ts" .project UPSTREAM.md packages`. Leave a plan whose status is `built` or `dropped`, and every `implemented.md`, as it is.
5. Run `node tools/schema.mjs`.

## Validation

- `ls packages/sdk/src` shows none of the six old names.
- `git diff main --stat` shows the six files as renames.
- The exports of `packages/sdk/src/index.ts` keep the same names.
- `pnpm build`, `pnpm typecheck`, `pnpm boundary` and `npx vitest run` pass from the root.

## Resume
