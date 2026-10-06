---
title: A cofold session in a computer runs in an ahpd started inside it - implemented
date: 2026-10-06
refs:
  - "[code://packages/sdk/src/nested.ts](../../../../packages/sdk/src/nested.ts) - the proxy: the inner host's stdio, the inner session and root, the mirror and the URI rewrite"
  - "[code://packages/sdk/src/host/spawn.ts](../../../../packages/sdk/src/host/spawn.ts) - the host gives a `runsNested` backend the proxy, with the plugin that registered it"
  - "[code://packages/sdk/src/host/chatactions.ts](../../../../packages/sdk/src/host/chatactions.ts) - an ended session refuses later chat actions with its sentence"
  - "[code://packages/sdk/src/plugins.ts](../../../../packages/sdk/src/plugins.ts) - `agentPlugins`, folded from each contribution's spec"
  - "[code://packages/sdk/src/types/computers.ts](../../../../packages/sdk/src/types/computers.ts) - `NestedSpawn` and its `workingDirectory`"
  - "[code://packages/computer/src/plugin.ts](../../../../packages/computer/src/plugin.ts) - `nestedHost`, which starts the inner host through `reach`"
  - "[code://packages/sdk/test/nested-process.test.ts](../../../../packages/sdk/test/nested-process.test.ts) - the proxy against a real `ahpd --stdio`"
---

A session on `computer://<id>` whose backend declares `runsNested` runs in an `ahpd --stdio` started inside that machine, with the plugin that registered the agent loaded there, and looks to a client like a session on this host.
A dead or misbehaving inner host ends the session with a sentence, never an uncaught error or a hang, and every later chat action on it is refused with that sentence.
The inner session is named after the outer one, so a resume reaches the inner transcript, and it works at the path the session's folder has inside the machine.
The proxy reports only what the inner session holds: models from the inner root, config keys it declares, sign-ins it asks for, and no blind `true`.

## What was built

- Tasks 01 to 06 (2026-09-26): the computers port starts a nested host through `reach` with the profile's `host` command, `packages/sdk/src/nested.ts` opens an inner session over `AhpClient` and forwards turns, asks, config, cancel and the end, `Agent.runsNested` chooses the proxy, cofold declares it, a failed start says why, and `docs/COMPUTER.md` explains it.
- [`code://packages/sdk/src/nested.ts`](../../../../packages/sdk/src/nested.ts) - the end read from `close` with the signal in the sentence, a stdin `error` listener that waits 500 ms for the process's own end, and `stop` sending SIGTERM then SIGKILL after 3 s (task 07).
- The same file - `lineReader` with a `StringDecoder`, one scan per byte, stderr lines cut at 400 characters with an ellipsis, and a 12-line tail (task 08).
- [`code://packages/sdk/src/types/session.ts`](../../../../packages/sdk/src/types/session.ts) and [`code://packages/sdk/src/host/chatactions.ts`](../../../../packages/sdk/src/host/chatactions.ts) - `Session.ended?()`, and every chat action on an ended session refused with its sentence; the proxy's `sessionState` reports lifecycle `failed` with it (task 09).
- `nested.ts` - every inner chat URI rewritten by a deep walk over the inner-to-outer map, the default chat to `start.chatUri`; an inner subagent chat opened outside through the host's `subagent` seam with its title and prompt, its actions written to the outer chat on the turn the host opened and its end ending that turn, its row the host's own, and a link to it naming the outer chat; catalogue actions about any other inner chat are withheld and logged once (task 10).
- `nested.ts` - the inner session named `<inner provider>:/<outer id>`, `createSession` skipped on resume, and an unknown id ending with "computer://X holds no session <id> to resume" (task 11).
- [`code://packages/sdk/src/types/sessions.ts`](../../../../packages/sdk/src/types/sessions.ts), [`code://packages/sdk/src/sessions.ts`](../../../../packages/sdk/src/sessions.ts), [`code://packages/sdk/src/host/catalogue.ts`](../../../../packages/sdk/src/host/catalogue.ts) and [`code://packages/sdk/src/host/history.ts`](../../../../packages/sdk/src/host/history.ts) - `NestedRecord` and `SessionStore.nested`, `setNested` and `nestedSessions`, optional on the port; `spawn` writes the record when a nested session opens and moves its title and time; the file store keeps it as `nested` in the session's own version 1 file, a file without it reads as before, and one whose record lacks a field is ignored; the catalogue lists recorded sessions no backend lists and never prunes them, and `past` opens one with no turns of its own, so the first turn resumes it inside (task 11).
- `nested.ts` - `steer`, `resume` and `setAnswer` gated on the mirrored state, `setConfig` refusing an undeclared or `sessionMutable: false` key with a sentence, and customization and MCP members present only where the inner session holds them (task 12).
- `nested.ts` - the inner root `ahp-root://` subscribed and reduced for `models` and the choice of provider, `awaiting` from the inner `authRequired` resources, `authenticated` forwarding `authenticate`, and every inner server request refused with a sentence (task 13).
- [`code://packages/sdk/src/types/computers.ts`](../../../../packages/sdk/src/types/computers.ts) and [`code://packages/computer/src/plugin.ts`](../../../../packages/computer/src/plugin.ts) - `NestedSpawn.workingDirectory` from `within(held, cwd)`, used for the inner session and mapped back in `sessionState()` (task 14).
- `nested.ts` - `close` resolving at once and, behind it, `disposeSession` bounded by 3 s, then `shutdown`, then `stop()` (task 15).
- [`code://packages/sdk/src/plugins.ts`](../../../../packages/sdk/src/plugins.ts), [`code://packages/sdk/src/types/plugin.ts`](../../../../packages/sdk/src/types/plugin.ts), [`code://packages/sdk/src/types/host.ts`](../../../../packages/sdk/src/types/host.ts), [`code://packages/server/src/plugins.ts`](../../../../packages/server/src/plugins.ts) and [`code://packages/sdk/src/host/spawn.ts`](../../../../packages/sdk/src/host/spawn.ts) - `Contribution.spec`, `HostOptions.agentPlugins`, and `nestedAgent` taking required `plugins` instead of deriving `@ahpd/agent-<name>` (task 17).
- [`code://packages/sdk/src/types/agent.ts`](../../../../packages/sdk/src/types/agent.ts) and [`code://packages/sdk/src/validate.ts`](../../../../packages/sdk/src/validate.ts) - `Agent.variant`, checked as a boolean; Claude sets it on every preset but the built-in and ACP on every preset, through `variant` on their options, while cofold and pi register one agent, renamed or not, without it; the proxy lets the inner host's single agent stand in only for an agent without it (task 17).
- [`code://packages/sdk/src/host/actions.ts`](../../../../packages/sdk/src/host/actions.ts) - `session/activeClientSet` on an ended session refused with its sentence (task 09).
- `docs/COMPUTER.md` - "A backend that runs nested" rewritten: the plugin that registered the agent, profile-only configuration, an image installing with `ahpd plugin install --no-enable` as `node`, the writable HOME and XDG rule and its `EACCES` end, an ended session, resume, and the mounted working directory (task 16).
- `packages/sdk/test/fixtures/plugin-nested-echo` - an echo agent under `cofold` with a file store under `$XDG_STATE_HOME`, `PACE` for slow turns and `IGNORE_SIGTERM`.

