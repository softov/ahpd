---
title: The switch, and the checks at a session and at a turn
status: todo
depends: [task-01-the-policy-row-and-the-policies-port.md, task-02-the-policy-scheme-and-its-grant.md, task-03-the-decide-function.md]
layer: "sdk"
refs:
  - "[code://packages/sdk/src/host.ts#L4399-L4411](../../../../packages/sdk/src/host.ts#L4399-L4411) - `charge`, where a session's scope is resolved at creation and kept in `charged`"
  - "[code://packages/sdk/src/host.ts#L8219-L8335](../../../../packages/sdk/src/host.ts#L8219-L8335) - `createSession`, where the two checks go: before `placedIn`, inside the `finally` that releases the claims"
  - "[code://packages/sdk/src/host.ts#L5104-L5134](../../../../packages/sdk/src/host.ts#L5104-L5134) - `placedIn`, which is what makes `config.computer` say which machine this session runs in"
  - "[code://packages/sdk/src/host.ts#L5169-L5201](../../../../packages/sdk/src/host.ts#L5169-L5201) - `beginOrRun` and the `uncharged` refusal it already returns, beside which the turn's check sits"
  - "[code://packages/sdk/src/host.ts#L4347-L4366](../../../../packages/sdk/src/host.ts#L4347-L4366) - `ownerFor` and `principalFor`, which say who a turn belongs to and which person that is"
  - "[code://packages/sdk/src/host.ts#L3580-L3592](../../../../packages/sdk/src/host.ts#L3580-L3592) - the meter, which reads a session's `computer` setting the same way this check does"
  - "[code://packages/sdk/src/types/host.ts#L209-L225](../../../../packages/sdk/src/types/host.ts#L209-L225) - `usage` and `usagePer`, the port and the mode beside which `policies` and `policiesCheck` are added"
  - "code://packages/sdk/src/decide.ts - `decide`, written by task 03, which this task calls and nothing else calls"
  - "[code://packages/server/src/config.ts#L28-L40](../../../../packages/server/src/config.ts#L28-L40) - `UsageSetting`, the daemon block a `policies` switch sits beside"
  - "[code://packages/server/src/config.ts#L204-L222](../../../../packages/server/src/config.ts#L204-L222) - `automationsPath` and `sessionsPath`, beside which `policiesPath` is added"
  - "[code://packages/server/src/commands/options.ts#L56-L76](../../../../packages/server/src/commands/options.ts#L56-L76) - the `Options` fields a `policiesCheck` joins"
  - "[code://packages/server/src/commands/options.ts#L222-L276](../../../../packages/server/src/commands/options.ts#L222-L276) - the `usage` field and `FILE_ONLY`, where the `policies` field is declared"
  - "[code://packages/server/src/commands/options.ts#L589](../../../../packages/server/src/commands/options.ts#L589) - where a setting is read out of the configuration into an option"
  - "[code://packages/server/src/commands/run.ts#L304-L375](../../../../packages/server/src/commands/run.ts#L304-L375) - where the daemon serves the people schemes and hands the host its usage store"
  - "[code://packages/sdk/src/computers.ts#L69-L84](../../../../packages/sdk/src/computers.ts#L69-L84) - `openComputer`, which answers a machine's id and is the only place one is made for a session"
  - "[code://docs/DAEMON.md#L419-L427](../../../../docs/DAEMON.md#L419-L427) - the settings list a `policies` key joins"
  - "[code://README.md#L393-L404](../../../../README.md#L393-L404) - the document table, where the new document is a row"
  - "file:///github/ahp-review/prospect/ahp-user-rules.md - \"What gets checked, when\", and the examples 15, 16, 19, 21, 22, 26 and 27 the plan's checklist names"
---

## Objective

A daemon option switches the checks on, and with it on a host refuses a session or a turn that no policy allows, naming the policy that refused it, while an existing host with the option off behaves exactly as it did.
The checks run at a session's creation and at each turn's start, over the three kinds the plan names, and a root connection, an automation and a host with no people are never checked.

## Files

- `UPDATE: packages/sdk/src/types/host.ts:209-225` - `policies?: Policies` and `policiesCheck?: boolean`, in the same pair as `usage` and `usagePer`.
- `UPDATE: packages/sdk/src/host.ts:8219-8335` - the two checks in `createSession`, before `placedIn`, so a refused session makes no machine.
- `UPDATE: packages/sdk/src/host.ts:5169-5201` and `:9669`, `:9724` - the turn's check, wrapped so the two call sites of `beginOrRun` can await it.
- `UPDATE: packages/server/src/config.ts:28-40`, `:204-222` - `PoliciesSetting` and `policiesPath`, beside `UsageSetting` and `sessionsPath`.
- `UPDATE: packages/server/src/commands/options.ts:56-76`, `:222-276`, `:589` - the `policiesCheck` option, the `policies` field in the schema and in `FILE_ONLY`, and the read that defaults it off.
- `UPDATE: packages/server/src/commands/run.ts:304-375` - `policies: filePolicies({ file: policiesPath() })`, `policiesCheck`, and `policy:` added to the same `resourceProviders` map the people schemes are given through, not in a second spread.
- `CREATE: packages/sdk/test/policy-checks.test.ts`, `CREATE: packages/server/test/policy-option.test.ts`.
- `CREATE: docs/POLICY.md` - the row, the scheme, the switch, what is checked where, and what this plan does not yet enforce; `UPDATE: docs/DAEMON.md:419-427` the configuration key; `UPDATE: README.md:393-404` the row in the document table.

## Steps

