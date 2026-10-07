---
title: A session in a machine gets each attachment copied into that machine at the same path
status: accepted
date: 2026-10-07
refs:
  - "[code://packages/sdk/src/host/attachments.ts#L102-L120](../../packages/sdk/src/host/attachments.ts#L102-L120) - `filesOf`, the files a message names under the session's own folder"
  - "[code://packages/sdk/src/host/chatactions.ts#L61-L72](../../packages/sdk/src/host/chatactions.ts#L61-L72) - the gate: written first, copied, and only then the action is applied"
  - "[code://packages/sdk/src/types/computers.ts#L329-L356](../../packages/sdk/src/types/computers.ts#L329-L356) - `putIn` and `takeOut` on the port, so `sdk` reaches a machine without importing the plugin"
  - "[code://packages/computer/src/runtime.ts#L3234-L3260](../../packages/computer/src/runtime.ts#L3234-L3260) - the copy as one `docker exec` per file, as root, read-only"
  - "[code://packages/sdk/src/host/lifecycle.ts#L221-L233](../../packages/sdk/src/host/lifecycle.ts#L221-L233) - a removed session's folder taken back out of its machine"
---

## Context

A message's attachment is a file this host wrote in the session's own folder, and the message names it by path - decision [an-attachments-bytes-are-written-to-disk-and-the-message-names-the-file](an-attachments-bytes-are-written-to-disk-and-the-message-names-the-file.md).
A session that runs inside a machine reads that path there, and the machine has no such path unless something puts one there.

A mount at make time serves at most one session, and not every session can have one. Several sessions may share one machine, and a machine an operator made ahead of time, or one a session entered after it was made, was made for nobody in particular. A running machine also takes no new mount, so a session that enters an existing one could never be given one.
The bytes have to arrive some other way, and they have to arrive with the message that names them.

## Decision

When the host writes a session's attachments and that session is running in a machine, the plugin copies each of those files into that machine at the same absolute path, read-only, mode 0444, making the folder above it. This holds for every machine, however it was made, and for every session running in it.
The copy happens after the files are written and before the action is applied, so the machine's session is handed the same paths this host wrote. A copy that fails is a line in the log, and the turn still runs.
When the session is removed, its attachments folder is removed in the machine too, where the machine still runs.

Source: Softov, 2026-10-07, asked "How does a session in a machine see the attachments folder - a read-only bind per session, or a copy into the machine?" and chose "Copy into the machine".

## Consequences

- A session's files reach its machine one message at a time, so a machine made for nobody and shared by several sessions works, and a session that entered an existing machine works.
- The plugin reaches into a machine after it is made, which needs a way in that is not a mount: the copy runs inside as root, so a host-shaped path such as `/home/<user>/...` can be made and the file is not one the machine's own user can write over.
- The machine's copy is per session, made for one message, and is removed with the session; a machine that outlives the session keeps nothing of it.
- The `sdk` reaches this through a port on the computer plugin, so the host holds a machine's files without importing the runtime that made it.

## Options

- A read-only bind of the session's attachments folder, put in at make time. Lost: a running machine takes no new mount, and a machine made ahead of time, or shared by several sessions, would serve at most the one session whose folder it was made with.
- The session's whole folder mounted at make time, with every session's attachments in it, leaving the machine to pick its own. Lost: a session would be handed every other session's files, and the machine maker would still need the folder to exist before the machine does.
