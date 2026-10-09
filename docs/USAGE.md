# Usage

**Usage** is what this host writes down about the work it did, and what a **pool** has been charged for it. A record is written once and never edited, and it is read back through a scheme of its own - `usage:` - rather than a command, so a client uses the resource calls it already has. What it is not is an enforcement: nothing here refuses anything, and the rows that decide who may use which agent, model and computer are [POLICY.md](POLICY.md).

Terms, one line each:

| Term | |
| --- | --- |
| a usage record | One thing that was spent - a model call, or a stretch of computer time |
| a pool | The name a record is charged to: a person, a team or a project |
| the owner | Who the work belongs to, as a typed reference - `user:<id>`, `team:<name>`, `project:<team>:<project>` or `root:<host>` |
| the store | Where the records are kept and what a pool has been charged |
| the charged cost | What the pools are charged, in US dollars |
| the provider's cost | What the provider or the harness reported, kept beside the charged one |
| the split | A cost reported in two parts, what the tokens sent cost and what the tokens received cost |

## What a record is

Two kinds share one base and one port. A **model call** is `kind: 'model'`, written by the proxy for a call through `/v1` (`source: 'proxy'`) or by the agent meter for a turn a session's own harness ran (`source: 'agent'`). **Computer time** is `kind: 'computer'`, a stretch a machine was up, written against the machine's owner - decision [Model use and computer time are two record types behind one usage port](../.project/decisions/usage-and-computer-time-are-two-records-behind-one-port.md).

Every record carries when it happened, what wrote it, who it belongs to and where it ran: the owner, the team and the project it is charged under, the session, the chat and the turn, the agent provider, and the computer when there was one. The base is the same for both kinds, so a listing by agent or by computer is a filter and never a join.

A model record carries the model's `<maker>/<name>`, the provider it ran on, and the tokens in three parts: `input`, `output`, and `cache` split into what was read from and written to the provider's cache. A pool's `tokens` is all three added together, because those are the tokens that were billed, and the three counts are kept apart as well so a report can say what was sent and what came back.

### The two costs

