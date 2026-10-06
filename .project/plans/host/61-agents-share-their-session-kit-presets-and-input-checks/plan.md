---
title: The agents share their status, activity, title and preset reading, and the host checks tool inputs and request params one way
domain: host
status: planned
priority: medium
created: 2026-10-05
revalidated: 2026-10-05
requires:
  - plans/host/59-one-record-store-provider-and-shared-value-helpers/plan.md
changes: []
creates: []
decisions: []
refs:
  - "[code://packages/agent-acp/src/session.ts#L88-L106](../../../../packages/agent-acp/src/session.ts#L88-L106) - `doing` and `status`, as each of the four agents writes them"
  - "[code://packages/agent-claude/src/session/parts.ts#L62-L68](../../../../packages/agent-claude/src/session/parts.ts#L62-L68) - `doing`, over `ctx.activity`"
  - "[code://packages/agent-claude/src/session/parts.ts#L192-L195](../../../../packages/agent-claude/src/session/parts.ts#L192-L195) - `status`"
  - "[code://packages/agent-cofold/src/runs.ts#L53-L68](../../../../packages/agent-cofold/src/runs.ts#L53-L68) - `doing` and `status`, over `ctx`"
  - "[code://packages/agent-pi/src/session.ts#L179-L184](../../../../packages/agent-pi/src/session.ts#L179-L184) - `doing`"
  - "[code://packages/agent-pi/src/session.ts#L370-L373](../../../../packages/agent-pi/src/session.ts#L370-L373) - `status`"
  - "[code://packages/sdk/src/catalog.ts#L18-L25](../../../../packages/sdk/src/catalog.ts#L18-L25) - `Status`, beside which the shared pieces go"
  - "[code://packages/agent-acp/src/session/queue.ts#L42-L46](../../../../packages/agent-acp/src/session/queue.ts#L42-L46) - a command's title: its first 60 characters, newlines included"
  - "[code://packages/agent-acp/src/session/queue.ts#L159-L164](../../../../packages/agent-acp/src/session/queue.ts#L159-L164) - a message's title: the same rule"
  - "[code://packages/agent-cofold/src/turns.ts#L49-L53](../../../../packages/agent-cofold/src/turns.ts#L49-L53) - cofold's title: the same rule"
  - "[code://packages/agent-pi/src/session.ts#L66-L70](../../../../packages/agent-pi/src/session.ts#L66-L70) - `titleFrom`: the first non-blank line, 80 characters"
  - "[code://packages/agent-pi/src/catalog.ts#L192-L196](../../../../packages/agent-pi/src/catalog.ts#L192-L196) - `firstLine`, `titleFrom` copied in the same package"
  - "[code://packages/agent-claude/src/session.ts#L56](../../../../packages/agent-claude/src/session.ts#L56) - a seeded session's title, the first 60 characters of the seed's first message"
  - "[code://packages/agent-acp/src/plugin.ts#L96-L130](../../../../packages/agent-acp/src/plugin.ts#L96-L130) - `secretsOf` and `fromEnvOf`, which requires exactly one key"
  - "[code://packages/agent-claude/src/plugin.ts#L115-L138](../../../../packages/agent-claude/src/plugin.ts#L115-L138) - `secretsOf`, acp's but for the value type"
  - "[code://packages/agent-claude/src/options.ts#L243-L247](../../../../packages/agent-claude/src/options.ts#L243-L247) - `fromEnvOf`, which allows other keys beside `fromEnv`"
  - "[code://packages/agent-claude/src/claude.ts#L46-L51](../../../../packages/agent-claude/src/claude.ts#L46-L51) - `baseUrlOf`, a third `fromEnv` read, inline"
  - "[code://packages/agent-acp/src/plugin.ts#L267-L292](../../../../packages/agent-acp/src/plugin.ts#L267-L292) - the per-preset loop, which logs and says each failure"
  - "[code://packages/agent-claude/src/plugin.ts#L158-L189](../../../../packages/agent-claude/src/plugin.ts#L158-L189) - the same loop, which says each failure and calls a preset a variant"
  - "[code://packages/sdk/src/vault.ts#L55-L68](../../../../packages/sdk/src/vault.ts#L55-L68) - `secretRef`, the one-key rule"
  - "[code://packages/sdk/src/artifacttools.ts#L42-L46](../../../../packages/sdk/src/artifacttools.ts#L42-L46) - `requireString`, which trims what it answers"
  - "[code://packages/sdk/src/sessiontools.ts#L49-L69](../../../../packages/sdk/src/sessiontools.ts#L49-L69) - `required`, `optional`, `flag`, `when`; `required` answers the value untrimmed"
  - "[code://packages/sdk/src/rpc.ts#L13-L16](../../../../packages/sdk/src/rpc.ts#L13-L16) - four named codes, and no `-32602`"
  - "[code://packages/sdk/src/host/vscodemethods.ts#L102-L130](../../../../packages/sdk/src/host/vscodemethods.ts#L102-L130) - `connectionId` checked twice the same way"
  - "[code://packages/sdk/src/host/vscodemethods.ts#L143-L310](../../../../packages/sdk/src/host/vscodemethods.ts#L143-L310) - a run of `typeof params.x !== 'string'` refusals"
  - npm://@microsoft/agent-host-protocol@1.0.0 - `JsonRpcErrorCodes.InvalidParams` is `-32602`
