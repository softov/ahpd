---
title: The prose
status: done
depends:
  - task-01-an-issuer-answers-for-a-subject.md
  - task-02-the-daemon-names-one.md
layer: docs
refs:
  - "[code://docs/USERS.md](../../../../docs/USERS.md) - three ways in and a record with no issuer, which this completes"
  - "[code://docs/DAEMON.md](../../../../docs/DAEMON.md) - the keys, which gain `issuer`"
  - "[code://.project/working/HANDOFF.md](../../../working/HANDOFF.md) - pending 3 and 6, which this plan is"
  - "[code://.project/plans/host/00-host.md](../00-host.md) - the known gaps, one of which this closes"
---

## Objective

Every page says what an issuer is, how a deployment names one, and what it does and does not change, and the handoff no longer lists the issuer as unplanned.

## Files

- `UPDATE: docs/USERS.md` - a section on the issuer: the record gains `authorization_servers`, the subject is the record's id, the local hash is tried first, and an unreachable issuer answers `-32007`.
- `UPDATE: docs/DAEMON.md` - the `issuer` key and the flag.
- `UPDATE: .project/working/HANDOFF.md` - pending 3 and 6 closed by this plan, and the state lines brought up to date.
- `UPDATE: .project/plans/host/00-host.md` - the known gap about the record naming an issuer.
- `CREATE: .project/research/a-host-level-protected-resource.md` - the AHP gap this plan works around: discovery is per agent, so a host-wide login rides on every agent and makes each read as required. Written so an upstream note does not have to rediscover it.
- `UPDATE: .project/plans/index.md` - the row.
- `UPDATE: .project/plans/host/07-identity-and-the-record/deferred.md` - the issuer row points here rather than at an unwritten plan.

## Steps

1. Write the issuer section in `docs/USERS.md`, including where the subject comes from and what happens when the issuer cannot be reached.
2. Name the `issuer` key in `docs/DAEMON.md` beside `users` and `resource`.
3. Write the research file on the host-level resource gap, with the file and line refs the plan carries.
4. Correct `HANDOFF.md`: the state lines, pending 3 and 6, and the constraint about the record being deliberately incomplete.
5. Update `00-host.md`, `plans/index.md`, and the deferred row in plan 07.
6. Read the changed pages once against the code, since the last documentation task existed because prose drifted.

## Validation

- Every claim in the changed pages is checkable against a file, a flag or a test.
- `rg -n "authorization_servers" docs .project` returns only what this plan and plan 07 intend.
- `plans/index.md` has the row with the right status.

## Resume

Done 2026-09-23.
`docs/USERS.md` gained an issuer section with the record it produces and the three things worth knowing, and its clients section no longer calls the issuer a later plan; `docs/DAEMON.md` names the `issuer` key; and `research/a-host-level-protected-resource.md` records the protocol gap this plan works around.
`00-host.md`, the index row and plan 07's deferred row were updated.
Found: `required: true` on a host-wide login is what makes every agent read as required, which is a modelling gap rather than something to fix here, so it is written up as a finding and left for an upstream note.

