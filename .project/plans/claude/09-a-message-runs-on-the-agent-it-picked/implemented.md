---
title: A message runs on the custom agent it picked - implemented
---

## What exists

- `MessageFrom.agent` (`packages/sdk/src/types/session.ts`) carries a message's pick; `messageFrom` in `host.ts` reads it on a live and a queued send.
- Built-in agents are listed as `claude-internal:/agent/<name>`, and `general-purpose` is not listed, as VS Code lists them.
- `agentNameOf` (`packages/agent-claude/src/session.ts`) resolves the SDK name as VS Code's `resolveClaudeAgentName` does: the last segment of an internal uri, a file's frontmatter `name`, else the file name without `.md`. A file is read only when it is a regular file of at most 64 KiB, and a broken escape names nothing.
- A turn whose pick differs from the running agent closes the query and resumes the same CLI session on the picked agent; the same pick twice builds one query, and a queued message switches only on its own turn.
- A restored session reopens on its stored model when the variant offers it (`seedModels`).
- `packages/agent-claude/README.md` has "The agent a message picks".

## Verified

- `agent-claude-agent-pick.test.ts` (12 cases) and `agent-claude-restored-model.test.ts` (6 cases), plus host cases in `sessions.test.ts`; the switch cases fail with `switchAgent` neutered.
- Review on 2026-10-04: the name lookup compared with VS Code at the checkpoint; a folder with a space, an upper-case `.MD`, `/dev/zero`, an oversized file and a broken escape each tested.
- After rebasing onto main: `pnpm exec tsc --noEmit`, `pnpm boundary`, `pnpm test` (176 files, 2700 tests) pass.

## Departures

- Not checked by hand in ahpapp or VS Code.
- `config.values.model` still reports a stored id the variant refused, since `config.values` is the stored settings.
- ahpd reads an agent file only when it is a regular file under 64 KiB, where VS Code reads any; a client names the uri.
