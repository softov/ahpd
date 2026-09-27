---
title: A cofold session has files, shell, web and memory, run by cofold itself - implemented
date: 2026-09-26
refs:
  - "[code://packages/agent-cofold/src/session.ts](../../../../packages/agent-cofold/src/session.ts) - `agentOf`, the per-turn capabilities, and `insideDirectory`"
  - "[code://packages/agent-cofold/src/capabilities.ts](../../../../packages/agent-cofold/src/capabilities.ts) - the four capabilities, and the search providers in configured order"
  - "[code://packages/agent-cofold/src/tools.ts](../../../../packages/agent-cofold/src/tools.ts) - the tool calls drawn, and `toolInputOf`"
  - "[code://packages/agent-cofold/src/mapping.ts](../../../../packages/agent-cofold/src/mapping.ts) - the approval request and the approved call"
  - "[code://packages/agent-cofold/src/agent.ts](../../../../packages/agent-cofold/src/agent.ts) - the sentence a turn with no model fails with"
  - "[code://docs/PLUGINS.md](../../../../docs/PLUGINS.md) and [code://packages/agent-cofold/README.md](../../../../packages/agent-cofold/README.md) - what the tools are and what confines them"
---

A cofold session reads, searches, edits and writes files, runs a command, fetches and searches the web, and keeps memory, with cofold running each tool in its own process.
ahpd draws each call, asks for what the permission mode says to ask, reports the edits a tool made, and judges a path with cofold's own resolver, so a write through a symlink out of the workspace, including one whose target does not exist yet, asks first.

## What was built

- [`code://packages/agent-cofold/src/session.ts`](../../../../packages/agent-cofold/src/session.ts) - `agentOf` builds the four `@cofold/tools` capabilities per turn from the plugin's `tools` option; `insideDirectory` is `resolveWithin(workspace, path).inside`, so a relative link and a link whose target is missing are judged where they lead; a declined approval is settled in `confirm`, where the call id is still known, and the unreachable `approval.resolved` branch it left is gone.
- [`code://packages/agent-cofold/src/capabilities.ts`](../../../../packages/agent-cofold/src/capabilities.ts) - files, shell, web and memory as one value; `searchOf` keeps the configured key order and `searchProviders` builds the array in it; `web_search` exists only when a provider is named.
- [`code://packages/agent-cofold/src/tools.ts`](../../../../packages/agent-cofold/src/tools.ts) - `toolInputOf`, so a `shell_exec` ready action carries the bare command rather than its JSON, and the denial and end-of-run sweep paths are settled for a call in flight.
- [`code://packages/agent-cofold/src/mapping.ts`](../../../../packages/agent-cofold/src/mapping.ts) - the approval request and the approved call carry the same tool input on the part and the action.
- [`code://packages/agent-cofold/src/agent.ts`](../../../../packages/agent-cofold/src/agent.ts) - a turn with no model says the backend has no default and to add `"model"` as `"<provider>/<model>"` to the cofold configuration file, naming its path.
- [`code://packages/agent-cofold/package.json`](../../../../packages/agent-cofold/package.json) - `@cofold/agents`, `@cofold/model-openai-compat` and `@cofold/store-file` at `^0.1.1`, `@cofold/tools` at `^0.1`, and `README.md` in `files`.
- [`code://docs/PLUGINS.md`](../../../../docs/PLUGINS.md) and [`code://packages/agent-cofold/README.md`](../../../../packages/agent-cofold/README.md) - what confines the tools, that a read outside the workspace asks in `default` and runs in `auto`, that search follows the configured order, and that a session with no working directory uses the daemon's own.

## Verified

- [`code://packages/agent-cofold/test/agent-cofold-tools.test.ts`](../../../../packages/agent-cofold/test/agent-cofold-tools.test.ts) - the mode table, including an edit through a symlink out of the workspace, an edit through a dangling symlink whose target is outside, and a read outside it; a declined edit whose `after` is sent before the next question, with the run still paused; a scripted `web_search` with `duckduckgo` before `brave`; an internal `http://127.0.0.1:1/` fetch refused under `bypassPermissions` with the stub `fetch` never called; the denial order, the end-of-run sweep, cancel killing the process group, and a session with no working directory keeping its tools.
- [`code://packages/agent-cofold/test/agent-cofold-turn.test.ts`](../../../../packages/agent-cofold/test/agent-cofold-turn.test.ts) - the `!` command sends its bare string as the tool input, and a turn with no model fails with the sentence and the path.
- `pnpm typecheck` green; `pnpm test` green at 101 files and 1326 tests, which includes all of the daemon/04 and daemon/05 review fixes except the ones waiting on a release; `pnpm boundary` green; `pnpm install --frozen-lockfile` clean.

## Departures from the plan

- Task 08 moved `@cofold/agents`, `@cofold/model-openai-compat` and `@cofold/store-file` to 0.1.1 as well as taking `@cofold/tools` `^0.1`, because the 0.1.0 releases declared exact `0.1.0` peers and leaving them would have warned about unmet peers. The entries in `pnpm-workspace.yaml`'s `minimumReleaseAgeExclude` are the versions the lockfile holds, without which the release-age gate refused the install.
- Task 09 pins the cancel path through the `run.finished` sweep rather than a declined approval: `stopNow` clears `pending` before it rejoins and cancels, so `apply` finds no call to settle. Task 15 added the other half of that: a decline never reached the branch either, because `confirm` deletes the entry first, which is why the settle now lives there.
- Task 14's Files named `node_modules/@cofold/tools/dist/paths.js`, which resolves under `packages/agent-cofold/`, and task 15's case lives in `agent-cofold-tools.test.ts` rather than the `agent-cofold-turn.test.ts` it named, because `open` in the tools file is the helper that records `onFileEdit`.
- A declined approval still leaves cofold's own tool-call row `pending-confirmation` in `mapping.ts`; that row is the client's to move and not this plan's.

## Left for later

- The three VS Code checks and cofold's own `pnpm test` are in [deferred.md](deferred.md).
