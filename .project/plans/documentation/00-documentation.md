---
title: Documentation - what exists today
domain: documentation
revalidated: 2026-09-19
---

The documentation is `docs/`, four documents with one job each, plus the files at the root that say what the reference is and what each pass against it found.
There is no package and no test: a document is correct when it describes the code as it is, so a change in behaviour is a change to the document that promised it.

## Packages

- There is none. The documents are the deliverable, and `docs/AHP.md` is the one that is authoritative about the surface.

## Contracts

- `code://docs/AHP.md` - the surface: every command, action and well-known key this host serves, each with the row that says why.
- `code://docs/AGENT.md` - writing a backend: the `Agent` interface, and what a backend owes it.
- `code://docs/DAEMON.md` - the command line: the verbs, the flags, and the configuration file that sits under them.
- `code://docs/LIBRARY.md` - using `@ahpd/sdk` to build a host rather than running this one.
- `code://README.md` - what the repository is and how to start it.
- `code://REFERENCE.md` - where the reference lives, how the clone is made, and the revisions last read.
- `code://UPSTREAM.md` - the running list, one section per pass, a box per item.

## Runtime path

Nothing runs. A pass reads the reference, writes its review under `.project/review/`, and the documents that describe the changed behaviour move with the code in the same commit.

## Tests

- There is no test. The documents are checked by reading them against the code, which is what produced the six findings recorded in the pass at [the pass 4 review](../../review/2026-09-19-upstream-pass-4.md).

## Known gaps

- Six places where the prose contradicts the code, each verified and none of them caused by an upstream change; plan [01 - Correct the stale prose](01-correct-the-stale-prose/plan.md).
