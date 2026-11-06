---
title: The switch is read from the file and reaches a running claude session
status: done
depends: []
layer: server
refs:
  - "[code://packages/server/src/commands/options.ts#L477-L491](../../../../packages/server/src/commands/options.ts#L477-L491) - `sessionTools` and `sessionToolsProviders`, each with a `default` that hides the file"
  - "[code://packages/server/src/commands/options.ts#L924](../../../../packages/server/src/commands/options.ts#L924) - `given`, the flag before the file"
  - "[code://packages/server/src/commands/options.ts#L1051-L1053](../../../../packages/server/src/commands/options.ts#L1051-L1053) - the fallbacks, which give the same defaults"
  - "[code://packages/sdk/src/host/tooling.ts#L1085-L1092](../../../../packages/sdk/src/host/tooling.ts#L1085-L1092) - `retool`, which drops what `setTools` answers"
  - "[code://packages/agent-claude/src/session/clienttools.ts#L482-L492](../../../../packages/agent-claude/src/session/clienttools.ts#L482-L492) - claude's `setTools`, through `setMcpServers`"
---

## Objective

`"sessionTools": false` and `"sessionToolsProviders"` in `config.json` take effect when no flag is given.
A live change of either key reaches a running claude session: a tool switched off cannot be called, and a tool switched on can.

## Files

- `UPDATE: packages/server/src/commands/options.ts:477-491` - the two fields have no `default`; the fallbacks give it.
- `UPDATE: packages/sdk/src/host/tooling.ts:1085-1092` - `retool` logs a `false` or a failure from `setTools`.
- `UPDATE: packages/agent-claude/src/session/clienttools.ts:482-492` - `setTools` makes the running CLI use the new tool list.
- `UPDATE: packages/server/test` - a case that a file value reaches the options with no flag.
- `UPDATE: packages/agent-claude/test` - a case that a live `setTools` changes what the CLI can call.

## Steps

1. Read the plan's *Resume state*, which says how task 03 failed live.
2. Remove `default` from `sessionTools` and `sessionToolsProviders` in `serverFields`.
3. Check that `--help` still says the defaults, and that `advancedTools` reads the same way.
4. Add a test that `"sessionTools": false` in the file, with no flag, gives `sessionTools: false`.
5. Make `retool` log the session's URI when `setTools` answers `false` or throws.
6. Find what the Claude SDK does when `setMcpServers` declares the `ahp` server again with other tools.
7. If the SDK keeps the old tools, stop and report what you found, with the options you see.
8. In `setTools`, when the session declares `ahp` now, call `setMcpServers` without it first, then with the new `ahp`.
9. Make an empty list call `setMcpServers` once, without `ahp`.
10. After the first call succeeds, hold the set without `ahp`, and hold the new set only after the second call.
11. Add the agent-claude test that a live `setTools` disconnects `ahp` and connects the new one.

## Validation

- A file value of `sessionTools: false`, with no flag, offers no session tool, and the startup line says so.
- A file value of `sessionToolsProviders`, with no flag, offers the session tools to those providers only.
- A live `sessionTools: false` makes a running claude session refuse `mcp__ahp__get_current_session`.
- A live `sessionTools: true` makes a running claude session able to call `mcp__ahp__list_sessions`.
- Run `pnpm -s typecheck`, `pnpm -s boundary` and `pnpm -s schema`; each exits 0.
- Run vitest on `packages/sdk`, `packages/server`, `packages/agent-claude` and `packages/agent-acp`; all pass.

## Resume

Step 7 stopped the task on 2026-10-13: the Claude Agent SDK keeps the old tools when the `ahp` server is declared again, so re-declaring it was a no-op. Softov took option 1 below the same day - "Remove, then add again" - and steps 8 to 11 are built on it. Every step of the task is now built; nothing here is reviewed or set to done.

### Step 6: what the SDK does with a server of the same name

`Query.setMcpServers` in `@anthropic-ai/claude-agent-sdk@0.3.278` (`node_modules/.pnpm/@anthropic-ai+claude-agent-sdk@0.3.278_*/node_modules/@anthropic-ai/claude-agent-sdk/sdk.mjs`) splits the declaration into sdk-type servers (`type: "sdk"` and an `instance`) and the rest, then walks the sdk ones:

```js
let l = this.sdkMcpServers.get(a);
if (!l) this.connectSdkMcpServer(a, c);
else if (rm(c.timeout) !== l.timeout) ie(`... '${a}' is already registered; its timeout change is ignored until the server is removed and re-added`);
```

A name already registered is left exactly as it was. `createSdkMcpServer` builds a fresh server object holding that call's tools, and `connectSdkMcpServer` is what binds it to the name's transport, which is where `handleMcpControlRequest` routes the CLI's `tools/list`. `ahp` is registered at construction: `packages/agent-claude/src/session.ts:139` puts it in `ctx.declared`, `packages/agent-claude/src/session/query.ts:283` passes that as `mcpServers`, and the `Query` constructor connects every sdk server it was given. So by the time `setTools` declares `ahp` again the name is taken, the new instance is thrown away, and the CLI goes on seeing the old tools. The control request that does go out carries `{type: 'sdk', name: 'ahp'}` and never the tools. The only thing an already-registered name provokes is the timeout warning above, and the timeout never changes here.

**So this SDK keeps the old tools.** Re-declaring `ahp` is a no-op, and that is the whole of the second live defect.

