# Automations

An **automation** is one instruction this host carries out with nobody watching: a trigger says when, and a **run** is a session whose first message is what the automation wrote. A run may be a session of its own, or one more turn in the chat a pinned automation keeps.

Automations live on a catalogue of their own, `ahp-automations://`. A client subscribes to it, writes definitions into it, and watches each run on the run's own channel.

A client that wants only its own automations subscribes to `ahp-automations://?owner=me`. The snapshot keeps the entries whose `_meta['ahpd.owner']` is that connection's principal: `user:<id>` for a person, `plugin:<name>` for a plugin. A connection with no principal owns nothing, and the filter answers no entries. Any other value is refused with `-32602`, the way a wrong param is. An action about one automation reaches a filtered subscription only when that automation is the subscriber's own. A removal carries an id and no entry, so it reaches every filtered subscription.

Terms, one line each:

| Term | |
| --- | --- |
| an automation | A definition: the message a run is given, the shape of its session, and the triggers that wake it |
| a trigger | When it runs: a `schedule`, an `event` of a type this host or a plugin offers, or nothing at all, which is manual only |
| a run | One execution, with a lifecycle and the sessions it started |
| the overlap | What happens to an event that arrives while a run of the same automation is going |
| pinned | An automation that keeps one chat and adds each run to it as the next turn |
| the owner | Whose work the automation is, as `user:<id>`, `team:<id>`, `project:<id>` or `root:<host>` |

## The three kinds of trigger

A trigger has an `id`, a `kind`, a `type`, a `title`, and either `events` or a `schedule`.

`schedule` is the protocol's own and is not listed by this host: a client may always write one, and the store that fires it is what decides whether it means anything. Its `schedule.expression` is a five-field AHP cron expression - minute, hour, day of month, month, day of week - that accepts a list, a `from-to` range and a `/step` in each field, and the month and weekday names (`jan`, `mon`). `7` and `0` are both Sunday. When both day fields are restricted an occurrence matches if **either** does, which is cron's own rule and the one thing about it that is easy to get backwards; when one is `*` the other simply applies. Its `schedule.timeZone` is an `Intl` zone name and defaults to `UTC`. `misfirePolicy` is `runOnce`, the default, or `skip`: with `runOnce` an occurrence missed while the daemon was down is caught up once however many went by, so a machine off for a week comes back to one run and not two hundred.

`event` is the half this page is about, and it comes in three flavours:

| `type` | What it is |
| --- | --- |
| `session` | One of the eight things a session does, with a count, a follow-up or a state check around it |
| `watch` | One of five patterns somebody already thought about, with its numbers left to you |
| a plugin's | A type a plugin registered, with its own events and its own config schema |

`listAutomationTriggerDefinitions` answers with every event type this host fires - the two above, and each plugin's beside them - and nothing for a schedule, which needs no form. Manual is not a trigger at all: an empty trigger list is what the protocol says manual-only means.

A trigger this host cannot read is a trigger it does not fire. A `session` trigger naming an event the type does not offer, a `watch` trigger naming a preset that does not exist, and an event trigger whose config has a key the schema does not name are each refused when the automation is saved, with the key or the id named.

A trigger of a plugin's own type is held to its `configSchema` when the automation is saved: a key the schema does not name, a value of the wrong kind, and an event id the type does not offer are each refused. A field the schema marks `x-ahpd-connector` names a stored connector of the adapter the mark names: the host refuses the save when it serves no such connector with that id, and when the connector belongs to neither the automation's owner nor the host. A fire compares the connector's owner again, so one person's automation never reads another person's calls. A trigger whose config fails its type's schema does not fire either, so an automation saved before the type was loaded, or against a type this store never saw, is not a catch-all.

## What a session does

| Event | Fires when |
| --- | --- |
| `turnCompleted` | The last turn of the session ended well |
| `turnFailed` | The last turn of the session ended with an error |
| `turnCancelled` | Somebody stopped the last turn |
| `toolCalled` | A tool call in the session finished |
| `toolFailed` | A tool call in the session failed |
| `messageQueued` | A message waits behind the turn that is running |
| `idle` | The last turn ended with nothing waiting behind it |
| `childFinished` | A session or worker chat this one started went quiet |

