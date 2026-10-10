---
title: Stopping a dev container needs the computer's grant
status: accepted
date: 2026-10-10
refs:
  - "[code://packages/sdk/src/host/gate.ts#L90-L100](../../packages/sdk/src/host/gate.ts#L90-L100) - the two `NEEDS` rows for `stop` and `remove`"
  - "[code://packages/sdk/src/host/admission.ts#L135-L144](../../packages/sdk/src/host/admission.ts#L135-L144) - `capabilityFor` asks both grants for the two methods"
  - "[code://packages/sdk/src/users.ts#L168-L173](../../packages/sdk/src/users.ts#L168-L173) - the container subject, with `stop` and `remove` in its `write` group"
  - "[code://packages/sdk/src/host/vscodemethods.ts#L218-L234](../../packages/sdk/src/host/vscodemethods.ts#L218-L234) - `devContainerStopped`, where both methods are served"
  - "[code://.project/decisions/connecting-to-a-dev-container-needs-a-grant.md](../decisions/connecting-to-a-dev-container-needs-a-grant.md) - why the container surface has a grant at all, and why it is not the machine's"
  - "[code://.project/decisions/a-machine-made-for-a-session-counts-against-max-and-needs-computer-write.md](../decisions/a-machine-made-for-a-session-counts-against-max-and-needs-computer-write.md) - a machine made for a session asks `computer:write` beside the operation that names it"
---

## Context

`vscode/devContainers/stop` and `vscode/devContainers/remove` are the two methods VS Code sends when a dev container is idle or gone.
Each takes `{ workspaceFolder }` and acts on the machine that folder already is.
Since `container/03` that machine is a `computer://` computer like any other, and sessions of this host may be running in it.
So each of the two methods does two things at once: it acts on the container surface, and it destroys a computer.

`container/02` task 04 stopped on the second half.
`container:write` was settled by `connecting-to-a-dev-container-needs-a-grant`, and what either method asks for beyond it was not.
The reference host asks its client for workspace trust first, and answers `false` while another window still uses the container.
This host has no workspace trust, and whether the asking principal owns the machine was the open half.

The task's *Objective* and the plan's *Resume state* both held the question, and the task was not built until it was answered.

## Decision

`vscode/devContainers/stop` needs `container:stop`, and `vscode/devContainers/remove` needs `container:remove`.
`computer:write` is asked beside each of them, in `capabilityFor`, so a caller holds three grants in all and nothing more.
The asking principal is not checked against the machine's owner.

Softov answered on 2026-10-10.
The question was `which grant should stop and remove ask for beyond container:write?`, and the answer was both grants with no owner check.
A grant is role-wide everywhere else in this host, so an owner check here would be the one act whose permission depends on a row.

- The container operation is its own name in the `container` subject, as `container:connect` and `container:disconnect` are. `container:write` covers both as the subject's `write` group - decision `a-grant-names-an-operation-and-read-and-write-are-its-groups`.
- The machine's grant rides beside the operation rather than replacing it, as a session that names a source asks `session:create` and `computer:write`.
- Ownership is asked nowhere else, and a role that holds `computer:write` may already remove any `computer://` machine on this host.

## Consequences

A role that may reach the relay surface and not destroy a machine names `container:write` alone, and is refused on both methods.
That is the reason the two grants are asked apart, and it is the whole of what the pair buys.
A role that holds `computer:write` may stop a folder's container it did not make. That is the authority it already has over every machine.
The refusal is `-32009` and names the first pair the caller lacks, so a caller missing both is told about the container operation first.
The `false` answer for a container another connection is relaying to stays as it is. So does the one for a container a session is placed on.
Neither is a grant, and both are the reference host's own answer: the container is left as it was rather than the call being refused.

## Options

- **`container:write` alone, as `connect` and `disconnect` ask.** Rejected: stopping a folder's dev container destroys a `computer://` machine, and `computer:write` is the verb for that act - which is exactly the distinction `connecting-to-a-dev-container-needs-a-grant` drew.
- **Both grants, and the machine's owner on top.** Rejected by Softov: a grant is role-wide everywhere else in this host, so an owner check on this one act would be a permission that depends on a row rather than on a role.
- **Ownership instead of `computer:write`.** Rejected: it would let a person who owns a machine destroy it without ever being given the machine's verb, and it would refuse the host's own operator on a machine somebody else made.
- **`computer:write` alone, the container operation implied.** Rejected: a client of the container surface that may not touch containers at all would then be able to stop one, and a role could not be given the machine's verb without the container's.