---

## Goal

The four agent backends stop writing the same session pieces four times: what a session is doing, its status, and its title from the first message come from the sdk, and every backend titles a session the same way.
The two backends with presets read a preset's secrets and environment references and loop over presets through the sdk.
The host's tool inputs and request params are checked by one reader each, and `-32602` has a name.
Nothing a client sees changes except the title acp and cofold give a session.

## Reconnaissance

The files read and the patterns to reuse are the `refs` above, each with its note.

### Searches performed

- `rg -n "const doing|activityChanged" packages/agent-*/src` - four `doing`, identical but for where `activity` is held: a local in acp and pi, `ctx.activity` in claude and cofold, read again by each session's summary row.
- `rg -n "Status.InputNeeded" packages/agent-*/src` - four `status`, the same ternary over different names for waiting, active and failed.
- `rg -n "slice\(0, (60|80)\)" packages/agent-*/src` - acp (`queue.ts:43`, `:160`) and cofold (`turns.ts:50`) cut at 60 with newlines; pi cuts the first line at 80 (`session.ts:69`, `catalog.ts:195`); claude cuts a seed at 60 (`session.ts:56`).
- `rg -n "secretsOf|fromEnvOf" packages/agent-*/src` - acp and claude only.
- `rg -n "RpcError\(-32602" packages/*/src` - 104, of which 65 in `packages/sdk/src`; `rpc.ts` names `-32700`, `-32600`, `-32601`, `-32603` and not `-32602`.
- `rg -n "String\(params\.[a-zA-Z]+ \?\? ''\)" packages/sdk/src/host` - 42 in eight files, 15 of them in `resourcemethods.ts` and 13 in `sessionmethods.ts`.

### Runtime path

```
a turn starts -> doing('Thinking') -> chat/activityChanged + session/activityChanged, once per change
the first message -> titleFrom(text, UNTITLED) -> session/titleChanged
plugin load -> eachPreset(host, presets, build) -> readSecrets(env) -> one agent per preset, a problem per dropped one
a request -> param readers -> -32602 with the same sentence as today
```

### Gaps

- acp and cofold title a session with the first 60 characters, newlines and all, and pi with the first line; one backend's row reads differently from another's for the same message.
- claude reads `{ fromEnv, other }` as a reference and acp does not.
- `-32602` is written raw 104 times.

## Decisions locked in

No decision file: every row below is either Softov's answer or a choice anyone would make.

