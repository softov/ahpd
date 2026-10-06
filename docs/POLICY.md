# Policies

A **policy** says who may use which agent, model and computer. An operator writes them; a daemon enforces them; a client edits them. They are off until a daemon is switched on, and a daemon that is switched on with an empty store refuses everybody but the root connection, which says so once at start.

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
| `limits` | How much may be used. Absent or empty means unlimited. Stored, and not enforced yet - see below. |
| `pool` | A name several rows draw from one total under. Enforced by a later plan. |
| `cap` | Whether the row counts and never pays. Enforced by a later plan. |
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

### What a `limit` holds

Each limit is an `amount`, a `measure`, a `period` (`day`, `week`, `month` or `total`) and a `pool` (`shared`, one total for the group, or `each`, every member has their own). A row has room only while every one of its limits has room, and whichever is reached first closes it whatever its unit - which is why several limits on one row, a day and a week and a month, are the ordinary case.

Measures are chosen by the kind of the row:

| Kind | Measures |
| --- | --- |
| `model` | `usd`, `tokens`, `calls` |
| `agent` | `usd`, `tokens`, `turns`, `hours` |
| `computer` | `hours`, `sessions` |

A row is refused, by name, for a measure its kind does not have, a limit with no `pool`, a `from` after its `until`, or a value type its kind does not take.

## The scheme

A host with a policies store serves one scheme of its own, the way it serves `computer:`. See [USERS.md](USERS.md) for the grants and the resource calls; this is what the addresses are.

| Address | What it is |
| --- | --- |
| `policy://` | Every row, in the order the store holds them |
| `policy://<id>` | One row, as JSON |

A write to `policy://<id>` makes the row or edits the one there. **A row is written whole**: a field the body does not name is the one the row already had, and the id in the URI wins over any the body carries, so a client that reads a row and writes the same JSON back has changed nothing. `createOnly` refuses an id that is already held, and `resourceDelete` takes a row away.

The daemon keeps the rows in `policies.json` beside its configuration.

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
| A turn starts | `agent`, for the harness, the session's machine and the model the turn named | The same, on the action's rejection reason |
| A proxy call ([PROXY.md](PROXY.md)) | `model`, for the name called and each provider entry that serves it; the first entry allowed is called | 403 in the caller's dialect, naming the row; a session's call is checked as the person it runs for unless `proxy.sessionCalls` is `skip` |

The session's checks run **before** the machine is made, so a refused session leaves nothing behind.

Each check runs the same four steps:

1. A person holding `*:*` is allowed at once.
2. The candidates are the rows of that kind that are **active now**, whose **scope** holds the person with the request's team and project, and whose **match** holds the request.
3. Any candidate that denies refuses it, and the refusal names that row's id.
4. No candidate at all refuses it, and the refusal names the kind and what was asked.

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

## What this does not yet enforce

- **`limits` are stored and read by nobody.** A row that has already spent what it had still allows. Enforcing a limit, charging the right pool for it, and refusing when every pool is out are the next plan's work.
- **`pool` and `cap` are stored and read by nobody**, for the same reason. A row naming a `pool` does not yet draw from one total with the rows naming the same one.
- **Which row pays is not settled here.** A refused turn is refused; an allowed one is not yet charged to a particular row in a particular unit.

## Where it is in the code

| | |
| --- | --- |
| The four steps | `decide` in `packages/sdk/src/decide.ts` |
| The row and the two stores | `packages/sdk/src/policies.ts` |
| The `policy:` scheme | `packages/sdk/src/policy.ts` |
| The switch, in the host | `policies` and `policiesCheck` on `HostOptions`, `packages/sdk/src/types/host.ts` |
| The switch, in the daemon | `PoliciesSetting` in `packages/server/src/config.ts`, and the wiring in `packages/server/src/commands/run.ts` |
| The proxy's check | `policyFor` in `packages/server/src/proxy/listener.ts` |
