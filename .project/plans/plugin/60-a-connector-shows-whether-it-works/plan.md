---
title: A connector shows whether it works
domain: plugin
status: built
priority: medium
created: 2026-10-23
revalidated: 2026-10-23
requires: []
changes: []
creates: []
refs:
  - "[code://packages/sdk/src/types/connectors.ts#L103-L143](../../../../packages/sdk/src/types/connectors.ts#L103-L143) - `Adapter`, with `open` and `run` and no check"
  - "[code://packages/sdk/src/connectors/channel.ts#L58-L59](../../../../packages/sdk/src/connectors/channel.ts#L58-L59) - `ConnectorState`, which says only whether a connector is open"
  - "[code://packages/sdk/src/connectors/channel.ts#L226-L234](../../../../packages/sdk/src/connectors/channel.ts#L226-L234) - `stateOf` and `connectorRow`, the row a client reads"
  - "[code://packages/sdk/src/connectors/channel.ts#L329-L340](../../../../packages/sdk/src/connectors/channel.ts#L329-L340) - `resolved`, which reads each `$secret` back from the vault"
  - "[code://packages/sdk/src/connectors/channel.ts#L355-L369](../../../../packages/sdk/src/connectors/channel.ts#L355-L369) - `openOne`, where a check runs after the open"
  - "[code://packages/sdk/src/connectors/channel.ts#L380-L398](../../../../packages/sdk/src/connectors/channel.ts#L380-L398) - `run`, the one place an action call goes through"
  - "[code://packages/sdk/src/connectors/channel.ts#L400-L449](../../../../packages/sdk/src/connectors/channel.ts#L400-L449) - `moveSecrets`, which refuses a reference in a secret field"
  - "[code://packages/sdk/src/connectors/channel.ts#L172-L180](../../../../packages/sdk/src/connectors/channel.ts#L172-L180) - `ownerAllows`: a host connector takes `connector:host`"
  - "[code://packages/sdk/src/access/vault.ts#L64-L70](../../../../packages/sdk/src/access/vault.ts#L64-L70) - `secretRef`, the single-key rule a reference reader follows"
  - "[code://packages/sdk/src/host/tooling.ts#L531](../../../../packages/sdk/src/host/tooling.ts#L531) - action tools call `connectors.run`"
  - "[code://packages/sdk/test/connectors-channel.test.ts](../../../../packages/sdk/test/connectors-channel.test.ts) - the channel's tests, with a fake adapter and vault"
  - "[code://docs/plugins/PLUGINS.md#L1176](../../../../docs/plugins/PLUGINS.md#L1176) - the connectors commands table"
  - "[code://docs/sdk/HOST.md#L177](../../../../docs/sdk/HOST.md#L177) - the grants table for connectors"
  - file:///github/ahp-review/briefs/model-proxy.md - answers 1, 6 and 10, which this plan builds the connector part of
---

## Goal

A person who makes a connector can see whether it works, and not only whether it is saved.
An adapter can check a connector with a call that needs its key.
The host keeps the last call and the last failure of each connector.
A host connector can take a secret from an environment variable of the daemon in place of a value.
The model proxy's providers become connectors in the next plan, and they use all of this.

## Reconnaissance

The files read and the patterns to reuse are the `refs` above, each with its note.

### Searches performed

- `rg -n "health|lastError|check" packages/sdk/src/types/connectors.ts` - no check and no call state on an adapter or a connector.
- `rg -n "\\$env" packages/*/src` - nothing reads an environment reference in a config.
- `rg -n "connectors.run" packages/sdk/src packages/server/src` - action tools are the one caller of `run`.

### Runtime path

```
put -> openOne -> adapter.open -> adapter.check -> health in memory -> connectors row -> client
action tool -> connectors.run -> adapter.run -> last call in memory -> connectors row -> client
host part (the proxy, next plan) -> connectors.note -> last call in memory -> connectors row
```

### Gaps

- `Adapter` has no `check`, so a saved connector with a wrong key reads as `open`.
- The channel keeps no outcome of a call.
- A secret field takes a value only, so a host key that lives in the daemon's environment has to be copied into the vault.
- No command reruns a check after a person fixes the service side.

## Answers

