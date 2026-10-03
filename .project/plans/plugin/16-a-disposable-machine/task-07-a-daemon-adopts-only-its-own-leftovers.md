---
title: A daemon adopts only the disposable machines whose session it keeps
status: todo
depends: [task-06-a-resumed-session-counts-as-a-user.md]
layer: "computer | sdk | server"
refs:
  - "[code://packages/computer/src/plugin.ts#L515-L536](../../../../packages/computer/src/plugin.ts#L515-L536) - the startup listing, which opens a stretch for every running machine and arms every labelled leftover"
  - "[code://packages/computer/src/plugin.ts#L507-L512](../../../../packages/computer/src/plugin.ts#L507-L512) - `watch`, which starts a machine with no session counted"
  - "[code://packages/computer/src/plugin.ts#L762-L777](../../../../packages/computer/src/plugin.ts#L762-L777) - the disposable create, which hands `run` the `disposable` labels"
  - "[code://packages/computer/src/runtime.ts#L414-L423](../../../../packages/computer/src/runtime.ts#L414-L423) - `MACHINE_OWNER`, `MACHINE_TEAM`, `MACHINE_PROJECT`, where the session label's constant goes"
  - "[code://packages/computer/src/runtime.ts#L701-L723](../../../../packages/computer/src/runtime.ts#L701-L723) - the labels `run` writes"
  - "[code://packages/computer/src/runtime.ts#L21-L64](../../../../packages/computer/src/runtime.ts#L21-L64) - `Machine`, which has no session field"
  - "[code://packages/computer/src/runtime.ts#L67-L178](../../../../packages/computer/src/runtime.ts#L67-L178) - `MachineSpec`, which has no session field"
  - "[code://packages/sdk/src/types/plugin.ts#L137-L169](../../../../packages/sdk/src/types/plugin.ts#L137-L169) - `PluginHost`: `machineNeeds` and `recordUsage` read the host when called; nothing reads its sessions"
  - "[code://packages/sdk/src/plugins.ts#L254-L273](../../../../packages/sdk/src/plugins.ts#L254-L273) - `HostRecordingOptions`, where `agents` and `usage` are handed in as functions"
  - "[code://packages/server/src/plugins.ts#L686-L696](../../../../packages/server/src/plugins.ts#L686-L696) - where the daemon hands each plugin host `agents` and `usage` as functions"
  - "[code://packages/sdk/src/types/sessions.ts#L50-L56](../../../../packages/sdk/src/types/sessions.ts#L50-L56) - `SessionStore`, read per id, with no list"
  - "[code://packages/sdk/src/host.ts#L4211-L4221](../../../../packages/sdk/src/host.ts#L4211-L4221) - the `gone` predicate handed to `kept.prune` after a full listing"
  - "[code://packages/sdk/src/host.ts#L4921-L5044](../../../../packages/sdk/src/host.ts#L4921-L5044) - `removeSession`, which ends in `kept.forget`"
---

## Objective

A disposable machine carries the session it was made for as a label, and at startup a daemon adopts only leftovers whose session it keeps, counting that session as a user until it is disposed and opening the machine's up-time stretch.
A leftover whose session this daemon does not keep is not watched, not removed and not metered.
This applies [A daemon adopts only the disposable machines whose session it keeps](../../../decisions/a-daemon-adopts-only-the-disposable-machines-whose-session-it-keeps.md); not opening a stretch for another daemon's machine follows from it, since that machine "is left alone", and stops `usage/03`'s startup listing charging one machine's up time twice.

## Files

- `UPDATE: packages/computer/src/runtime.ts:414-423` - `MACHINE_SESSION = 'ahpd.session'` beside `MACHINE_OWNER`, documented as the session a machine was made for.
- `UPDATE: packages/computer/src/runtime.ts:21-64`, `:67-178` - `Machine.session?` and `MachineSpec.session?`, documented.
- `UPDATE: packages/computer/src/runtime.ts:701-723` - `run` writes the session label when the spec names one; the listing reads it by name through `plugin/15` task 08's reader (its key joins that list), and `inspect` readers answer it.
- `UPDATE: packages/computer/src/plugin.ts:762-777` - the disposable create passes `session: asked.session`.
- `UPDATE: packages/sdk/src/types/plugin.ts:137-169` - `PluginHost.sessionKept(uri): boolean`, read when called: whether this host's session store keeps that session.
- `UPDATE: packages/sdk/src/plugins.ts:254-273`, `:319-328` - `HostRecordingOptions.sessions?: () => SessionStore | undefined`, and `sessionKept` answered from it as `machineNeeds` is from `agents`; `false` when there is no store.
- `UPDATE: packages/server/src/plugins.ts:542-553`, `:686-696` - the live session store handed to every plugin host, the way `usage: () => reached?.usage` is.
- `UPDATE: packages/computer/src/plugin.ts:515-536` - for a disposable leftover, adopt it only when its session label names a session `sessionKept` answers for: `watch` it with that session already in its set, and `open` its stretch if it is running; skip it otherwise. A machine that is not disposable keeps today's behaviour.
- `UPDATE: packages/sdk/src/host.ts:4211-4221` - the predicate handed to `kept.prune` notes each id it answers `true` for, with the machine that session's stored config names, and after the prune the host calls `leaveForgotten` for each.
- `UPDATE: packages/sdk/src/host.ts:4921-5044` - `removeSession` calls `leaveForgotten` before `kept.forget`, for a session that is forgotten without having entered a machine in this process.
- `UPDATE: packages/sdk/src/host.ts` - `leaveForgotten(uri, config)`, one function: reads the `computer://<id>` the stored config names and calls the port's `leave` for that session; a source or no setting does nothing. It is the one place that decides how a gone session lets its machine go, so another signal can replace it.
- `UPDATE: packages/computer/test/computer-disposable.test.ts`, `packages/computer/test/computer-uptime.test.ts`, `packages/sdk/test/plugin-host.test.ts` - the cases below.

## Steps

1. Write the session label at create; task 08's refusal reads the same label.
2. `watch` takes an optional first session, so an adopted machine starts with its set non-empty and arms no timer.
3. A disposable leftover with no session label was made before this task; treat it as today (watched with the delay) so nothing made earlier is kept forever.
4. Adoption reads `sessionKept` at startup as it is, and a session the store forgets or prunes later lets its machine go through `leaveForgotten`; the port's `leave` for a session not in the machine's set does nothing, so a session that already left is harmless.

## Validation

- Two hosts over one fake Docker: host B starting neither removes host A's live disposable machine nor writes an up-time record for it. Today it arms a removal and the fake sees `rm`, so the case fails.
- A kept session's machine survives a restart without the session being resumed, and goes `disposableDelay` after the session is disposed.
- `PluginHost.sessionKept` answers `true` for a stored session, `false` for an unknown one and `false` with no store.
- An adopted leftover whose session is then pruned by a full listing is removed `disposableDelay` later; today it stays up.
- A forgotten session whose machine was adopted but never entered in this process lets it go the same way.

## Resume
