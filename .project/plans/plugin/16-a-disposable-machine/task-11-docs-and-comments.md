---
title: The docs say what a disposable machine does, and the comments document
status: done
depends: [task-05-a-machine-is-left-when-its-session-moves-away.md, task-06-a-resumed-session-counts-as-a-user.md, task-07-a-daemon-adopts-only-its-own-leftovers.md, task-08-a-disposable-alone-machine-refuses-another-session.md, task-09-a-machine-made-for-a-session-counts.md, task-10-the-session-folder-needs-the-profiles-flag.md]
layer: "docs"
refs:
  - "[code://packages/sdk/src/types/computers.ts#L160-L177](../../../../packages/sdk/src/types/computers.ts#L160-L177) - `enter`, documented as not called on a pre-turn restart, which `host.ts:5125` does call, and `leave`"
  - "[code://packages/computer/src/plugin.ts#L780-L786](../../../../packages/computer/src/plugin.ts#L780-L786) - the plugin's comment on `enter` and `leave`, \"a restart the host did not report as a start\""
  - "[code://docs/COMPUTER.md#L226-L256](../../../../docs/COMPUTER.md#L226-L256) - the disposable section and its `alone` wording"
---

## Objective

`docs/COMPUTER.md` says what `disposableAlone`, `sessionFolder`, `max`, `computer:write` and the startup adoption do now, and the comments on `enter`/`leave` say what the host does.

## Files

- `UPDATE: packages/sdk/src/types/computers.ts:160-177` - `enter` documented as called by every start of a backend in the machine, as a set, and `leave` as called when the session is disposed or moves to another machine.
- `UPDATE: packages/computer/src/plugin.ts:780-786` - the same, from the plugin's side.
- `UPDATE: docs/COMPUTER.md:226-256` - the disposable section: `disposableAlone` refuses another session even by id; `sessionFolder` (from task 10); a machine made at session start counts against `max` and needs `computer:write`; at startup a daemon adopts only machines whose session it keeps (`ahpd.session` label), and a leftover none adopts stays up, uncharged, until removed by hand, with the `docker ps --filter label=ahpd.disposable` line that finds it.

## Steps

1. Describe behaviour, not history; one paragraph per line, as the file is.

## Validation

- By reading: every profile field and rule in this plan is in the docs; no comment says what used to be. No em dashes.

## Resume