1. Add `policies` and `policiesCheck` to `HostOptions` beside `usage` and `usagePer`, and say in the file what leaving each out means: no port is nothing to check, and the flag is off whatever the port holds. This is the same shape as the usage port and its mode, and saying so is the whole of the decision the daemon option records.
2. In the host, write one `checked()` helper beside `charge` and `principalFor` that answers the refusal a request would get, or nothing: nothing when the flag is off, when there is no `policies` port, or when there is no `Principal` behind the work, and otherwise `decide(...)` on the two or three kinds the caller names. No principal means no person to check, which is what makes a host with no users directory, a root connection and an automation all inert here, as the plan's second table settles.
3. At a session's creation, before `placedIn` makes or picks a machine, call `checked()` twice with the scope the session is charged to (`charged.get(uri)?.scope`): once for `agent` with the harness (`provider`) and the computer the session asked for (`config.computer` as the client sent it, read with `computerSource`/`computerId`; none means this host), and once for `computer` with that computer. A refusal throws `RpcError(-32009, <the sentence decide wrote, naming the policy>)` out of `createSession` before any machine exists, and the existing `finally` releases the claims.
4. A machine this host made for a session that is then refused is not destroyed, because nothing on `ComputerPort` destroys one: it has `how`, `agents`, `nested`, `create`, `enter` and `leave`. Say that in a comment where the check is, so the leftover is a fact of the code rather than an oversight. Whether the port grows a `destroy` is the fourth open question in the plan's Resume state, and nothing here waits on it.
5. At a turn's start, check in `beginOrRun` beside the `uncharged` refusal: the person is `principalFor(sender)` where the turn was sent by somebody, else the session's own owner, the harness is the `provider` the turn is running under, the machine is the session's `computer` setting read as `computerId(...)` the way the meter reads it, and the model is the one the turn's message named. One `decide` for `agent` with all of them.
6. `decide` is awaited, so `beginOrRun` can no longer answer the refusal synchronously. Do not make it return a promise: wrap the two call sites instead, awaiting inside the async block at `:9669` and inside a new one at `:9724`, and pass `beginOrRun` whatever the check did not refuse. Both call sites already hand a refusal to `refuse(...)`, so a refused turn is refused the way an uncharged one is, with the same shape on the wire.
7. When the turn's message names no model, check the `agent` kind against the harness and the machine alone, and leave the model unchecked rather than resolved: the host never learns which model a harness picked for itself, `meter.ts` records the turn's own choice and the report's, and nothing here would be guessing a value. This is the first open question in the plan's Resume state and the step depends on it; the proposed answer is the one written here, and the alternative is to read the session's own `model` setting, which is chat-scoped and is resolved nowhere in the host.
8. In the daemon, add `policies?: PoliciesSetting` with `check?: boolean` to `Config` beside `usage`, the `policiesPath()` beside `sessionsPath()`, the `policies` field to the schema and to `FILE_ONLY` (it is a file-only setting, with no flag, like `usage` and `http`), and `policiesCheck: boolean` to `Options` defaulting to `false`. The block's shape is the second open question in the plan's Resume state and this step depends on it; the proposed answer is a `policies` object holding one boolean, beside `usage`, rather than a flat `policyChecks` key and a second block for a store choice.
9. In `run.ts`, hand the host `policies: filePolicies({ file: policiesPath(), onProblem })` beside `usage`, and `policiesCheck: options.policiesCheck`. Merge `policyProviders(policies)` into the same `resourceProviders` object the people schemes are spread into, because two spreads of the same key would leave `policy:` off the install that has people and turn it on everywhere else. A host with no users directory still gets the store, because the store and the gate are separate and the scheme is what a client lists.
10. Say at start, through the daemon's own log and where `run.ts` already reports what it could not do, that the checks are on and the store holds no policy, since a host in that state refuses everybody but root. The line goes out once at start, never per refusal.

## Validation

- `packages/sdk/test/policy-checks.test.ts`, on a host with the draft's store and `policiesCheck: true`: a session for a person no policy allows is refused at `createSession` with the policy's id in the sentence; a session the draft's example 15 allows is created; a turn on a model a policy denies is refused with the deny's id, the draft's example 21, and a turn on a model the draft's example 19 allows runs; the draft's example 22, a person starting a harness on a machine no policy gives them, is refused at `createSession` and not at the turn; the draft's example 26, a harness a machine does not carry, is refused by the machine's own check and not by a policy, which a `ComputerPort` whose `agents()` answers a fixed list is enough to show; a `*:*` holder is refused nothing; a root connection, an automation and a host with no users directory are refused nothing.
- The same file, with `policiesCheck` off and the same store present: every case above that was refused is not refused, which is the plan's checklist item that an existing host behaves as before.
- `packages/server/test/policy-option.test.ts`: `policies: { "check": true }` in a configuration file is accepted and reaches the host, a file with no `policies` is off, `policies: { "check": "yes" }` refuses the start the way a wrong `usage.per` does, and a daemon switched on with an empty store writes the line from step 10. A policy written through `policy://` by a client holding `policy:write` is in `policies.json` and is read back by a second daemon over the same configuration directory.
- `pnpm exec vitest run packages/sdk/test/policy-checks.test.ts packages/server/test/policy-option.test.ts`
- `pnpm test`, `pnpm typecheck`, `pnpm boundary`
- By hand: nothing here reads a `limit`, a `pool` or a `cap`, and the `usage` port is asked nothing by the checks. A policy that is stored with a limit it has already spent still allows, which is policy/02's work and is said as such in `docs/POLICY.md`.

## Resume

Nothing done yet.
