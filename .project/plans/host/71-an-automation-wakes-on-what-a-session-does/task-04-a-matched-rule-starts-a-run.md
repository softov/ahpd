---
title: A matched rule starts a run that knows what woke it
status: done
depends: [task-01-the-host-emits-session-events.md, task-02-the-rule-engine-matches-a-rule.md, task-03-the-host-lists-its-trigger-types.md]
layer: "sdk host"
refs:
  - "[code://packages/sdk/src/host/automations.ts#L1004-L1022](../../../../packages/sdk/src/host/automations.ts#L1004-L1022) - `due`"
---

## Objective

A match starts a run with `origin.kind: 'trigger'`, and its message has the placeholders filled and the summary block at its end.

## Files

- `UPDATE: packages/sdk/src/host/automations.ts` - add rules for enabled automations with event triggers, feed the stream, and start runs on a match.
- `UPDATE: packages/sdk/src/types/host.ts` - what an automation with no owner sees.
- `UPDATE: packages/server/src/config.ts` - the same key in the daemon's configuration file, beside `automations`.
- `UPDATE: packages/server/src/commands/options.ts` - the flag, spelled as the configuration key.
- `UPDATE: packages/server/src/commands/run.ts` - hand the answer to the host.
- `CREATE: packages/sdk/src/wakemessage.ts` - the placeholders and the summary block.
- `CREATE: packages/sdk/test/automation-wake.test.ts` - the cases below.

## Steps

1. Add a rule for each enabled automation with an event trigger.
2. Remove the rule when a person disables, changes or removes the automation.
3. Give an event to a rule only when the automation's owner may `session:read` its session. An owner this host has not met gets none.
4. Give an automation that names no owner every session, unless the host runs with `none`.
5. Drop an event whose session a run of the same automation made.
6. Start the run through `due` with `{ kind: 'trigger', triggerId, event }`.
7. Fill `{{session}}`, `{{sessionTitle}}`, `{{event}}`, `{{count}}`, `{{trigger}}` and `{{at}}` in the message.
8. Add the summary block after the message: the event title, the session title and URI, the count, the time.
9. Count the runs of the last hour, and drop a match past 20 with one log line.

## Validation

- `it('starts a run with a trigger origin when the rule matches')`
- `it('fills the placeholders and adds the summary block')`
- `it('ignores a session the owner may not read')`
- `it('ignores every session when the owner has not signed in')`
- `it('gives an automation with no owner every session, and none when the host says so')`
- `it('is not woken by the sessions its own runs made')`
- `it('stops at 20 runs an hour and logs the drop')`
- `it('does not spend one of the twenty on an event it dropped')`
- `it('counts the hour across a switch off and on again')`
- `it('stops matching when the automation is disabled')`
- Run the full gates from the plan. All pass.

## Resume

Built. `createAutomations` watches every enabled automation that carries an event trigger. `watchFor` reads the definition back from the store and turns its trigger into a `SessionRule` through `ruleOf`. That is the `session` type's config plus the chosen event, or the preset a `watch` trigger names. It adds that to one rule engine. `changed` re-reads on every store notification, so a disable, an edit and a removal all come to the same place. The runs already counted against the hourly cap are kept across an edit. They are kept across a switch off and on again as well, because what the cap counts is how often an automation starts. The map holding those runs is not the watch's to clear. An event an automation asked to be dropped while it was busy does not use a slot at all. A wake that started nothing is not one of the twenty.

A match goes through `woke`, which is where the facts an event does not carry are settled. Three of them are the owner's `session:read` (`maySee`), the loop guard (`origins.get(session)?.automation`) and the hourly cap of 20. Past that the wake is dropped with one log line. `woke` asks whether the host has closed first, the way `due` and a plugin's `fired` do. A rule that matches as the host is going starts nothing. The run then starts through the store's `run` with `{ kind: 'trigger', triggerId, event }`. The `start` callback is wrapped so `beginAutomation` gets the message `wakeMessage` fills, because the store keeps owning the template. Six placeholders are filled and a four-line summary block is appended.

`packages/sdk/src/wakemessage.ts` holds `WAKE_PLACEHOLDERS`, `WakeFacts` and `wakeMessage`. `packages/sdk/src/types/host.ts` gained `unownedAutomations?: 'every' | 'none'`, read beside `automations` in the daemon's config and on its command line. The two answer through `maySee` for an automation that names no owner.

Ten cases in `test/automation-wake.test.ts` pass. One was wrong when it was written, and the code was right to disagree. A triggered run's origin carries the *trigger's* id (`t1`), not the event's, which is what a schedule trigger's origin already carried.

