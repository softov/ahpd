---
title: A commit and a pull request get their words as configured - implemented
date: 2026-10-09
refs:
  - "[code://packages/sdk/src/changewords.ts](../../../../packages/sdk/src/changewords.ts)"
  - "[code://packages/sdk/src/changes.ts](../../../../packages/sdk/src/changes.ts)"
  - "[code://packages/sdk/src/host/changesets.ts](../../../../packages/sdk/src/host/changesets.ts)"
  - "[code://packages/sdk/src/host/root.ts](../../../../packages/sdk/src/host/root.ts)"
---

The root config has a `changeWords` setting that says where a commit message and a pull request's words come from when the person gives none.
The four modes are the session title, which is the default, forced, a named model and the session's own agent.

## What was built

- [`code://packages/sdk/src/host/root.ts`](../../../../packages/sdk/src/host/root.ts) - `changeWords` in the root config schema, with `mode`, `provider` and `model`.
- [`code://packages/sdk/src/host/actions.ts`](../../../../packages/sdk/src/host/actions.ts) - a push that names a provider the host does not serve, or a model the provider does not list, is refused.
- [`code://packages/sdk/src/changewords.ts`](../../../../packages/sdk/src/changewords.ts) - the commit and pull request prompts, the split of an answer into a title and a body, and the cut of a long diff.
- [`code://packages/sdk/src/changes.ts`](../../../../packages/sdk/src/changes.ts) - `wordsFor` writes the words for the commit, the commit `create-pr` makes of a dirty tree, and the pull request. The person's own text wins in every mode, and a fallback is said in the operation's message.
- [`code://packages/sdk/src/host/changesets.ts`](../../../../packages/sdk/src/host/changesets.ts) - `askModel` runs one turn on a throwaway session and removes it. `askAgent` asks a side chat made from the newest turn, and the chat stays. `watchTurn` waits for the turn, and cancels it after `changeWordsTimeoutMs`, which is two minutes when unset.
- [`code://packages/sdk/src/host/spawn.ts`](../../../../packages/sdk/src/host/spawn.ts), [`code://packages/sdk/src/host/tooling.ts`](../../../../packages/sdk/src/host/tooling.ts) - a throwaway session gets no host tools, MCP servers or client plugins.
- [`code://packages/sdk/test/changewords.test.ts`](../../../../packages/sdk/test/changewords.test.ts), [`code://packages/sdk/test/commit.test.ts`](../../../../packages/sdk/test/commit.test.ts), [`code://packages/sdk/test/root-config.test.ts`](../../../../packages/sdk/test/root-config.test.ts) - every mode for the commit, the `create-pr` commit and the pull request, the time limit, and the setting.

## Verified

- The builder's run passed 4716 tests in 266 files.
- The full gates ran on the review tree after the review fix below. Schema, build, typecheck and boundary are clean, and the suite passed 4760 tests in 267 files.

## Departures from the plan

- In review, `watchTurn` waited on any turn end in the session, because a session event does not name its chat. In agent mode, a turn that ended in the main chat also ended the wait for the side chat. The words fell back, and the side chat's turn was not cancelled. `watchTurn` now waits until the watched chat has a turn more than it had, and a test in `changewords.test.ts` covers it.

## Left for later

- A throwaway session has no host tools, but a backend's own built-in tools are still there. A Claude backend asks before it runs one, and no client watches the throwaway session, so the turn waits until the time limit.
