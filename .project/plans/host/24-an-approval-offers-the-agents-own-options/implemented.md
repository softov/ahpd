---
title: "An approval offers the agent's own options, and the one picked reaches the agent - implemented"
date: 2026-09-28
refs:
  - git://373253e
  - "[code://packages/sdk/src/types/session.ts](../../../../packages/sdk/src/types/session.ts) - `Session.confirm(toolCallId, approved, optionId?)`"
  - "[code://packages/agent-acp/src/mapping.ts](../../../../packages/agent-acp/src/mapping.ts) - `confirmationOptions`"
  - "[code://packages/agent-claude/src/session.ts](../../../../packages/agent-claude/src/session.ts) - `canUseTool` offers `allow-always` from `suggestions`"
  - "[code://packages/agent-cofold/src/mapping.ts](../../../../packages/agent-cofold/src/mapping.ts) - `allow-session`"
---

An approval shows the agent's own choices, Claude's always allow, an ACP agent's `allow_always` and cofold's allow for this session, and the option the person picks reaches the agent.
A backend without such choices keeps plain approve and deny.

## What was built

- `Session.confirm` takes `optionId`; the host passes `selectedOptionId`, a worker chat's answer and the nested proxy included.
- [`code://packages/agent-acp/src/mapping.ts`](../../../../packages/agent-acp/src/mapping.ts) - the server's `PermissionOption`s as `ConfirmationOption`s, and the picked one sent back.
- [`code://packages/agent-claude/src/session.ts`](../../../../packages/agent-claude/src/session.ts) - `allow-once`, `allow-always` and `deny` when the SDK suggests permissions, with `updatedPermissions` only on `allow-always`.
- [`code://packages/agent-cofold/src/mapping.ts`](../../../../packages/agent-cofold/src/mapping.ts) - `allow-session`, sent as `alwaysApprove`.
- `docs/PLUGINS.md`, `docs/AGENT.md`, `UPSTREAM.md` and the three backend READMEs.

## Verified

- `subagent-chat.test.ts`, `nested-proxy.test.ts`, `agent-acp-ports.test.ts`, `host.test.ts` (an approval that can be kept) and `agent-cofold-approval.test.ts`; the new cases failed first, and the frames validate with `checker`.
- `pnpm typecheck`, `pnpm boundary` clean; full `pnpm test` 1544 tests passed.

## Departures from the plan

- ACP: with no once option of the answer's kind the server is answered `cancelled`, following the locked row over task 02's step 3.
- An option whose kind does not match `approved` is ignored and the once option of the answer's kind is used, on ACP and Claude.
- Claude's option labels are the builder's wording; cofold's label uses the tool's display name.
- The lead-chat test is in `subagent-chat.test.ts`, which already has a fake recording `confirm`.

## Left for later

- By hand: VS Code or ahpapp showing the options in its approval dropdown.
- Frames the ACP backend already sent with defects the checker reports (turn `origin`, a customization `type`, a part `id`) were not touched.
