---
title: The root owner has a fixed host name
created: 2026-11-13
refs:
  - git://77a9aa996 - main when the facts were checked
  - "[code://packages/server/src/commands/run.ts#L728](../../packages/server/src/commands/run.ts#L728) - `hostName: hostname()`, also at L1281 and L1300"
  - "[code://packages/sdk/src/host/owners.ts#L78](../../packages/sdk/src/host/owners.ts#L78) - a root connection's owner is `root:<hostName>`"
  - "[code://packages/server/src/commands/automation.ts#L166](../../packages/server/src/commands/automation.ts#L166) - the CLI writes `root:<hostname()>` itself"
  - "[code://packages/sdk/src/host/sessionmethods.ts#L1184-L1193](../../packages/sdk/src/host/sessionmethods.ts#L1184-L1193) - the session list's owner filter compares the whole owner"
  - "[code://packages/sdk/src/host.ts#L1157](../../packages/sdk/src/host.ts#L1157) - the `owner=me` automations compare the whole owner, also at L1188"
  - "[code://packages/sdk/src/usage/meter.ts#L205](../../packages/sdk/src/usage/meter.ts#L205) - a usage record keeps the owner as a key"
---

# The root owner has a fixed host name

Softov wants the root owner to have a name that does not change with the machine, such as `root:main`.
He asked (2026-11-13): "a backup running on another host will not work? Its binded? We did not had defined a name for the main host? like root:main?"

## What ahpd does today

- The daemon sets `hostName` to `os.hostname()` at start. No setting changes it.
- A root connection owns its work as `root:<hostName>`, under the default `rootOwner` `host`. On Softov's machine that is `root:soft-sandbox`.
- The `ahpd automation` CLI writes `root:<hostname()>` itself, not through the daemon's value.
- Sessions, bots and automations keep the owner as a string. A usage record keeps it as a key.
- 16 checks in `packages/*/src` ask only for the `root:` prefix, so root keeps access to records of another host name.
- Some code compares the whole owner: the session list's owner filter, the `owner=me` automations and the usage keys. These were not yet checked for a root reader.
- Bot talks key every `root:*` owner as `root`, in the bot-talk branch.

## What changes when the host name changes

- A backup restored on another machine, or a renamed machine, gives root a new owner string.
- Records written before keep the old string, so old and new root work carry two names.

## Open questions

- A setting name and its default: `hostName`, with the OS host name as the default, or a fixed word such as `main`.
- What happens to records that already carry `root:soft-sandbox`: read every `root:*` as the root, or rewrite them once.
- Whether every whole-owner comparison should read every `root:*` owner as one.
