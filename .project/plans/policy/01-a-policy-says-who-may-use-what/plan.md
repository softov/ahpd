---
title: A policy says who may use which agent, model and computer
domain: policy
status: built
priority: high
created: 2026-10-02
revalidated: 2026-10-02
requires:
  - plans/host/36-people-are-resources-a-client-manages/plan.md
changes: []
creates: []
decisions:
  - decisions/policies-are-a-scheme-clients-edit.md
  - decisions/policy-checks-are-switched-on-by-a-daemon-option.md
refs:
  - "[code://packages/sdk/src/people.ts](../../../../packages/sdk/src/people.ts) - `peopleProviders`, the schemes a client lists and edits; the `policy:` scheme follows it"
  - "[code://packages/sdk/src/users.ts#L40-L46](../../../../packages/sdk/src/users.ts#L40-L46) - `SUBJECTS`, where `policy` joins as a grant subject"
  - "[code://packages/sdk/src/types/users.ts](../../../../packages/sdk/src/types/users.ts) - `Principal`: `can`, `memberships`, `primary`"
  - "[code://packages/sdk/src/scopes.ts](../../../../packages/sdk/src/scopes.ts) - `scopeFor`, the team and project a request names or defaults to"
  - "[code://packages/sdk/src/host.ts#L4398-L4411](../../../../packages/sdk/src/host.ts#L4398-L4411) - `charge`, where a session's scope is resolved at creation"
  - "[code://packages/sdk/src/host.ts#L5180-L5195](../../../../packages/sdk/src/host.ts#L5180-L5195) - the `uncharged` refusal at a turn's start, where a turn's check sits beside"
  - "[code://packages/sdk/src/host.ts#L5105-L5135](../../../../packages/sdk/src/host.ts#L5105-L5135) - where a session's `computer` is resolved"
  - "[code://packages/sdk/src/types/plugin.ts#L31-L44](../../../../packages/sdk/src/types/plugin.ts#L31-L44) - `PortKey`, and `registerUsage`, the registration a `registerPolicies` mirrors"
  - "[code://packages/sdk/src/usage.ts](../../../../packages/sdk/src/usage.ts) - `fileUsage`, the file store pattern in the config folder"
  - "[code://packages/server/src/config.ts#L28-L40](../../../../packages/server/src/config.ts#L28-L40) - `UsageSetting`, the daemon block a `policies` switch sits beside"
  - "[code://packages/server/src/config.ts#L204-L222](../../../../packages/server/src/config.ts#L204-L222) - `sessionsPath`, beside which `policiesPath` goes"
  - "[code://packages/server/src/commands/options.ts#L222-L276](../../../../packages/server/src/commands/options.ts#L222-L276) - the `usage` field and `FILE_ONLY`, where the `policies` field is declared"
  - "[code://packages/server/src/commands/run.ts#L304-L375](../../../../packages/server/src/commands/run.ts#L304-L375) - where the daemon serves the people schemes and hands the host its stores"
  - "[code://packages/server/src/plugins.ts](../../../../packages/server/src/plugins.ts) - where the daemon wires its default stores"
  - "[code://packages/sdk/src/types/usage.ts](../../../../packages/sdk/src/types/usage.ts) - the `Usage` port, whose shape the `Policies` port follows"
  - "[code://packages/sdk/src/automations.ts](../../../../packages/sdk/src/automations.ts) - `memoryAutomations`, the store a `memoryPolicies` is written beside"
  - "[code://packages/sdk/src/scheduled.ts#L179-L205](../../../../packages/sdk/src/scheduled.ts#L179-L205) - `save`, the write-beside-and-rename a file store uses"
  - "[code://packages/sdk/src/plugins.ts#L30-L33](../../../../packages/sdk/src/plugins.ts#L30-L33) - `PORT_KEYS`, the runtime half of `PortKey`"
  - "[code://packages/sdk/src/validate.ts#L126-L166](../../../../packages/sdk/src/validate.ts#L126-L166) - `PORT_MEMBERS` and `PORT_METHOD`, the tables a new port key must be in"
  - "[code://packages/sdk/src/types/resources.ts](../../../../packages/sdk/src/types/resources.ts) - `ResourceProvider` and `SchemeDescription`, what the `policy:` scheme implements"
  - "[code://packages/sdk/src/host.ts#L8219-L8335](../../../../packages/sdk/src/host.ts#L8219-L8335) - `createSession`, where the checks at a session's creation go"
  - "[code://packages/sdk/src/host.ts#L6865-L6886](../../../../packages/sdk/src/host.ts#L6865-L6886) - `capabilityFor`, which reads the grant out of the URI's scheme, so a scheme needs no gate of its own"
  - "[code://packages/sdk/src/computers.ts#L69-L84](../../../../packages/sdk/src/computers.ts#L69-L84) - `openComputer`, the only place a machine is made for a session"
  - "[code://packages/sdk/src/meter.ts#L176-L207](../../../../packages/sdk/src/meter.ts#L176-L207) - how a record finds the model a turn ran on, which is what a turn's check may and may not know"
  - "[code://packages/sdk/src/index.ts](../../../../packages/sdk/src/index.ts) - what the package exports, where the port, the stores, the scheme and `decide` go"
  - "[code://docs/PLUGINS.md#L70-L88](../../../../docs/PLUGINS.md#L70-L88) - the registration table `registerPolicies` joins"
  - "[code://docs/USERS.md#L354-L398](../../../../docs/USERS.md#L354-L398) - the subject and verb table, where `policy` is a row"
  - "[code://docs/DAEMON.md#L419-L427](../../../../docs/DAEMON.md#L419-L427) - the settings list the `policies` key joins"
  - "file:///github/ahp-review/prospect/ahp-user-rules.md - the rules draft: the row shape, the match types, the check steps and the examples"
