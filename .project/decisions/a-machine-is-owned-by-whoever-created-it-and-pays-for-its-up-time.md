---
title: A machine is owned by whoever created it, and its owner pays for the time it is up
status: accepted
date: 2026-10-02
refs:
  - "[code://packages/sdk/src/types/computers.ts](../../packages/sdk/src/types/computers.ts) - `ComputerPort.create`, `enter`, `leave`"
  - "[code://packages/computer/src/plugin.ts](../../packages/computer/src/plugin.ts) - the machines and their labels"
---

## Context

Decision `usage-and-computer-time-are-two-records-behind-one-port` charges computer time to the machine's owner, and machines have no owner today.
The host sees sessions enter and leave a machine; only the computer plugin sees it start and stop.

## Decision

A machine's owner is whoever created it: the owner of the session whose `computer` source made it, or the person who created it directly.
A machine made outside ahpd has no recorded owner and is charged to `root:<host>`.
Computer time is the time a machine is up, from start to stop, as the computer plugin sees it, not the time a session is inside it.
Source: Softov, 2026-10-02, asked "Machines have no owner today. Who is the \"machine owner\" that pays for computer time?": "for now whoever created... with possible future for the session in it mainly when remote session arrive."; asked "What does computer time measure?": "Machine up time".

## Consequences

The owner is stored with the machine, so it survives a daemon restart.
An idle machine left running costs its creator.
Charging the sessions inside a machine instead is expected once remote sessions arrive, and would be a new decision superseding this one.

## Options

- **The sessions inside it pay**: deferred to remote sessions, see above.
- **Time with a session in it**: rejected, a running idle machine costs money and would be charged to nobody.