Every event also carries the session it happened in, its owner, its provider, its project, the folders it works in and whether a run of an automation made it - which is what a rule's `filter` names.

`childFinished` is about the sessions a `create` tool call starts: the child going quiet says it, which is its last turn ending with nothing queued behind it; every later turn that goes quiet says it again; and the child being disposed of says it too. A worker chat a session opened says it when its turn ends.

## The rule around the event

A `session` trigger picks its event in `events`, and its `config` holds four optional parts. Every one of them left out is a rule that fires on the event itself, in any session.

| Key | What it says |
| --- | --- |
| `filter` | Which sessions this rule looks at: `sessions`, `providers`, `owners`, `projects`, `folders`, `automated`. A folder matches when it is one of the session's own. Left out, every session is looked at |
| `count` | How many times the event has to happen: `n`, and whether they have to arrive `consecutive`, with `sameInput`, or inside a `within` |
| `then` | What has to follow: `{ "kind": "event", "event": "id", "within": "5m" }` for another event, `{ "kind": "idle", "for": "3m" }` for quiet, `{ "kind": "absent", "event": "id", "for": "3m" }` for an event that does not come |
| `when` | What the session has to look like as the event arrives: `running`, `queuedAtLeast`, `toolCallsAtLeast`, `turnLongerThan` |

A duration is written `30s`, `5m` or `2h`. A key the rule does not have is refused with the key named, and so is a value of the wrong kind, when the automation is saved.

```json
{
  "title": "Fix the failing tests",
  "enabled": true,
  "message": { "text": "{{event}} in {{sessionTitle}}: look at it." },
  "session": { "provider": "claude", "workingDirectories": ["file:///work/api"] },
  "triggers": [{
    "id": "t1",
    "kind": "event",
    "type": "session",
    "title": "Failing tests",
    "events": [{ "id": "toolFailed" }],
    "config": {
      "count": { "n": 3, "consecutive": true, "within": "5m" },
      "when": { "running": true },
      "filter": { "projects": ["api"] }
    }
  }]
}
```

That one is a count and a state check together: three tool calls failing one after another inside five minutes, while the turn is still running, in a session of the `api` project.

A follow-up is a rule that waits for a second thing after the first: `"then": { "kind": "event", "event": "turnCompleted", "within": "10m" }` fires on a failure that was followed by a turn finishing within ten minutes, and fires on nothing at all if that turn never comes. An absence is the other way round: `"then": { "kind": "absent", "event": "toolCalled", "for": "5m" }` fires on a failure that five minutes passed without a tool call after, and `"then": { "kind": "idle", "for": "3m" }` waits for the session to be quiet for three minutes instead.

A turn that works without saying anything emits no event, so a rule about a turn that has gone quiet is **timed** rather than fired. The host tells the engine when each turn starts and every time the session does anything, and the engine arms a timer that matches once the turn has been quiet the rule's length. `when.turnLongerThan` is read the same way, against the turn running as the event arrives. A rule that watches a turn ending, with no count and no follow-up, is fired by that timer alone.

## The presets

A `watch` trigger names one of these in `events` and its numbers in `config`. Each is the `session` rule above, written out, so the host treats it as one.

| Preset | Watches for | Number, and what it starts as |
| --- | --- | --- |
| `looks-stuck` | The same tool called with the same input several times | `times`, 3 |
| `failing-tools` | Tool calls failing one after another | `times`, 3 |
| `long-silent-turn` | A turn still running with nothing happening for a while | `minutes`, 10 |
| `idle-after-failure` | A turn failed and the session went quiet after it | `minutes`, 3 |
| `waiting-while-busy` | A message queued behind a turn that has already run several tool calls | `toolCalls`, 3 |

