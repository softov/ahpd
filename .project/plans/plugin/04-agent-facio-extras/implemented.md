---
title: The facio extras - implemented
date: 2026-09-20
refs:
  - git://32ff260
  - code://packages/agent-facio/src/session.ts
  - code://packages/agent-facio/src/agent.ts
  - code://packages/agent-facio/src/tools.ts
  - code://packages/sdk/src/types/agent.ts
  - code://packages/sdk/src/types/host.ts
  - code://test/agent-facio-fork.test.ts
  - code://test/agent-facio-approval.test.ts
  - code://test/agent-facio-client-tool.test.ts
  - file:///github/facio/packages/agents/src/store/cut.ts
  - file:///github/facio/packages/store-file/src/store.ts
  - code://docs/PLUGINS.md
---

`@ahpd/agent-facio` now does the four things plan 03 left open: a host tool can say that running it writes or is destructive so facio's own default policy asks about it, a conversation can be forked at a turn and rewound to one, a tool a connected client runs is offered and waited for, and the backend reads the harness's own configuration so a provider already written for facio does not have to be repeated or lent.
Each is a capability another backend already had, so a facio session is no longer the one that cannot do what the window offers.

## What was built

- `code://packages/sdk/src/types/agent.ts` - `ToolEffects` (`reads`, `writes`, `network`, `destructive`), carried optionally by `BoundTool` and passed through `host.ts`'s `boundTools`.
- `code://packages/agent-facio/src/tools.ts` - `facioTool` hands a host tool's effects to `createTool`, so the default policy asks about a destructive one with no policy configured; `ClientToolCall` and `ClientToolRelay` carry a call an owner-bound tool hands to its client and awaits.
- `code://packages/agent-facio/src/session.ts` - `forkPoint` and `endPoint` answered from the run record as a turn ends; the cut `create` makes before the first turn (`Store.sessions.fork` for a fork, `Store.sessions.truncate` for a rewind) with a refusal that fails the turn rather than continuing; `toolCallOwner`, `completeToolCall` and `clientGone` over the held calls; the harness configuration's instructions fallback.
- `code://packages/agent-facio/src/agent.ts` - `chats: { fork: true }`, `modelOf` and `resourceOf` consulting the harness configuration, and the comment that said fork and rewind were unmapped replaced by what they are.
- `code://packages/agent-facio/src/config.ts` - `harnessConfig`, `harnessConfigPath` and `splitModel`.
- `file:///github/facio/packages/agents/src/store/cut.ts` - `selectCut`, the one rule both facio stores cut by: keep the messages through the given one, and a run only when it is terminal and both its `inputMessageId` and `lastMessageId` are among them.
- `file:///github/facio/packages/store-file/src/store.ts` - `truncate` and `fork`, and `appendMessages` advancing a run's `lastMessageId` with every message it writes.

## Verified

- `test/agent-facio-approval.test.ts` - a destructive host tool pauses with no `policy` configured and has not run, and a tool that says nothing runs.
- `test/agent-facio-client-tool.test.ts` - six cases: the call is offered with its owner and not run here, the owner may stream into it and another client may not, the owner's completion settles it and the model's next step carries the text, another client's completion is refused with the call still waiting, `clientGone` fails it, and a tool with no owner and no `run` is still not offered.
- `test/agent-facio-config.test.ts` - six cases over `harnessConfig`, `splitModel` and the precedence.
- `test/agent-facio-fork.test.ts` - nine cases: a fork through the session, a rewind under the same id, no point for a turn read back off the store, both cuts at once refused, a point the conversation does not hold failing the turn without appending anything, the store-level shape of a fork, a plain session, and the same fork and rewind driven through `createHost` by `createChat` with `source.kind: 'fork'` and by a `chat/truncated` dispatch.
- `npx vitest run` - 791 tests, 790 passed; the one failure is the pre-existing `test/host.test.ts` `create-pr` case that flakes under the full run and passes alone, untouched by this plan.
- `tsc -p tsconfig.json --noEmit` green; `node scripts/boundary.mjs` green; `node tools/schema.mjs` unchanged at 473 definitions.
- `pnpm` itself could not be used for the build and install in this environment, so the checker and the runner were invoked directly (`node node_modules/typescript/bin/tsc`, `npx vitest`), which is the same work `pnpm typecheck` and `pnpm test` do.
- By hand, earlier in the plan: a daemon on the harness configuration alone streamed `harness config works`, the endpoint saw `Bearer harness-key` for `test-model`, and a restart listed the session and read its transcript back.
- Not run: driving the actual window. The host handlers a window calls are exercised end to end by the fork test through `createHost`, so what is unverified is the client's drawing of the controls, not the backend.

## Departures from the plan

- `ToolEffects` lives in `types/agent.ts` rather than `types/host.ts`, because `BoundTool` is already there and the dependency already runs that way.
- The harness configuration is read directly rather than through `@facio/config`'s layered `resolveConfig`, so the project file, `$FACIO_CONFIG` and `--config` layers are not consulted; see [deferred.md](deferred.md).
- The fork cuts at the prompt of the turn rather than at its end, which is what `forkPoint` means and what lets the forked turn be asked again, so the forked conversation keeps that prompt and not its reply.
- `endPoint` is answered from the store's run record rather than tracked off the run's events, because the last message a run writes can be a tool result, a steer or a cancel marker that no event names.
- A fork that cannot be cut fails the turn with `chat/error` through a new `failTurn` instead of being refused at `create`, because a cut is a store call and the turn is where a client can be told.
- `setTools` was implemented with task 03 although the task named three members, because the host re-declares a running session's tools through it.

## Left for later

- The `@facio/*` packages are `link:` dependencies of a sibling checkout, so the two store primitives task 02 needs are an uncommitted change in `/github/facio`; publishing facio and moving the dependency to a range is the release step, and until then a fresh checkout of this repository cannot build the bridge without that sibling.
- `@ahpd/agent-acp` remains the next agent package, and `@deepseek-ai/dsh-acp` is one of the servers it will cover.
