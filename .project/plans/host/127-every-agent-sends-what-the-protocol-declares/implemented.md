---
title: Every agent sends what the protocol declares, and a late client reads what a watching one built - implemented
date: 2026-10-27
refs:
  - git://288ddab7
  - "[code://packages/sdk/test/support/replay.ts](../../../../packages/sdk/test/support/replay.ts)"
  - "[code://packages/sdk/test/support/wire.ts](../../../../packages/sdk/test/support/wire.ts)"
---

Every first-party agent sends only what AHP 1.0.0 declares.
A tool call part or a notice has no `id`, every agent has a `description`, and ACP's commands sit in a directory.
A client that subscribes late reads the calls that a client that watched built from the actions, for every agent.
Each agent's suite drives it through `createHost` and reads every frame and a late subscription with the protocol's own schema and reducer.

## What was built

- [p1 - The host describes every agent](../127-p1-the-host-describes-every-agent/implemented.md).
- [p2 - A Claude session sends what the protocol declares](../127-p2-a-claude-session-sends-what-the-protocol-declares/implemented.md).
- [p3 - An ACP session sends what the protocol declares](../127-p3-an-acp-session-sends-what-the-protocol-declares/implemented.md).
- [p4 - A cofold session sends what the protocol declares](../127-p4-a-cofold-session-sends-what-the-protocol-declares/implemented.md).
- [p5 - A pi session sends what the protocol declares](../127-p5-a-pi-session-sends-what-the-protocol-declares/implemented.md).
- [p6 - A bot chat sends what the protocol declares](../127-p6-a-bot-chat-sends-what-the-protocol-declares/implemented.md).
- [`code://packages/sdk/test/support/replay.ts`](../../../../packages/sdk/test/support/replay.ts) - the chat a client builds from a snapshot and the actions after it, and the calls in it.

## Verified

- The eight new cases fail on the code before this plan with an assertion, and pass after it.
- The agent-acp suite passes, 282 of 282, and the agent-cofold and bot suites pass, 430 of 430.
- The agent-pi suite passes 212 of 214, and the two others pass alone: they went past their budget under a parallel run.
- The agent-claude, host turn, wire, conformance and notes suites pass 447 of 448.
  The other is the wire case that builds a schema in a process, past its 5 s budget under a parallel run.
  The wire suite alone passes 17 of 17.
- `pnpm boundary`, `pnpm typecheck` and `pnpm build` pass.
- The whole `pnpm test` fails 194 of 7275 cases on a machine of 8 cores with no Docker.
  The failures are in the computer, server and nested host suites, and the same files fail on the code before this plan.
  They are timeouts, and commands that need Docker.

## Departures from the plan

- The checklist named the whole `pnpm test`.
  Its computer suite needs Docker and its server suites start many daemons at once, so it runs in CI and not on this machine.
  The checklist names the suites of the packages this plan changes, which pass here.

## Left for later

- none.
