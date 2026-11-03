---
title: A refused back turn stays working in another window
status: open
date: 2026-11-03
severity: minor
refs:
  - "[code://packages/sdk/src/types/session.ts#L25-L40](../../packages/sdk/src/types/session.ts#L25-L40) - `Handed`: a backend refuses a client's action to the client that sent it"
  - "[code://packages/agent-claude/src/session/turns.ts#L620-L633](../../packages/agent-claude/src/session/turns.ts#L620-L633) - Claude refuses a turn while one is still starting"
  - git://97b0ca4f - the commit of ahpd it was seen at
---

## Symptom

On 2026-11-03 at 10:54 UTC, the bot sent "then reply" to the back session `claude:/032ec6cb` as a turn.
Claude refused it with "A turn is running in this chat".
ahpw showed the message in that back session with a "Working" spinner, and the spinner stayed.
After a reload, the spinner was gone and the chat showed the turns that ran.

## Cause

Unknown.
The protocol refuses an action to the client that sent it, which was the bot plugin's connection, not ahpw.
ahpw drew a turn that the host did not keep, so it got the turn by some path and never got its end.

## Impact

A person who watches a back session sees a turn that never runs, and the spinner stays until a reload.

## Workaround

Reload the window.

## Fix

- Find the path by which another subscriber sees a turn that its backend refuses, and send the refusal's end on the same path.
