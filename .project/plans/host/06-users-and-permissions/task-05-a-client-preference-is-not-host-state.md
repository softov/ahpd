---
title: A client preference is the connection's, not the host's
status: todo
depends:
  - task-03-one-gate-decides-every-command.md
layer: packages/sdk
refs:
  - "[code://packages/sdk/src/host.ts#L3829-L3844](../../../../packages/sdk/src/host.ts#L3829-L3844) - `rootConfig` and the comment saying these are a person's preferences, which is the contradiction this task resolves"
  - "[code://packages/sdk/src/host.ts#L3415](../../../../packages/sdk/src/host.ts#L3415) - `commanded`, the `!command` path, which reads `defaultShell`"
  - "[code://packages/sdk/src/host.ts#L3490](../../../../packages/sdk/src/host.ts#L3490) - `StartTerminals.open`, the factory a backend opens a terminal with, which reads it with no connection in sight"
  - "[code://packages/sdk/src/host.ts#L5193](../../../../packages/sdk/src/host.ts#L5193) - `createTerminal`, the client path, which reads it"
  - "[code://packages/sdk/src/host.ts#L6396-L6420](../../../../packages/sdk/src/host.ts#L6396-L6420) - the `root/configChanged` branch and the narrow `defaultShell` rule this task replaces"
  - "[code://packages/sdk/src/types/host.ts#L405-L441](../../../../packages/sdk/src/types/host.ts#L405-L441) - `Connection`, where a per-connection config would live beside `principal`"
  - "[code://docs/USERS.md](../../../../docs/USERS.md) - the two paragraphs that describe the narrow rule and would describe this instead"
---

## Objective

`defaultShell` is held per connection rather than per host, so the shell a terminal opens is the preference of whoever asked for that terminal, and a person who may write a file cannot decide which binary somebody else's tool call runs.

## Context

The host's own comment says these are "the preferences a *client* holds about how the host should behave for it", and names VS Code pushing `defaultShell` on connect.
They are stored in one `rootConfig` shared by every connection, which on a single-user daemon is the same thing and on a multi-user one is not: the last client to connect sets everybody's shell, silently, with nobody malicious involved.

Task 03 gated `ahp-root://` at `write`, and the narrow rule added after review requires `terminal` to set `defaultShell` specifically, because three paths read it and one is the factory a backend opens a terminal with.
That closes the escalation and leaves the correctness bug: two people on one daemon still share one shell setting, and whichever connected last wins.

## Files

- `UPDATE: packages/sdk/src/types/host.ts:405-441` - `Connection.config?: Record<string, unknown>`, the preferences that connection pushed.
- `UPDATE: packages/sdk/src/host.ts:3829-3844` - `rootConfig` keeps only what is genuinely host-wide; the comment says which keys are which and why.
- `UPDATE: packages/sdk/src/host.ts:6396-6420` - `root/configChanged` writes a per-connection key to the connection and a host-wide key to `rootConfig`; the narrow `defaultShell` rule goes, replaced by the key being the connection's own.
- `UPDATE: packages/sdk/src/host.ts:3415,5193` - both read the asking connection's `defaultShell`, falling back to the host's.
- `UPDATE: packages/sdk/src/host.ts:3490` - the backend factory, which has a session and no connection: it reads the session owner's preference. This is the one that needs a decision, below.
- `UPDATE: test/users-gate.test.ts` - the narrow-rule cases become per-connection cases.
- `UPDATE: docs/USERS.md` - the `defaultShell` paragraph.

## Steps

1. Decide which keys are a person's and which are the host's. `defaultShell` is a person's, by the host's own comment. `artifactToolsCompactPrompts` and `deferredTitleGeneration` change what every session is told, so they are the host's and stay where they are, gated at `write`.
2. Add `Connection.config` and write a per-connection key there. Keep echoing the whole record back in `values`, because a client reads its own settings from it and a host that dropped what it did not understand would report settings that silently reverted.
3. Route `commanded` and `createTerminal` through the asking connection.
4. Answer the open question for the backend factory before touching it.
5. Remove the narrow rule and the two tests that pin it, replacing them with: two connections with two shells each get their own; a person with `write` and no `terminal` can set their own shell and cannot reach anybody else's; and an unconfigured daemon still behaves as one host with one setting.
6. Run `pnpm test`, `pnpm typecheck`, `pnpm boundary` and `pnpm build`.

## Open question

**Whose preference does a backend's terminal use?** `StartTerminals.open` has a session and a chat, not a connection, and an automation fires with nobody connected at all. Three answers, and the plan does not pick one:

- the session's owner, which needs a session to record who created it, and is the honest answer;
- the host's configured default only, so a backend never runs a person's shell, which is the safest and drops a real preference;
- whichever connection is driving the session now, which is wrong the moment two people watch one session.

This is the reason the task exists separately rather than being folded into 03.

## Validation

- `test/users-gate.test.ts` - the five cases in step 5.
- `test/host.test.ts` - the existing terminal suite unchanged, which is the proof a single-user daemon did not move.
- By hand: two clients, two shells, one daemon, and a terminal from each opening the right one.
- `pnpm test`, `pnpm typecheck`, `pnpm boundary` and `pnpm build` green.

## Resume

