---
title: An attachment's bytes are a file the host wrote, and every backend reads attachments through one helper with one set of limits - implemented
date: 2026-10-07
refs:
  - git://79be3dd - the commit this work sits on; none of it is committed yet, on `build/agents/08652669`
  - "[code://packages/sdk/src/host/attachments.ts#L86-L120](../../../../packages/sdk/src/host/attachments.ts#L86-L120) - `needsWriting` and `filesOf`, which say whether an action has files to write and which files it names"
  - "[code://packages/sdk/src/host/attachments.ts#L137-L210](../../../../packages/sdk/src/host/attachments.ts#L137-L210) - `snapshot`, which writes the bytes and rewrites the attachment"
  - "[code://packages/sdk/src/attachments.ts#L29-L152](../../../../packages/sdk/src/attachments.ts#L29-L152) - `SNAPSHOT_TAG`, `Part`, `PartOptions` and `partsOf`, with the limits as named constants"
  - "[code://packages/sdk/src/host/chatactions.ts#L43-L120](../../../../packages/sdk/src/host/chatactions.ts#L43-L120) - `settledMessage`, and the gate both actions go through"
  - "[code://packages/sdk/src/types/sessions.ts#L171](../../../../packages/sdk/src/types/sessions.ts#L171) - `SessionStore.attachmentsDir?`, the one place that knows the folder"
  - "[code://packages/sdk/src/sessions.ts#L183-L200](../../../../packages/sdk/src/sessions.ts#L183-L200) - `folderNameOf` and `below`, which name a session's folder and say whether a path is inside one"
  - "[code://packages/sdk/src/sessions.ts#L251-L266](../../../../packages/sdk/src/sessions.ts#L251-L266) - `fileSessions` answers the folder and removes it with the session"
  - "[code://packages/sdk/src/types/session.ts#L368](../../../../packages/sdk/src/types/session.ts#L368) - `steer(id, text, attachments?)`"
  - "[code://packages/sdk/src/types/session.ts#L420](../../../../packages/sdk/src/types/session.ts#L420) - `queue(id, text, model?, from?, attachments?)`"
  - "[code://packages/sdk/src/host/machines.ts#L161-L218](../../../../packages/sdk/src/host/machines.ts#L161-L218) - `watched`, `putIn` and `takeOut`"
  - "[code://packages/sdk/src/types/computers.ts#L329-L356](../../../../packages/sdk/src/types/computers.ts#L329-L356) - `ComputerPort.putIn?` and `takeOut?`"
  - "[code://packages/sdk/src/host/lifecycle.ts#L221-L233](../../../../packages/sdk/src/host/lifecycle.ts#L221-L233) - a removed session's folder taken back out of its machine"
  - "[code://packages/computer/src/runtime.ts#L3244-L3260](../../../../packages/computer/src/runtime.ts#L3244-L3260) - the copy as one `docker exec` per file, as root, read-only"
  - "[code://packages/computer/src/plugin.ts#L1301-L1334](../../../../packages/computer/src/plugin.ts#L1301-L1334) - the plugin's `putIn` and `takeOut`, and where they are registered"
  - "[code://packages/computer/src/plugin.ts#L338-L356](../../../../packages/computer/src/plugin.ts#L338-L356) - `underAttachments`, the shape of a path a session's own files live under"
  - "[code://packages/sdk/test/sessions.test.ts](../../../../packages/sdk/test/sessions.test.ts) - a session's folder whatever its id says, and a removal that reaches only its own"
  - "[code://packages/computer/test/fixtures/docker.mjs](../../../../packages/computer/test/fixtures/docker.mjs) - the exec branch records the bytes a test asked it to read"
  - "[code://packages/sdk/test/host-attachments.test.ts](../../../../packages/sdk/test/host-attachments.test.ts) - a pasted PNG and pasted text in state, in the session file and in `begin`'s arguments"
  - "[code://packages/sdk/test/host-machine-attachments.test.ts](../../../../packages/sdk/test/host-machine-attachments.test.ts) - the copy's place in the turn, its failures, and the removal"
  - "[code://packages/sdk/test/attachments.test.ts](../../../../packages/sdk/test/attachments.test.ts) - every limit `partsOf` applies"
  - "[code://packages/computer/test/computer-attachments.test.ts](../../../../packages/computer/test/computer-attachments.test.ts) - what the machine sees, over a scripted docker"
---

A pasted image, pasted text, an unsaved editor or a client-only file now reaches every backend as a read-only file the host wrote.
The message carries its path, and one helper turns it into text and image parts within one set of limits.
A queued or steering message carries its attachments the way a begun one does.
A session running in a machine is handed each file at the same path, and the machine keeps nothing of a session that is gone.
The folder a session's files sit in is a folder of its own under one root, and no id names the folder above it.

