---
title: A command sent as a turn while another runs is answered by the queued message it waits as - implemented
date: 2026-10-31
refs:
  - "[code://packages/sdk/src/host.ts#L763-L812](../../../../packages/sdk/src/host.ts#L763-L812) - where an action finds the client's dispatch it answers"
---

A `!command` a client sends as a turn while another turn runs waits behind it as a queued message under the turn's id, and the `chat/pendingMessageSet` that holds it carries the client's origin.
The client is answered once, as it sends the turn, and the command runs as a queued message runs once the turn in front of it ends.

## What was built

- [`code://packages/sdk/src/host.ts#L763-L812`](../../../../packages/sdk/src/host.ts#L763-L812) - `owedUnder` names the key an action finds the client's dispatch under: its own kind and what it names, or, for a queued message with nothing owed under its own kind, the turn start of the same id. `answering`, `originOf` and `answeredBy` read and let go of that key.
- [`code://docs/sdk/TERMINALS.md#L48`](../../../../docs/sdk/TERMINALS.md#L48), the `!` command, and [`code://docs/sdk/AHP.md#L263`](../../../../docs/sdk/AHP.md#L263), the `chat/turnStarted` row.
- One case in `host-terminals.test.ts` (Claude) and one in `agent-acp-turn.test.ts` (ACP): the command's queued message is the one envelope with the client's origin, before and after the command runs as the turn that takes it.
- `host-terminals.test.ts`'s `ended` finds the turn that took a queued message as well as a turn by its id, so the case 'runs a command typed during a turn instead of handing it to the agent' waits for the command's own turn.

## Verified

- On `90e5eb5f` both cases fail for the reason they name: no envelope carries the client's origin.
- After the change both pass, with `host-terminals` (33) and `agent-acp-turn` (36) whole.
- `echo-origin`, `host-senders`, `host-local-turns`, `nested-proxy`, `policy-checks`, `host-terminals`, the agent-claude and the agent-acp suites, with a 60 s timeout for the machine's load: 82 files, 959 of 960 pass. The one is an agent-acp-machine case with its own 20 s timeout, which times out the same way on a union without this change.
- The round's full run, with the machine waiting on I/O: `test:unit` failed 201 cases in 65 files, every one a timeout or a wait run out. One file at a time, those files pass 1475 cases with 18 timeouts; a recheck of the seven files those fell in passes 299 with six timeouts in other cases, and the two `agent-acp` files among them then pass whole (115). `test:processes` at two workers passes 682 cases, with 13 timeouts in eight `computer-*` files and `server-cli-start`. One file at a time, those nine pass 254 with nine timeouts in six `computer-*` files, and the same six files on a union without this change pass 169 with four timeouts in other cases.
- `pnpm run typecheck` and `pnpm run boundary` pass.

## Departures from the plan

- none.

## Left for later

- none.
