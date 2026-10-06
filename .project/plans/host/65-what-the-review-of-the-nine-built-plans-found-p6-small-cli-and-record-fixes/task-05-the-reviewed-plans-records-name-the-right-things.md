---
title: The reviewed plans' records name the right things
status: todo
depends: []
layer: "docs"
refs:
  - "[code://.project/plans/host/44-ahpd-speaks-ahp-1-0-0-p2-an-automation-disables-itself/task-02-a-scheduled-automation-switches-itself-off.md#L11](../../../../.project/plans/host/44-ahpd-speaks-ahp-1-0-0-p2-an-automation-disables-itself/task-02-a-scheduled-automation-switches-itself-off.md#L11) - the ref host/48 p11 rewrote, naming `onDue`"
  - "[code://packages/sdk/src/host/automations.ts#L233](../../../../packages/sdk/src/host/automations.ts#L233) - `due`"
  - "[code://.project/plans/container/04-a-cofold-session-in-a-computer/plan.md#L128](../../../../.project/plans/container/04-a-cofold-session-in-a-computer/plan.md#L128) - Next action, pointing at an answered question"
  - "[code://.project/plans/container/04-a-cofold-session-in-a-computer/task-09-an-ended-nested-session-refuses-with-the-reason.md#L39](../../../../.project/plans/container/04-a-cofold-session-in-a-computer/task-09-an-ended-nested-session-refuses-with-the-reason.md#L39) - Resume, the same"
  - "[code://.project/plans/container/04-a-cofold-session-in-a-computer/implemented.md#L60](../../../../.project/plans/container/04-a-cofold-session-in-a-computer/implemented.md#L60) - where it was answered"
  - "[code://.project/plans/container/03-a-dev-container-is-a-computer/implemented.md#L5](../../../../.project/plans/container/03-a-dev-container-is-a-computer/implemented.md#L5) - `git://ae250ef`"
  - "[code://.project/plans/proxy/02-the-proxy-serves-a-persons-model-calls/implemented.md#L5](../../../../.project/plans/proxy/02-the-proxy-serves-a-persons-model-calls/implemented.md#L5) - `git://2cb298d`"
  - "[code://.project/plans/daemon/15-a-verb-declares-only-its-own-flags/implemented.md#L36](../../../../.project/plans/daemon/15-a-verb-declares-only-its-own-flags/implemented.md#L36) - `--config-file` left for later, which task 02 does"
---

## Objective

Each record the review found wrong says what is true: the function a ref names, the question a next action points at, the commit a build is.

## Files

- `UPDATE: .project/plans/host/44-ahpd-speaks-ahp-1-0-0-p2-an-automation-disables-itself/task-02-a-scheduled-automation-switches-itself-off.md:11` - the note names `due`; today it names `onDue`, the option the function is registered under.
- `UPDATE: .project/plans/container/04-a-cofold-session-in-a-computer/plan.md:128` - Next action is Softov's review; today it also points at the question `implemented.md:60` records as answered.
- `UPDATE: .project/plans/container/04-a-cofold-session-in-a-computer/task-09-an-ended-nested-session-refuses-with-the-reason.md:39` - says the question was answered, and how, in one line after the line as it stands.
- `UPDATE: .project/plans/container/03-a-dev-container-is-a-computer/implemented.md:5` - `git://52f98f6`; today `git://ae250ef`, the base it was rebased onto, which line 25 names as such and keeps.
- `UPDATE: .project/plans/proxy/02-the-proxy-serves-a-persons-model-calls/implemented.md:5` - `git://3e93f6a`; today `git://2cb298d`.
- `UPDATE: .project/plans/daemon/15-a-verb-declares-only-its-own-flags/implemented.md:36` - points at host/65 p6 task 02.

## Steps

1. Make each change in place; no task status changes in any of these plans.

## Validation

- `rg -n "onDue" .project/plans/host/44-*p2*` finds only the plan's search line; `rg -n "ae250ef|2cb298d" .project/plans/*/0*/implemented.md` finds only container/03's line 25.

## Resume
