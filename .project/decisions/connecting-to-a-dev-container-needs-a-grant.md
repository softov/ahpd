---
title: Connecting to a dev container needs a grant of its own
status: accepted
date: 2026-09-24
refs:
  - "[code://packages/sdk/src/host.ts#L139-L190](../../packages/sdk/src/host.ts#L139-L190) - `NEEDS`, the method to grant table"
  - "[code://packages/sdk/src/host.ts#L193-L240](../../packages/sdk/src/host.ts#L193-L240) - `UNGATED`, and why an unclassified method is the dangerous default"
  - "[code://packages/sdk/src/host.ts#L4686-L4735](../../packages/sdk/src/host.ts#L4686-L4735) - `capabilityFor`, where a method with no URI answers its own pair"
  - "[code://test/users-gate.test.ts#L100-L130](../../test/users-gate.test.ts#L100-L130) - the staleness test that fails on an unclassified handler"
  - "[code://.project/decisions/a-grant-is-a-subject-and-a-verb.md](../decisions/a-grant-is-a-subject-and-a-verb.md) - what a grant is"
---

## Context

The dev container methods are extension methods, and an extension method has no entry in `NEEDS` unless somebody writes one.
`capabilityFor` answers nothing for a method it does not know (`NEEDS[method] === undefined`), and nothing is what an ungated method needs, so the default for a method nobody classified is that anybody who completed a handshake may call it.
The staleness test in `test/users-gate.test.ts` exists because of exactly that: every handler must be in `NEEDS` or in `UNGATED`, and the test names both sets.

What the surface does is start a container and run commands in it, which is the host's Docker access by proxy: a container is not a sandbox against the host's daemon, and a person who can ask for one can already ask for a great deal.
The reference gates it on workspace trust, which is a client concept this host does not have and should not grow for this.
Every act on the surface is a write to the host's machine: `connect` makes a container, `disconnect` removes one, and `relaySend` runs a whole agent host inside it.

## Decision

`vscode/devContainers/connect`, `vscode/devContainers/disconnect` and `vscode/devContainers/relaySend` need `container:write`, and `vscode/devContainers/isDockerAvailable` is ungated.

- The subject is `container` and the verb is `write`, in the grammar `a-grant-is-a-subject-and-a-verb` set, so a role names it like any other pair and `admin` reaches it as `*:*`.
- The probe is ungated because it answers one boolean about the host's own machine and starts nothing, the way `ping` and `initialize` answer without a grant.
- The pair is read on every command, so a role that loses the grant is refused on the next call rather than at the next sign-in.
- `container:write` is not `computer:write`: a dev container is a folder's own definition rather than a `computer://<name>` a person manages, and the params name a workspace folder rather than a URI, so the two grants stay separate by design.

## Consequences

A deployment can let somebody use the file tree and the sessions without letting them start containers, which is the point of a grant that names the act.
A person who may make `computer://` machines is not automatically allowed to start dev containers, and the reverse, so a role that wants both names both. That is more words in a users file and the honest amount of authority.
The refusal is `-32009` with the pair in it, which is the same sentence every other refusal uses, so a client has nothing new to learn.
The staleness test now holds the four method names, so a later handler added beside them without a decision fails the suite rather than being served to anyone.
The cost is one more subject in a small vocabulary, and it is the second mechanism to get one after `computer:`. If a third arrives, the pattern is settled rather than reconsidered.

## Options

- **Gate on `computer:write`.** Rejected: the params carry a workspace folder and not a `computer://` URI, and a dev container is not a machine a person manages, so naming the machine's verb would grant an authority the act does not use.
- **Gate on plain `write`.** Rejected: in this vocabulary plain `write` is the file capability a client needs to save the file it has open, and a container is not a file.
- **Leave it ungated, as the reference leaves its extension methods to trust.** Rejected: this host has a grant vocabulary and no workspace trust, so ungated here means Docker for anybody who completed a handshake.
- **Gate the probe too.** Rejected: a boolean about whether Docker exists starts nothing, and a client has to be able to ask before it can ask for anything else.
