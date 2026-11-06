---
title: The session tools can be switched off
status: done
depends: []
layer: server
refs:
  - "[code://packages/server/src/commands/options.ts#L390-L590](../../../../packages/server/src/commands/options.ts#L390-L590) - `serverFields`; `advancedTools` is the nearest boolean, `http` the nearest object-or-boolean"
  - "[code://packages/server/src/commands/run.ts#L626](../../../../packages/server/src/commands/run.ts#L626) - the daemon passes `hostTools()` to every session"
  - "[code://packages/sdk/src/tools/index.ts#L24-L56](../../../../packages/sdk/src/tools/index.ts#L24-L56) - `hostTools`, the session, wakeup and artifact tools"
  - "[code://packages/sdk/src/host/tooling.ts#L1316-L1358](../../../../packages/sdk/src/host/tooling.ts#L1316-L1358) - `boundTools` and `offeredTools`, the tools one session is offered"
  - "[code://packages/sdk/src/host/tooling.ts#L1031-L1034](../../../../packages/sdk/src/host/tooling.ts#L1031-L1034) - `providerOf`, a session's provider"
  - "[code://packages/server/src/rootconfig.ts#L33-L42](../../../../packages/server/src/rootconfig.ts#L33-L42) - `DAEMON_KEYS` and `LIVE`"
  - "[code://packages/sdk/src/host/actions.ts#L429-L441](../../../../packages/sdk/src/host/actions.ts#L429-L441) - a live option applied to running sessions with `retool`"
---

## Objective

A daemon key `sessionTools` is `true` by default, or `false` to offer no session tool.
A daemon key `sessionToolsProviders` is a list of providers. When it is not empty, only the sessions of those providers get the session tools.
The artifact tools, `schedule_wakeup` and `ahp_terminals` are not session tools and stay as they are.

## Files

- `UPDATE: packages/server/src/commands/options.ts:390-590` - `sessionTools`, type boolean, default `true`, and `sessionToolsProviders`, type array of strings, default `[]`.
- `UPDATE: packages/server/src/config.ts` - the option read from the config file.
- `UPDATE: packages/server/src/rootconfig.ts:33-42` - both keys in `DAEMON_KEYS` and `LIVE`.
- `UPDATE: packages/server/src/main.ts` - the option in the help text.
- `UPDATE: packages/sdk/src/types/host.ts:336` - the host options `sessionTools` and `sessionToolsProviders` beside `tools`.
- `UPDATE: packages/server/src/commands/run.ts:626` - the host is given both keys.
- `UPDATE: packages/sdk/src/host/tooling.ts:1316-1358` - `offeredTools` leaves out the nine session tools for a session whose provider is not offered them.
- `UPDATE: packages/sdk/src/host/actions.ts:429-441` - a change to either key retools the running sessions.
- `UPDATE: docs/sdk/HOST.md` - the option.
- `UPDATE: docs/sdk/TOOLS.md` - which tools the option covers.
- `UPDATE: docs/server/REFERENCE.md` - the option in the config reference.
- `UPDATE: packages/sdk/test/host-tools.test.ts` - the option cases below.

## Steps

1. Read the plan's *Decisions locked in* rows for task 03.
2. Add `sessionTools` to `serverFields` with type boolean, default `true`, and `sessionToolsProviders` with type array, items string, default `[]`.
3. Read both keys in `config.ts`, and add both to `DAEMON_KEYS` and `LIVE` in `rootconfig.ts`.
4. Add both keys to the help text in `main.ts`, as the flag parser renders them.
5. Add the host options `sessionTools?: boolean` and `sessionToolsProviders?: string[]` beside `tools`, and pass both from `run.ts`.
6. Mark the nine session tools by name in one exported list in `tools/session.ts`.
7. In `offeredTools`, leave out the listed tools when `sessionTools` is `false`.
8. Leave them out also when `sessionToolsProviders` is not empty and does not hold the session's provider from `providerOf`.
9. On a live change to either key, dispatch `session/serverToolsChanged` and call `retool` for every running session, as for `advancedTools`.
10. Write the option in `docs/sdk/HOST.md`, `docs/sdk/TOOLS.md` and `docs/server/REFERENCE.md`.