| What | Source | Task |
| --- | --- | --- |
| Code repeated in more than one place is replaced by one shared helper, with no new dependency | Softov, 2026-10-05, asked which of the survey's findings become plans: all four | 01-06 |
| A session's title from its first message is the first non-blank line, cut at 80 characters (pi's rule), for every backend | Softov, 2026-10-05, asked "acp, cofold and pi each make a session title from the first message, with different rules. Which rule should the shared one use?": "First line, up to 80" | 02 |
| `statusOf`, `activityOf` and `titleFrom` live in `packages/sdk/src/catalog.ts` beside `Status`, exported | the survey's item 5 and Softov's brief for this plan, 2026-10-05 | 01, 02 |
| `readSecrets` and `fromEnvRef` live in `packages/sdk/src/vault.ts` beside `secretRef`, and `eachPreset` in `packages/sdk/src/plugins.ts`, exported | the survey's item 6 and Softov's brief for this plan, 2026-10-05 | 03, 04 |
| `fromEnvRef` takes `secretRef`'s rule: an object whose only key is `fromEnv`, holding a non-empty string | (defaulted: acp already says so and `secretRef` is the sibling; claude's looser read is an open question) | 03 |
| Every refusal keeps its sentence word for word; the loop's noun (`preset`, `variant`) and whether it also logs are the caller's | (defaulted: tests and people read these sentences) | 04, 05, 06 |
| `INVALID_PARAMS = -32602` is named in `rpc.ts` beside the four codes already there | (defaulted: the sibling pattern; the protocol package's `JsonRpcErrorCodes.InvalidParams` is the same number) | 06 |
| Claude's seeded-session title takes the same rule, first line up to 80, through the shared helper | Softov, 2026-10-06, asked "should claude's seeded title use the new rule too?": "Yes same rule" | 02 |
| The derived title is a placeholder: a title the agent gives the session replaces it, and neither replaces a name a person gave; every agent keeps both rules, as acp does | Softov, 2026-10-06, same answer: "if the agent gives the session a title it will get that title?"; [`code://packages/agent-acp/src/session/handlers.ts#L85-L97`](../../../../packages/agent-acp/src/session/handlers.ts#L85-L97) | 02 |
| Claude reads an env reference by the one-key rule, `{ fromEnv }` alone, as acp does | Softov, 2026-10-06, asked "claude takes the one-key rule?": "Yes, one-key rule" | 03 |

## Proposed architecture

- **Data flow** - a backend calls `activityOf(emit)` once and `statusOf({ waiting, active, failed })` per read; a first message goes through `titleFrom`; a plugin's `optionsOf` hands its presets to `eachPreset` and each preset's `env` to `readSecrets`.
- **Event flow** - unchanged: the same two `activityChanged` actions, once per change, and one `session/titleChanged`.
- **State flow** - the last activity is held inside `activityOf`'s closure and read through its `current()`; claude and cofold read that where they read `ctx.activity`.
- **Layer responsibilities** - sdk `catalog.ts`, `vault.ts`, `plugins.ts`: the shared pieces · sdk `toolinput.ts` (new, internal), `rpc.ts`: the readers · agent-acp, agent-claude, agent-cofold, agent-pi: callers.
- **Source-of-truth files** - [`code://packages/sdk/src/catalog.ts`](../../../../packages/sdk/src/catalog.ts), [`code://packages/sdk/src/vault.ts`](../../../../packages/sdk/src/vault.ts), [`code://packages/sdk/src/rpc.ts`](../../../../packages/sdk/src/rpc.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - A session's status and activity come from the sdk](task-01-a-sessions-status-and-activity-come-from-the-sdk.md) | todo | - |
| [02 - Every backend titles a session from the first line, up to 80](task-02-every-backend-titles-a-session-from-the-first-line.md) | todo | - |
| [03 - A preset's secrets and environment references are read by the sdk](task-03-a-presets-secrets-and-environment-references-are-read-by-the-sdk.md) | todo | - |
| [04 - One loop registers a plugin's presets](task-04-one-loop-registers-a-plugins-presets.md) | todo | 03 |
| [05 - The host's tools read their input one way](task-05-the-hosts-tools-read-their-input-one-way.md) | todo | - |
| [06 - Request params are read one way, and -32602 has a name](task-06-request-params-are-read-one-way.md) | todo | - |

## Risks and tradeoffs

- Every agent task needs the peer range host 59 task 05 raises; an agent package that imports `titleFrom` from an sdk without it fails at load, which is what host 59 guards.
- acp and cofold titles change for a message whose first line is short or that starts with a blank line; a session titled before this keeps its stored title.
- Host 57 task 01 builds pi's `find` row with `firstLine`; whichever lands second uses `titleFrom`, and 57's equality test against `list` still holds because both go through the same function.
- `configvalues.ts` and `validate.ts` are hand validators kept on purpose (the sdk takes no runtime dependency) and are not merged with the readers here; `computer/src/manifest.ts`'s refusals and `checkPolicy` are domain rules with their own sentences and stay.
- The watched-session registries in `agent-acp/src/catalog.ts` and `agent-pi/src/catalog.ts` look alike and are keyed differently; they stay two.

## Resume state

- **Done so far:** nothing.
- **Next action:** [task-01-a-sessions-status-and-activity-come-from-the-sdk.md](task-01-a-sessions-status-and-activity-come-from-the-sdk.md), after host 59 is built; 05 and 06 touch only the sdk and can start before it.
- **Open questions:** none.
- **Watch out for:** `activityOf` must emit nothing when the activity did not change, as all four `doing` do; claude's `status` reads truthiness (`ctx.active ?`) and the other three `!== undefined`, so `statusOf` takes booleans and each caller says what counts; pi's `UNTITLED` is the fallback for a blank message, and acp and cofold have their own.

## Final verification checklist

- [ ] `rg -n "const doing|const status = \(\)" packages/agent-*/src` finds nothing.
- [ ] `rg -n "slice\(0, 60\)" packages/agent-*/src` finds nothing.
- [ ] `rg -n "const secretsOf|const fromEnvOf" packages/agent-*/src` finds nothing.
- [ ] `rg -n "RpcError\(-32602" packages/sdk/src` finds nothing.
- [ ] `pnpm exec tsc --noEmit`, `pnpm boundary`, `pnpm test` pass.
- [ ] `plans/index.md` updated.