---

## Goal

An operator writes policies that say which agents, models and computers each person, team, project or everyone may use, and switches them on.
Once on, a session that starts a harness on a machine nobody allowed, or a turn on a model nobody allowed, is refused with the policy that refused it, and root is never refused.
How much may be used is written into a policy now and enforced in policy/02.

## Reconnaissance

The files read and the patterns to reuse are the `refs` above, each with its note.

### Searches performed

- `rg -n "polic" packages` - nothing; no policy exists.
- `rg -n "charge\(|uncharged" packages/sdk/src/host.ts` - the session's scope is resolved at creation and refused at a turn's start.
- `rg -n "registerUsage|PortKey" packages/sdk/src/types/plugin.ts` - the port pattern.

### Runtime path

```
createSession(principal, config: provider, computer, scope)
  -> charge -> [new] decide(principal, scope, 'agent', {agent, computer}) and decide(..., 'computer', {computer})
sendMessage(turn, model) -> uncharged refusal -> [new] decide(principal, scope, 'agent', {agent, model, computer})
policy:/ list, policy:/<id> read and write -> [new] policies port -> policies.json
```

### Gaps

- No `policies` port, store, scheme or grant subject.
- No check at session creation or turn start, and no daemon switch.

## Decisions locked in

| # | Decision | Rationale / source |
| --- | --- | --- |
| 1 | [Policies are kept behind a port and edited through a policy scheme](../../../decisions/policies-are-a-scheme-clients-edit.md) | Softov, 2026-10-02 |
| 2 | [Policy checks are switched on by a daemon option](../../../decisions/policy-checks-are-switched-on-by-a-daemon-option.md) | Softov, 2026-10-02 |
| 3 | [A deny binds only when everything it names was asked, while an allow skips what was not](../../../decisions/a-deny-binds-only-what-was-asked.md) | Softov, 2026-10-02 |

