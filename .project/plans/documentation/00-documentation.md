---
title: Documentation - what exists today
domain: documentation
revalidated: 2026-09-19
---

The documentation is `docs/`, one file per area of the host, plus the files at the root that say what the reference is and what each pass against it found.
`docs/README.md` says what each file covers.
There is no package and no test: a document is correct when it describes the code as it is, so a change in behaviour is a change to the document that promised it.

## Packages

- There is none. The documents are the deliverable, and `docs/AHP.md` is the one that is authoritative about the surface.

## Contracts

- `code://docs/README.md` - the index: one line on each file in `docs/`.
- `code://docs/AGENT.md` - writing a backend: the `Agent` interface, and what a backend owes it.
- `code://docs/AHP.md` - the surface: every command, action and well-known key this host serves, each with the row that says why.
- `code://docs/AUTHENTICATION.md` - how a client proves who it is: the door, the tokens, `authenticate` and the issuer.
- `code://docs/AUTOMATIONS.md` - automations: their triggers, the runs they make and the catalogue they live on.
- `code://docs/CHATS.md` - one conversation inside a session: its turns, its parts and its URI.
- `code://docs/COMPUTER.md` - `@ahpd/computer`: making a machine, running a session inside it, and its profiles.
- `code://docs/CONTAINERS.md` - a session inside a folder's dev container.
- `code://docs/DAEMON.md` - the command line: the verbs, the flags, and the configuration file that sits under them.
- `code://docs/HOST.md` - the host itself: what it announces, what it serves, and every setting it reads.
- `code://docs/LIBRARY.md` - using `@ahpd/sdk` to build a host rather than running this one.
- `code://docs/PLUGINS.md` - writing a plugin: the contract, what you may register and the manifest.
- `code://docs/POLICY.md` - who may use which agent, model and computer.
- `code://docs/PROXY.md` - the model proxy served under `/v1`.
- `code://docs/RESOURCES.md` - what a resource is: the schemes, the `resource*` methods and the grants.
- `code://docs/SESSIONS.md` - what a session is: its backend, its settings and what it is charged to.
- `code://docs/TERMINALS.md` - terminals: where one runs, who opens one and its grants.
- `code://docs/TOOLS.md` - what tools a session's model is offered.
- `code://docs/USAGE.md` - the records this host writes and what a pool has been charged.
- `code://docs/USERS.md` - the user directory: the people, their roles and what their work may be charged to.
- `code://README.md` - what the repository is and how to start it.
- `code://REFERENCE.md` - where the reference lives, how the clone is made, and the revisions last read.
- `code://UPSTREAM.md` - the running list, one section per pass, a box per item.

## Runtime path

Nothing runs. A pass reads the reference, writes its review under `.project/review/`, and the documents that describe the changed behaviour move with the code in the same commit.

## Tests

- There is no test. The documents are checked by reading them against the code, which is what produced the six findings recorded in the pass at [the pass 4 review](../../review/2026-09-19-upstream-pass-4.md).

## Known gaps

- Six places where the prose contradicts the code, each verified and none of them caused by an upstream change; plan [01 - Correct the stale prose](01-correct-the-stale-prose/plan.md).
