---
title: ahpd serves what AHP 1.0.0 added - implemented
date: 2026-10-09
refs:
  - git://154925b
  - "[code://UPSTREAM.md](../../../../UPSTREAM.md) - Pass 5's boxes for these plans, now ticked"
---

ahpd serves the parts of AHP 1.0.0 that host/44, host/43 p3 and host/45 did not.
A chat moves and is reordered, lists its background work, and can send a blocking MCP server startup to the background.
File edits use the protocol's types, an automation carries its template's client plugins, and a changeset says when it is recomputing.

## What was built

- [p1](../47-ahpd-serves-what-ahp-1-0-0-added-p1-moving-a-chat/implemented.md) - `moveChat`, `session/chatsReordered` and `chat/movableChanged`.
- [p2](../47-ahpd-serves-what-ahp-1-0-0-added-p2-a-chat-lists-its-background-work/implemented.md) - `ChatState.backgroundWork` and its two actions.
- [p3](../47-ahpd-serves-what-ahp-1-0-0-added-p3-an-mcp-server-startup-can-be-backgrounded/implemented.md) - `session/mcpServerBackgroundRequested` and `McpServerStartingState.blocking`.
- [p4](../47-ahpd-serves-what-ahp-1-0-0-added-p4-a-file-edit-is-the-protocols-type/implemented.md) - `FileEditSide` and `FileEditCollection`, and the Claude write preview.
- [p5](../47-ahpd-serves-what-ahp-1-0-0-added-p5-an-automation-carries-client-plugins/implemented.md) - `customizations` on an automation and its capability.
- [p6](../47-ahpd-serves-what-ahp-1-0-0-added-p6-a-changeset-says-it-is-recomputing/implemented.md) - `ChangesetStatus.recomputing`.

## Verified

- Each child's implemented.md lists its tests and its gate run.
- The last gate run, on p1 merged with host/44 p3, passed 268 files and 4801 tests.

## Departures from the plan

- p1 serves the move where VS Code answers `MethodNotFound`, as the plan said it would.
- The child departures are in each child's implemented.md.

## Left for later

- The canvas actions and the `ahp-canvas:` channel, left out by Softov on 2026-10-03.
- A move into a session of another provider or another computer, in p1's [deferred.md](../47-ahpd-serves-what-ahp-1-0-0-added-p1-moving-a-chat/deferred.md).
