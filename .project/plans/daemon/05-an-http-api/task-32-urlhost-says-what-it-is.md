---
title: The comment on urlHost says what it is
status: done
depends: [task-28-a-personal-url-brackets-an-ipv6-host.md]
layer: "server"
refs:
  - "[code://packages/server/src/config.ts#L290-L294](../../../../packages/server/src/config.ts#L290-L294) - `urlHost`, whose comment says what the function is"
---

## Objective

The comment on `urlHost` says what the function is and nothing about where it used to be or why it moved.

## Files

- `UPDATE: packages/server/src/config.ts:290-294` - the comment.

## Steps

1. Keep the first line, "A host as a URL writes it: an IPv6 address in brackets, any other host as it is."
2. Remove "Here rather than in the run command because ...", which is where the function came from and belongs in the commit.

## Validation

- The comment names no other file and no earlier place.
- `pnpm typecheck` green.

## Resume

Implemented 2026-09-27. `urlHost`'s comment is one sentence, "A host as a URL writes it: an IPv6 address in brackets, any other host as it is.", and nothing else; the paragraph that said where the function came from is gone, so the comment names no other file and no earlier place.

This is a comment-only change, so there was no test to watch fail. The check run instead was reading `packages/server/src/config.ts:290-294` and searching it for a file name or an earlier place, which is the task's first Validation. `tsc -p packages/server/tsconfig.json --noEmit` is green.
