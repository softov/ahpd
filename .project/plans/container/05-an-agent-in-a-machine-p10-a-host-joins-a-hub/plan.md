---
title: A host joins another, which lists it as a computer and relays its sessions
domain: container
status: draft
priority: medium
created: 2026-09-26
revalidated: 2026-09-26
requires:
  - plans/container/05-an-agent-in-a-machine-p9-an-ssh-machine-runs-a-nested-host/plan.md
changes: []
creates: []
decisions:
  - decisions/any-ahpd-can-be-the-hub.md
  - decisions/a-nested-host-speaks-stdio.md
  - decisions/a-grant-is-a-subject-and-a-verb.md
refs:
  - "[code://packages/sdk/src/listen.ts](../../../../packages/sdk/src/listen.ts) - the listener a joining host dials"
  - "[code://packages/sdk/src/nested.ts#L95-L120](../../../../packages/sdk/src/nested.ts#L95-L120) - the proxy that relays a host's session"
  - "[code://packages/sdk/src/rpc.ts#L74-L100](../../../../packages/sdk/src/rpc.ts#L74-L100) - `createPeer`, whose wire can be a socket the other side opened"
---

## Goal

`ahpd join <url> --token <t>` on a machine behind NAT dials another ahpd, which lists it as `computer://<node>` and runs sessions on it through the proxy, over the socket the node opened.
No port is opened on the node, each node has its own token, and dropping the token removes the node.

## Reconnaissance

### Gaps

- A host can only reach a host it starts.
- No grant names a node.

## Decisions locked in

| Decision | Plans |
| --- | --- |
| [Any ahpd can be the hub other hosts join](../../../decisions/any-ahpd-can-be-the-hub.md) | the hub is a role |
| [The nested host speaks AHP over stdio](../../../decisions/a-nested-host-speaks-stdio.md) | the relay stays a byte stream |
| [A grant is a subject and a verb](../../../decisions/a-grant-is-a-subject-and-a-verb.md) | a node is a subject |

## Tasks

Written when this plan leaves draft. The outline:

1. `ahpd join`: a command that dials and keeps the connection, reconnecting.
2. The hub: a joined connection becomes a computer, and `nested()` answers the socket instead of a spawn.
3. A node grant and its token.
4. Placement: a profile may name where it runs.
5. Docs.

## Resume state

- **Done so far:** nothing.
- **Next action:** leave draft once p9 is built.
- **Open questions:**
  1. Does the hub start sessions on a node, or does a client connect to the node through the hub? - proposed: the hub owns the session, as it does for a nested host.
  2. Is the connection AHP with the node as a client, or a raw pipe carrying the nested host's frames? - proposed: the pipe, so the relay code is the nested one.
- **Watch out for:** a hub that restarts loses its nodes until they reconnect; a node's sessions keep running on the node.

## Final verification checklist

- [ ] A node behind NAT joins, is listed, and a session on it answers a turn.
- [ ] Revoking the node's token drops it.
- [ ] `plans/index.md` updated.
