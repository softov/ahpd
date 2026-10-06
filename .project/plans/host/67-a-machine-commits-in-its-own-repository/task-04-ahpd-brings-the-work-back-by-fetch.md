---
title: ahpd brings a machine's work back by fetch
status: todo
depends: [task-03-the-machines-repository-is-seeded-from-the-hosts.md]
layer: "computer, sdk"
refs:
  - "[code://packages/sdk/src/types/computers.ts#L182-L184](../../../../packages/sdk/src/types/computers.ts#L182-L184) - `ComputerPort`"
  - "[code://packages/computer/src/runtime.ts#L725](../../../../packages/computer/src/runtime.ts#L725) - `ran`, text only"
  - "[code://packages/computer/src/runtime.ts#L1371](../../../../packages/computer/src/runtime.ts#L1371) - `reachedDevContainer`"
  - "[code://packages/sdk/src/repo/hardened.ts#L11-L30](../../../../packages/sdk/src/repo/hardened.ts#L11-L30) - the hardened argv"
---

## Objective

`ComputerPort.bringBack(id)` fetches the commits a machine's branch has beyond the host's into the host's repository and moves the host's branch to them where that is a fast-forward with nothing staged, reading nothing from the machine but a bundle on a pipe.

## Files

- `UPDATE: packages/sdk/src/types/computers.ts` - `bringBack?(id: string): Promise<BroughtBack | undefined>`; `BroughtBack` is `{ moved: boolean; waiting?: string }`, the hidden ref when the work waits.
- `UPDATE: packages/computer/src/runtime.ts` - a byte stream out of `docker exec` (and the dev container road) into a file made `0600` in a fresh private directory; `bringBack` runs `git bundle create - refs/heads/<branch> --not <last>` in the machine, then on the host `git -c transfer.fsckObjects=true fetch --no-tags --no-write-fetch-head <file> +refs/heads/<branch>:refs/ahpd/machines/<machine>/<branch>`, then, where the old tip is an ancestor and `diff --cached --quiet` holds, `update-ref refs/heads/<branch> <new> <old>`, `reset -q` in the tree and `update-ref -d` of the hidden ref.
- `UPDATE: packages/computer/src/plugin.ts` - the port's `bringBack` for machines it made.
- `UPDATE: packages/computer/test/computer-git-fetch.test.ts` and `computer-disposable.test.ts` - the cases below.

## Steps

1. Failing case first, real Docker: a commit in the machine is not on the host's branch after `bringBack`; today there is no `bringBack`.
2. The byte stream: `ran` stays for text; the new one writes stdout straight to the file.
3. The host's fetch reads only the file; it never names a path inside the machine's volume.
4. Diverged, or something staged: keep the hidden ref, log `the work of <machine> waits in refs/ahpd/machines/<machine>/<branch>: <branch> moved on the host` (or `the index holds staged changes`), answer `waiting`.
5. Empty bundle: answer `{ moved: false }`, no fetch.

## Validation

- `computer-git-fetch.test.ts`: a machine commit is on the host branch after `bringBack`, with a clean host `git status`; a bundle whose pack fails fsck is refused and the host branch is untouched; a host commit made meanwhile leaves the work under the hidden ref; staged host changes the same; nothing new is `{ moved: false }`; the private file is gone after each case.
- `computer-disposable.test.ts`, scripted Docker: the argv of the bundle and the fetch, and that the fetch names only the file.
- `npx tsc -b` clean; `npx vitest run packages/computer` passes.

## Resume
