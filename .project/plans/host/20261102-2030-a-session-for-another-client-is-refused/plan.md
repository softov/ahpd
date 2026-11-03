---
title: A session for another client is refused
domain: host
status: built
priority: high
created: 2026-11-02
revalidated: 2026-11-02
refs:
  - git://89ebe4d5 - the commit of ahpd this plan was checked at
  - "https://github.com/microsoft/agent-host-protocol/blob/v1.0.0/types/channels-session/commands.ts#L77-L85 - the creator's `activeClient`, whose `clientId` MUST match the one it gave at `initialize`"
  - "https://github.com/microsoft/agent-host-protocol/blob/v1.0.0/types/channels-session/state.ts#L267-L273 - `SessionActiveClient` requires a `clientId`"
  - "https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/protocolServerHandler.ts#L2209-L2213 - VS Code's host refuses an `activeClient` whose `clientId` is not the connection's, before the session is made"
  - "[code://packages/sdk/src/host/sessionmethods.ts#L947-L962](../../../../packages/sdk/src/host/sessionmethods.ts#L947-L962) - `createSession`'s checks before anything is claimed or made"
  - "[code://packages/sdk/src/host/sessionmethods.ts#L1037-L1072](../../../../packages/sdk/src/host/sessionmethods.ts#L1037-L1072) - the creator's entry, held under this connection's id whatever it named"
  - "[code://packages/sdk/test/presence.test.ts#L577-L587](../../../../packages/sdk/test/presence.test.ts#L577-L587) - the case that holds the creator under its own id"
---

## Goal

A `createSession` whose `activeClient` names a `clientId` other than the connection's is refused, as VS Code's host refuses it.
Nothing is claimed or made for it.
A creator naming its own id, or none, is held in the session as it is today.

## Reconnaissance

The files read and the patterns to reuse are the `refs` in the frontmatter, each with its note.

### Searches performed

- `rg -n "activeClient" packages/sdk/src/host/sessionmethods.ts` - the creator's entry takes the connection's id over the one it named.
- `rg -ln "createSession" packages/*/test | xargs rg -ln activeClient` - the cases that create a session with a creator's entry.
- `rg -n "activeClient" notes/ahpd/deploy-probe.mjs` - the probe creates sessions with no creator's entry.
- VS Code main at `a4e689ae` refuses the request with `-32602` before it forwards it.

### Runtime path

```
createSession -> sessionmethods.ts -> the provider and its use checked -> the creator's id checked -> claims, the session made, the creator held
```

### Gaps

- A creator naming another client is held as this connection, where VS Code's host refuses the request.
- The protocol says the two ids MUST match, and names no answer for a request where they differ.
- So VS Code's host is the reference.

## Answers

| What | Source | Task |
| --- | --- | --- |
| A creator's `clientId` other than the connection's is refused with `-32602`, "createSession.activeClient.clientId must match the connection's clientId" | [protocolServerHandler.ts#L2209-L2213](https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/protocolServerHandler.ts#L2209-L2213); [commands.ts#L77-L85](https://github.com/microsoft/agent-host-protocol/blob/v1.0.0/types/channels-session/commands.ts#L77-L85) | 01 |
| A creator's entry with no `clientId` takes the connection's, as a `session/activeClientSet` entry does here; the reference host's comparison refuses it, and this plan leaves it as it is | [code://packages/sdk/src/host/actions.ts#L787-L810](../../../../packages/sdk/src/host/actions.ts#L787-L810); [protocolServerHandler.ts#L2211](https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/protocolServerHandler.ts#L2211) | - |
| The check comes after the provider and the caller's use of it are checked, and before anything is claimed or made | [protocolServerHandler.ts#L2205-L2213](https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/protocolServerHandler.ts#L2205-L2213) | 01 |

## Proposed architecture

- **Event flow** - `createSession` refuses a creator naming another id, and holds a creator naming its own as it does today.
- **Layer responsibilities** - `sessionmethods.ts` checks the request.
- **Source-of-truth files** - [`code://packages/sdk/src/host/sessionmethods.ts`](../../../../packages/sdk/src/host/sessionmethods.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - A creator naming another client is refused](task-01-a-creator-naming-another-client-is-refused.md) | done | - |

## Risks and tradeoffs

- A client naming another client's id is refused where it was held as itself, and sends its own id.

## Resume state

- **Done so far:** task 01, 2026-11-02.
- **Next action:** none; see [implemented.md](implemented.md).
- **Open questions:** none.
- **Watch out for:** a creator's entry with no `clientId`, which the cases send and which takes the connection's.

## Final verification checklist

- [x] Each new or changed case fails on `89ebe4d5` for the reason it names, and passes after the change.
- [x] The touched test files pass.
- [x] `pnpm run typecheck` and `pnpm run boundary` report no errors, and the prose lint is clean.
