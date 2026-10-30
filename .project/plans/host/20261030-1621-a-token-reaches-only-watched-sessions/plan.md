---
title: A token reaches only the sessions its connection watches
domain: host
status: built
priority: high
created: 2026-10-30
revalidated: 2026-10-30
requires:
  - plans/host/20261030-1608-a-targeted-token-reaches-only-its-server/plan.md
refs:
  - "[code://packages/sdk/src/host/handshake.ts#L633-L813](../../../../packages/sdk/src/host/handshake.ts#L633-L813) - `authenticate`, which gives an MCP token to the waiting chats of every session on the host"
  - "[code://packages/sdk/src/host/handshake.ts#L216-L240](../../../../packages/sdk/src/host/handshake.ts#L216-L240) - `aimedAt`, which takes a target's session if the host holds it"
  - "[code://packages/sdk/src/host/handshake.ts#L145-L191](../../../../packages/sdk/src/host/handshake.ts#L145-L191) - `expire`, which names the session that `channelAwaiting` finds"
  - "[code://packages/sdk/src/host/auth.ts#L23-L52](../../../../packages/sdk/src/host/auth.ts#L23-L52) - `asking`, which says `auth/required` to the connections that watch the session under the name it is held by"
  - "[code://packages/sdk/src/host/auth.ts#L165-L178](../../../../packages/sdk/src/host/auth.ts#L165-L178) - `channelAwaiting`, the first session on the host that waits for the resource"
  - "[code://packages/sdk/src/host.ts#L984-L1002](../../../../packages/sdk/src/host.ts#L984-L1002) - `leaves`, where a client is in a session while it watches it under any spelling"
  - "[code://packages/sdk/src/host/routing.ts#L48-L57](../../../../packages/sdk/src/host/routing.ts#L48-L57) - `heldAs`, the name a session is held by for any spelling of it"
  - "[code://packages/sdk/src/host.ts#L576-L596](../../../../packages/sdk/src/host.ts#L576-L596) - `broadcast`, which addresses a client by the name it watches a channel under"
  - "[code://packages/sdk/src/types/host.ts#L1260-L1277](../../../../packages/sdk/src/types/host.ts#L1260-L1277) - `Connection.tokens`: a token is spent only on the sessions its client asks for"
  - "[code://packages/sdk/test/host-handshake.test.ts#L785-L807](../../../../packages/sdk/test/host-handshake.test.ts#L785-L807) - a backend's token is not lent to a session another client asked for"
  - "[code://docs/sdk/AUTHENTICATION.md#L78](../../../../docs/sdk/AUTHENTICATION.md#L78) - a token for a backend or an MCP server is spent only on the sessions its connection asks for"
  - "[code://docs/sdk/AHP.md#L96](../../../../docs/sdk/AHP.md#L96) - the `authenticate` row, which says the same"
  - "[code://docs/sdk/AHP.md#L160](../../../../docs/sdk/AHP.md#L160) - the `auth/required` row: said to the connections watching that session"
  - git://3f05fd47 - MCP servers that need a sign-in, with the token given to every waiting chat on the host
  - git://b617234f - the `authenticate` row, written after it: spent only on that connection's sessions
  - git://9def5ad0 - `AUTHENTICATION.md`, written after it, which names an MCP server's token in the same rule
  - "https://github.com/microsoft/agent-host-protocol/blob/0b7b7f9f4ceb2fbd8846557416f765ac73da647d/docs/specification/authentication.md#L147 - without a target, a token may satisfy every matching pending challenge"
  - "https://github.com/microsoft/agent-host-protocol/blob/0b7b7f9f4ceb2fbd8846557416f765ac73da647d/docs/specification/authentication.md#L255-L257 - authentication status is per connection, each client authenticating independently"
---

## Goal

A token a client pushes for an MCP server is spent only on the sessions that client's connection watches.
Another person's session never gets it, with or without a target, which is the rule this host documents for every pushed token.
The connections asked to sign in for a session are the ones whose tokens it can take.
Each is asked under the name it watches the session by.

## Reconnaissance

The files read and the patterns to reuse are the `refs` in the frontmatter, each with its note.

### Searches performed

- `rg "spent only|asks for" docs packages/sdk/src` - the rule is in `AHP.md`, `AUTHENTICATION.md` and `Connection.tokens`, and `AUTHENTICATION.md` names an MCP server's token in it.
- `git log -S "authenticated?.(resource, token)"` - the code that gives the token to every waiting chat came first, in `3f05fd47`, and both documents were written after it.
- `rg "watching.has" packages/sdk/src` - `asking` asks only the connections that watch the session under the name it is held by.

### Runtime path

```
authenticate { resource, token } -> every chat of every session on the host whose awaiting() holds the resource
asking -> auth/required to each connection with watching.has(session), under the held name only
expire -> auth/required on channelAwaiting(resource), the first session on the host that waits for it
```

### Gaps

- A token one client pushes reaches the servers of sessions another client opened, another person's on a host with users.
- A target may name a session the connection does not watch.
- A client that watches a session under another spelling is never asked to sign in for it.
- The expiry of an MCP token can name a session the connection does not watch.

## Answers

| What | Source | Task |
| --- | --- | --- |
| A token is spent only on the sessions its connection asks for, and a token for an MCP server is no exception | [code://docs/sdk/AUTHENTICATION.md#L78](../../../../docs/sdk/AUTHENTICATION.md#L78); [code://packages/sdk/src/types/host.ts#L1260-L1277](../../../../packages/sdk/src/types/host.ts#L1260-L1277) | 01 |
| The sessions a connection asks for are the ones it watches, under any spelling | [code://packages/sdk/src/host.ts#L984-L1002](../../../../packages/sdk/src/host.ts#L984-L1002), where a client is in a session while it watches it; [code://packages/sdk/src/host/auth.ts#L23-L52](../../../../packages/sdk/src/host/auth.ts#L23-L52), which asks the watchers to sign in | 01 |
| A token with no target goes to the waiting chats of the sessions its connection watches | the same | 01 |
| An MCP token that no session the connection watches waits for, and no backend advertises, is refused with `-32602` | [code://packages/sdk/src/host/handshake.ts#L655-L661](../../../../packages/sdk/src/host/handshake.ts#L655-L661), this host's answer for a resource it did not advertise | 01 |
| A target whose session the connection does not watch is refused with `-32602` | the protocol refuses a target with an unknown session; the session is not one this connection asked for | 01 |
| `auth/required` reaches every connection that watches the session, under the name it watches it by | [code://packages/sdk/src/host.ts#L576-L596](../../../../packages/sdk/src/host.ts#L576-L596) | 01 |
| The expiry of a token names a session its connection watches, or the root channel when none waits | [code://packages/sdk/src/host/auth.ts#L165-L178](../../../../packages/sdk/src/host/auth.ts#L165-L178) | 01 |

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - A token stays with its connection's sessions](task-01-a-token-stays-with-its-sessions.md) | done | - |

## Risks and tradeoffs

- A client that wants a token for another session's server has to watch that session first.
  It is told about the server's sign-in only while it watches the session, so a client that answers one is watching it.
- The protocol lets a token with no target satisfy every matching challenge.
  This host keeps it to the client's own sessions, which the protocol allows and this host documents.

## Resume state

- **Done so far:** planned and built 2026-10-30. See [implemented.md](implemented.md).
- **Next action:** none.
- **Open questions:** none.
- **Watch out for:** a client may watch a session under an older spelling, so a check by the held name alone misses it.