Worth knowing when reading the log line step 5 added: `setMcpServers` resolves normally here, so `agent-claude`'s `setTools` answers `true` and the new warning never fires. The host believes the retool worked. Step 5 fixes the other half of the old comment - a backend that answers `false` or throws was dropped in silence - and not this failure.

### The options, as they stood

1. **Declare the set twice.** `setMcpServers` with `ahp` left out, then again with the new one. The first call disconnects it (`disconnectSdkMcpServer` closes the transport and takes it out of the map), the second connects the new instance. Two control requests, and a window in which the CLI has no `ahp` server at all - a call already out in that window has nothing to land on. This is the smallest change and the one the SDK's own warning points at ("until the server is removed and re-added"). **Taken by Softov on 2026-10-13 and built as steps 8 to 11.**
2. **Start the chat again**, so the CLI is handed the new list at startup. The host already has the path and holds a move until the turn ends. Costs the conversation's process, and the counts task 02 keeps are per session tree, so a restart is not free of them.
3. **Name the server on the tool set** (`ahp-2`). No removal window, but the tools become `mcp__ahp-2__*`, which breaks the naming this task's own validation asks for and every prompt that names a tool.
4. **Accept the CLI's limit.** A live change reaches the sessions started after it and not the ones already running, and the log says so rather than the host pretending. Nothing is built; the validation bullets about a running session stay unmet.

### What was built

- `packages/server/src/commands/options.ts` - `default` taken off `sessionTools` and `sessionToolsProviders`. The fallbacks in `optionsFrom` are the only defaults now, which is what the file's header comment says the rule is; `--help` still says "On by default" in the description and the two fields read exactly as `--advanced-tools` does.
- `packages/sdk/src/host/tooling.ts` - `retool` logs the session's URI when `setTools` answers `false` or throws, instead of dropping both.
- `packages/server/test/server-cli.test.ts` - a case that a file holding `sessionTools: false`, then one holding `sessionToolsProviders`, reaches the announcement when the line names neither key. It was checked against the defect by putting the `default` back, and it fails there.
- `packages/server/test/server-root-config.test.ts` - the two `default:` assertions dropped, since the field no longer carries one and the written schema is built from the fields.

### What steps 8 to 11 built

- `packages/agent-claude/src/session/clienttools.ts` - `setTools` declares twice when `ahp` is on the list: the set with `ahp` taken out, then the set with the new `ahp` in it. An empty list makes the first call alone, there being no server to add back. A refused declaration answers `false`. The review fix below says what the session holds then. The method's doc comment carries the why and names the decision; its last paragraph was rewritten with the review fix, since it still said a refusal leaves the session offering what it offered before, which the fix made untrue.
- `packages/agent-claude/test/agent-claude-contributed-tools.test.ts` - the harness's `refuse` went from a boolean to `'all' | number`, with a `made` counter and a `refusingAt(at)` that refuses the `at`-th declaration from there on, so a case can hold the removal and refuse the re-add.   Three cases were there and three were added. The two that count declarations went from 1 to 2, and the refusal case now also asserts nothing went out. The added ones:
  - `removes the ahp server first, then declares it again with the new tools` - the two declarations, `['host']` then `['ahp', 'host']`.
  - `declares one set, with no ahp in it, when the list is emptied` - three declarations over two changes, the last `['host']`.
  - `holds the set without ahp when the declaration that adds it back is refused` - renamed by the review fix below.
  - Checked against the old single-declaration form: five of the six fail, and the one that passes is the whole-set case, whose last declaration is the same either way.

### Checks

Run 2026-10-13 on a loaded box (`--maxWorkers=2 --testTimeout=15000`). `pnpm -s typecheck`, `pnpm -s boundary` and `pnpm -s schema` each exit 0. vitest over `packages/sdk`, `packages/server`, `packages/agent-claude` and `packages/agent-acp`: 241 files, 4345 tests, all passing.

The file half of the validation is met end to end: `sessionTools: false` from the file with no flag offers no session tool and says so, and `sessionToolsProviders` from the file narrows the offer. The two bullets about a running claude session are met as far as the tests reach: the session declares the new set in the two steps the SDK needs and holds what those declarations carried, which is the whole of what the backend can decide. No test reads a real CLI's `tools/list` back after a live change - `packages/sdk/test/support/claude-sdk.ts` is a fake `setMcpServers` that records the declarations - so a run against a real CLI is what would close those two bullets.

Worth knowing when reading them: the `ahp` server carries the host's tools as well as a client's - `boundTools` is `clientTools` plus `contributingTo`, and the session tools are in the second - so the window between the two declarations is a window with no `mcp__ahp__list_sessions` either. That is what makes a live `sessionTools: false` reach a running session at all.

### Left for Softov

- `packages/sdk/test/fixtures/wire.jsonl` is rewritten by the suite, with the host endpoint and the 39 `ahpd.` `_meta` lines. Restore it with `git checkout -- packages/sdk/test/fixtures/wire.jsonl`; every restore command is refused in this mode, so it is still dirty.
- Nothing here is committed.

### Review fix, 2026-10-13

The review changed `setTools` in two places.
A session with no `ahp` yet now makes no removal call, as step 8 says.
After the removal succeeds, the session holds the set without `ahp`.
So after a refused re-add, the session does not hold a list that the CLI does not have.
The agent-claude cases now check both.
