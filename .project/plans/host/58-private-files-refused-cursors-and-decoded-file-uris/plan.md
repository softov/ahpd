---
title: Policy and automation files are private, a cursor the host did not issue is refused, and a file URI is decoded
domain: host
status: built
priority: high
created: 2026-10-05
revalidated: 2026-10-05
requires: []
changes: []
creates: []
decisions: []
refs:
  - "[code://packages/sdk/src/policies.ts#L311-L323](../../../../packages/sdk/src/policies.ts#L311-L323) - `save`, which writes the policy file with no mode, so it lands with the umask's"
  - "[code://packages/sdk/src/scheduled.ts#L197-L207](../../../../packages/sdk/src/scheduled.ts#L197-L207) - the automation file's write, also with no mode"
  - "[code://packages/sdk/src/sessions.ts#L236-L241](../../../../packages/sdk/src/sessions.ts#L236-L241) - the session store's write, the shape the two above should have: pid temp name, `0o600`"
  - "[code://packages/sdk/src/users.ts#L672-L687](../../../../packages/sdk/src/users.ts#L672-L687) - `write`, whose temp file is `${path}.tmp` with no pid"
  - "[code://packages/server/src/daemon.ts#L125](../../../../packages/server/src/daemon.ts#L125) - `TEMP`, the one sweeper of temp files, which only knows the pid form"
  - "[code://packages/sdk/src/automations.ts#L51-L59](../../../../packages/sdk/src/automations.ts#L51-L59) - `entry`, which issues `runsNextCursor` as a number of runs"
  - "[code://packages/sdk/src/automations.ts#L260-L269](../../../../packages/sdk/src/automations.ts#L260-L269) - `runs`, where a cursor that is not a number, or is negative, starts again at 0"
  - "[code://packages/sdk/src/types/automations.ts#L208-L209](../../../../packages/sdk/src/types/automations.ts#L208-L209) - the port's `runs` signature"
  - "[code://packages/sdk/src/host/automations.ts#L306-L310](../../../../packages/sdk/src/host/automations.ts#L306-L310) - `fetchAutomationRuns`, which hands the store's page back as it is"
  - "[code://packages/sdk/src/paging.ts#L39-L56](../../../../packages/sdk/src/paging.ts#L39-L56) - `older`, which answers nothing for a cursor it did not issue, the pattern `runs` mirrors"
  - "[code://packages/sdk/src/host/sessionmethods.ts#L182-L190](../../../../packages/sdk/src/host/sessionmethods.ts#L182-L190) - `fetchTurns`, which turns that nothing into `-32602 Unrecognised cursor`"
  - "[code://packages/sdk/src/resources.ts#L32-L41](../../../../packages/sdk/src/resources.ts#L32-L41) - `pathOf` with `fileURLToPath` and `uriOf` with `pathToFileURL`, the one pair that encodes"
  - "[code://packages/sdk/src/host/channels.ts#L19-L20](../../../../packages/sdk/src/host/channels.ts#L19-L20) - the second `uriOf`, `file://${path}`, not encoded"
  - "[code://packages/sdk/src/debuglogs.ts#L43](../../../../packages/sdk/src/debuglogs.ts#L43) - `asPath`, which decodes by hand"
  - "[code://packages/sdk/src/policy.ts#L43-L49](../../../../packages/sdk/src/policy.ts#L43-L49) - `splitFor`, which refuses with `-32609`"
  - "[code://packages/sdk/src/people.ts#L312-L318](../../../../packages/sdk/src/people.ts#L312-L318) - people's `split`, also `-32609`"
  - "[code://packages/computer/src/provider.ts#L118-L122](../../../../packages/computer/src/provider.ts#L118-L122) - computer's `at`, which refuses with `-32009`"
  - "[code://packages/sdk/src/usage.ts#L394-L397](../../../../packages/sdk/src/usage.ts#L394-L397) - usage's `at`, also `-32009`"
  - "[code://packages/sdk/src/host/resourcemethods.ts#L52-L58](../../../../packages/sdk/src/host/resourcemethods.ts#L52-L58) - `storeFor`, which hands a provider only URIs whose lowercased scheme is its own"
  - "npm://@microsoft/agent-host-protocol@1.0.0 - `common/errors.ts`: `JsonRpcErrorCodes.InvalidParams` is `-32602`, `AhpErrorCodes.PermissionDenied` is `-32009` (\"not permitted to access\"), and no `-32609` exists; `common/commands.ts` says an unrecognised cursor SHOULD be rejected with `InvalidParams`"
---

## Goal

Five small defects the code reduction survey of 2026-10-05 found are fixed, each with a case written first and seen failing.
The policy and automation files are written owner-only like every other file the daemon keeps, the user file's temp name is its writer's own, a page of automation runs asked for with a cursor the host did not issue is refused rather than answered from the start, every `file://` URI the host reads is percent-decoded and every one it writes is encoded the same way, and a provider refuses a URI it cannot split with one code.

## Reconnaissance

The files read and the patterns to reuse are the `refs` above, each with its note.

### Searches performed

