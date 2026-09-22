---
title: Plan records are named cofold, not facio
status: accepted
date: 2026-09-22
refs:
  - code://.project/plans/plugin/03-agent-cofold/plan.md - the plan folder and title that moved
  - code://.project/plans/plugin/04-agent-cofold-extras/plan.md - the extras plan that moved with it
  - code://.project/decisions/cofold-is-the-runtime-name-everywhere.md - the rename whose document half this settles
  - code://.project/plans/index.md - the rows a reader scans
---

## Context

The runtime rename reached the code, the documentation and the decision record, and it left the plan records alone on purpose: [the runtime identity moves to cofold](cofold-is-the-runtime-name-everywhere.md) said that `.project/` prose is a historical record and that only broken paths would be corrected there.
A later pass then rewrote the links inside `.project/` to `03-agent-cofold` and `04-agent-cofold-extras` without moving the folders, so the index and the domain reference pointed at paths that did not exist while a reader browsing `plans/plugin/` still saw `03-agent-facio`.
A name is what a reader scans, and the two spellings had already cost one broken-link pass.

## Decision

The plan records are named after the runtime.
`.project/plans/plugin/03-agent-facio` became `03-agent-cofold`, `04-agent-facio-extras` became `04-agent-cofold-extras`, and the plan, task, implemented and deferred titles that named the runtime or its provider say `cofold`.
The historical prose inside those records stays as it was written, because it describes the work as it was done and the earlier decision still governs that half.

Source: the user, 2026-09-22: "rename plans facio to cofold... to make more sense."

## Consequences

This supersedes the "plan records keep their paths" reading of [the runtime identity moves to cofold](cofold-is-the-runtime-name-everywhere.md), whose consequences are amended to point here.
Every link that named a renamed folder is repointed, the two plans' `title:` lines move with them, and `.project/` has no broken relative link or `code://` reference left.
`plans/index.md` and `plans/plugin/00-plugin.md` carry the cofold names because those are the rows and the sentences a reader scans, and the `code://` references several decisions already held to `04-agent-cofold-extras` resolve now rather than dangling.
`do-spec`'s rule that a plan path is an identity is overridden for this rename by the direct instruction, and the record of the older name is the rename history in git rather than a redirect left on disk.

## Options

- **Rename the plan records**, which is the direction taken.
- **Keep the folders and correct the links back to `03-agent-facio` and `04-agent-facio-extras`.**
  Rejected: it leaves the one directory a reader browses naming a runtime that no longer exists, and it would undo links a concurrent pass had already moved the other way.
- **Rename the folders and rewrite the body prose to cofold as well.**
  Rejected: the reconnaissance, decisions and departures describe what was true when the work was done, and rewriting them would state that a then-unpublished runtime was published.
