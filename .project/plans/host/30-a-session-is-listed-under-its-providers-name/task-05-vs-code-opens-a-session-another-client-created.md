---
title: VS Code opens a session another client created
status: todo
depends: [task-02-every-request-answers-to-either-name.md, task-03-an-action-reaches-an-aliased-subscriber-in-its-spelling.md, task-04-a-chat-title-survives-the-new-name.md]
layer: "sdk"
refs:
  - "[code://packages/sdk/src/host.ts#L7187-L7281](../../../../packages/sdk/src/host.ts#L7187-L7281) - `createSession`, the path under test"
---

## Objective

With the daemon still running, a Claude session created from ahpapp opens in VS Code's Agents Window with its history and its pending approval, and ahpapp keeps streaming it.

## Files

- None; this is a check by hand against a daemon built from the plan.

## Steps

1. Start the daemon with `--wire` and connect ahpapp and the VS Code Agents Window.
2. In ahpapp, create a Claude session in a folder and send a turn that asks for a tool needing approval.
3. Open the session in the Agents Window without approving it; approve it there.
4. Repeat with ahpc in place of ahpapp.

## Validation

- The Agents Window log has no `No harness descriptor found for session type …-ahp-session`, and the session's `sessionType` is `claude`.
- The Agents Window shows the turns and the approval, and approving there reaches the agent.
- ahpapp and ahpc each show the session once, stream the turn, and see the approval resolved.
- The wire capture shows `listSessions` and `root/sessionAdded` naming `claude:/<uuid>`, and ahpapp's own frames in the `ahp-session:` spelling.

## Resume

