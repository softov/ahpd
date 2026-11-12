---
title: A person who may read a bot can drive its trusted child session
status: open
date: 2026-11-08
severity: minor
blocks: []
refs:
  - "[code://packages/bot/src/chat.ts#L1383](../../packages/bot/src/chat.ts#L1383) - a bot-chat start checks `mayRead` only"
  - "[code://packages/bot/src/wake.ts#L299-L320](../../packages/bot/src/wake.ts#L299-L320) - the child session is trusted, on the bot's folder and computer"
  - "[code://packages/bot/src/wake.ts#L471](../../packages/bot/src/wake.ts#L471) - the agent check reads the bot's owner, not the person"
  - "[code://packages/sdk/src/host/admission.ts#L135](../../packages/sdk/src/host/admission.ts#L135) - the `computer:write` check a client's own create meets"
  - "[code://docs/plugins/BOTS.md#L228](../../docs/plugins/BOTS.md#L228) - the docs describe the new access"
  - git://ff5093883 - the `bot:chat` grant is removed
  - git://83efef0ca - the audit branch's head when the problem was read
  - git://598b5d35b - main when the problem was read again, on 2026-11-11
---

## Symptom

Read from the code in the security review of 2026-11-08, and not reproduced.
A member of the team that owns a bot, who only had read access, opens a chat with the bot.
The bot's child session runs their messages, trusted, on the bot's folder and computer.

## Cause

At `e388d12f5`, `mayChat` allowed the bot's owner or a person with `bot:chat`.
Main removes `bot:chat`, and a start checks `mayRead`, which a `bot:get` holder and each member of the owning team or project pass.
The child session is trusted, and its agent is checked against the bot's owner.

## Impact

A person who could only read a team bot can now run work on its folder and computer.
That can pass by the `computer:write` check that a client's own create meets.
`docs/plugins/BOTS.md` describes the new access, so the change looks intended, and nobody has decided it.

## Workaround

Keep bots that hold a computer or a sensitive folder out of team and project ownership.

## Fix

- Restore a chat grant, apart from read.
- Keep read as the chat grant, and run the child session with the chatting person's grants for the computer and the agent.
