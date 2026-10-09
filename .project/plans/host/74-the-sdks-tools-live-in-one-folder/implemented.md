---
title: The sdk's tools live in one folder - implemented
date: 2026-10-09
refs:
  - git://9f3798c
  - "[code://packages/sdk/src/tools](../../../../packages/sdk/src/tools) - the six files, under the folder's names"
  - "[code://packages/sdk/src/index.ts#L42-L54](../../../../packages/sdk/src/index.ts#L42-L54) - the same export names, read from the new paths"
---

The sdk's tool code is one folder, `packages/sdk/src/tools/`, where six files sat at the top of `src/` before. Nothing a package imports from `@ahpd/sdk` changed: every name is the same, and only its path moved.

## What was built

- [`code://packages/sdk/src/tools/index.ts`](../../../../packages/sdk/src/tools/index.ts) - `hostTools`, from `tools.ts`.
- [`code://packages/sdk/src/tools/session.ts`](../../../../packages/sdk/src/tools/session.ts) - the session tools, from `sessiontools.ts`.
- [`code://packages/sdk/src/tools/artifacts.ts`](../../../../packages/sdk/src/tools/artifacts.ts) - the artifact tools, from `artifacttools.ts`.
- [`code://packages/sdk/src/tools/server.ts`](../../../../packages/sdk/src/tools/server.ts) - the host's tools served as an MCP server, from `toolserver.ts`.
- [`code://packages/sdk/src/tools/clientcalls.ts`](../../../../packages/sdk/src/tools/clientcalls.ts) - a call a client's tool runs, from `clientcalls.ts`.
- [`code://packages/sdk/src/tools/mcpcontent.ts`](../../../../packages/sdk/src/tools/mcpcontent.ts) - a client's answer as MCP content, from `mcpcontent.ts`.

## Verified

- `pnpm install`, `node tools/schema.mjs`, `pnpm build`, `pnpm typecheck` and `pnpm boundary` pass, 2026-10-09.
- `npx vitest run --maxWorkers=2 --testTimeout=10000`: 255 files, 4462 tests, all passing.
- `ls packages/sdk/src` shows none of the six old names, and `git status` shows the six as renames.
- `packages/sdk/src/index.ts` exports the same names as before the move.

## Departures from the plan

- The reconnaissance named one importer by path outside the sdk. There are fifteen: seven agent-acp tests, three agent-pi tests and four agent-cofold tests, beside one agent-acp test with a second import. All fifteen now name `sdk/src/tools/`.
- The plan's Files list named `UPSTREAM.md` and the `.project` files. Three more docs named an old path and were repointed: `docs/AHP.md`, `packages/sdk/README.md` and a comment in `packages/sdk/test/host-tools.test.ts`.
- `.project/review/2026-09-19-upstream-pass-4.md` and the two superseded decisions keep the old paths. They are dated records, like a built plan.

## Left for later

- The task stays `implemented` until Softov reviews the diff.
