---
title: A session in a machine reads its attachments at the path the host wrote
status: done
depends: [task-01-an-attachment-becomes-a-file-the-host-wrote.md]
layer: "computer"
refs:
  - "[code://packages/sdk/src/host/attachments.ts#L102-L120](../../../../packages/sdk/src/host/attachments.ts#L102-L120) - `filesOf`, the files a message names under the session's own folder"
  - "[code://packages/sdk/src/host/chatactions.ts#L43-L72](../../../../packages/sdk/src/host/chatactions.ts#L43-L72) - `settledMessage`, where the files are written and then handed over"
  - "[code://packages/sdk/src/host/machines.ts#L180-L218](../../../../packages/sdk/src/host/machines.ts#L180-L218) - `putIn` and `takeOut`, which hold the machine and the folder"
  - "[code://packages/sdk/src/types/computers.ts#L329-L356](../../../../packages/sdk/src/types/computers.ts#L329-L356) - the port the host reaches a machine's files through"
  - "[code://packages/computer/src/runtime.ts#L3234-L3260](../../../../packages/computer/src/runtime.ts#L3234-L3260) - the copy as one `docker exec` per file, as root, read-only"
  - "[code://packages/computer/src/plugin.ts#L1280-L1302](../../../../packages/computer/src/plugin.ts#L1280-L1302) - the plugin's own `putIn` and `takeOut`, and where they are registered"
  - "[code://packages/sdk/src/host/lifecycle.ts#L221-L233](../../../../packages/sdk/src/host/lifecycle.ts#L221-L233) - a removed session's folder taken back out of its machine"
---

## Objective

A session running in a machine is handed each file its message names, at the path the host wrote, read-only.
The copy is made after the files are written and before the action is applied.
The session's folder goes out of the machine when the session is removed.

## Files

- `CREATE: packages/sdk/src/host/attachments.ts` - `filesOf`, the settled message's files under the session's own folder.
- `UPDATE: packages/sdk/src/host/chatactions.ts` - `settledMessage` awaits the copy before it applies the action.
- `UPDATE: packages/sdk/src/host/machines.ts` - `putIn` and `takeOut` on `Machines`, and the promise plumbing both ride.
- `UPDATE: packages/sdk/src/host/lifecycle.ts` - `teardown` takes the folder out of the machine the session was in.
- `UPDATE: packages/sdk/src/types/computers.ts` - `ComputerPort.putIn?` and `takeOut?`, so `sdk` reaches a machine without importing the plugin.
- `UPDATE: packages/computer/src/runtime.ts` - `ComputerRuntime.putIn` and `takeOut`, as root, one `docker exec` per file.
- `UPDATE: packages/computer/src/plugin.ts` - the two on `registerComputers`.
- `CREATE: packages/computer/test/computer-attachments.test.ts` and `packages/sdk/test/host-machine-attachments.test.ts`.

## Steps

1. `putIn(id, paths)` writes each file with one `docker exec -i --user 0 <machine> sh -c 'mkdir -p "$(dirname "$1")" && cat > "$1" && chmod 0444 "$1"' sh <path>`, as root, with the bytes on that command's input. The machine's own user cannot make a host-shaped folder, and it could write over a file it owns.
2. `takeOut(id, paths)`: one `docker exec --user 0 <machine> rm -rf <path>` per path.
3. The plugin registers both on `host.registerComputers`, and the host reaches them through `ComputerPort`, so `sdk` never imports `computer`.
4. Copy into the machine the session entered: one made for it, one made ahead of time, or one it shares.
5. Log a copy that fails, and apply the action anyway.
6. Refuse a path that is not below a folder named `attachments`. Do it before a copy and before a removal, and say so in a line.

## Validation

- `computer-attachments.test.ts`: a session's file arrives in its machine at the same path, as root and read-only, with nothing mounted. A second session in the same machine gets its own, and a dev container works the same way. The folder leaves the machine with the session, and a store that keeps no files copies nothing. The plugin refuses a path that is no session's attachments, and says so in a line. It runs nothing in a machine for one.
- `host-machine-attachments.test.ts`: the host asks for the copy after the write and before the turn, with the session's own folder. Two sessions in one machine each get their own, and a session in no machine gets nothing. Log a failed copy and run the turn. Ask for the folder back out on removal.
- `pnpm build`, `pnpm typecheck`, `pnpm boundary` and `npx vitest run` pass from the root.

## Resume

Built. Decision [a-session-in-a-machine-gets-each-attachment-copied-into-it](../../../decisions/a-session-in-a-machine-gets-each-attachment-copied-into-it.md) answers the fork of the first draft's step 3: every session in every machine gets its own files, one message at a time.
A session that moves to another machine is not a removal, so its folder stays in the machine it left until that machine goes. The plan records this under Risks.

A review finding then reached the two paths this task writes and removes. A path that is not below a folder named `attachments` is one this plugin did not get from a session. The folder holding every session is the one path a `rm -rf` must never reach. So both the copy and the removal refuse it, in a line, before anything is run in a machine. The store refuses the same shape on its own side, which is where the folder is named.