`cost` is what the pools are charged and `providerCost` is what the provider or the harness reported, and they are two fields because they are two different things - decision [A record keeps the provider's cost beside the cost it charges, and a configured price is what it charges](../.project/decisions/a-record-keeps-the-providers-cost-beside-the-charged-one.md). A cost carries `from`, which says which of the two worked it out: `price` when this host computed it from a price list, `harness` when the agent or the provider reported it.

A call the proxy priced is charged that price and keeps the provider's figure beside it. An agent's harness calls its model itself, so the figure it reported is both what the pools are charged and what the provider reported - decision [A record keeps the provider's cost beside the cost it charges](../.project/decisions/a-record-keeps-the-providers-cost-beside-the-charged-one.md). A cost of `0` on a turn that counted no token is a harness saying it spent nothing, which is no cost at all: it is left off rather than written as `0`, because a record of `0` there would charge a pool for a call that never happened.

A harness that priced what was sent and what was received apart says so beside the amount, and those two parts are the **split**. They are kept as `input` and `output` on the cost, and a pool's `inputUsd` and `outputUsd` add them over the records that have them - a measure nothing was charged in is absent rather than zero, so a total over records that never split says nothing about the split rather than saying it was nothing.

## Pools

A record names the pools it is charged to, and `pools` on the record is the whole of it: the owner, `team:<name>`, and `project:<team>:<project>`. Each is named only when the record has it, so work with no owner and no scope is charged to no pool rather than to one whose name says nothing - decision [Usage is charged to the owner's, the team's and the project's pool](../.project/decisions/agent-usage-is-charged-to-owner-team-and-project-pools.md). The name is opaque to the store; what a pool means belongs to the policy plan.

The store keeps a **live total** per pool per day, rebuilt when it starts up, because a limit is checked before a call and debited as usage arrives - an answer read off the month's file would be a total from before the last few seconds. A day is the granularity, which is exact for the ranges a limit asks about and counts a partly covered day whole - decision [The usage store answers a pool's live total, not only appends](../.project/decisions/the-usage-store-answers-live-totals.md).

## What a pool reads

Through the `usage:` scheme, one leaf under the pool - decision [Usage is read through a usage resource scheme, totals and records, and a person reads their own pools without a grant](../.project/decisions/usage-is-read-through-a-usage-scheme.md).

| URI | What it answers |
| --- | --- |
| `usage://` | The pools this reader may see, as directory entries: every pool a record was charged to for a reader holding `usage:read`, and their own pools otherwise |
| `usage://<pool>` | That pool as `{ pool, day, week, month }`, each a total |
| `usage://<pool>/day`, `/week`, `/month` | One of those periods on its own |
| `usage://<pool>/records?from=&until=` | The records charged to it, newest first, at most the newest 200 |

A pool name holds colons, so it is one encoded path segment: `usage://project%3Abackend%3Asearch` is the pool `project:backend:search` and not an authority called `project`. A record naming no instant is kept nowhere and said out loud, which is the only answer that is not a charge in the wrong place. A request for a leaf that is not one of the four is `-32008`.

The three periods are ranges in the configured zone rather than in UTC, so a week starts on the deployment's Monday 00:00 and not the evening before - see the `timezone` key below. `until` is always now, so the day behind the current hour is a partly covered one and is counted whole. The records a period's total summed are the records that period's `records` leaf lists, because both compare the range at the day.

## Configuration keys

Both keys are in the daemon's configuration file, under `usage`. Neither has a flag, because both are properties of a deployment rather than of one run.

| Key | Values | Default | What changes |
| --- | --- | --- | --- |
| `usage.per` | `turn` or `report` | `turn` | `turn` holds the running sum a harness reports and writes one record when the turn ends. `report` writes one record for every usage report, each holding what that report added since the one before it, so a long turn is billed while it is still running |
| `usage.timezone` | an IANA zone name, as `America/Sao_Paulo` | the system's own zone | The zone a day begins in and a week starts in. A week is Monday 00:00 there, not the system's own |

Both modes bill the same work, and a wrong value is refused by name at startup: `usage.per` must be one of `turn` or `report`, and a `timezone` this host cannot read is one line at start and the system's own zone - decision [The agent meter writes one record per turn, or one per report when configured](../.project/decisions/the-agent-meter-writes-per-turn-or-per-report.md).

Where the records are kept is not a key: the daemon writes them into a `usage` folder beside its own configuration, and a host built from the SDK is handed its own store. Everything else about the daemon's keys is [HOST.md](HOST.md#configuration-keys).

## Commands

Two, and both read through the `usage:` provider rather than holding a second copy of the rule about who may read what.

| Command | What it does |
| --- | --- |
| `ahpd usage` | Lists every pool a record was charged to that you may see |
| `ahpd usage <pool>` | Prints that pool's today, this week and this month, cut in `usage.timezone` |

Served over HTTP they are `GET /api/usage` and `GET /api/usage/<pool>`, and a pool that is not the caller's is `403` whichever transport asked. There is no write verb: a record is written by the meter that charges it, and nothing edits one.

## Grants

Reading a pool is `usage:get` on the `usage` subject, which like every scheme's carries the resource operations under its own name - `get`, `list`, `resolve`, `watch` in the read group - and `usage:read` is the group that holds all four ([RESOURCES.md](RESOURCES.md#grants)). There is no write half, because a record is never edited and nothing is made, and this provider implements `get`, `list` and `resolve`: a `usage:watch` is a grant a role may hold and an operation nothing here answers.

What a person may see is not only the grant. Their own `user:<id>` pool, and the `team:` and `project:` pools of the teams and projects they belong to, are readable with no grant at all, because a client showing somebody their own spending has to be able to. Every other pool needs `usage:read`. That is the provider's own `authorize` rather than a rule in the host, which is how a scheme opens part of itself without a host change - decision [A scheme provider may let a read through that its grant would refuse](../.project/decisions/a-scheme-provider-may-authorize-a-read-itself.md). Where the pools come from is [USERS.md](USERS.md#roles).

## See also

| | |
| --- | --- |
| [RESOURCES.md](RESOURCES.md) | What a scheme is, and the grants a resource method asks for |
| [POLICY.md](POLICY.md) | The limits a pool's total is checked against |
| [PROXY.md](PROXY.md) | The calls through `/v1` that write the `proxy` records, and the prices they are charged |
| [SESSIONS.md](SESSIONS.md) | The turns the `agent` records belong to |
| [USERS.md](USERS.md#roles) | The people, teams and projects a pool is named after |
| [HOST.md](HOST.md#configuration-keys) | The daemon's keys, `usage` beside the rest |
