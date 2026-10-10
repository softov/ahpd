---
title: Completions offer each slash command once
domain: host
status: built
priority: medium
created: 2026-10-09
revalidated: 2026-10-09
refs:
  - "[code://packages/sdk/src/host/sessionmethods.ts#L285-L305](../../../../packages/sdk/src/host/sessionmethods.ts#L285-L305) - the channel resolves to a session, and the session's own commands are read from its customizations"
  - "[code://packages/sdk/src/host/sessionmethods.ts#L364-L376](../../../../packages/sdk/src/host/sessionmethods.ts#L364-L376) - `wide` joins every provider's commands when `provider` is absent, and the sort puts the copies together"
  - "[code://packages/sdk/src/host/context.ts#L74](../../../../packages/sdk/src/host/context.ts#L74) - `byChat` holds a chat's session URI, which is `<provider>:/<id>`"
  - "[code://packages/sdk/test/host-harness.test.ts#L247-L340](../../../../packages/sdk/test/host-harness.test.ts#L247-L340) - the completion tests to extend"
---

## Goal

A `/` completion lists each command once.
A session's completion falls back to the commands of the session's own provider, not to the commands of every provider.

## Reconnaissance

The files read and the patterns to reuse are the `refs` above, each with its note.

### Searches performed

- `rg -n "provider" packages/sdk/src/host/sessionmethods.ts` - `completions` reads `params.provider` and nothing else to pick a provider.
- `rg -n "completions" packages/sdk/test` - the tests cover one provider only.

### Gaps

- A session with no customizations yet gets the commands of every provider.
- Five Claude presets report the same commands, so ahpapp shows `/batch` five times.
- The protocol does not require a client to send `provider`, and ahpapp does not send it.

## Decisions locked in

| What | Source | Task |
| --- | --- | --- |
| Fix the duplicate commands in ahpd, not in each client | Softov, 2026-10-09, asked where to fix the repeated `/` commands in ahpapp: "Plan for dsh in ahpd" | 01 |
| A session's fallback is its own provider; with no session and no `provider`, every provider, each command once | [code://packages/sdk/src/host/sessionmethods.ts#L355-L363](../../../../packages/sdk/src/host/sessionmethods.ts#L355-L363), the comment that says a client's `provider` is the only thing that knows when no session does | 01 |
| The first command of a name wins | (defaulted: providers are read in registration order, which keeps the answer stable) | 01 |

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - Completions offer each command once](task-01-completions-offer-each-command-once.md) | done | - |

## Risks and tradeoffs

- Two providers with one command name and two meanings show one of them on the root channel.
- A client that sends `provider` on the root channel still gets that provider only.

## Resume state

- **Done so far:** task 01 implemented on `build/agents/ad2f487a` on 2026-10-09, and left uncommitted for review. A session's fallback list is its own backend's commands, and the root channel with no provider offers each command once.
- **Next action:** none; see [implemented.md](implemented.md).
- **Open questions:** none.
- **Watch out for:** an explicit `provider` still wins over the session's provider.
- **Gates:** `pnpm install`, `node tools/schema.mjs`, `pnpm build`, `pnpm typecheck` and `pnpm boundary` are clean. The full `vitest` run reports 265 files and 4686 tests passed.

## Final verification checklist

- [x] Several providers with the same command give one item on the root channel.
- [x] A new session gets its own provider's commands only.
- [x] `pnpm test` passes.
- [x] `plans/index.md` updated.