| What | Source | Task |
| --- | --- | --- |
| Configured is not the same as working: every connector gets a state that a client shows | Softov, 2026-10-23 | 03 |
| Every connector gets it, not only a model provider | Softov, 2026-10-23 | 01, 03 |
| An adapter may give a check, a call that needs its credentials, to say whether the key is valid | Softov, 2026-10-23 | 01, 03 |
| The host keeps in memory the last call's status and time, and the last failure's error and time | Softov, 2026-10-23 | 03 |
| A secret field holds a value or the name of an environment variable, which the host reads when it opens the connector | Softov, 2026-10-23 | 01, 02 |
| The environment form is `{ "fromEnv": "<NAME>" }`, beside `{ "$secret": "<name>" }` | Softov, 2026-10-23: one form, the one presets use | 01, 02 |
| Only a host connector may name an environment variable. A team or a person's connector that names one is refused on a put, and again when the record is opened | (defaulted: else any person reads any daemon variable, by sending it to an endpoint they choose) | 02 |
| A row shows an environment reference as it is stored, because the name is not a secret | (defaulted: a client shows where the key comes from) | 02 |
| A missing variable fails the open, and the connector is `invalid` with a problem line that names the variable | (defaulted: as a missing vault secret does today) | 02 |
| A check answers `ok`, `denied` (the service refused the credentials), `unreachable` or `failed`, with an optional message | (defaulted: the three outcomes Softov named, and one for anything else) | 01, 03 |
| A check runs after each open. A put waits for it, so its answer carries the result. A start does not wait | (defaulted: a put is where a person learns the key is wrong, and a start must not hold on a slow service) | 03 |
| A check that takes more than 10 seconds is `unreachable` | (defaulted: as the icon fetch limits a slow server) | 03 |
| `x-ahpd/connectors/check` takes `{ id }`, runs the check again and answers the row. It takes `connector:put` and the owner's rule, as a put does | (defaulted: who may change a connector may test it, with no new grant) | 03 |
| A call through `run`, and a call a host part reports through `note`, sets the last call. A failed one also sets the last failure | (defaulted: `run` is the one action path, and the proxy calls no `run`) | 03 |
| An error message is kept at most 500 characters, as the thrower gave it | (defaulted: a row stays small) | 03 |
| The channel sends at most one refresh each second for call state | (defaulted: a busy provider must not send a row on every call) | 03 |
| A connector with no check and no call has no `health` key | (defaulted: nothing known is nothing sent) | 03 |
| ahpw draws the state in its own session, outside this plan | (defaulted: ahpd plans hold no client work) | - |

## Proposed architecture

- **Data flow** - the adapter answers a check. The channel holds the check, the last call and the last failure for each open connector, and adds them to the row as `health`.
- **Event flow** - a put, a start, a check command, a `run` and a `note` each update the health, and a coalesced refresh sends the rows.
- **State flow** - health lives in memory only. A restart clears it, and the checks at start fill it again. A close or a remove drops it.
- **Layer responsibilities** - sdk: the types, the shared `fromEnvRef`, the channel, its tests. docs: the adapter section, the commands table and the grants table.
- **Source-of-truth files** - [`code://packages/sdk/src/connectors/channel.ts`](../../../../packages/sdk/src/connectors/channel.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - The types carry a check and health](task-01-the-types-carry-a-check-and-health.md) | done | - |
| [02 - A host secret can name an env variable](task-02-a-host-secret-can-name-an-env-variable.md) | done | 01 |
| [03 - The channel keeps each connector's health](task-03-the-channel-keeps-health.md) | done | 01 |
| [04 - The docs say how a connector shows health](task-04-the-docs-say-how-health-shows.md) | done | 02, 03 |

## Risks and tradeoffs

- An environment reference lets a connector read the daemon's environment. Only a host connector, which takes `connector:host`, may name one.
- An adapter's error message can hold anything the service answered. The host keeps it as given, and only readers of that connector see it.
- Health is lost on a restart. The checks at start fill the check part again, and the call part fills on the next call.

## Resume state

- **Done so far:** task-01, task-02, task-03 and task-04 are implemented. The sdk has `Adapter.check`, `CheckResult`, `CallOutcome` and `ConnectorHealth`. A host connector's `writeOnly` field may hold `{ "fromEnv": "<NAME>" }`, the form presets use, which the channel reads from the daemon's environment when it opens the connector. A team's or a person's connector that holds one is refused on a put and again at open. The channel keeps each open connector's health in memory. It runs the check after a put and after a start, and records each `run` and each `note`. It sends one refresh a second for them, and serves `x-ahpd/connectors/check`. `docs/plugins/PLUGINS.md` and `docs/sdk/HOST.md` describe all of it.
- **Next action:** none. The plan is built, and `implemented.md` says what exists.
- **Open questions:** none.
- **Watch out for:** `state` stays as it is, `open`, `invalid` or `unavailable`. `health` is a second key beside it, and does not change it.
