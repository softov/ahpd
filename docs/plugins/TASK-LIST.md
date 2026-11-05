# The task list

`@ahpd/tasks` keeps one list of tasks and plans on the host, for every agent and every person. A task is a record of the `tasks` collection and a plan is a record of `plans`, so the list survives a restart and is read by whoever opens it. Every session is offered the same host tools, so a Claude, a pi and a cofold session work the same list - [How the tools reach a session](#how-the-tools-reach-a-session).

Everyone sees every task and may change every one, for now. The stamps say who did what, and a later version may narrow that.

## The task

| Field | What it is |
| --- | --- |
| `id` | `t<n>`, counted up in the collection. The host mints it |
| `title` | What the task is, in one line |
| `status` | Where it is: `todo`, `doing`, `blocked`, `review`, `done` or `dropped` |
| `priority` | How urgent it is: `high`, `medium` or `low`. `medium` where absent |
| `labels` | Words a client groups tasks by |
| `topic` | What the task is about, where one word says it |
| `plan` | The plan it belongs to, by plan id. Absent for a task in the flat list |
| `bot` | The bot it belongs to, by slug |
| `folder` | The folder it was made in, as text |
| `session` | The session it was made in, as text, so removing the session leaves a valid task |
| `blockedBy` | Task ids that must be `done` before this one is ready |
| `active` | What is being done right now, in one line, while the status is `doing` |
| `note` | One line about where the task stands |
| `refs` | Links and references the task needs |
| `source` | On a translated task only: `{ tool, id }`, the tool that wrote it and the id it has in that harness |
| `body` | The long text of the task, in Markdown. It is the record's body |

`todo` is where a task starts. A task moves by `task_set`, and the host stamps the move.

## The plan

| Field | What it is |
| --- | --- |
| `id` | `p<n>`, counted up in the collection. The host mints it |
| `scope` | Where it belongs: `{"kind":"folder","folder":"/srv/work"}`, `{"kind":"bot","bot":"pilot"}` or `{"kind":"session","session":"one"}` |
| `title` | What the plan is, in one line |
| `goal` | What the plan is for, in Markdown. It is the record's body |
| `status` | `draft`, `active`, `done` or `dropped` |
| `refs` | Links and references the plan needs |

A plan starts as a `draft`. A task names its plan and a plan does not list its tasks: `plan_show` finds them.

## A harness's own list

A Claude or ACP session may also write the session's plan from the list its harness keeps. The backend is the only thing that sees the harness's calls, so it hands the host the whole list or one change to it, the host raises `plan_update`, and this plugin writes it. No task tool takes part.

The plan is the session's: its scope is `{"kind":"session","session":"one"}`, it is called by the session's title, and `Session one` until the session has one, when a later list renames it. The goal stays empty, because a harness's list says nothing about what the plan is for. Every turn of the session writes the same plan, so the list survives the turn that sent it.

A whole list matches each entry to a task of the plan by its text, taking the first task with that text no earlier entry took. An entry that matches none is a new task, `todo`, with `source` naming the tool and no id, because a whole list names no id. A step the list no longer holds is `dropped` rather than removed, so the record stays as the history of what the harness asked for. A list cleared after every step was `done` drops nothing: that is a harness tidying up, not a plan nobody wants.

The four harness statuses map as `pending` to `todo`, `in_progress` to `doing`, `completed` to `done` and `deleted` to `dropped`. A priority is the same `high`, `medium` or `low` a host task has, and an entry that names none leaves the task at `medium`. A translated task keeps `source`, the tool that wrote it and the id the harness gave it where there is one.

A single change names the task by the harness's id, in `change.id`, and finds the task whose `source.id` is that. A change to a task the plan does not hold needs the text it carries to add one; a change with no text is refused. A change with no status leaves the status where it is, and a task it adds starts `todo`.

A Claude session writes a whole list with `TodoWrite`, and one change with `TaskCreate` or `TaskUpdate`, when it keeps its own tools (`hostTasks: false`). An ACP session writes a whole list with each `plan` update, which is the road a `codex-acp` session takes.

## What a client sees

The list reaches a client on three surfaces, and all three are views of the same records: nothing a client reads is written anywhere else.

### The Plan call

A turn shows one Plan call, drawn by the host from the session's plan: the plan whose scope is `{"kind":"session","session":"one"}`, plus the tasks whose `session` field names it. The call's content is one line per task, `- [x] <title>` for `done` and `- [ ] <title>` for every other status. The host opens the call on the first change to the plan in the turn, rewrites its content on each later change, and completes it as the turn ends.

When no plugin gives the host lines, a backend draws its own call as it did before. When one does, the host tells the backend with `Start.plan`, so an ACP bridge draws no Plan call of its own and a Claude session writes no `TodoWrite` row: one turn, one call.

### The open count

A session's `_meta` carries `ahpd.tasks`, the number of its open tasks:

```json
{ "ahpd.tasks": { "open": 2 } }
```

A session's tasks are the tasks of its plan and the tasks whose `session` names it. Every status but `done` and `dropped` counts, so a task that is `blocked` or in `review` is open. A session no task names has no key. When a count moves the host sends `session/metaChanged` with the whole `_meta` map, and the session's row moves with it.

### The plan channel

One plan is one channel URI, `x-ahpd-plans://<plan id>`. A client subscribes to a plan and is answered with the plan and the tasks that name it; after that each change is one action.

The state is `{ plan: PlanRecord, tasks: TaskRecord[] }`, the records above as the store holds them. Four actions follow it:

| Action | When the client gets it |
| --- | --- |
| `{ type: 'x-ahpd-plans/taskAdded', task: TaskRecord }` | A task of the plan was made, or a task moved to the plan |
| `{ type: 'x-ahpd-plans/taskSet', task: TaskRecord }` | A task of the plan changed |
| `{ type: 'x-ahpd-plans/taskRemoved', taskId: string }` | A task left the plan, and `taskId` is the one it had |
| `{ type: 'x-ahpd-plans/set', plan: PlanRecord }` | The plan itself changed |

A subscribe needs `session:read`, which every built-in role holds. A client cannot dispatch an action to the channel: the records are the only writer, so a change made through a tool, a translation or a hand edit is the one the channel sends.

A subscribe to a URI under the scheme with no plan behind it is refused with `-32001` and `Resource not found: <uri>`, as VS Code's host refuses a subscribe it has no state for. A task is published to the plan it now names. A task that leaves a plan, for another plan or for none, is `taskRemoved` on the plan it left and `taskAdded` on the one it joined, as a chat that moves between sessions is removed from one catalog and added to the other. A removal says the id the task had: the sweep removes a finished plan's tasks this way, and the channel the removal goes to is the one the task was last seen on.

The channel is an `x-ahpd` extension and not part of the protocol yet. [The proposal](../../.project/proposals/agent-host-protocol-plan-channel.md) is the text for filing it upstream.

## The stamps

A task has five stamps, each with `at`, `by` and `in`: when it was written, who the call was by, and the session it was made in.

| Stamp | When the host writes it |
| --- | --- |
| `created` | With `task_add`, once |
| `approved` | With `task_approve`, and again each time somebody approves it |
| `started` | At the first `doing`, and never again |
| `finished` | Once, at the first of `review`, `done` or `dropped` |
| `reviewed` | With `task_review`, and again on each review. It may carry a `verdict` of `approved` or `changes` |

A plan has four: `created`, `approved`, `finished` and `reviewed`. `finished` is stamped at the first move to `done` or `dropped`.

The host writes every stamp from the call: no tool takes a stamp as input, so a model cannot say when a task started or who approved it. `by` is the person behind the call, the session's owner where nobody is behind it, and `host` where the session has no owner either. `in` is the session the call was made in, as text.

## The tools

Each tool answers in one line per item, so a model reads a list in a turn rather than a tree of JSON. Tasks answer `id, status, priority, title` and plans answer `id, status, title`.

| Tool | Inputs | What it does |
| --- | --- | --- |
| `plan_create` | `title`, `goal`, `scope`, `refs` | Makes a plan, `draft`, with a `created` stamp |
| `plan_set` | `plan`, `title`, `status` | Changes a plan's title or status |
| `plan_show` | `plan` | Answers the plan and one line per task that names it |
| `plan_list` | `scope`, `status` | Lists plans, filtered |
| `task_add` | `title`, and any of `priority`, `labels`, `topic`, `plan`, `bot`, `folder`, `session`, `blockedBy`, `active`, `note`, `refs`, `body` | Makes a task, `todo`, with a `created` stamp. A new task is always `todo` |
| `task_set` | `task`, and any of the fields `task_add` takes, `status` among them | Changes the fields it names. Stamps `started` and `finished` at the first move to those statuses, and clears `active` when the task leaves `doing` |
| `task_list` | `status`, `approved`, `ready`, `by`, `since` | Lists tasks, filtered |
| `plan_approve` | `plan` | Stamps a plan `approved`. Needs `task:approve` |
| `task_approve` | `task` | Stamps a task `approved`. Needs `task:approve` |
| `task_review` | `task`, `verdict` | Stamps a task `reviewed`, with `approved` or `changes` where a verdict is given. Asks no grant |

`task_list` reads its filters against a whole task. `by` and `since` match any of the five stamps, so a task appears under the person who created it, approved it or touched its start, finish or review. `ready` is a `todo` task whose every `blockedBy` task is `done`, and, with approval on, one that has an `approved` stamp.

A tool refuses an input it cannot take in the words VS Code's server tools refuse theirs with, naming the tool, the field and what it must be: `Invalid task_set input: status must be todo, doing, blocked, review, done, or dropped.`, or `Invalid task_add input: plan must match the id of a known plan (see plan_list).` for an id no record holds.

## The task record

Each task is a file of the host's record store, its fields as YAML frontmatter and its `body` as the Markdown below. A plan is kept the same way, with `goal` as the body.

```md
---
id: t1
title: Read the plan
status: doing
priority: high
labels:
  - docs
topic: tasks
plan: p1
bot: pilot
folder: /srv/work
session: ahp-session:/one
blockedBy: []
refs: []
active: Reading the plan
created:
  at: 2026-10-18T10:00:00.000Z
  by: ana
  in: ahp-session:/one
approved:
  at: 2026-10-18T10:01:00.000Z
  by: bob
  in: ahp-session:/two
started:
  at: 2026-10-18T10:02:00.000Z
  by: ana
  in: ahp-session:/one
---

The long text of the task.
```

A record that is not a task - a field of the wrong type, an id that is not `t<n>`, a status or a priority that is not one of those above - is reported and left out of the list.

## The approve grant

`plan_approve` and `task_approve` ask the person behind the call for `task:approve`. A role of that one grant is the smallest way to let somebody approve:

```json
{
  "roles": {
    "approver": ["task:approve"]
  },
  "users": [
    { "id": "ana", "roles": ["approver"], "token": "sha256:…" }
  ]
}
```

A host with no user directory has nobody to ask, and its tools act as they always did. Under one, a turn nobody sent - a host's own, or one reached after its turn ended - holds no grant and cannot approve. `task_review` asks for none, so a session may review without holding the approve grant.

## The settings

```json
{
  "plugins": [
    { "name": "@ahpd/tasks", "options": { "requireApproval": true, "sweepAfterDays": 30 } }
  ]
}
```

| Option | Default | What it does |
| --- | --- | --- |
| `requireApproval` | `false` | Whether `task_set` refuses to move a task to `doing` until it has an `approved` stamp. `ready` in `task_list` also asks for one |
| `sweepAfterDays` | absent | How many days a `done` or `dropped` plan is kept, with the tasks that name it. Absent keeps it forever, which is the default |

The sweep looks once when the plugin is applied and then every hour. It removes a finished plan and every task that names it, once the newest stamp among them is older than the setting. A plan that is `draft` or `active` never goes. A pass that fails is written to the daemon's log, and the next hour's pass looks again.

## How the tools reach a session

The plugin registers each tool with `host.registerTool`, and the host folds it into the tools every session is offered. A harness needs no change: pi gets the tool as a pi tool and cofold as a host tool, and both call the same `run` on the same list.
