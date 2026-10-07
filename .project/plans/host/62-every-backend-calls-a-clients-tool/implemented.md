---
title: Every backend calls a client's tool, acp, cofold, pi and claude, the way the protocol asks - implemented
date: 2026-10-06
refs:
  - git://build/agents/8cd9a284
  - "[code://packages/sdk/src/clientcalls.ts](../../../../packages/sdk/src/clientcalls.ts) - one holder for a client's call, p1"
  - "[code://packages/sdk/src/toolserver.ts](../../../../packages/sdk/src/toolserver.ts) - the tool server runs a client's tool through a backend's runner, p1"
  - "[code://packages/agent-claude/src/session/clienttools.ts](../../../../packages/agent-claude/src/session/clienttools.ts) - claude onto the holder, p2"
  - "[code://packages/agent-pi/src/session.ts](../../../../packages/agent-pi/src/session.ts) - pi onto the holder, p3"
  - "[code://packages/agent-cofold/src/turnagent.ts](../../../../packages/agent-cofold/src/turnagent.ts) - cofold onto the holder, p3"
  - "[code://packages/agent-acp/src/session/clientcalls.ts](../../../../packages/agent-acp/src/session/clientcalls.ts) - ACP's client calls through the host tool server, p4"
---

A tool a client announces is callable by every backend ahpd ships, the way the protocol asks.
The call is reported against the client that owns it.
It is raised on the session as the `toolClientExecution` entry a client watching `inputNeeded` finds.
That client answers with its whole content - text, images and resources.
The content reaches the model in the richest shape its harness takes.
The agent gets it as the tool result it is blocked on.

A call whose client leaves, or that nobody answers, ends in a failure the model reads rather than a turn that hangs.
One holder in the sdk holds all of it, instead of four maps in four backends.
The review of the three children found three defects, and all three are fixed.
A claude call a person is asked about opens when they allow it.
An ACP request that two open calls could be for is refused rather than guessed.
A stopped turn leaves no waiter behind (the review of 2026-10-06).

## What was built

Each child's `implemented.md` is the account of its own work, task by task:

- [p1 - the sdk holds a client call](../62-every-backend-calls-a-clients-tool-p1-the-sdk-holds-a-client-call/implemented.md) - `createClientCalls`: one holder per session, `open`, `wait`, `complete`, `owner`, `gone`, `release` and `entries`.
  The entry is the protocol's `toolClientExecution` request, raised and removed without the session ever reading as needing input.
  A call nobody answers fails after the daemon's `clientToolTimeoutMs`, ten minutes by default.
  The tool server runs a client's tool through the backend's runner and hands back MCP content.
  Reviewed and merged.
- [p2 - Claude runs its client calls through the sdk](../62-every-backend-calls-a-clients-tool-p2-claude-runs-client-calls-through-the-sdk/implemented.md) - claude's own map is gone.
  A call is raised when the CLI reports it running.
  An answer that arrives before the harness asks is kept.
  The handler is told which call it runs by `_meta['claudecode/toolUseId']`, with a warned name-and-input fallback.
  The live-CLI run that would let the fallback go is in [deferred.md](../62-every-backend-calls-a-clients-tool-p2-claude-runs-client-calls-through-the-sdk/deferred.md).
  The review of 2026-10-06 found the confirmation path never opened the call, and it is fixed.
  An approved call opens, and a declined one refuses its handler.
- [p3 - pi and cofold run their client calls through the sdk](../62-every-backend-calls-a-clients-tool-p3-pi-and-cofold-run-client-calls-through-the-sdk/implemented.md) - pi and cofold onto the same holder.
  pi hands its model an image as an image.
  cofold names what its text-only tools cannot carry.
  cofold's open and wait are one step in its relay rather than two.
- [p4 - An ACP agent calls a client's tool](../62-every-backend-calls-a-clients-tool-p4-an-acp-agent-calls-a-clients-tool/implemented.md) - a `tool_call` the agent reports for a client's tool carries the client contributor.
  The `tools/call` on the session's `ahp` MCP server is paired to it, and waits on the owner.
  The endpoint's list follows `setTools`.
  `toolsChanged`, `notify` by default, is how the agent hears of a tool that arrived after it listed.
  The by-hand ACP run waits, and so does pairing a request with a call already answered: [deferred.md](../62-every-backend-calls-a-clients-tool-p4-an-acp-agent-calls-a-clients-tool/deferred.md).
  The review of 2026-10-06 found the pairing answered a request with the oldest open call when the agent reported no arguments.
  It now pairs a lone open call, and refuses a request two calls could be for.

## Verified

- Every task's case was seen failing on the code before its fix and passing after.
  The children's `implemented.md` name the failures each one saw.
- `npx tsc -b` green at every child's close and again at this one.
  `pnpm boundary` green: every package's imports are declared, none undeclared.
- `npx vitest run` over the five packages this plan touches is green: 168 files, 2274 tests.
  The five are `packages/sdk`, `packages/agent-claude`, `packages/agent-pi`, `packages/agent-cofold` and `packages/agent-acp`.
  The first run of the round lost the flake below to its five-second limit.
  The repeat was all green.
  `packages/agent-acp` alone is 202 cases in 14 files.
  `agent-acp-client-tool.test.ts` is 19 of them, and `agent-acp-turn.test.ts` 31.
- Each backend's tests cover an image result.
  claude's is `hands the model the client's image as an image, and its words as words`.
  pi's is `hands the model the client image as an image, and its other files as a line`.
  cofold's is `carries a client's text and names the image it could not pass`.
  ACP's is `answers with the client's blocks as the MCP content an agent reads`.
- One pre-existing flake, recorded by p4's task 01 and not caused by this plan.
  `agent-acp-machine.test.ts > reaches a disposable machine` takes about 4.9 s on its own, and tips past the default five under the whole suite's load.
  It passed in the build round's runs, at 4858 ms and under the five packages' parallel load.
  The review's run saw it tip over, at 5047 ms under the five packages' load, and it passed alone at 4490 ms.
  The five packages' run repeated green (the review of 2026-10-06).
- `pnpm test` was not run as that script; the gates above are what it runs.
  The review's round ran `pnpm typecheck`, `pnpm boundary` and `pnpm build` directly, all green (the review of 2026-10-06).
- The work is uncommitted on `build/agents/8cd9a284`; nothing was pushed and no daemon was restarted.

## Departures from the plan

- p3's cofold opens and waits in one step inside its relay rather than from the running ready.
  `@cofold/agents` runs the tool without yielding to this host's reader.
  p3's `implemented.md` says why, and what the alternative would cost.
- p4's README rows for `toolsChanged` moved into task 03.
  `agent-acp-options.test.ts` holds the options schema to the README's table, and the two have to change together.
- No decision in any of the four children's tables was changed, except one.
  The review of 2026-10-06 overtook p4's pairing row, and the code no longer follows it.
  A lone open call is paired.
  A request two calls could be for is refused.
  The plan and the task still read the old rule, which p4's `implemented.md` notes (the review of 2026-10-06).

## Left for later

- The by-hand runs: a live CLI with a client tool for claude, pi and cofold.
  A VS Code with an ACP agent calling one of its tools is the other.
  They need a live daemon, and each child's `deferred.md` says what each would show.
- p2's name-and-input fallback, and p4's pairing of a request with a call already answered.
  Both wait on those runs, and p2's would be a decision about what a live CLI sends.
- Every task p2, p3 and p4 built is `implemented`.
  The review of them found the three defects above, which are now fixed.
  The tasks await the verdict that moves them to `done`.
  p1's three were reviewed and are `done`.