## Validation

- `host-tools.test.ts`: `sessionTools: false` offers no session tool and still offers `schedule_wakeup` and the artifact tools.
- `host-tools.test.ts`: `sessionToolsProviders: ['claude']` offers the session tools to a claude session and not to an acp session.
- `host-tools.test.ts`: a live change retools a running session.
- Run `pnpm -s typecheck`, `pnpm -s boundary` and `pnpm -s schema`; each exits 0.
- Run vitest on `packages/sdk`, `packages/server`, `packages/agent-claude` and `packages/agent-acp`; all pass.

## Resume

Done 2026-10-13. Every step is built, and the fork the first build reported is answered. Softov split the option into two keys on 2026-10-13, and this is the two-key build.

**The fork, and its answer.** The first build implemented step 2 as `type: ['boolean', 'array']` and reported that step 4 could not hold beside it. `@cofold/commands` takes a flag's coercer from the JSON Schema, and for a union it reads the first named type. So `--session-tools` took `true` or `false` and refused a provider word. A settings screen would draw one type for a union too. Softov's answer was to split the key. `sessionTools` is the switch, boolean, true by default. `sessionToolsProviders` is the list, an array of strings, empty by default. Each key now carries one type, so the flag parser and the settings screen take both.

File by file:

- `packages/server/src/commands/options.ts` - `sessionTools: boolean` and `sessionToolsProviders: string[]` on `Options`, and the two fields in `serverFields` as steps 2 and 3 write them. The returned `Options` takes `given('sessionTools') ?? true` and `given('sessionToolsProviders') ?? []`. Steps 2 and 3.
- `packages/server/src/config.ts` - both keys on the file's `Config` type. Each says it narrows or is narrowed by the other. Step 3.
- `packages/server/src/rootconfig.ts` - both keys into `DAEMON_KEYS`, between `advancedTools` and `closedChats`, and both into `LIVE`. Step 3. Each is one type, so the property a client draws is a boolean and an array of strings, with no union to fold.
- `packages/server/src/main.ts` - the config-key paragraph now ends `trustToken, advancedTools, sessionTools, sessionToolsProviders`. Step 4.
- `packages/sdk/src/types/host.ts` - `sessionTools?: boolean` and `sessionToolsProviders?: string[]` beside `tools`. Step 5.
- `packages/sdk/src/host/context.ts` - both held like `advancedTools`, because each is a daemon key that takes hold while the daemon runs. Step 5.
- `packages/server/src/commands/run.ts` - the host is given both values from the options. Step 5.
- `packages/sdk/src/tools/session.ts` - `SESSION_TOOL_NAMES`, the nine by name. Step 6.
- `packages/sdk/src/host/tooling.ts` - `ctx.sessionTools` and `ctx.sessionToolsProviders` off the options, defaulting to `true` and `[]`. `sessionToolsFor(uri, provider)` answers whether one session is offered them. `contributingTo(uri, provider)` is the host's tools less the session tools where that answer is no. `toolDefinitions` and `offeredTools` both read it. Steps 7 and 8.
- `packages/sdk/src/host/actions.ts` - after the `advancedTools` block, the same shape for the two keys: every running session is dispatched `session/serverToolsChanged` with its own `toolDefinitions(uri)` and `retool`ed. Step 9.
- `docs/sdk/HOST.md` - two rows in the configuration table, both keys in the daemon-keys list, and the live/restart split. The split says the two session tool keys are rebuilt per session, since a provider list is not one answer for all of them. Step 10.
- `docs/sdk/TOOLS.md` - the `Which sessions are offered the session tools` section, rewritten for two keys. Then two rows in the configuration table, and `The first four` where the daemon's live keys are counted. Step 10.
- `docs/server/REFERENCE.md` - `--session-tools` and `--session-tools-providers <id>` in the flag table, and the `Configuration` sentence. Step 10.
- `packages/sdk/test/host-tools.test.ts` - a new describe, `the session tools, which an install may switch off`, with the three cases the Validation asks for. 63 cases before, 66 after.