- `rg -n "writeFileSync" packages/*/src` - sessions, users, owners, vault and daemon pass `mode: 0o600`; `policies.ts:318` and `scheduled.ts:202` pass nothing.
- `rg -n "\.tmp" packages/*/src` - every temp name carries `process.pid` except `users.ts:675`.
- `rg -nF "replace(/^file:" packages/sdk/src` - 15 `.replace(/^file:\/\//, '')` strips in `host/sessionmethods.ts` (234, 490, 680, 793, 893), `host/chatactions.ts` (180, 339, 747), `host/lifecycle.ts:711`, `host/tooling.ts:325`, `host/vscodemethods.ts:242`, `host/terminals.ts:266`, `host/changesets.ts:39`, `automations.ts:170`, `sessiontools.ts:158`, and one `.replace(/^file:\/\/[^/]*/, '')` in `terminals.ts:126` for a shell's OSC 7.
- `rg -n "'file://'.length" packages/sdk/src` - two more strips by slicing, `host/facts.ts:241` and `sessiontools.ts:298`, and the one that decodes, `debuglogs.ts:43`.
- `rg -n "uriOf" packages/sdk/src` - `resources.ts:41` encodes and serves the file store; `host/channels.ts:20` does not and has one caller, `host/sessionmethods.ts:249`, the `@` completion's attachment URI.
- `rg -n "3260[0-9]" node_modules/@microsoft/agent-host-protocol/src` - nothing: `-32609` is not a protocol code.
- `rg -n "32609|32009" packages/*/test` - `people.test.ts:72` and `policy-scheme.test.ts:171-172` pin `-32609`; `usage-scheme.test.ts:288` pins `-32009`; computer has no case for it.

### Runtime path

```
policy or automation edited -> save() -> <file>.<pid>.tmp written with the umask -> renamed over the file, readable by the machine
fetchAutomationRuns { cursor: "x" } -> store.runs -> Number("x") is NaN -> page from 0 -> the client pages the newest runs again
resourceRead file:///home/a/my%20dir/x -> pathOf decodes -> fine; createTerminal { cwd: file:///home/a/my%20dir } -> strip -> "/home/a/my%20dir" -> no such directory
resourceRead usage:x (no //) -> storeFor routes by scheme -> usage at() -> -32009, a permission answer to a malformed URI
```

### Gaps

- `policies.json` and `automations.json` are readable by every account on the machine; the first names who may use what, the second whose work an automation is.
- Two writers of the user file at once share one temp file, so one can rename the other's half-written bytes into place.
- `runs` restarts at 0 on a cursor it did not issue, which `common/commands.ts` in the protocol says to reject with `InvalidParams`.
- A folder with a space or a non-ASCII letter in its name, sent as VS Code sends it, arrives at 18 places as `my%20dir`.
- A provider refuses a URI it cannot split with `-32609`, which no specification defines, or `-32009`, which says the caller is not permitted.

## Decisions locked in

No decision file: every row below is either Softov's answer or a choice anyone would make.

| What | Source | Task |
| --- | --- | --- |
| Code repeated in more than one place is replaced by one shared helper, with no new dependency | Softov, 2026-10-05, asked which of the survey's findings become plans: all four | 04, 05, 06 |
| The policy and automation files are written `0o600`, as the session, user, owner, vault and daemon files are | (defaulted: every other file the daemon keeps is owner-only, and nothing reads these two but the daemon) | 01 |
| The user file's temp name carries the pid, `${path}.${pid}.tmp` | (defaulted: the form every other writer uses and the one `daemon.ts`'s sweeper knows) | 02 |
| A runs cursor the store did not issue answers nothing from the store and `-32602 Unrecognised cursor <c>` from the host, as `older` and `fetchTurns` do | npm://@microsoft/agent-host-protocol@1.0.0 `common/commands.ts`: "An unrecognised cursor SHOULD be rejected with an `InvalidParams` error"; [`code://packages/sdk/src/host/sessionmethods.ts#L182-L190`](../../../../packages/sdk/src/host/sessionmethods.ts#L182-L190) | 03 |
| One `localPath(uri)` that percent-decodes and never throws, and one `uriOf(path)` that encodes with `pathToFileURL`, in one sdk file; `channels.ts`'s unencoded copy goes | (defaulted: `resources.ts` already reads and writes this way, and VS Code sends encoded URIs) | 04, 05 |
| A provider that cannot split a URI refuses it with `-32602`, people, policy, usage and computer alike | npm://@microsoft/agent-host-protocol@1.0.0 `common/errors.ts`: `-32609` is not defined, `-32009` is `PermissionDenied`; [`code://packages/sdk/src/host/resourcemethods.ts#L52-L58`](../../../../packages/sdk/src/host/resourcemethods.ts#L52-L58) hands a provider only its own scheme, so what reaches `split` is a malformed parameter such as `usage:x`; (defaulted: `-32602` rather than `-32601`, which [A scheme nobody serves is not a permission error](../../../decisions/a-scheme-nobody-serves-is-not-a-permission-error.md) keeps for a scheme no provider serves) | 06 |
| A provider that cannot split a URI refuses it with `-32602`, people, policy, usage and computer alike | Softov, 2026-10-06, asked "which error code for a URI of its scheme a provider cannot split?": "-32602 InvalidParams" | 06 |
| The agents' own `file://${path}` builders move to the sdk's `uriOf` in a later plan, after host 59 raises their peer range; this plan leaves them | Softov, 2026-10-06, asked "move the agents to the shared uriOf too?": "Yes, in a later plan" | - |
| The runs cursor fix stays here; host 43 p2 keeps its refusal when it lands | Softov, 2026-10-06, asked "keep the small fix in 58?": "Keep it in 58" | 03 |
| `localPath` decodes the same way with or without an authority: an encoded slash or NUL is never decoded | Softov's review of the host/58 build, 2026-10-06 | 04 |

