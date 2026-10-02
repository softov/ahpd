---
title: The bridge signs in, and says when an agent needs it
domain: acp
status: built
priority: high
created: 2026-09-26
revalidated: 2026-09-26
requires: []
changes: []
creates: []
decisions: []
refs:
  - "[code://packages/agent-acp/src/session.ts#L526-L547](../../../../packages/agent-acp/src/session.ts#L526-L547) - `initialize` then `session/new`, where `authenticate` goes between"
  - "[code://packages/agent-acp/src/connection.ts#L137-L146](../../../../packages/agent-acp/src/connection.ts#L137-L146) - the handshake reply, whose `authMethods` is never read"
  - "[code://packages/agent-acp/src/types.ts#L42-L60](../../../../packages/agent-acp/src/types.ts#L42-L60) - `AcpOptions`"
  - "[code://.project/plans/container/05-an-agent-in-a-machine-p2-an-acp-agent-says-what-its-machine-needs/plan.md](../../../../.project/plans/container/05-an-agent-in-a-machine-p2-an-acp-agent-says-what-its-machine-needs/plan.md) - where this work was first planned, and moved from"
  - npm://@agentclientprotocol/sdk - `authenticate`, `AuthMethod`, the `auth_required` error
---

## Goal

A spec can name the sign-in method the bridge sends after `initialize`, so an agent that refuses `session/new` until it is signed in starts.
An agent that answers `auth_required` ends the turn with an error that says so and names the methods it offers, instead of a generic failure.

## Reconnaissance

The files read and the patterns to reuse are the `refs` above, each with its note.

### Searches performed

- `rg "authenticate|authMethods" packages/agent-acp/src` - nothing.

### Gaps

- Codex with only a key, and Cursor, refuse a session until `authenticate`.

## Decisions locked in

| What | Source | Task |
| --- | --- | --- |
| Sign-in lives in the acp domain, not the container plan | Softov, 2026-09-26, asked "Container 05 p2 already has ACP sign-in and the presets. Where do they live?", answered "Sign-in moves to acp" | 01 |
| The method is named by the spec; the bridge never picks one itself | (defaulted: a wrong guess signs in as the wrong account) | 01 |

## Proposed architecture

- **Layer responsibilities** - `plugin.ts` and `types.ts`: the option · `session.ts`: the call and the error.

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - A spec may sign in after initialize](task-01-a-spec-may-sign-in.md) | done | - |
| [02 - auth_required is its own error](task-02-auth-required-is-its-own-error.md) | done | - |
| [03 - The docs show signing in](task-03-docs.md) | done | 01, 02 |

## Risks and tradeoffs

- Cursor's documented flow signs in with a browser when no key is set - its preset names the key method only (plan 05).

## Resume state

- **Done so far:** built 2026-10-02, see [implemented.md](implemented.md).

## Final verification checklist

- [x] A server that requires sign-in starts when the spec names the method.
- [x] `auth_required` reads as that, with the methods.
- [x] `pnpm test`, `pnpm typecheck` green.
- [x] `plans/index.md` updated.
