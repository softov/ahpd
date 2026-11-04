# Policies

A **policy** says who may use which agent, model and computer, and how much. An operator writes them; a daemon enforces them; a client edits them. They are off until a daemon is switched on, and a daemon that is switched on with an empty store refuses everybody but the root connection, which says so once at start.

Nothing here is on unless it is asked for. A host with no `policies` store, or with a store and no switch, behaves exactly as it did before policies existed: the rows are kept and the `policy:` scheme is served, and nothing is refused.

## The row

Every policy is one row in one store, and every row has the same fields.

| Field | Meaning |
| --- | --- |
| `id` | A name for the row. `policy://<id>` is one address, and the id is the address rather than anything the body says. |
| `scope` | Who the row is about: `all`, `user:<id>`, `team:<id>` or `project:<team>:<project>`. `all` is everybody and behaves like any other scope. |
| `kind` | What the row is about: `model` (the proxy's calls), `agent` (the harnesses ahpd runs) or `computer` (the machines sessions run in). |
| `effect` | `allow` or `deny`. **A deny wins over any allow**, so one `deny` that matches is the whole answer. |
| `match` | What the row applies to, as typed values with globs. |
| `limits` | How much may be used. Absent or empty means unlimited. A row with limits is charged for its work and refused when a counted one is out - see [How a limit is counted](#how-a-limit-is-counted). |
| `pool` | A name several rows draw from one total under. A pooled row writes `pool:<name>/...` keys instead of `policy:<id>/...`, so rows naming the same pool share every total under it. |
| `cap` | Whether the row counts and never pays. Its keys are written and its limits are checked, but it never ends a measure; a later row pays it. |
| `from`, `until` | When the row is valid. Absent means already valid, or no expiry. A bare `YYYY-MM-DD` is the whole day on both sides, so a window is stored as the instants a check compares. |

### What a `match` holds

Values are lists, one list per type. **Values of one type are alternatives; values of different types must all hold.**

| Type | Written as | Which kinds may name it |
| --- | --- | --- |
| `model` | `<maker>/<name>`, as a model is named on the wire | `model`, `agent` |
| `proxy` | The proxy provider the call goes through | `model` |
| `agent` | The harness: `claude`, `pi`, `cofold`, `acp:<server>` | `agent` |
| `computer` | The machine, as the `computers` port names it | `agent`, `computer` |

`*` stands for any run of characters within one value, the value is matched whole, and no other character is special. So `deepseek/*` matches `deepseek/deepseek-v4.1-flash` and not `anthropic/fable-5`, `agent:*` matches `claude` and `acp:something`, and `model:*` matches any model.

A type left out is unconstrained, so a `model` row naming no `proxy` allows any provider.

A type the request did not ask for is skipped by an `allow` and fails the match by a `deny`. An allow is a candidate on what was asked; a deny binds only when everything it names was asked. So a session, which is created before anybody names a model, is checked on the harness and the machine, and a deny meant to refuse a session outright names only those two.

A row whose `match` names no type is about nothing a request asks for, so it is never a candidate: an `agent` row of `model` values alone allows no harness, and a row with an empty `match` allows nothing. An allow meant to cover everything of its kind names `*` for the kind's own type, as `agent:*` covers every harness and `model:*` every model.

### What a `limit` holds

Each limit is an `amount`, a `measure`, a `period` (`minute`, `day`, `week`, `month` or `total`) and a `pool` (`shared`, one total for the group, or `each`, every member has their own). A row has room only while every one of its counted limits has room, and whichever is reached first closes it whatever its unit - which is why several limits on one row, a day and a week and a month, are the ordinary case.

Measures are chosen by the kind of the row, and only some of them are counted yet:

| Kind | Measures | Counted |
| --- | --- | --- |
| `model` | `usd`, `tokens`, `calls` | `usd`, `tokens` and `calls` |
| `agent` | `usd`, `tokens`, `turns`, `hours` | `usd`, `tokens` and `turns`; `hours` is not counted yet |
| `computer` | `hours`, `sessions` | neither yet |

A limit in a measure that is not counted yet is stored, never closes its row, and reads back as `counted: false`. `calls` counts the records a model row paid for, one per record; `turns` counts a turn once, by its first record. A period begins at 00:00 in `usage.timezone`: the day, the week on Monday and the month on the 1st, and it resets at the next one. A `total` limit counts from the row's `from`, or from the beginning of the store when it names none, and never resets. Unused room does not roll over.

A `minute` limit is the rate limit of other proxies: so many calls or tokens a minute, the rpm and tpm of an OpenAI-compatible proxy. Its minute is the minute of the clock in UTC, and not a minute of `usage.timezone`, because a minute is the same length everywhere. Its totals are kept in memory rather than in the store, which keeps no total finer than a day. A `calls` or `turns` minute limit counts the work when it is allowed, so a burst of calls that start together cannot pass one. A request counts once, on the keys of the candidate it is sent to, so a name a proxy serves from two connectors is one call. A `tokens`, `usd` or `hours` minute limit counts a record when the store keeps it, because the amount is known only when the work ends. A restart clears the minute totals, so the most a minute limit loses is one minute.

A row is refused, by name, for a measure its kind does not have, a limit with no `pool`, a `from` after its `until`, or a value type its kind does not take.

## The scheme

A host with a policies store serves one scheme of its own, the way it serves `computer:`. See [USERS.md](USERS.md) for the grants and the resource calls; this is what the addresses are.

| Address | What it is |
| --- | --- |
| `policy://` | Every row, in the order the store holds them |
| `policy://<id>` | One row, as JSON |
| `policy://<id>/limits` | One row's limits, each with what is used and when it resets - see [Reading a limit](#reading-a-limit) |

A write to `policy://<id>` makes the row or edits the one there. **A row is written whole**: a field the body does not name is the one the row already had, and the id in the URI wins over any the body carries, so a client that reads a row and writes the same JSON back has changed nothing. A field sent as `null` is removed, so `null` takes away `from`, `until`, `limits`, `pool`, `cap` and a list under `match`. `createOnly` refuses an id that is already held, and `resourceDelete` takes a row away.

The choices a form offers are the scheme's manifest rather than this page. `describe` answers a JSON Schema whose `kind`, `effect`, and a limit's `measure`, `period` and `pool` each carry an `enum` of the values accepted, and whose `allOf` holds one `if`/`then` per kind, narrowing a row to the measures and the match types that kind takes. A client draws its pickers from there, so a host that adds a value offers it without the client changing, and a body this host would refuse is one the form does not offer. The lists below are the same values written out for a person to read.

The daemon keeps the rows in `policies.json` beside its configuration.

## The channel and its commands

The rows are also the channel `x-ahpd-policies://`, which holds every row and needs `policy:read`. A subscribe answers `{ records }`, one `{ id, record }` per row, where the record is what a read of `policy://<id>` answers:

```json
{ "records": [{ "id": "M1", "record": { "id": "M1", "scope": "all", "kind": "model", "effect": "allow", "match": { "model": ["deepseek/*"] } } }] }
```

`x-ahpd-policies/added` and `x-ahpd-policies/changed` carry `{ id, record }`, and `x-ahpd-policies/removed` carries `{ id }`. A reader without `policy:read` is refused the subscribe, and a subscriber who loses the grant is sent `removed` for every row.

```json
{ "type": "x-ahpd-policies/added", "id": "M2", "record": { "id": "M2", "scope": "all", "kind": "agent", "effect": "allow", "match": { "agent": ["claude"] } } }
```

`x-ahpd/policies/put` takes `{ id, record, createOnly? }` and needs `policy:put`; `x-ahpd/policies/remove` takes `{ id }` and needs `policy:delete`. Both check a row the way a write to `policy://<id>` does, with the same refusals, and answer `{}`.

A write through the scheme or a command reaches the channel. **A hand edit to `policies.json` reaches no channel**: the daemon reads the file once at startup, so neither the store nor its subscribers see the edit until the daemon restarts.

## The switch

```json
{ "policies": { "check": true } }
```

Off by default, and it has no flag: a daemon that refuses somebody is a deployment's decision and not one run's. It has no effect on a host with no people either, because there is nobody to check.

The store and the switch are separate. A daemon that is switched off, or that has no users directory, still serves `policy:`, so a store can be filled in before anything is switched on.

## What is checked, and where

| When | Checked | Refused with |
| --- | --- | --- |
| A session is created | `agent`, for the harness and the machine asked for; then `computer`, for that machine | The users gate's `-32009`, naming the policy |
| A turn starts | `agent`, for the harness, the session's machine and the model the turn named; then the agent limits | A client's start is said, then ended in `chat/error` with the same words or the limit sentence below, as VS Code's host ends a turn its admission refuses; a queued message's set is refused with them |
| A proxy call ([PROXY.md](../server/PROXY.md)) | `model`, for the name called and each provider entry that serves it, and the model limits; the first entry allowed is called | 403 in the caller's dialect, naming the row; a session's call is checked as the person it runs for unless `modelProxy.sessionCalls` is `skip` |

The session's checks run **before** the machine is made, so a refused session leaves nothing behind.

Each check runs the same four steps:

1. A person holding `*:*` is allowed at once.
2. The candidates are the rows of that kind that are **active now**, whose **scope** holds the person with the request's team and project, and whose **match** holds the request.
3. Any candidate that denies refuses it, and the refusal names that row's id.
4. No candidate at all refuses it, and the refusal names the kind and what was asked.

A session's check stops at those four steps, because a session spends nothing until its first turn. A turn and a proxy call go on to [the limit walk](#how-a-limit-is-counted).

A model at its limit stays in `/v1/models`, which asks only whether a policy allows it. The call to it is the one that is refused.

A store that cannot be read refuses the work and says so, because a check that failed open is not a check.

A request that names no team and no project is held by `all` and by `user:` rows alone, which is how somebody in no team is covered by a host-wide policy and by nothing else.

**Never checked:** the root connection, an automation with no person behind it, and a host with no users directory. The first is the host rather than a person, the second is nobody's work, and the third has nobody to ask.

A turn that names no model is checked on the harness and the machine alone. The host never learns which model a harness picked for itself, so a check that guessed would be checking nothing.

### What a refusal says

A deny reads as the row and then the request:

```
A5 refuses agent claude with model anthropic/fable-5 on sandbox-alice
```

Nothing allowing it reads as there being no policy for it:

```
no policy allows computer kvm-shared
```

## How a limit is counted

A turn and a proxy call walk their rows for room after the four steps allowed them. Each measure is walked on its own, in the person's order: the key's own row first, then their own rows, the project, the team and `all` last. Within one scope, `policies.payOrder` says which row goes first.

1. A row with no limits takes the measure and adds no key.
2. A row with no limit in this measure is skipped, and the measure walks on.
3. A row with a counted limit that has used its amount is closed, and the measure spills to the next row.
4. A `cap` row is checked and adds its keys, but it never pays; a row with room adds the keys of its limits in this measure and ends the measure.
5. A measure no row pays is recorded with no key, and the work is refused only when no measure finds a payer.

A key minted with limits adds one row of its own, walked before every row about a person. It is a `cap` about every model, scoped to the key, so it adds its keys and never pays: the limits of a key narrow what a policy allows and never allow a model alone. The row is made from the token record rather than read from a store, so it holds for a `*:*` holder and with `policies.check` off too, as long as a usage store is there.

A row has room only while every counted limit has room, so a row closed in one measure pays no other. The check is before the work and the record after it, so two turns that start together can both pass an amount in `usd` or `tokens`. A `calls` or `turns` key is counted when the work is allowed, so a `minute` limit on one of them holds a burst.

`policies.payOrder` decides among the rows of one scope only:

| Value | Which row of one scope pays first |
| --- | --- |
| `ending` | The row whose `until` comes soonest, and rows with none last. This is the default. |
| `regular` | The rows with no `until`, then the others by `until`. |
| `extra` | The rows with an `until`, the newest `from` first, and rows with none last. |

Rows that compare equal keep the order the store holds them in.

### The keys

A record carries its owner, team and project as before, and beside them one key for each limit that paid for it:

| Row | Limit `pool` | Key |
| --- | --- | --- |
| `policy:<id>` | `shared` | `policy:<id>/<measure>` |
| `policy:<id>` | `each` | `policy:<id>/<measure>/user:<id>` |
| `pool:<name>` | `shared` | `pool:<name>/<measure>` |
| `pool:<name>` | `each` | `pool:<name>/<measure>/user:<id>` |
| `token:<id>` | `shared` | `pool:token:<id>/<measure>` |

Every record of one turn carries the keys its check chose, so a turn written per report is charged the same way as one written at its end. With the check off, with no usage store, with no person, or for a `*:*` holder, no policy key is written. The key's own row is the exception: its `pool:token:<id>` keys are written with the check off and for a `*:*` holder, because they are the key's limits rather than a policy's.

### The refusal

A row with no room ends the turn in an error or refuses the call, and names itself and the figure that closed it:

```
A3 has no room: 100 / 100 usd this week
```

A key's own limit refuses the same way, with the key's address in place of a row's id:

```
token:k1 has no room: 2 / 2 calls this day
```

A `total` limit says `in total` rather than `this week`. The id is the first row the walk met with no room, and the measure is the first of its counted limits that closed.

### Reading a limit

Two reads answer a limit, both with the same figure: the amount, what the period has used, where the period began and when it resets. `from` is the first instant of the period, in `usage.timezone` for a day, a week or a month and in UTC for a minute, and `resets` is the next one. Both read the daemon's own minute meter, so a `minute` limit answers the figure the next turn or call is checked against. A `total` limit has no `resets`, a row with an `until` says `ends`, and a measure that is not counted yet says `counted: false` and carries no figure.

`policy://<id>/limits` answers one row to a reader holding `policy:read`. An `each` limit answers every member the store holds a key for, as `{ user, used }`, because the reader may see them all. A member who used nothing has no key and is not listed, and their figure is zero. A row that is not there is `-32008`, and a host with no usage store serves no leaf.

```json
{
  "id": "A2",
  "kind": "agent",
  "scope": "team:backend",
  "limits": [
    {
      "amount": 400,
      "measure": "usd",
      "period": "week",
      "pool": "shared",
      "counted": true,
      "from": "2026-10-19T04:00:00.000Z",
      "resets": "2026-10-26T04:00:00.000Z",
      "used": 120
    },
    {
      "amount": 20,
      "measure": "usd",
      "period": "week",
      "pool": "each",
      "counted": true,
      "from": "2026-10-19T04:00:00.000Z",
      "resets": "2026-10-26T04:00:00.000Z",
      "members": [
        { "user": "ana", "used": 30 },
        { "user": "beto", "used": 45 }
      ]
    }
  ]
}
```

`usage://limits` answers a list of the same shape, one entry for each active row whose scope holds the reader: `all`, the reader, or a team or project of theirs. An `each` limit answers only the reader's own figure, as `used` and never `members`. A reader with no person, which is the root connection or a host with no users directory, reads `[]`. The read needs no grant, and it is served while `policies.ownLimits` is on, which is the default; off, it is `-32008`.

## What waits

- **`hours` and `sessions`.** A limit in either is stored, reads back as `counted: false`, and never closes its row. Counting machine hours, open sessions and agent work time is a later plan.
- **The cancel during a turn.** With the default `per: 'turn'`, what a limit has used moves only when the turn ends, so a long turn can pass its amount. Cancelling a turn when it passes its amount, and moving its charge to the next row with room, is a later plan.
- **Charge rules.** Everybody is charged in the `auto` order: their own rows, then the project, the team and `all`. A person's own charge rule, and a team default for its members, are a later plan.
- **Two turns that start together** can both pass an amount, because the check is before the work and the record after it. That is accepted rather than fixed.
- **Usage recorded before limits were counted** carries no policy key, so every limit starts at zero. The daemon says so once at start with the check on.

## Where it is in the code

| | |
| --- | --- |
| The four steps | `decide` in `packages/sdk/src/access/decide.ts` |
| The walk, the keys and the figures | `chargeFor`, `keysOf` and `limitsOf` in `packages/sdk/src/usage/charge.ts` |
| The periods | `periodOf` in `packages/sdk/src/usage/periods.ts` |
| The turn's check and its keys | `checked` in `packages/sdk/src/host/owners.ts`, and `write` in `packages/sdk/src/usage/meter.ts` |
| The row and the two stores | `packages/sdk/src/access/policies.ts` |
| The `policy:` scheme and its channel | `packages/sdk/src/access/policy.ts` and `packages/sdk/src/resources/recordschannel.ts` |
| The switch and the charge settings, in the host | `policies`, `policiesCheck`, `policiesPayOrder` and `usageTimezone` on `HostOptions`, `packages/sdk/src/types/host.ts` |
| The switch and the charge settings, in the daemon | `PoliciesSetting` and `UsageSetting` in `packages/server/src/config.ts`, and the wiring in `packages/server/src/commands/run.ts` |
| The `ownLimits` switch, in the usage scheme | `ownLimits` on `UsageProviderOptions`, `packages/sdk/src/usage/usage.ts` |
| The proxy's check and its record | `policyFor` and `record` in `packages/server/src/proxy/listener.ts` |
| The reads | `policy://<id>/limits` in `packages/sdk/src/access/policy.ts`, and `usage://limits` in `packages/sdk/src/usage/usage.ts` |