## Proposed architecture

- **Data flow** - the two stores write as `sessions.ts` does; `runs` answers `undefined` for a foreign cursor and the host refuses; every host path that reads a `file:` URI goes through `localPath`, and every one the host builds from a path goes through `uriOf`.
- **Event flow** - unchanged.
- **State flow** - unchanged; the files keep their format, only their mode and temp name change.
- **Layer responsibilities** - sdk `policies.ts`, `scheduled.ts`, `users.ts`: the writes · sdk `automations.ts`, `types/automations.ts`, `host/automations.ts`: the cursor · sdk `fileuri.ts` (new) and the 18 strip sites: the paths · sdk `people.ts`, `policy.ts`, `usage.ts` and computer `provider.ts`: the refusal code.
- **Source-of-truth files** - [`code://packages/sdk/src/resources.ts`](../../../../packages/sdk/src/resources.ts), [`code://packages/sdk/src/paging.ts`](../../../../packages/sdk/src/paging.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - Policies and automations are written owner-only](task-01-policies-and-automations-are-written-owner-only.md) | implemented | - |
| [02 - The user file is written through a temp file of its own](task-02-the-user-file-is-written-through-a-temp-file-of-its-own.md) | implemented | - |
| [03 - A runs cursor the host did not issue is refused](task-03-a-runs-cursor-the-host-did-not-issue-is-refused.md) | implemented | - |
| [04 - One file URI reader and one writer](task-04-one-file-uri-reader-and-one-writer.md) | implemented | - |
| [05 - Every file URI the host reads is decoded](task-05-every-file-uri-the-host-reads-is-decoded.md) | implemented | 04 |
| [06 - A URI a provider cannot split is refused with one code](task-06-a-uri-a-provider-cannot-split-is-refused-with-one-code.md) | implemented | - |

## Risks and tradeoffs

- `writeFileSync`'s `mode` applies when a file is created, and the temp file is new on every save, so the rename leaves the policy and automation files `0600` from the first save after this lands; a file written before stays as it was until then.
- Host 43 p2 task 02 rewrites `runs` so a page arrives on `automation/set`, and already plans the same `-32602`; task 03 here is the small fix in the meantime, and 43 p2 keeps its refusal.
- `tail` and `older` page turns backwards and stay as they are; a shared forward pager for `listSessions` and runs is the survey's item 9 and is not this plan, so task 03 does not merge `runs` into `paging.ts`.
- Decoding changes what a URI with a literal `%` resolves to: the agents still build `file://${path}` without encoding (about 20 places in `agent-*/src`), so a folder whose real name holds `%20` is read back as a space; `localPath` keeps the text as it is when it does not decode, and the agents' builders are an open question below.
- VS Code encodes more characters than `pathToFileURL` does (`agent-claude/src/input.ts:172-186` copies its encoder), so a URI this host writes may differ by text from one VS Code writes for the same path; both decode to the same path, which is what every reader here compares after this plan.
- `-32602` changes three pinned tests in people, policy and usage; the refusal's sentence stays word for word.

## Resume state

- **Done so far:** all six tasks implemented, on 2026-10-06; [implemented.md](implemented.md) says what was built and what was verified.
- **Next action:** Softov's review; the tasks are `implemented`, not `done`.
- **Open questions:** none.
- **Watch out for:** `pathOf` in `resources.ts` throws an `RpcError` and stays the file store's; `localPath` never throws, because the 18 sites it replaces never threw; `sessiontools.ts:158` lowercases for a comparison and keeps doing so after decoding; `terminals.ts:126` drops an OSC 7 host part and keeps dropping it.

## Final verification checklist

- [x] A fresh `policies.json` and `automations.json` are `0600`.
- [x] No writer in `packages/*/src` uses a temp name without the pid.
- [x] `fetchAutomationRuns` with `cursor: "x"` or `"-1"` answers `-32602`.
- [x] `rg -nF "replace(/^file:" packages/sdk/src` finds nothing, and `host/channels.ts` has no `uriOf`.
- [x] `rg -n "32609" packages` finds nothing.
- [x] `pnpm exec tsc --noEmit`, `pnpm boundary`, `pnpm test` pass.
- [x] `plans/index.md` updated.
