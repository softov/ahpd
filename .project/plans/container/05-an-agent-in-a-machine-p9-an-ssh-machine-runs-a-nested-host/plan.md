---
title: An ssh machine runs a nested host
domain: container
status: draft
priority: medium
created: 2026-09-26
revalidated: 2026-09-26
requires:
  - plans/container/05-an-agent-in-a-machine-p5-agents-run-from-their-parts/plan.md
changes: []
creates: []
decisions:
  - decisions/one-computer-provider-with-runtimes-as-options.md
  - decisions/a-nested-host-speaks-stdio.md
  - decisions/a-nested-host-is-used-only-where-a-command-cannot-reach-the-agent.md
refs:
  - "[code://packages/computer/src/runtime.ts#L167-L185](../../../../packages/computer/src/runtime.ts#L167-L185) - `ComputerRuntime`, which an ssh runtime implements"
  - "[code://packages/sdk/src/types/computers.ts#L122](../../../../packages/sdk/src/types/computers.ts#L122) - `nested()`, whose answer becomes `ssh -T host -- ahpd --stdio`"
  - "[code://.project/ideas/more-computer-runtimes.md](../../../ideas/more-computer-runtimes.md) - `ssh` as the first runtime without a mount"
  - https://github.com/microsoft/vscode/blob/832cf23c588/src/vs/platform/agentHost/node/sshRemoteAgentHostService.ts - VS Code's SSH remote agent host, the parity target
---

## Goal

A machine can be a host listed in the computer plugin's options and reached over ssh: `computer://<name>` lists it, and a session there runs `ahpd --stdio` on it through the proxy backend, whatever the agent.

## Reconnaissance

### Gaps

- `@ahpd/computer` refuses every runtime but `docker`.
- Nothing puts ahpd on a remote box.

## Decisions locked in

| Decision | Plans |
| --- | --- |
| [One computer: provider, one package, the runtime chosen by option](../../../decisions/one-computer-provider-with-runtimes-as-options.md) | `ssh` is a runtime value |
| [The nested host speaks AHP over stdio](../../../decisions/a-nested-host-speaks-stdio.md) | ssh carries the same pipe |
| [A nested host is used only for a backend that runs nested and for a machine on another host](../../../decisions/a-nested-host-is-used-only-where-a-command-cannot-reach-the-agent.md) | every session here is nested |

## Tasks

Written when this plan leaves draft. The outline:

1. `runtime: "ssh"` with hosts in the options; list, status, stats by ssh.
2. `nested()` answers `ssh -T <host> -- <host command> --stdio --plugin <each>`.
3. Several runtimes on one host, each machine id recording which made it.
4. Docs.

## Resume state

- **Done so far:** nothing.
- **Next action:** leave draft once p5 is built.
- **Open questions:**
  1. How does ahpd get onto the box: installed by a person, or copied from the ahpd part on first use as VS Code copies its CLI? - proposed: copied from the part, at the version the outer host speaks.
  2. Is an ssh host a runtime value or a separate "remote target" list? - proposed: a runtime value, per the decision.
- **Watch out for:** the box may be FreeBSD; the ahpd part is Linux glibc, so a FreeBSD box needs ahpd installed by a person.

## Final verification checklist

- [ ] A session on `computer://<ssh host>` answers a turn run by the box's ahpd.
- [ ] `plans/index.md` updated.
