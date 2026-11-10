---
title: The root config declares title generation
created: 2026-11-10
refs:
  - git://d558e2f06 - the commit of this repository the facts were checked at
  - git://c4453f8ea430 - VS Code 1.145.2, the reference checked
  - "[code://packages/sdk/test/root-config.test.ts#L838-L861](../../packages/sdk/test/root-config.test.ts#L838-L861) - says VS Code 1.140 dropped the two title keys, and expects them undeclared"
  - "[code://packages/sdk/test/wire.test.ts#L350-L360](../../packages/sdk/test/wire.test.ts#L350-L360) - lists the two title keys among the four keys 1.140 dropped"
  - "[code://packages/sdk/src/vscoderootconfig.ts](../../packages/sdk/src/vscoderootconfig.ts) - the root config this host declares, with no title key"
  - "[code://packages/sdk/src/host/tooling.ts#L544-L549](../../packages/sdk/src/host/tooling.ts#L544-L549) - every session runs the deferred title strategy"
  - "[code://packages/sdk/src/types/host.ts#L1243](../../packages/sdk/src/types/host.ts#L1243) - TitleStrategy has activeAgent, utility and deferred"
  - "[code://packages/sdk/src/tools/session.ts#L796-L815](../../packages/sdk/src/tools/session.ts#L796-L815) - rename_chat by title strategy"
  - https://github.com/microsoft/vscode/blob/c4453f8ea430/src/vs/platform/agentHost/common/agentHostSchema.ts#L611-L629 - the title keys and strategies at 1.145.2
  - https://github.com/microsoft/vscode/blob/c4453f8ea430/src/vs/platform/agentHost/common/agentHostSchema.ts#L936-L959 - the three title properties in platformRootSchema at 1.145.2
---

# The root config declares title generation

Softov wants the root config tests to say what VS Code declares today. Two tests say VS Code 1.140 dropped `activeAgentTitleGeneration` and `deferredTitleGeneration`. VS Code 1.145.2 declares both, and a third key, `titleGeneration`. This brief records the facts for a later fix. Softov chose no fix for now, on 2026-11-10.

## What others do

VS Code 1.145.2 declares three title keys in `platformRootSchema`:

| Key | Type | Default | Meaning |
|---|---|---|---|
| `titleGeneration` | `utility`, `activeAgent` or `agentReview` | `utility` | The strategy for new sessions and chats. It takes precedence over the two legacy keys. |
| `activeAgentTitleGeneration` | boolean | `false` | Legacy. The active agent names chats with rename tools. |
| `deferredTitleGeneration` | boolean | `false` | Legacy. The host seeds a title and refines it after the first response. It wins over `activeAgentTitleGeneration`. |

The strategy type also has `deferred`, which is `agentReview` without the reminder to the agent. VS Code keeps it for existing sessions and for the legacy key. A change applies to new sessions only. The same three properties are on VS Code main at `6b68d3fe7dd`, the revision the ahpd code cites, and at `8c08c62ce9ee`.

## What ahpd has today

- `root-config.test.ts` says VS Code 1.140 dropped the two legacy keys. It expects neither key declared, and each pushed value kept.
- `wire.test.ts` lists the two legacy keys in `OLD`, the four keys it says 1.140 dropped.
- `vscoderootconfig.ts` declares no title key.
- `strategyOf` in `tooling.ts` answers `deferred` for every session.
- `TitleStrategy` has `activeAgent`, `utility` and `deferred`, but no `agentReview`.
- `rename_chat` reads the strategy: `utility` removes it, and `deferred` gives it the wording of the reference host.

A window pushes only the root keys that the host's schema declares, as Pass 4 in `UPSTREAM.md` found. So a 1.145.2 window sends none of the three keys to ahpd today.

## Who writes

- `origin/host/20261110-0813-agent-merge-merges` changes `vscoderootconfig.ts` in four lines. A fix that declares keys there must merge with it.
- No other branch on `origin` or `maycxc` has unmerged changes to the two tests, `tooling.ts` or `tools/session.ts`.

## The change

- The comments in the two tests stop saying that VS Code dropped the two title keys.
- If the keys are declared, `titleGeneration` comes first, with the legacy keys read for an older window.
- If the keys are declared, `strategyOf` reads them instead of answering `deferred` for every session.

## Open points

- Declare the three keys, or only correct the tests. Softov chose neither for now, on 2026-11-10.
- `agentReview` needs a utility model to refine a title. Check which backend can give one before a plan offers it.
