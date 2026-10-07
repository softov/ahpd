---
title: Claude and pi load a project's files only when it is trusted - implemented
date: 2026-10-06
refs:
  - git://fb1f022
  - "[code://packages/agent-claude/src/session/query.ts#L13-L22](../../../../packages/agent-claude/src/session/query.ts#L13-L22) - `ALL_SOURCES`, the three files the CLI reads"
  - "[code://packages/agent-claude/src/session/query.ts#L156](../../../../packages/agent-claude/src/session/query.ts#L156) - `settingSources`, read from the host's answer about the folder"
  - "[code://packages/agent-claude/src/mcp.ts#L30-L35](../../../../packages/agent-claude/src/mcp.ts#L30-L35) - `serversFor`, which reads a project's `.mcp.json` only for a folder the host vouched for"
  - "[code://packages/agent-claude/src/claude.ts#L578-L585](../../../../packages/agent-claude/src/claude.ts#L578-L585) - where both are given `start.trusted`"
  - "[code://packages/agent-pi/src/session.ts#L682](../../../../packages/agent-pi/src/session.ts#L682) - `trustProject`, narrowed by the host's answer"
  - "[code://packages/agent-claude/test/agent-claude-trust.test.ts](../../../../packages/agent-claude/test/agent-claude-trust.test.ts) - the four Claude cases"
  - "[code://packages/agent-pi/test/agent-pi-trust.test.ts](../../../../packages/agent-pi/test/agent-pi-trust.test.ts) - the three pi cases"
---

A Claude session in a folder the host did not vouch for is built with `settingSources: ['user']`, and with no server from that folder's `.mcp.json`. So the project's settings and the hooks they declare, its plugins, its skills and its `CLAUDE.md` reach neither this host nor the model. In a folder the host vouched for, the CLI is told all three sources by name, and the folder's server is declared as before. The person's own `~/.claude.json` is read either way, because it is not a project's. A pi session in such a folder starts with `trustProject: false` whatever its own `projectTrust` says. So `.pi/settings.json`, `.pi/extensions`, its skills, prompts, themes and packages do not load. In a vouched-for folder the session's `projectTrust` decides as it did, `deny` included. Absent `Start.trusted` is read as untrusted in both, which is the host having said nothing.

## What was built

- [`code://packages/agent-claude/src/session/query.ts`](../../../../packages/agent-claude/src/session/query.ts) - `ALL_SOURCES` is `['user', 'project', 'local']`, named rather than left off, because omitting the option is what loads all three. There is no other way to say "the person's alone". The query's `settingSources` is that list where `ctx.options.trusted?.(ctx.options.cwd) === true`, and `['user']` otherwise.
- [`code://packages/agent-claude/src/mcp.ts`](../../../../packages/agent-claude/src/mcp.ts) - `serversFor(directories, trusted?)` reads `join(dir, '.mcp.json')` only for a directory the answer vouches for. The home file is not filtered, and the doc says why. It is the person's own rather than a project's. The CLI's `user` source is kept in both cases anyway.
- [`code://packages/agent-claude/src/claude.ts`](../../../../packages/agent-claude/src/claude.ts) - `start.trusted` goes to `serversFor` and to the session options, spread conditionally so `exactOptionalPropertyTypes` holds. The query and the MCP file are the two halves of one answer, each read where it is used.
- [`code://packages/agent-claude/src/session/context.ts`](../../../../packages/agent-claude/src/session/context.ts) - `ClaudeSessionOptions.trusted`, carried from `Start` with the comment saying absent is untrusted.
- [`code://packages/agent-pi/src/session.ts`](../../../../packages/agent-pi/src/session.ts) - `trustProject` is `trust !== 'deny' && start.trusted?.(where) === true`; the session's own `projectTrust` can only narrow, and the host's answer is what opens the folder.
- [`code://packages/agent-claude/test/agent-claude-trust.test.ts`](../../../../packages/agent-claude/test/agent-claude-trust.test.ts) - new: a folder with a `.mcp.json` of its own, and the query the fake SDK receives for it. Untrusted, trusted, and the host saying nothing.
- [`code://packages/agent-pi/test/agent-pi-trust.test.ts`](../../../../packages/agent-pi/test/agent-pi-trust.test.ts) - new: `trusted: () => false` with no `projectTrust` gives `trustProject: false`, `trusted: () => true` gives `true`, and a vouched-for folder with `projectTrust: 'deny'` gives `false` - the session narrowing, never widening.

## Verified

- Task 01: `npx vitest run packages/agent-claude/test/agent-claude-trust.test.ts` was `Tests 4 failed (4)` before the change - `expected undefined to deeply equal [ 'user' ]` on each, the option being absent - and 4 passed after.
- Task 02: `npx vitest run packages/agent-pi/test/agent-pi-trust.test.ts` was `Tests 1 failed | 2 passed (3)` before the change. The failure was `expected false, received true` on `trustProject`, for a folder the host did not vouch for. The other two passed before and after, which is what they are for.
- `npx tsc -b` clean.
- `pnpm boundary` clean, all eight packages "declared, none undeclared".
- `npx vitest run packages/agent-claude packages/agent-pi` - 35 files, 369 tests, all passed.
- The work is uncommitted on `fb1f022`, as p1's is.

## Departures from the plan

- The plan's task 01 names `settingSources` and `serversFor` in `agent-claude`. The answer travels to the query through `ClaudeSessionOptions` (`context.ts`), and to `serversFor` through its own parameter. The two are built in different places from the same `Start`. A reviewer looking for one seam will find two.
- The home `~/.claude.json` is read in both cases. The plan does not say either way. The file is the person's rather than a folder's. `settingSources: ['user']` keeps the same file for the CLI, so filtering it here would have made this host and the CLI disagree about one file.

## Tests that changed because the behaviour did

- `packages/agent-claude/test/mcp.test.ts` - `serversFor` takes the answer now. So the three existing cases that read a project's file pass `vouched` (`() => true`), which is what they were asserting about. One case is new: a folder nobody vouched for adds nothing to the home file, and an absent answer is the same as a no.

## Left for later

- none. Nothing this plan named is left; there is no `deferred.md`.
- A host with no people directory used to trust nothing, so both backends here loaded no project files there whatever a window pushed. The review of 2026-10-06 settled it: on such a host the sender's push decides ([the decision](../../../decisions/the-sender-decides-on-a-host-with-no-people.md)). That is where trust is read rather than where it is used. This plan's code is the same either way, and both backends read the host's answer unchanged.
