---
title: Every register method checks what it is given before it records it
status: done
depends:
  - task-01-contract-and-fold.md
layer: packages/sdk
refs:
  - code://packages/sdk/src/types/plugin.ts - `PluginHost`, the surface this task implements and checks
  - code://packages/sdk/src/types/agent.ts#L158-L300 - `Agent`, the required members `checkAgent` tests for
  - code://packages/sdk/src/types/host.ts#L279-L332 - `HostTool`, the required members `checkTool` tests for
  - code://packages/sdk/src/types/host.ts#L25-L130 - `ResourceStore`, `TerminalStore` and `DirectoryFacts`
  - code://packages/sdk/src/types/changes.ts - `ChangesetSource`
  - code://packages/sdk/src/types/worktrees.ts - `Worktrees`
  - code://packages/sdk/src/types/github.ts - `PullRequests`
  - code://packages/sdk/src/types/automations.ts - `AutomationStore`
  - code://packages/sdk/src/types/sessions.ts - `SessionStore`
  - code://.project/decisions/plugin-registration-kinds.md - why the check exists and where it lives
  - file:///github/doop/packages/sdk/src/plugin-asserts.ts - the same idea in doop, one assert per registered shape
  - code://scripts/dev-hooks.mjs - the repository's own habit of a small hand-written check instead of a dependency
---

## Objective

`packages/sdk/src/plugins.ts` exports `pluginHost(by, context)`, the `PluginHost` a plugin's `apply` is handed, and every `register*` on it refuses a value whose required members are missing or the wrong kind, throwing one message naming the plugin, the method and the member, so a bad registration fails its plugin and never reaches `createHost`.

## Files

- `CREATE: packages/sdk/src/validate.ts` - `checkAgent`, `checkTool`, `checkPort`, and the `miss` helper they report through.
- `UPDATE: packages/sdk/src/plugins.ts` - `pluginHost(by, context)`, which validates then records into a `Contribution`.
- `UPDATE: packages/sdk/src/index.ts` - export `pluginHost` beside `foldHostOptions`.
- `CREATE: test/plugin-validate.test.ts` - the cases below.

## Steps

1. Write `miss(by, method, member, expected)` returning the one message shape every check uses: the plugin, the method, the member, and what was expected there. One shape, because a reader of the daemon log has to tell a plugin's mistake from the host's.
2. Write `checkAgent(value, by)`: an object, with `provider` and `displayName` non-empty strings, and `schema`, `defaults` and `create` functions. Every other member of `Agent` is optional, so each one that is present is checked to be a function.
3. Write `checkTool(value, by)`: an object, with `definition` an object carrying a non-empty string `name`, and `run` a function. Check `instruction` as a string when present.
4. Write `checkPort(key, value, by)`: an object, then the required members that port's contract names, each a function, keyed by `PortKey` so the compiler refuses a port added without a checker.
5. Use the members the interfaces name today: `resources` needs `list`, `read`, `resolve`, `complete`; `terminals` needs `create`; `changes` needs `scopes`, `state`, `summary`; `directories` needs `meta`; `worktrees` needs `repository`, `branches`, `create`, `dirty`, `remove`; `github` needs `forBranch`, `create`; `automations` needs `list`, `get`, `triggers`, `create`, `update`, `remove`, `run`, `runOf`, `runs`; `sessions` needs `flags`, `setFlags`, `config`, `setConfig`, `artifacts`, `setArtifacts`, `pullRequests`, `setPullRequests`, `chatTitle`, `setChatTitle`, `forget`; `diagnostics` requires nothing, so an object passes and a comment says why.
6. Write `pluginHost(by, context)` returning `{ host, contribution }`, where each method calls its checker first and only then records: `registerAgent` and `registerTool` append, each `register<Port>` records `{ value, replace: when === 'replace' }`.
7. Refuse a second registration of the same port by the same plugin inside `pluginHost`, naming the key, since that is a mistake in one `apply` rather than a collision between two plugins, which the fold owns.
8. Refuse a duplicate agent `provider` and a duplicate tool name inside one plugin too, because the same `apply` twice is the same mistake as the same plugin twice.
9. Do not check anything optional away: a port with the write half left off, a `Watcher`-less `resources`, an `Agent` with no `probe` and a `Diagnostics` with nothing on it are all valid, and a regression case pins each so a later stricter checker does not quietly break them.
10. Throw a plain `Error` from each check, so the loader's existing try around `apply` in task 03 reports it and discards the contribution, and no second failure path is introduced.

## Validation

- `test/plugin-validate.test.ts`:
  - a complete `Agent`, `HostTool` and each of the nine ports record without throwing, and the fold sees them.
  - `registerAgent({})` throws naming the plugin, `registerAgent` and `provider`.
  - `registerAgent` with a valid `provider` but no `create` throws naming `create`.
  - `registerTool` with a `definition` but no `name` throws naming `name`; with no `run` throws naming `run`.
  - `registerResources({})` throws naming `list`; `registerTerminals({})` throws naming `create`.
  - `registerSessions` with everything but `chatTitle` throws naming `chatTitle`, which is the case that catches a member added to the interface and not to the checker.
  - `registerDiagnostics({})` is accepted, and so is an `Agent` with no `probe`.
  - a second `registerResources` from the same plugin throws naming `resources`.
  - two agents with the same `provider` in one plugin throw; the same across two plugins is still the fold's problem, not this one.
- A test written against a plain JavaScript object with no types at all, because that is the caller the checks exist for.
- `pnpm test` green, `pnpm typecheck` green, `pnpm boundary` green.

## Resume

Done 2026-09-20.
`packages/sdk/src/validate.ts` holds `miss`, `checkAgent`, `checkTool`, `checkPort` and the `PORT_MEMBERS` and `PORT_METHOD` tables keyed by `PortKey`.
`packages/sdk/src/plugins.ts` gains `pluginHost(by, context)` returning `{ host, contribution }`, and `packages/sdk/src/index.ts` exports both it and the `HostRecording` type.
`test/plugin-validate.test.ts` covers a complete `Agent`, `HostTool` and all nine ports, then the empty and incomplete values for `provider`, `create`, `name`, `run`, `list`, `create` and `chatTitle`, empty `diagnostics` and a probe-less `Agent`, a port registered twice by one plugin, and a repeated provider inside one plugin against the fold's handling of it across two.
Verified: `pnpm test` 667 passed, `pnpm typecheck` green, `pnpm boundary` green.
Departure from the plan: `checkAgent` checks each optional member by the kind the interface declares rather than "each present member is a function", because `description` is a string and `chats` an object; `checkPort` also checks `github.resource`, which the interface requires and the plan's shorthand omitted.
The checkers are hand-written, so the test pairs each with a complete implementation and with an empty one, which is what makes a later required member fail here rather than reach a host.
