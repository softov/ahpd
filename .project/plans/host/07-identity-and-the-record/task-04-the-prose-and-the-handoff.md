---
title: The prose and the handoff
status: done
depends:
  - task-01-the-record-is-true.md
  - task-02-a-connection-token-that-resolves-to-a-person.md
  - task-03-the-daemon-hands-a-person-their-url.md
layer: docs
refs:
  - "[code://docs/USERS.md](../../../../docs/USERS.md) - the page that describes two secrets, the record, and a revocation that does not happen"
  - "[code://docs/DAEMON.md](../../../../docs/DAEMON.md) - the flags and keys a daemon is configured with"
  - "[code://.project/working/HANDOFF.md](../../../working/HANDOFF.md) - current state, whose pending 3 says neither client can sign in, which is not true"
  - "[code://.project/plans/host/00-host.md](../00-host.md) - the domain reference and its known gaps"
  - "[file:///github/externals/vscode/src/vs/workbench/contrib/chat/browser/agentSessions/agentHost/agentHostAuth.ts#L838-L984](file:///github/externals/vscode/src/vs/workbench/contrib/chat/browser/agentSessions/agentHost/agentHostAuth.ts#L838-L984) - the dynamic provider path, which exists for MCP servers and is not wired for agent protected resources"
---

## Objective

Every page that describes how a person reaches this host describes what the code does: three ways in, a record that is true, a revocation semantics that is stated correctly, and a handoff whose pending list no longer claims clients cannot sign in.

## Files

- `UPDATE: docs/USERS.md` - three ways in rather than two secrets: the shared door token with no identity, a personal token resolved at the door, and `authenticate` for the protocol; the record and what each field is; the URL a person pastes into VS Code; and the honest sentence about removal landing on the next connection.
- `UPDATE: docs/DAEMON.md` - the `resource` key and `--resource`, next to the connection-token keys.
- `UPDATE: .project/working/HANDOFF.md` - pending 3 corrected (ahpc and ahpapp both push tokens today; VS Code is the client that cannot, and this plan is why it now can), the new plan named, and the auth paragraph brought up to date.
- `UPDATE: .project/plans/host/00-host.md` - the known gap for users and permissions points at this plan.
- `CREATE: .project/research/client-auth-and-the-reference-client.md` - what the reference client does with `authorization_servers`, why it cannot carry a host-issued secret, the dynamic provider path it has for MCP servers only, and the per-agent `required` modelling that a host-level login does not fit.
- `UPDATE: .project/plans/index.md` - the plan's row.

## Steps

1. Rewrite the parts of `docs/USERS.md` that name two secrets, the old identifier, and the old `authorization_servers`, and add the personal-URL instructions for a client that cannot sign in.
2. State removal honestly in that page: it refuses the next connection, and an open socket keeps what it was given until it drops.
3. Write the research file from the VS Code findings, with the file and line refs this plan already carries, so a later plan or an upstream note does not have to rediscover them.
4. Correct `HANDOFF.md`: pending 3, the state of the two clients with the evidence, and a pointer to this plan and the issuer plan after it.
5. Update `00-host.md` and the index row.
6. Read the changed pages once against the code, since the last documentation task in this domain was written precisely because prose drifted.

## Validation

- Every claim in the changed pages is checkable against a file, a flag or a test.
- `rg -n "ahpd://users" docs .project` returns only what is deliberately about the fallback or about a client's stored credential.
- `plans/index.md` has the row with the right status.

## Resume

Done 2026-09-23.
`docs/USERS.md` is rewritten around three ways in, the record the host advertises and what each client can do; `docs/DAEMON.md` names `users` and `resource`; and `.project/research/client-auth-and-the-reference-client.md` records what the reference client does with `authorization_servers`, what it does only for MCP servers, and why a host-level login has no home in the protocol.
`HANDOFF.md` was corrected in the same pass: pending 3 claimed neither client could sign in, and both can, so the remaining client was VS Code and this plan is what changed it.
Found: the page claimed `ahpd user rm` lands on the next command, which the code does not do, because a principal is attached once and expires only by its timer. Both pages now say the next connection, and the change that would make it the next command is in `deferred.md` rather than being pretended here.

