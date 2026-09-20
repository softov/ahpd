---
title: A session's title strategy shapes rename_chat, and is snapshotted when the session opens
status: done
depends: [task-01-root-config-keys.md]
layer: packages/sdk
refs:
  - code://packages/sdk/src/sessiontools.ts#L496-L528 - `rename_chat`, always offered and always carrying `automatic`
  - code://packages/sdk/src/types/host.ts#L263-L284 - `HostTool`, which gains the per-session variant
  - code://packages/sdk/src/host.ts#L3111-L3135 - `contributing` and `toolDefinitions`, which become per session
  - code://packages/sdk/src/host.ts#L3168-L3174 - `retool`, which hands a session's chats their tools again
  - code://packages/sdk/src/host.ts#L3330-L3335 - `boundTools` and `instructions`
  - code://packages/sdk/src/host.ts#L3608-L3610 - the session snapshot's `serverTools`
  - code://packages/sdk/src/host.ts#L3779-L3816 - `openSession`, where the strategy is snapshotted
  - code://packages/sdk/src/host.ts#L3872-L3887 - `setTools`, which replaces the set and tells every running session
  - code://test/sessiontools.test.ts#L196-L208 - the tool set and the required fields asserted today
  - code://test/host.test.ts#L4280-L4300 - the advertised tool names
  - code://test/host.test.ts#L4440-L4461 - the `rename_chat` cases
  - file:///github/externals/vscode/src/vs/platform/agentHost/node/shared/sessionServerTools.ts#L1520-L1532 - `isEnabled` and `getDefinitionForSession` shape `rename_chat` by strategy
  - file:///github/externals/vscode/src/vs/platform/agentHost/node/agentHostSessionTitleController.ts#L905-L921 - the strategy the reference snapshots
---

## Objective

A session's title strategy is resolved from `deferredTitleGeneration` when it opens, `rename_chat` is not offered under a utility strategy, and under a deferred strategy it is offered without `automatic` and with the reference's re-description.

## Files

- `UPDATE: packages/sdk/src/types/host.ts:263-284` - add `TitleStrategy` and `HostTool.forSession`.
- `UPDATE: packages/sdk/src/sessiontools.ts:496-528` - `rename_chat` gains `forSession`, and its deferred description is written beside the tool.
- `UPDATE: packages/sdk/src/host.ts:3118-3135` - `toolDefinitions(uri)` and `boundTools(uri, chatUri)` apply `forSession` and drop a tool it says is not offered.
- `UPDATE: packages/sdk/src/host.ts:3330-3335` - `boundTools(uri, chatUri)` and `instructions(uri)` follow the same shaping.
- `UPDATE: packages/sdk/src/host.ts:3779-3816` - `openSession` sets `strategies.set(uri, strategyOf(uri))` before `spawn`, so a later root change does not move a running session.
- `UPDATE: packages/sdk/src/host.ts:3608-3610`, `:3683` and `:3883-3886` - the snapshots and `setTools` report `toolDefinitions(uri)`.
- `UPDATE: test/sessiontools.test.ts:196-208` - a case for the three strategies.
- `UPDATE: test/host.test.ts:4280-4300` and `:4440-4461` - the deferred case end to end.

## Steps

1. `export type TitleStrategy = 'activeAgent' | 'utility' | 'deferred';` in `types/host.ts`.
2. `HostTool.forSession?: (session: { titleStrategy: TitleStrategy }) => { offered: boolean; definition?: Partial<ToolDefinition> } | undefined` in the same file, commented as the shape one session's strategy asks for.
3. In `sessiontools.ts`, `rename_chat` gets `forSession`: `utility` answers `{ offered: false }`; `deferred` answers `{ offered: true, definition: { description: DEFERRED_RENAME_CHAT_DESCRIPTION, inputSchema: { ...the current schema, properties: the current properties without automatic } } }`; `activeAgent` answers `undefined`.
4. Write `DEFERRED_RENAME_CHAT_DESCRIPTION` from the reference's deferred text: a rename only when the user explicitly asks, automatic naming is handled by the host, and no `automatic` argument (decision 1 and the reference `sessionServerTools.ts#L1530`).
5. In `host.ts`, `const strategies = new Map<string, TitleStrategy>();` and `const strategyOf = (uri: string): TitleStrategy => strategies.get(uri) ?? (rootConfig.deferredTitleGeneration === true ? 'deferred' : 'activeAgent');`.
6. In `openSession`, before `spawn`, `strategies.set(uri, strategyOf(uri))`; a browsed session with no entry resolves from the root config each time, which is the compatibility path the reference has.
7. `toolDefinitions(uri)`: apply `compact` first and then `forSession`, flattening a tool whose variant answers `offered: false` out of the list; `boundTools` and `instructions` use the same shaped definition.
8. `setTools` and the compact re-dispatch call `toolDefinitions(uri)` per session rather than the flat list.

## Validation

- `test/sessiontools.test.ts`: a new case takes the `rename_chat` tool and calls `forSession({ titleStrategy: 'utility' })`, asserting `offered: false`; `deferred` asserts the returned definition's `properties` has no `automatic` and its description differs from the current one; `activeAgent` asserts `undefined`.
- `test/host.test.ts`: with `deferredTitleGeneration: true` pushed before `createSession`, the session state's `serverTools` has `rename_chat` without `automatic`, and `rename_chat` called without it still answers `Renamed chat to "<title>".`.
- `pnpm vitest run test/sessiontools.test.ts` and `pnpm vitest run test/host.test.ts` green.
- `pnpm test`, `pnpm typecheck` and `pnpm boundary` green.

## Resume