## What was built

- [`code://packages/sdk/src/host/attachments.ts#L137-L210`](../../../../packages/sdk/src/host/attachments.ts#L137-L210) - `snapshot`. It decodes an `embeddedResource`, or fetches a client-only `file://` resource with `resourceRead` when the `sizeHint` allows it. It writes the bytes under the session's folder as `0400` in a `0700` folder. The attachment becomes a `resource` on that path, tagged `_meta["vscode.agentHost.snapshotAttachment"]`.
- [`code://packages/sdk/src/host/attachments.ts#L111-L120`](../../../../packages/sdk/src/host/attachments.ts#L111-L120) - `filesOf`, the settled message's files that lie under the session's own folder. It reads the rewritten message, so a file the host did not write is never copied anywhere.
- [`code://packages/sdk/src/attachments.ts#L71-L152`](../../../../packages/sdk/src/attachments.ts#L71-L152) - `partsOf(text, attachments, { images })`. The message text comes first, then an image the backend takes as an image at most 5 MB. A host-written textual file of at most 64 KiB follows as a fenced block. Every other file is named in one references block, in VS Code's wording.
- [`code://packages/sdk/src/attachments.ts#L32-L50`](../../../../packages/sdk/src/attachments.ts#L32-L50) - the limits as named constants: `IMAGE_LIMIT` 5 MB, `TEXT_LIMIT` 64 KiB, the four image types, and the read-only note.
- [`code://packages/sdk/src/host/chatactions.ts#L43-L120`](../../../../packages/sdk/src/host/chatactions.ts#L43-L120) - one gate for `chat/turnStarted` and `chat/pendingMessageSet`. `needsWriting` decides whether there is work. `settledMessage` writes the files and hands them to the session's machine. Only then does the host apply, store and echo the action.
- [`code://packages/sdk/src/types/sessions.ts#L171`](../../../../packages/sdk/src/types/sessions.ts#L171) and [`code://packages/sdk/src/sessions.ts#L251-L266`](../../../../packages/sdk/src/sessions.ts#L251-L266) - `attachmentsDir?(id)` on `SessionStore`. `fileSessions` answers `<its dir>/attachments/<name>`, makes it `0700`, and removes it in `forget`. The name is the id escaped. An id of nothing, `.` or `..` is escaped again. Each of the three names the folder it is written in rather than one under it. A folder that does not lie strictly inside the root is a line in the log and no folder at all. That skips the write and the removal. A store that keeps nothing answers nothing.
- [`code://packages/sdk/src/types/session.ts#L368`](../../../../packages/sdk/src/types/session.ts#L368) and [`code://packages/sdk/src/types/session.ts#L420`](../../../../packages/sdk/src/types/session.ts#L420) - `steer`, `queue` and `begin` all take an optional `attachments`, documented the same way. The host passes a message's own to each.
- [`code://packages/sdk/src/host/machines.ts#L161-L218`](../../../../packages/sdk/src/host/machines.ts#L161-L218) - `putIn(uri, paths)`, awaited before the turn, and `takeOut(id, uri)`, which rides the same promise book as a machine enter or leave. `watched` is the plumbing both use.
- [`code://packages/sdk/src/types/computers.ts#L329-L356`](../../../../packages/sdk/src/types/computers.ts#L329-L356) - `ComputerPort.putIn?` and `takeOut?`, so the host holds a machine's files without importing the plugin that made it.
- [`code://packages/computer/src/runtime.ts#L3244-L3260`](../../../../packages/computer/src/runtime.ts#L3244-L3260) - one `docker exec -i --user 0 <machine> sh -c 'mkdir -p "$(dirname "$1")" && cat > "$1" && chmod 0444 "$1"' sh <path>` per file, with the bytes on that command's input, and `rm -rf <folder>` for a removed session.
- [`code://packages/computer/src/plugin.ts#L1301-L1334`](../../../../packages/computer/src/plugin.ts#L1301-L1334) - `onlyAttachments`, `putIn` and `takeOut`. The plugin registers both on `registerComputers`, beside `bringBack` and `follow`, and each refuses a path no session's files live under before it reaches a machine.
- [`code://packages/computer/src/plugin.ts#L338-L356`](../../../../packages/computer/src/plugin.ts#L338-L356) - `underAttachments`, the shape of a path a session's own files live under: absolute, resolved, and below a folder named `attachments`. The host writes them at `<its state folder>/attachments/<session>/...`, so a folder named `attachments` itself, or the one above it, is not one of these. A refusal is a line, and nothing is run in a machine for it.
- [`code://packages/computer/test/fixtures/docker.mjs`](../../../../packages/computer/test/fixtures/docker.mjs) - the scripted docker reads the input of a command a test names in `inputCommands`, and records it on the call.
- [`code://packages/computer/test/computer.test.ts`](../../../../packages/computer/test/computer.test.ts) - the in-process fake runtime gained `putIn` and `takeOut`, so every computer test still holds to the port's whole surface.

## Verified

- `pnpm build` clean, `pnpm typecheck` clean, `pnpm boundary` clean - `@ahpd/sdk` still declares two dependencies and `@ahpd/computer` one, none undeclared.
- `npx vitest run` from the root - **244 files, 4238 tests, all passing**, none skipped. A whole-suite run on a shared box loses a few of the slowest machine tests to vitest's 5 second timeout. Each one passes on its own, and the suite passes whole on a quieter box.
- The files this plan's behaviour lives in - **35 cases**: `packages/sdk/test/attachments.test.ts` (13), `packages/sdk/test/host-attachments.test.ts` (9), `packages/sdk/test/host-machine-attachments.test.ts` (5), `packages/computer/test/computer-attachments.test.ts` (6), and the two added to `packages/sdk/test/sessions.test.ts`.
- `sessions.test.ts` names an id of `..`, `.`, `a/../..` and nothing. Each gets a folder directly under `<dir>/attachments`, four names that are four different folders. Removing each of those sessions leaves the sessions directory, the surviving session's row and the file in its folder where they were. The removed id's own folder is gone.
- `computer-attachments.test.ts` asks the plugin's own port for the attachments root. It also asks for a path that walks back out of a session's folder, and for a file outside the state folder. Nothing is run in a machine, and the plugin's five lines all say the path is not a session's attachments path.
- `host-attachments.test.ts` sends a `chat/turnStarted` with a pasted PNG and reads a tagged `file://` snapshot in state, in the session file and in `begin`'s arguments. A label of `../../x` writes inside the folder, and a deleted session leaves no folder.
- `attachments.test.ts` covers a small and a large image, an image of another type, and `images: false`. It also covers small and large text, a FIFO, a directory, a selection, `simple` and `annotations`.
- `host-machine-attachments.test.ts` reads the scripted port's calls. The copy is asked for after the file is written and before the turn, with the session's own folder. Two sessions in one machine each get their own path. A port that fails leaves the line `computers: putting a message's attachments into box for echo:/one failed: the machine is not running`, and the turn still runs. A removal asks for the folder back out, and a session in no machine copies nothing.
- `computer-attachments.test.ts` runs the real runtime against the scripted docker. The file arrives at the same absolute path as root with mode `0444`, the bytes on the command's input, and nothing mounted. A dev container is written the same way. The folder leaves with `rm -rf` as root on dispose, and a memory store copies nothing.

## Departures from the plan

- The plan's first draft of task 04 gave a machine the session's attachments folder as a read-only bind, put in when the machine was made. Softov answered the fork on 2026-10-07 with "Copy into the machine", and the plan now carries that as decision [a-session-in-a-machine-gets-each-attachment-copied-into-it](../../../decisions/a-session-in-a-machine-gets-each-attachment-copied-into-it.md). The mount is in no recipe, because none had been built. Task 04's objective, files, steps and validation, the plan's architecture line, its risks and its checklist were amended the same day.
- `filesOf` returns the paths a message names under the folder without checking that each file exists. A file that vanished between the write and the copy makes the copy fail. That failure is a line in the log, which the plan already wanted.
- The four tasks are `implemented`, not `done`, and the plan is left `planned`. Nothing here is committed or reviewed, so no run has seen it and CI has not run.
- The plan named two test files for the copy. The scripted docker's input recording holds the same behaviour, and every other computer test shares it.

## Left for later

- A session that moves to another machine keeps its folder in the machine it left, because only a removed session is taken back out. The plan records this under Risks.
- A machine that is not running when a message arrives is told nothing. The log has the line, and the message still goes with a path that is not a file in there.
- The backends still map attachments themselves. They take `partsOf` in their own plans: claude 20, acp 14, pi 15, plugin 36.
- A rewritten chip is a `file://` resource on this host's disk, so a client on another machine cannot open it, as with VS Code.
- A session can be called `.` or `..`. `createSession` refuses a channel whose id is empty and accepts these two, so `ahp-session:/..` opens a session. Nothing here refuses them, because what a client may call a session is not this plan's to decide. The folder name keeps them apart from every other session, and from the sessions directory, all the same.