## Verified

- `packages/sdk/test/nested-process.test.ts` (10, new file), `packages/sdk/test/nested-proxy.test.ts` (25 new, one replaced), `packages/sdk/test/nested-start.test.ts` (1 new), `packages/sdk/test/plugin-host.test.ts` (2 new), `packages/sdk/test/sessions.test.ts` (1 new), `packages/sdk/test/plugin-validate.test.ts` (1 new), `packages/agent-claude/test/agent-claude-presets.test.ts` (1 new) and `packages/agent-acp/test/agent-acp-presets.test.ts` (1 new).
- Each failed before its change, except four that passed already: the inner host that ignores SIGTERM (task 07's `stop` escalates), the read-only `XDG_CONFIG_HOME` giving `EACCES`, the plugin not installed, task 09's "emits nothing" part, and the host-level renamed default, which the count it replaced already let through.
- `pnpm exec tsc --noEmit`, `pnpm boundary`, `pnpm test` (216 files, 3058 tests, no flake seen) and `pnpm build` green.
- Docker 29.6.2 on 2026-10-06: the image from `docs/COMPUTER.md`'s example, with `@ahpd/server` and `@ahpd/agent-cofold` 0.9.0 from npm, ran as uid 1000 with a writable config directory, and `ahpd --stdio --plugin @ahpd/agent-cofold` loaded the plugin and answered `initialize` with protocol 1.0.0; the image was removed after.

## Departures from the plan

- The inner session is named `<inner provider>:/<outer id>` rather than the bare id, because the inner host broadcasts a resumed session on that name and the proxy otherwise watched the wrong channel.
- Task 13 refuses inner requests with `setServerRequestHandler`, which covers every method, rather than per-resource handlers.
- The fold records `contribution.spec ?? by`, so a plugin loaded without a spec is recorded by its name.
- Inner subagent chats are served through the host's `subagent` seam rather than a wider `Emit`: the seam already names the chat, announces and updates its row, opens its turn and links the call, so the proxy only feeds it, and the outer row is the host's own rather than the inner one forwarded.
- An inner worker chat is read when the inner host announces it, so its prompt and anything it said first come from the inner chat's snapshot; the outer turn is opened with that prompt.
- A nested session opened after a restart has no turns of its own outside until its first turn runs, since its transcript is the machine's and the record is read without asking it.
- Read, archived and terminal actions on an ended session stay allowed, as Softov chose on 2026-10-06.
- `stop` escalates to SIGKILL on a failure as well as on close.
- A stdin `error` waits 500 ms for the process's own end, so the sentence carries the exit code and stderr rather than `EPIPE`.
- `plans/index.md` is not updated, as this build was told not to edit it.

## Open questions

- None. Resolved on 2026-10-06 by Softov: whether read, archived and terminal actions stay allowed after the end (they do), how a variant is told from a plugin's default (`Agent.variant`), how a nested session is listed after a restart (the outer host's record), and inner subagent chats (served now).

## Left for later

- The checklist's by-hand lines against `computer://lulu` and VS Code are not run; only the image line is checked.
- The tasks stay `implemented` until Softov reviews them.
