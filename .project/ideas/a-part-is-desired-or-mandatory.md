---
title: A part is desired or mandatory
created: 2026-10-05
---

A machine's parts are not all equal: some are what its session cannot run without, and some only make it better.
A mandatory part that fails to build refuses the machine; a desired one that fails leaves the machine made without it, with a line naming the part.
Source: Softov, 2026-10-05, on [container/05 p4](../plans/container/05-an-agent-in-a-machine-p4-a-part-is-mounted-into-a-machine/plan.md)'s question of a machine made for one session whose own part fails: "I dont want to decide it as a rule, but for now refuse at create. in a future, some parts are desired, some are mandatory. so one desired does not fail. while a mandatory fails."

## Today

p4 refuses at create a machine made for one session (a disposable, or a dev container) when a part that session needs fails to build, and makes a shared machine without the failed part, refusing only the sessions that need it.
Every part is treated the same way; there is no way to say which ones a session can do without.

## Where it would wire in

- A part need (`PartNeed` in `packages/sdk/src/types/machine.ts`) or a profile's `parts` entry carries whether it is mandatory, the way an env need carries `required`.
- The create checks only the mandatory parts of the session it is for; a desired part that failed is logged and left out.
- The refusal of a session on a machine without a part asks the same question, so a session whose missing part is desired is not refused.

## Questions it must answer first

- Who says which: the agent that declares the part, the profile that lists it, or both, and which wins.
- Whether an agent's own binary is always mandatory, so only extras can be desired.
