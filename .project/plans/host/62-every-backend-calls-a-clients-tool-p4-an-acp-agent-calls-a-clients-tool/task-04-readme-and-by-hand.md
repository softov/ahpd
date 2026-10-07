---
title: The README says it, and an ACP agent runs a VS Code tool by hand
status: done
depends: [task-03-the-acp-session-takes-the-clients-tools.md]
layer: "agent-acp docs"
refs:
  - "[code://packages/agent-acp/README.md](../../../../packages/agent-acp/README.md) - where the host tools are described"
  - "[code://packages/agent-acp/src/session/opening.ts#L127-L145](../../../../packages/agent-acp/src/session/opening.ts#L127-L145) - the `hostTools` option, which client tools ride on"
---

## Objective

The README says an ACP session is offered its clients' tools through the host tool server, under `hostTools`.
It says what `toolsChanged` does with each value and its `notify` default.
It says what an agent that ignores the notification and never lists again misses.
One real ACP agent has run one VS Code tool through ahpd.

## Files

- `UPDATE: packages/agent-acp/README.md` - the client tools paragraph and the `toolsChanged` option.

## Steps

1. Write the paragraph in the README's style.
2. Run ahpd with an ACP agent that takes HTTP MCP servers.
   Connect VS Code.
   Have the agent call one of VS Code's tools.
3. Note in Resume the agent, and the `name` and `title` it reported.
   Note whether `_meta['claudecode/toolUseId']` arrived.
   Note whether it listed again after `list_changed`.

## Validation

- By hand, check the call shows as VS Code's in VS Code, and VS Code runs it.
- Check the agent's next message uses the result.
- Validate the `toolClientExecution` entry with `pnpm wire` against the capture of that run.

## Resume

- **Done:** the paragraph is in `packages/agent-acp/README.md`'s *What it does*, after the handshake and turn mechanics it belongs beside.
  The host's own tools and a session's clients' tools are one HTTP MCP server named `ahp`, where `hostTools` is on.
  That is the default.
  A call to a client's tool is reported against that client, and waits for its answer.
  That answer reaches the agent with everything the client sent, images and resources included.
  The paragraph says how a client that arrives after the agent listed is heard of.
  `notify` is the default, and `list` is the alternative.
  It says what an agent that ignores the notification and never lists again misses.
- **The option's own rows were written in task 03, not here:** `agent-acp-options.test.ts` holds the options schema to the README's table.
  So the rows for `toolsChanged` had to land with the schema.
  The plugin-level row and the per-preset row are already there.
  This task's prose is the paragraph they are not.
- **Failed first, and could not be:** a README paragraph is the deliverable itself, rather than a test of one.
  The run below cannot be made here.
  What was checked instead is that the suite that reads the README still holds.
  `agent-acp-options.test.ts` compares the first options table's names with the schema's.
  It stays green.
- **The by-hand run did not happen.**
  It needs a live daemon, a real ACP agent that takes HTTP MCP servers, and a VS Code connected to that daemon.
  That daemon needs a tool of its own to call.
  This work may not start a daemon.
  Nothing was observed about an agent's `name` and `title` spellings, or `_meta['claudecode/toolUseId']`.
  Nothing was observed about whether any agent lists again after `list_changed`.
  The step 3 notes are therefore empty.
  It waits in `deferred.md` with what it would answer.
  That is the same shape p2's run took.
- **Verification:** `npx tsc -b` is green.
  `pnpm boundary` is green (`@ahpd/agent-acp: 2 declared, none undeclared`).
  `npx vitest run packages/agent-acp` is green, 201 cases in 14 files, the machine case at 4858 ms this run.
- **Next action:** none - this is the plan's last task.
  What is left is the plan's own close: `implemented.md`, `deferred.md`, the checklist, and the index row.
