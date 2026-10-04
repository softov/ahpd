---
title: The URI names, the shared helpers and the state's interfaces are their own files
status: todo
depends: []
layer: "sdk"
refs:
  - "[code://packages/sdk/src/host.ts#L65-L139](../../../../packages/sdk/src/host.ts#L65-L139) - `uriOf`, `need`, `ROOT`, `isRootChannel`, `AUTOMATIONS`, `BANG`, `MARKS`, `CLOSING`, `reason`"
  - "[code://packages/sdk/src/host.ts#L398-L518](../../../../packages/sdk/src/host.ts#L398-L518) - `Space`, `spaceOf`, `baseOf`, `NameKind`, `Claimed`, `Claiming`, `URI_KEYS`, `ChannelKind`, `schemeOf`"
  - "[code://packages/sdk/src/host.ts#L615-L630](../../../../packages/sdk/src/host.ts#L615-L630) - `named`"
  - "[code://packages/sdk/src/host.ts#L1512-L1538](../../../../packages/sdk/src/host.ts#L1512-L1538) - `chatUriFor`, `subagentChatUri`, `WORKER_ACTIONS`, `toolCallOfSubagentChat`"
  - "[code://packages/sdk/src/host.ts#L1649](../../../../packages/sdk/src/host.ts#L1649) - `isAutomations`"
  - "[code://packages/sdk/src/host.ts#L950-L979](../../../../packages/sdk/src/host.ts#L950-L979) - `Held`; `LiveSubagent` at 1081, `Learned` at 1262, `Origin` at 1999"
---

## Objective

`host/common.ts`, `host/state.ts` and `host/channels.ts` exist, hold the declarations below with their comments, and `host.ts` imports them; nothing else changes.

## Files

- `CREATE: packages/sdk/src/host/common.ts` - `need`, `reason`, `CLOSING`, `BANG`.
- `CREATE: packages/sdk/src/host/state.ts` - `Held`, `LiveSubagent`, `Learned`, `Origin`, `NameKind`, `Claimed`, `Claiming`.
- `CREATE: packages/sdk/src/host/channels.ts` - `ROOT`, `isRootChannel`, `AUTOMATIONS`, `MARKS`, `uriOf`, `schemeOf`, `Space`, `spaceOf`, `baseOf`, `ChannelKind`, `URI_KEYS`, `named`, `chatUriFor`, `subagentChatUri`, `WORKER_ACTIONS`, `toolCallOfSubagentChat`, `isAutomations`.
- `UPDATE: packages/sdk/src/host.ts` - the declarations above removed; imports added; `export { ROOT, isRootChannel, type Summary }` at the end still exports both names, now re-exported.

## Steps

1. Cut each declaration with the comment above it and paste it unchanged into its file, with `export` added and nothing else; the four interfaces and the inner functions move from two-space indentation to none.
2. Add the imports each new file needs from `../rpc.js`, `../catalog.js`, `../types/*.js`.
3. Import them into `host.ts`; keep the final `export { ROOT, isRootChannel, type Summary }` working by importing and re-exporting.
4. Leave `uriOf`'s doc comment, `ROOT`'s and `isRootChannel`'s exactly as they are.

## Validation

- `pnpm exec tsc --noEmit`, `pnpm boundary`, `pnpm test` pass, with no test changed.
- `git diff --stat` shows only `host.ts` and the three new files; `git diff -M --color-moved=zebra` shows every removed line as moved.
- `wc -l packages/sdk/src/host.ts` recorded.

## Resume
