---
title: VS Code opens a session another client created
status: done
depends: [task-02-every-request-answers-to-either-name.md, task-03-an-action-reaches-an-aliased-subscriber-in-its-spelling.md, task-04-a-chat-title-survives-the-new-name.md]
layer: "sdk"
refs:
  - "[code://packages/sdk/src/host/sessionmethods.ts#L442-L566](../../../../packages/sdk/src/host/sessionmethods.ts#L442-L566) - `createSession`, the path under test"
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

The automated part: `host-names.test.ts`, `a session asked for by the name its creator used`, `opens for a second client the way VS Code opens it, with its turn and its pending approval`.
A creator makes `ahp-session:/<uuid>` and starts a turn that waits on a Bash approval; a second client lists it as `claude:/<uuid>`, subscribes to it and to `ahp-chat://default/<b64 claude:/<uuid>>`, sees the pending approval on that chat and the running turn, approves it, the agent is allowed, and the creator sees `session/inputNeededRemoved` and `chat/toolCallConfirmed` under its own names.
It was written after tasks 01 to 04 and passed as written; on `main` it fails at the listing.
Left for Softov, by hand, from the steps above: the daemon with `--wire`, ahpapp and the VS Code Agents Window; a Claude session created in ahpapp opens in the Agents Window with its turns and its pending approval and no `No harness descriptor found for session type …-ahp-session` in the log; approving there reaches the agent; ahpapp and then ahpc each show the session once, stream the turn and see the approval resolved; the wire capture names `claude:/<uuid>` in `listSessions` and `root/sessionAdded` and keeps ahpapp's frames in the `ahp-session:` spelling.
Re-run on 2026-10-04 and passing: the automated case passes on its own, and the whole of `packages/sdk` passes with it (2786 tests), so nothing is left here but the by-hand half, which needs a daemon, ahpapp and the Agents Window and is not something this build can do. The task stays `doing` until Softov runs those.

Softov ran the checks by hand on 2026-10-09 and confirmed them. No wire capture was kept.
