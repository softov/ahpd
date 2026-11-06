---
title: A change without a plan keeps the specs
created: 2026-11-06
refs:
  - git://ed4a9105 - the commit of ahpd the facts were checked at
  - git://1d52d06c - the head of #250, which changes how an ACP chat is read back
  - git://f37f5e1a - the merge of #246, which restores a session under its first URI
  - git://c6634b2b - the commit that deleted 250 decisions as "not choices"
  - git://c6634b2b^ - the last commit that holds those decisions
  - "[code://.project/specs/sessions-and-chats.md#L143-L162](../../.project/specs/sessions-and-chats.md#L143-L162) - *A turn is read back as it began*, the behaviour #250 changes"
  - "[code://.project/specs/agent-backends.md#L302-L316](../../.project/specs/agent-backends.md#L302-L316) - the ACP read and the turn after it, which say nothing of turn ids"
  - "[code://docs/README.md#L83](../../docs/README.md#L83) - the one pointer from the docs into `.project/`, which names only the decisions"
  - https://github.com/rust-lang/rfcs/blob/master/README.md - the Rust RFC process, read 2026-11-06
  - https://github.com/Fission-AI/OpenSpec - OpenSpec's specs and change folders, read 2026-11-06
---

# A change without a plan keeps the specs

Softov wants a guide for changes that arrive with no plan, such as the PRs of outside contributors.
Scott Wei's #246 is merged and his #250 is open, and neither came from a plan in `.project/plans/`.
Softov's idea (2026-11-06): "maybe we change to create specs to guide. so this replace decisions that were deleted and solve not planned features avoiding changes on behavior or taking notes on the changes done."
So the specs are the guide: a change keeps the behaviour the specs state, or it records the behaviour it changes.
The specs also take the place of the decisions that `c6634b2b` deleted.

## What others do

- Rust asks for an RFC before a "substantial" change, such as "any semantic or syntactic change to the language that is not a bugfix".
- Rust needs no RFC for a change where "changing shape does not change meaning", or for a change only other Rust developers notice.
- A Rust PR that makes a substantial change without an RFC may be closed, and its author is asked for an RFC first.
- OpenSpec keeps the current specs in `openspec/specs/`, and each change in a folder of its own under `openspec/changes/`.
- An OpenSpec change folder holds `proposal.md`, `design.md`, `tasks.md` and `specs/`, the spec text the change adds, under `## ADDED Requirements`.
- OpenSpec's archive step moves a finished change to `openspec/changes/archive/<date>-<name>/` and updates the specs from it.

## What ahpd has today

- `.project/specs/` has 21 specs, with scenarios in WHEN and THEN form and a line on the reason for each.
- Each of the 21 specs names the deleted decisions it was written from, in a ref to `git://d9d4f950^`.
- `d9d4f950` is not a commit of this repository, so none of those 21 refs resolves. `c6634b2b^` holds the decisions checked: three named in the refs.
- History deleted 272 decision files that `.project/decisions/` does not hold today. 25 of them are named by no spec, and 22 by no file in `.project/`.
- The repository has no `CONTRIBUTING.md`, no PR template, no `AGENTS.md` and no `CLAUDE.md`. `.github/` holds `FUNDING.yml` and the workflows.
- The docs point into `.project/` once, at the decisions, and not at the specs ([`code://docs/README.md`](../../docs/README.md#L83)).
- #246 changed `docs/sdk/SESSIONS.md`, three files in `packages/sdk/src/host/` and one test. It changed no file in `.project/`.
- #250 changes `docs/sdk/AGENT.md`, the `agent-acp` README, ACP and SDK code, and tests. It changes no file in `.project/`.
- For an opted-in backend, #250 changes two outcomes of *A turn is read back as it began* ([`code://.project/specs/sessions-and-chats.md`](../../.project/specs/sessions-and-chats.md#L143-L162)):

| The spec says | #250 does, for an opted-in backend |
| --- | --- |
| A turn the record does not hold joins the turn before it. | The turn stays a turn of its own. |
| A turn keeps the id its transcript gives it. | A recorded turn reads back under the caller's turn id. |

- ACP is the only backend that opts in. The ACP scenarios in [`code://.project/specs/agent-backends.md`](../../.project/specs/agent-backends.md#L302-L316) say nothing of turn ids.

## Who writes

| Writer | Files | What this change does to it |
| --- | --- | --- |
| Scott Wei, fork `shazhou-ww/ahpd` | #250 open, #246 merged | His PRs are checked against the specs. #250 needs a spec change for the two outcomes in its table. |
| MayCXC, fork `MayCXC/ahpd` | branches that Softov merges | The same check applies to a branch merged with no plan. |
| klntsky and terrbear, forks | none yet | The guide is what they read first. |
| dsh build sessions | plans, `implemented.md`, specs on close | No change: a plan already corrects its specs when it closes. |
| Softov's own sessions | `.project/` on `main` | They write the spec changes for a merged PR that did not write its own. |

## The change

- The specs are the statement of ahpd's behaviour for a change with no plan.
- A change that keeps every scenario needs no plan and no spec change.
- A change that alters a scenario corrects that scenario in place, in the same PR, and keeps its line on the reason true.
- The PR says which scenarios it changed, by spec and heading.
- A change that alters behaviour no spec states adds a scenario for it.
- A reader of the repository finds the specs from the docs, beside the pointer to the decisions.
- The 21 source refs point at `c6634b2b^`, which holds the deleted decisions.
- The 25 deleted decisions that no spec names are read, and each one goes into a spec or stays deleted.

## Open points

- Where the note on a change goes:
  - in the PR only
  - in a file under `.project/` beside the spec
  - in an OpenSpec-like change folder that is archived into the spec.
- Who writes the spec change for an outside PR: the contributor, or Softov's session before or after the merge.
- Whether #250 waits for its spec change, or merges and the spec is corrected after.
- Whether "a change keeps the specs or corrects them" is a rule. Only Softov writes rules.
- Whether the guide is a `CONTRIBUTING.md`, an `AGENTS.md`, a PR template, or a line in `docs/README.md`. Scott worked with agents, so an agent may read the guide first.
- Not checked: the other deletion commits, such as `d175b487` and `0fc05ffc`, and whether `c6634b2b^` holds every decision that the 21 refs name.