| What | Source | Task |
| --- | --- | --- |
| A policy row is `id`, `scope` (`all`, `user:<id>`, `team:<id>`, `project:<team>:<project>`), `kind` (`model`, `agent`, `computer`), `effect` (`allow`, `deny`), `match` (typed values with globs: `model:`, `proxy:`, `agent:`, `computer:`), `limits`, optional `pool` and `cap`, `from`, `until` | the rules draft, "The rule shape" and "Answered 2026-10-01" | 01 |
| `limits` is a list of `{ amount, measure, period, pool }`, validated against the measures of its kind and stored, and not enforced in this plan | Softov, 2026-10-02: several limits on one row, such as a day, a week and a month; enforcement is policy/02 | 01 |
| A row's `match`: values of one type are alternatives, values of different types must all hold; a `model` row takes `model:` and `proxy:`, an `agent` row `agent:`, `model:` and `computer:`, a `computer` row `computer:` | the rules draft | 01, 03 |
| The check runs the draft's steps 1 to 4: root and `*:*` allowed; candidates are active, of the kind, whose scope holds the person with the request's team and project, and that match; any matching deny wins; no candidate denies | the rules draft, "Each check runs the same steps" | 03 |
| A refusal names what refused it: the deny's `id`, or "no policy allows" with the kind and what was asked | the rules draft, examples | 03 |
| Checked at session creation (`agent` with the harness and computer, `computer` with the machine) and at each turn's start (`agent` with the turn's model) | the rules draft, "What gets checked, when" | 04 |
| The `model` kind is stored and decided by the same function, and called by the proxy listener in proxy/02 | (defaulted: the proxy serves no request yet) | 03 |
| `policy` joins `SUBJECTS`; `policy:read` lists and reads, `policy:write` writes | (defaulted: as `user`, `team`, `project`, `role`) | 02 |
| A host with no users directory has no person to check, so the switch has no effect there | (defaulted: every gate on such a host is inert) | 04 |
| A root connection and an automation with no person are not checked | the rules draft: root is never limited | 04 |
| A turn that names no model is checked on its harness and machine only; a turn that names one is checked on it too. Provisional, to revisit once the host resolves which model a harness picked | Softov, 2026-10-02, asked "A turn that names no model: how is its model checked?": "Harness and machine... but not a definitive decision" | 04 |
| The switch is `"policies": { "check": true }` in the daemon configuration, beside `usage`, file only | Softov, 2026-10-02, asked "How is the policy switch written in the daemon config?" | 04 |
| A refusal at session creation is the users gate's `-32009` with the sentence naming the policy | Softov, 2026-10-02, asked "A session refused by policy at creation: what error does the client get?": "The users-gate -32009" | 03, 04 |
| The session's checks run before its machine is placed, from the computer it asked for, so a refused session leaves nothing behind | Softov, 2026-10-02, asked "The check runs after the session's machine is placed... What then?": "Check before placing" | 04 |
| A bare `until` date is the end of that day | (defaulted: "when it ends", written as a day) | 03 |

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - The policy row and the policies port](task-01-the-policy-row-and-the-policies-port.md) | done | - |
| [02 - The policy: scheme and the policy grant](task-02-the-policy-scheme-and-its-grant.md) | done | 01 |
| [03 - The decide function, the draft's four steps](task-03-the-decide-function.md) | done | 01 |
| [04 - The switch, and the checks at a session and at a turn](task-04-the-switch-and-the-two-checks.md) | done | 01, 02, 03 |

## Risks and tradeoffs

- A host switched on with no policies refuses everyone but root; the daemon says so at start.
- Globs are matched as the draft writes them (`*` within a value); a richer pattern language is not offered.

## Resume state

- **Done so far:** built 2026-10-02, see [implemented.md](implemented.md) and [deferred.md](deferred.md).

## Final verification checklist

- [x] The draft's examples 15, 16, 19, 21, 22, 26 and 27 decide as the draft says, as tests (limits aside).
- [x] Off by default: an existing host with no policies behaves as before.
- [x] A client with `policy:write` writes a policy through `policy:` and reads it back after a restart.
- [x] `pnpm exec tsc --noEmit`, `pnpm test`, `pnpm boundary` pass.
- [x] `plans/index.md` updated.