Judgement calls the plan does not decide, each visible in the file it is made in:

- The filter is applied in `toolDefinitions(uri)` as well as in `offeredTools(uri, chatUri, provider)`, though steps 7 and 8 name only the second. The `advancedTools` precedent is "neither reported in `serverTools` nor bound for a call", and step 9's live dispatch carries `toolDefinitions(uri)`. A client told of a tool a backend was not handed would draw a control for nothing. One helper, `contributingTo`, is called by both, so the wire and the binding cannot disagree.
- `SESSION_TOOL_NAMES` is read off `sessionTools()` rather than written out a second time. That is what step 6's "mark the nine ... in one exported list" is for. A tool added to the host is one the option switches off. A tool taken away leaves the list, so nothing is kept in step by hand.
- Both keys are read back from `port.values()`, where the `advancedTools` block beside it reads what the client pushed. A pushed `null` is how a client takes a key back. The real `write` deletes the key for one, so what was asked for is not always what the daemon now holds. Reading back means a `null` falls to the default, which is on with no list. The third case holds that for both keys.
- The two keys are read in one block and compared together. Either one moving retools, because the two decide one answer, and a push that changes neither retools nothing.
- Reading only the list would leave a stale switch. Reading only the switch would leave a stale list, so `sessionToolsProviders` is filtered to strings and compared by value.
- The Validation calls the second provider "acp". There is no acp agent in `packages/sdk/test`, because the acp backend is its own package. The second provider in the cases is the `echo` example backend, a real `Agent` handed the same `Start.tools` as any other. The check is the same either way. A provider the list does not name is offered the host's own tools, and none of the session tools.
- The switch is negatable, so the line takes the off as `--no-session-tools`. `--session-tools` remains, as the default restated. The list is repeatable, as `--origin` and `--path` are.
- `run.ts` announces what the two keys decided, one line and only where that is not the default. Nothing said it before, and every key beside it in that announcement says what it did. The line is `session tools: offered to claude`, or `session tools: offered to no session` for the off. Off beats a list, so one line is written rather than two.
- Four server test files needed updating, which the task's Files list does not name. `server-root-config.test.ts` pins the daemon keys - eleven now - and takes each session tool key as its own type. `config-check.test.ts` reads `sessionTools: true` and `sessionToolsProviders: ['claude']` from a file. `server-commands.test.ts` carries `--session-tools-providers` in the flag list and in the repeatable list. `server-cli.test.ts` carries both spellings.

Validation:

- `pnpm -s schema`, `pnpm -s typecheck` and `pnpm -s boundary` each exit 0.
- Vitest: `packages/sdk` 144 files and 2826 tests pass, the three cases above added to 2823. `packages/server` 49 files and 958 tests pass, one case added for the repeatable flag. `packages/agent-claude` 32 files and 295 tests pass. `packages/agent-acp` 15 files and 246 tests pass. Run in one command as well: 240 files and 4325 tests, all pass. Run with `--maxWorkers=2 --testTimeout=10000`, and `pnpm -s schema` first.
- One sdk failure first time was `nested-proxy.test.ts`, which passes alone and passes in the one-command run. It is the load flake this suite has, not this task.
- Filtering only in `offeredTools`, with `toolDefinitions` reading `ctx.contributing`, makes all three cases fail, at test lines 532, 550 and 601. Restored, the file's 66 cases pass.
- Reading the two keys off what was asked, rather than off `port.values()`, makes the third case fail at test line 624. A `null` takes a key back, and the tools were expected on again. Restored, the case passes. Nothing else changed.

Left:

- `packages/sdk/test/fixtures/wire.jsonl` is modified by the suite, as for every task in this plan. 33 lines changed: the endpoint line and the `ahpd.` `_meta` lines, none of them about the tools. `git restore` is denied in this mode, so it is left as the suite wrote it. Run `git restore packages/sdk/test/fixtures/wire.jsonl` before committing.
- All three tasks of this plan are now implemented; nothing in the plan is done, which is Softov's to set.