A preset also takes the same `filter` the rule does, so one can be narrowed to a folder, a project or a provider. `long-silent-turn` is the one with no event behind it: its rule is about a turn that is still running, so the host times it, and the timer starts again on every tool call, tool result or message chunk in that turn - it fires only after that many minutes of nothing happening at all. Every preset's numbers count something, so the least any of them may be is one.

## Runs

A run is started by a schedule, by an event, or by a person pressing Run, and all three go through the same door, because what an automation says about running twice is about the automation rather than about what asked. Starting a run and a person pressing Run both begin the first turn in `beginAutomation`.

The store records the run before the session exists, marks it `running` when the session is asked for, and the host settles it when its sessions stop, not when it starts. Its lifecycle is `pending`, then `running`, then one of `completed`, `failed` or `cancelled`, and a `failed` one carries the error. A run that could not start at all is `failed` with no `startedAt`, because no execution began.

An automation's entry carries its runs newest first, twenty at a time, with `runsNextCursor` when there are more: `fetchAutomationRuns` grows the page in view and every subscriber reads the longer list off the same `automation/set`, because the protocol's answer to that command is empty. `operations` is always `update`, `remove` and `run`: `enabled` governs the schedule only, so a person can run a switched-off automation by hand.

## One chat, or a session each run

By default every run makes a session of its own. The automation's `_meta.ahpd.session` set to `pinned` changes that: it keeps one session and adds each run as the next turn in the chat that session holds, so a run sees the ones before it. The host writes that session's URI to `_meta.ahpd.pinnedSession` - it is the host's own note, and a client writing one has it dropped - and a run whose session is gone makes a new one and keeps it there. The session's folder, worktree and machine stay between runs, and its context grows until the backend compacts it. A pinned session that is asleep is woken in place for the run, and no new session is made - [SESSIONS.md](SESSIONS.md#sleep-and-wake).

A pinned automation also types into a chat somebody else may be using, so a turn running there is a turn already going, whoever started it: an event arriving then is answered by `overlap` like any other, and a run pressed by hand is refused while that turn runs. A pinned run into a chat that belongs to somebody else is refused as well - it is the one road into a session that does not go through `createSession`, and it must not be a way to type in another person's session as though the work were theirs.

```json
{ "_meta": { "ahpd": { "session": "pinned", "pinnedSession": "ahp-session://claude/local/..." } } }
```


## What an event does while a run is going

An event can arrive while the automation's own last run is still going, and `_meta.ahpd.overlap` says what happens to it. Left out, it is `queue`.

| Mode | What happens |
| --- | --- |
| `queue` | One run waits, and later events fold into it: the run that finally starts is told how many there were |
| `steer` | The event goes into the running turn as a message. With no turn running it becomes a `queue` |
| `parallel` | A run starts for every event |
| `skip` | The event is dropped, and counted on the run it arrived during |

A pinned automation refuses `parallel` when it is saved, because it has one chat and two turns in it at once is not a thing. A scheduled automation answers to this setting exactly as an event does. A run somebody presses by hand is not held behind one that is going - what the press is answered with is the run it started - with one exception: a press on a pinned automation is refused while its chat has a turn running, because that chat takes one turn at a time. Decision: An automation says what an event does while it runs.

An event dropped by `skip` is dropped before anything is counted, so it is not one of the twenty an hour either; the one counted on the run is noted as `ahpd.dropped` in the run's `_meta`, which is how the agent working in that turn, and anybody watching the run, learns what happened while it worked.

## What the run is told

The agent reads its message and nothing else, so the event that woke it arrives there, twice over: filled into the text where the automation asked for it, and stated at the end whether it did or not.

| Placeholder | What it becomes |
| --- | --- |
| `{{trigger}}` | The trigger's own title, as the automation wrote it |
| `{{event}}` | The event's title, as the type that offers it names it |
| `{{session}}` | The session's URI, where the event was about one |
| `{{sessionTitle}}` | That session's title, where this host has one to give |
| `{{count}}` | How many events the rule counted |
| `{{at}}` | When the event happened, ISO 8601 |
| `{{event.<field>}}` | One top-level field of a plugin event's data: a string as it is, any other value as JSON |

A name that is not in this table is left exactly as it was written, and a placeholder for something an event does not carry is filled with nothing rather than left in the message. A plugin's event names no session, because it may have none to name. A session event has no data, so `{{event.<field>}}` is filled with nothing there.

The summary block goes after whatever the automation wrote:

```
Examining the failing tests.

What woke this run: A tool call failed
Session: Fix the parser (ahp-session://claude/local/9f2c...)
Count: 3
At: 2026-10-07T14:22:05.118Z
```


## The owner

An automation may name an owner in `_meta['ahpd.owner']`, and a run is that owner's work whatever started it - a run a colleague pressed is still the maker's, because the thing that runs at nine is the thing somebody wrote. The owner travels with the run and is what the gates are asked about:

- A run acts as its owner. A session with a `computer` in its config needs the owner's `computer:write`, the same grant a client's `createSession` needs.
- An owner this process has never seen sign in cannot be checked at all, so the run waits for them rather than going unchecked: it is refused with a line saying they have to sign in once first.
- A `user:` owner who may not `session:read` is refused, when the run is pinned into a chat the host cannot show them.

An automation that names no owner is the host's own work and has nobody to be. See [Configuration](#configuration) for how far it may see.

## What stops a wake

- A rule only sees sessions its owner may `session:read`, and an owner this host has not met sees none. An automation that names no owner sees every session, unless the daemon was started with `unownedAutomations: "none"` - and an event a plugin fires is held to that same answer, whether or not it names a session.
- A run's own sessions never wake the automation that made them, so an automation cannot feed itself.
- An automation runs at most 20 times an hour. Past that an event is dropped and logged with the count, and the next one inside the hour is dropped too. Switching the automation off and on again does not start the hour over, and an event its own overlap mode dropped is not one of the twenty. A clock is not counted: a schedule's own cadence is the bound on it.
- Counts, timers and the hourly count live in memory and start again when the daemon restarts, so a wake that was halfway through is missed once. What somebody wrote down survives: with `automations: "file"` the definitions come back on a restart, and so does the occurrence each was waiting for.

## Configuration

| Key | Values | Default | What changes |
| --- | --- | --- | --- |
| `automations` | `file` or `memory` | `file` | `file` keeps each definition as a file of its own, [under `automations/` beside the configuration](#where-an-automation-is-kept), and fires their schedules, which is the mode a daemon wants: being running at nine in the morning is the only way a schedule fires with nobody connected. `memory` holds them until the process ends and fires nothing - a client may still write, patch, list and run one, and what it will not get is a `nextRunAt` |
| `unownedAutomations` | `every` or `none` | `every` | What an automation that names no owner wakes on |

Run history is in memory either way, in both modes: a run names the sessions it started, and those are this daemon's. Both stores are the same `AutomationStore`, so the host is not told which it was given.

## Where an automation is kept

With `automations: "file"`, the default, an automation is one Markdown file in `<configDir>/automations`, named after the id it has on the catalogue: `ahp-automation:/nightly-review` is `nightly-review.md`. It is the same shape as a record a plugin keeps, held the same way - YAML frontmatter and a Markdown body, written whole at mode 0600 in a folder made at 0700 - and the body is the message a run is given, which is the long text and so the part a person came to the file to read:

```markdown
---
title: Nightly review
enabled: true
session:
  provider: claude
triggers:
  - id: t1
    kind: schedule
    title: Every morning at nine
    schedule:
      expression: 0 9 * * *
      timeZone: Europe/Berlin
---

Review what changed in the repository today and open a pull request for anything that needs one.
```

The file name is the id, not a field in the frontmatter, and the id is lowercase letters, digits and dashes, one to sixty-four of them, starting with a letter or a digit - a rule of its own rather than a bot's slug, because a client may name an automation with a UUID - so an id that could not name a file is refused where the automation is written rather than kept somewhere unexpected. A copy under a new name is a new automation: `cp nightly-review.md monday-review.md` installs a second one, which this host picks up at once, with a run history that starts empty.

What a run changes is not in the file. The count against an `afterRuns` allowance, the occurrence it is waiting for, and when it last moved are in `<configDir>/automations-state.json`, so a run never rewrites a file somebody is editing. The file holds what a person wrote: the definition, the owner, and when the automation was made.

A daemon that is running reads a file the moment it changes - added, edited or removed - and follows it at once: the schedule is armed again, the state file is written, and every client subscribed to `ahp-automations://` is told, exactly as if the change had come over the protocol. A file this host will not run, because its frontmatter cannot be read or its definition is one the host refuses, is reported to the log and skipped, with the definition the daemon already had left in place.

A daemon started over the `automations.json` an earlier version wrote converts it once: one file per automation, the run state into the state file, and the original left beside it as `automations.json.migrated`. A folder that already holds an automation is left as it is, file and all.

## Commands

Automations are driven over the protocol, and over the HTTP API where the daemon serves one. `ahpd automation export` and `import` move one out and in as [ahpd's own file](#automation-files), or as [VS Code's file](#vs-code-automation-files) with `--vscode`.

`ahpd automation list` shows one row per automation: the id that export takes, the name, the folder, the schedule and whether it is on. `--json` gives the same rows, and over HTTP it is `GET /api/automation/list`.

```text
0b6f1c1e-4d8e-4d8a-9a43-6a3f4c2b9e10  Review yesterday's commits  /home/softov/ahpd  0 9 * * * America/Campo_Grande  on
```

| Command | What it does |
| --- | --- |
| `listAutomationTriggerDefinitions` | Every event trigger type this host fires: `session`, `watch`, and each plugin's |
| `runAutomation` | Start one now, as the automation's owner, and answer with the run's URI. Refused when there is no such automation. A switched-off automation runs, and the run does not count against an `afterRuns` cap |
| `fetchAutomationRuns` | Bring one more page of an automation's runs into view. An unrecognised cursor is refused rather than guessed at |
| `automation/createRequested` | Write one into the catalogue |
| `automation/updateRequested` | Patch one - absent keys are left alone, so two clients editing different fields do not revert each other |
| `automation/removed` | Take one out |
| `automationRun/cancelRequested` | Stop a run: the turns of its sessions stop, and the run settles `cancelled` once none is going. Answered to the client that asked; refused for a run that is unknown or already over |

The `automation/*` and `automationRun/*` rows, with their origins, are [AHP.md](AHP.md#automation--4-of-4-).

## Automation files

`ahpd automation export` writes an automation as the file [this host keeps it in](#where-an-automation-is-kept), without the owner, the time it was made and the id. Every trigger, zone and setting is in it, so it moves to another ahpd host as it is.

```bash
ahpd automation export nightly-review
ahpd automation export nightly-review --out nightly-review.automation.md
```

```markdown
---
title: Nightly review
enabled: true
session:
  provider: claude
  workingDirectories:
    - file:///home/softov/ahpd
triggers:
  - id: t1
    kind: schedule
    title: Every ten past
    schedule:
      expression: 10 * * * *
      timeZone: America/Campo_Grande
    misfirePolicy: skip
---

Review what changed in the repository today.
```

The id is the automation's id in this host's store, bare or as `ahp-automation:/<id>`. The file name is made from the title, as VS Code makes it. The note of the chat a pinned automation keeps is left out, because that chat is on this host.

`ahpd automation import` makes an automation from that file:

```bash
ahpd automation import nightly-review.automation.md
ahpd automation import nightly-review.automation.md --folder ~/src/ahpd
```

The automation is new and switched off: it has an id of its own, and a second import of the same file is a second automation. Without `--folder` it runs in the folders the file names, and each one must be a folder this host serves, or one under it. `--folder` replaces them. A file VS Code wrote is refused with "This is a VS Code automation file. Add --vscode."

Over HTTP, export is `GET /api/automation/export/{id}`, which answers the id, the file name and the text, and import is `POST /api/automation/import`, with the file's text as the body's `text`. There is no `--out`; the caller writes the file.

## VS Code automation files

VS Code shares an automation as one `.automation.md` file: YAML frontmatter with a name and a schedule, and the prompt as the body. `ahpd automation export --vscode` writes one in that format exactly, so it opens in VS Code.

```bash
ahpd automation export 0b6f1c1e-4d8e-4d8a-9a43-6a3f4c2b9e10 --vscode
ahpd automation export 0b6f1c1e-4d8e-4d8a-9a43-6a3f4c2b9e10 --vscode --out review-yesterday-s-commits.automation.md
```

```markdown
---
version: 1
id: "review-yesterday-s-commits"
name: "Review yesterday's commits"
schedule:
  kind: cron
  expression: "0 9 * * *"
  timeZone: local
---

Review the commits made to this repository since yesterday morning.
```

The id is the automation's id in this host's store, bare or as `ahp-automation:/<id>`. The file's `id` and its file name are made from the title, as VS Code makes them. The file holds the title, the message and the schedule, and nothing else: no folder, no provider, no owner, and not whether it is on, because VS Code refuses a file with any key it does not know.

The file holds a schedule VS Code's editor can show, so export refuses an automation it cannot hold and says what:

| The automation has | Why it is refused |
| --- | --- |
| An event or webhook trigger | The file holds only a schedule |
| More than one schedule | The file holds one |
| A cron other than `M H * * *`, `M H * * 1-5` or `M H * * D` | The file holds daily, weekday and weekly schedules |
| `M * * * *` with `M` other than 0 | The file runs hourly on the hour |
| `misfirePolicy: skip` | VS Code always catches a missed run up |

An automation with no schedule is written as `kind: manual`. Export keeps the hour and drops the zone: the file says `timeZone: local`, which is the zone of whoever imports it.

Over HTTP it is `GET /api/automation/export/{id}?vscode=true`.

`ahpd automation import --vscode` makes an automation from a file VS Code wrote, or from one `export --vscode` wrote:

```bash
ahpd automation import review-yesterday-s-commits.automation.md --vscode --folder ~/src/ahpd
```

The automation is new and switched off, as VS Code's import makes it: it has an id of its own, a second import of the same file is a second automation, and it runs on its schedule only once it is turned on. Its title is the file's `name` and its message is the body. The file's `id` and `description` are not kept.

`--folder` is the folder it runs in, and it is required, because the file names none. It must be a folder this host serves, or one under it. No provider is set, so a run uses this host's default.

The schedule is read as VS Code reads it, in this host's zone:

| The file says | The automation runs on |
| --- | --- |
| `kind: manual` | No trigger. It runs when somebody presses Run |
| `kind: hourly` | `0 * * * *` |
| `kind: cron` | The file's `expression` |

A file VS Code would refuse is refused with VS Code's sentence: an unknown `version`, a key it does not know, a cron its editor cannot show, or a `timeZone` other than `local`.

Over HTTP it is `POST /api/automation/import`, with the file's text as the body's `text`, `vscode` as `true`, and the folder as `folder`, which must be absolute. A request names no path on the host, so it cannot read a file there.

## Grants

| What | Grant |
| --- | --- |
| List the catalogue, read a run, ask the trigger definitions, list the automations, export one | `automation:list` |
| Write, patch or remove an automation, import one | `automation:create`, `automation:update`, `automation:remove` |
| Press Run | `automation:run` |
| Ask to stop a run | `automation:cancel`, which is asked before the refusal |

`guest` holds `automation:read`, which is the `list` operation, so a guest sees what the automations are and may press none of them. `member` holds none of them. The read group is `list`; the write group is everything else.

## See also

| | |
| --- | --- |
| [AHP.md](AHP.md#automation--4-of-4-) | The automation channel's actions, and the run channel's |
| [SESSIONS.md](SESSIONS.md) | What a run's session is |
| [HOST.md](HOST.md#configuration-keys) | The `automations` and `unownedAutomations` keys beside the rest |
| [PLUGINS.md](../plugins/PLUGINS.md) | Registering a trigger type |
| [USERS.md](USERS.md) | Roles and grants |
