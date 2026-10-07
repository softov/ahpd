---
title: A session in a machine reads its attachments at the path the host wrote
status: todo
depends: [task-01-an-attachment-becomes-a-file-the-host-wrote.md]
layer: "computer"
refs:
  - "[code://packages/computer/src/gitdir.ts#L97-L104](../../../../packages/computer/src/gitdir.ts#L97-L104) - `GitBind`, a bind with `readOnly`, the shape to reuse"
  - "[code://packages/computer/src/gitdir.ts#L313](../../../../packages/computer/src/gitdir.ts#L313) - `gitMounts`, where a machine's binds are put together"
  - "[code://packages/computer/src/runtime.ts](../../../../packages/computer/src/runtime.ts) - where a machine is made with its binds"
  - "[code://packages/computer/src/plugin.ts#L1593](../../../../packages/computer/src/plugin.ts#L1593) - `enter`, a session entering a machine that already exists"
---

## Objective

A machine made for a session binds that session's attachments folder, `<sessions dir>/attachments/<session>`, read-only at the same path.
A path that `partsOf` names resolves to the same file inside the machine as on the host.

## Files

- `UPDATE: packages/computer/src/runtime.ts` - when a machine is made for a session, add one read-only bind of the session's attachments folder at its own path. Create the folder first if it does not exist, so the bind has a source.
- `UPDATE: packages/computer/src/devcontainer.ts` - the same bind for a dev container, in the form its CLI takes.
- `CREATE: packages/computer/test/computer-attachments.test.ts` - the cases below.

## Steps

1. Find the code that makes a machine for a session. It must know the session and the host's sessions directory.
2. Add the bind with the existing bind shape, `readOnly: true`.
3. A running container takes no new mount. So a session that enters a machine made for another session gets no bind. Stop and ask before you decide what that session gets.

## Validation

- `computer-attachments.test.ts`: the arguments for a machine made for session `s` hold a read-only bind of `<sessions dir>/attachments/s` at the same path.
- The same file: a dev container made for `s` has the same bind.
- The same file: the code creates the folder before it makes the machine.
- `pnpm build`, `pnpm typecheck`, `pnpm boundary` and `npx vitest run` pass from the root.

## Resume
