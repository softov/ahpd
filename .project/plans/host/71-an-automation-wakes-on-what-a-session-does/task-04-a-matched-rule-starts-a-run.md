---
title: A matched rule starts a run that knows what woke it
status: todo
depends: [task-01-the-host-emits-session-events.md, task-02-the-rule-engine-matches-a-rule.md, task-03-the-host-lists-its-trigger-types.md]
layer: "sdk host"
refs:
  - "[code://packages/sdk/src/host/automations.ts#L233-L247](../../../../packages/sdk/src/host/automations.ts#L233-L247) - `due`"
---

## Objective

A match starts a run with `origin.kind: 'trigger'`, and its message has the placeholders filled and the summary block at its end.

## Files

- `UPDATE: packages/sdk/src/host/automations.ts` - add rules for enabled automations with event triggers, feed the stream, and start runs on a match.
- `CREATE: packages/sdk/src/wakemessage.ts` - the placeholders and the summary block.
- `CREATE: packages/sdk/test/automation-wake.test.ts` - the cases below.

## Steps

1. Add a rule for each enabled automation with an event trigger.
2. Remove the rule when a person disables, changes or removes the automation.
3. Give an event to a rule only when the automation's owner may `session:read` the event's session.
4. Drop an event whose session a run of the same automation made.
5. Start the run through `due` with `{ kind: 'trigger', triggerId, event }`.
6. Fill `{{session}}`, `{{sessionTitle}}`, `{{event}}`, `{{count}}`, `{{trigger}}` and `{{at}}` in the message.
7. Add the summary block after the message: the event title, the session title and URI, the count, the time.
8. Count the runs of the last hour, and drop a match past 20 with one log line.

## Validation

- `it('starts a run with a trigger origin when the rule matches')`
- `it('fills the placeholders and adds the summary block')`
- `it('ignores a session the owner may not read')`
- `it('is not woken by the sessions its own runs made')`
- `it('stops at 20 runs an hour and logs the drop')`
- `it('stops matching when the automation is disabled')`
- Run the full gates from the plan. All pass.

## Resume

