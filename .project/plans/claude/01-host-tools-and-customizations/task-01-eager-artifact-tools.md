---
title: The artifact tools carry a load policy, and the one the instruction names is eager
status: done
depends: []
layer: packages/sdk
refs:
  - code://packages/sdk/src/types/host.ts#L270-L284 - `HostTool`, which gains an optional `deferLoading` beside `instruction`
  - code://packages/sdk/src/types/agent.ts#L18-L36 - `BoundTool`, which gains the same field so a backend can read it
  - code://packages/sdk/src/host.ts#L3330-L3333 - `boundTools()`, which must copy `deferLoading` from the host tool onto the bound one
  - code://packages/sdk/src/artifacttools.ts#L157-L230 - the three definitions, where add carries a false `deferLoading` and remove and list carry true
  - code://packages/agent-claude/src/session.ts#L432-L482 - `contributed()`, which turns a defined `deferLoading` into `_meta['anthropic/alwaysLoad']`
  - code://test/artifacttools.test.ts#L1-L20 - where `artifactTools()` is already inspected by name
  - code://test/toolauth.test.ts#L47-L77 - the mocked `createSdkMcpServer` that returns the tools array, the seam a policy test reads through
  - file:///github/externals/vscode/src/vs/platform/agentHost/node/claude/claudeServerToolMcpServer.ts#L63-L78 - the reference passes the option only when `deferLoading` is defined
  - npm://@anthropic-ai/claude-agent-sdk@^0.3.250 - `_meta['anthropic/alwaysLoad']` is the raw-definition route the SDK reads
---

## Objective

The host's tools carry a per-tool `deferLoading`, `artifactTools()` marks add false and remove and list true, and `contributed()` passes `_meta['anthropic/alwaysLoad']` for a tool that defines it, so the tool the artifact instruction names is never deferred while every other host and client tool keeps the SDK default.

## Files

- `UPDATE: packages/sdk/src/types/host.ts:270-284` - add `deferLoading?: boolean` to `HostTool` beside `instruction`, commented as a host-side hint that is not part of the published definition.
- `UPDATE: packages/sdk/src/types/agent.ts:18-36` - add the same optional field to `BoundTool`.
- `UPDATE: packages/sdk/src/host.ts:3330-3333` - carry `one.deferLoading` into the bound tool only when it is defined.
- `UPDATE: packages/sdk/src/artifacttools.ts:157-230` - `deferLoading: false` on the add definition and `deferLoading: true` on the remove and list definitions.
- `UPDATE: packages/agent-claude/src/session.ts:446-481` - in `contributed()`, spread `_meta: { 'anthropic/alwaysLoad': !one.deferLoading }` when `one.deferLoading` is defined, so `createSdkMcpServer` receives it on the raw definition.
- `CREATE: test/toolpolicy.test.ts` - the SDK mock and the policy cases.

## Steps

1. `HostTool` in `types/host.ts`: add `deferLoading?: boolean` with a comment saying the host sets it and the published `ToolDefinition` never carries it.
2. `BoundTool` in `types/agent.ts`: add the same optional field, so a backend is not asked to read it off the definition.
3. `boundTools()` in `host.ts`: spread `deferLoading` into the returned object when `one.deferLoading !== undefined`.
4. `artifactTools()` in `artifacttools.ts`: add `deferLoading: false` to the add definition, and `deferLoading: true` to the remove and list definitions, with a comment naming the reference's rule (decision built into the plan).
5. `contributed()` in `session.ts`: build the object handed to `createSdkMcpServer` with `...(one.deferLoading !== undefined ? { _meta: { 'anthropic/alwaysLoad': !one.deferLoading } } : {})`, since the SDK's `tool()` helper is not used here, and note that a false value is the SDK's own default so a deferred tool is not forced either way.
6. Leave `toolDefinitions()` in `host.ts` untouched, so `deferLoading` never reaches a client.

## Validation

- `test/artifacttools.test.ts`: a case asserting `artifactTools()` has `deferLoading` false on `add_artifact_or_reference` and true on `remove_artifact_or_reference` and `list_artifacts_and_references`.
- `test/toolpolicy.test.ts`: with the SDK mocked as `test/toolauth.test.ts` does, a host built with `tools: artifactTools()` yields an `ahp` server whose add tool has `_meta['anthropic/alwaysLoad'] === true`, whose remove and list tools have it `false`, and whose tools with no `deferLoading` have no `_meta`.
- `pnpm test` green; `pnpm typecheck` and `pnpm boundary` green.
- By hand: the published `ToolDefinition` list for the artifact tools still has no `deferLoading` key.

## Resume

Done.
`HostTool` and `BoundTool` carry `deferLoading`, `boundTools()` passes it on, `artifactTools()` marks add false and remove and list true, and `contributed()` turns a defined value into `_meta['anthropic/alwaysLoad']`.
`test/toolpolicy.test.ts` asserts the raw SDK definitions and `test/artifacttools.test.ts` asserts the policy on the tools themselves.
