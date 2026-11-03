---
title: The ask_user tool
status: todo
depends:
  - task-01-a-host-tool-asks-the-person.md
layer: "@ahpd/sdk tools, @ahpd/agent-claude"
refs:
  - "[code://packages/sdk/src/tools/index.ts#L24-L56](../../../../packages/sdk/src/tools/index.ts#L24-L56) - `hostTools`"
  - "[code://packages/agent-pi/src/tools.ts#L26-L82](../../../../packages/agent-pi/src/tools.ts#L26-L82) - the drop by name to copy"
  - "[code://packages/agent-claude/src/session/clienttools.ts#L62-L132](../../../../packages/agent-claude/src/session/clienttools.ts#L62-L132) - where Claude builds its host tools"
  - "[code://packages/agent-cofold/src/turnagent.ts#L316-L358](../../../../packages/agent-cofold/src/turnagent.ts#L316-L358) - cofold gives the name to the host tool"
  - npm://@cofold/agents@0.4.0 - `dist/tool/ask-user.js`, the input schema and the answer checks
---

## Objective

The host offers `ask_user` to every session.
Its input is cofold's: up to four questions, each with an id, a header, options with descriptions, `multiSelect` and `allowOther`.
Claude drops it, so a Claude session keeps only its own question tool.

## Files

- `CREATE: packages/sdk/src/tools/askuser.ts` - the tool, its schema, its input checks, and its answer as text.
- `UPDATE: packages/sdk/src/tools/index.ts:24-56` - `hostTools` includes it.
- `UPDATE: packages/agent-claude/src/session/clienttools.ts:62-132` - drop a host tool named `ask_user`, with a comment that names the deferred change.
- `CREATE: packages/sdk/test/ask-user-tool.test.ts` - the tool through the host.
- `UPDATE: packages/agent-cofold/test/` - one case: a cofold session uses the host's `ask_user`.
- `UPDATE: packages/agent-claude/test/` - one case: a Claude session is not offered `ask_user`.
- `UPDATE: .project/specs/agent-backends.md` - which backends get `ask_user`.

## Steps

1. Write the schema from cofold's `ask-user.js` in ahpd's own code.
2. Check duplicate ids and `multiSelect` without options, as cofold does.
3. Call `at.ask` and return the answers as one line for each question.
4. Add the tool to `hostTools`.
5. Drop `ask_user` in Claude's host tools.
6. Write the tests and the spec lines.

## Validation

- `ask-user-tool.test.ts`: two questions go out in one `chat/inputRequested`, and the answers come back in order.
- `ask-user-tool.test.ts`: the tool refuses a duplicate id, and `multiSelect` with no options.
- cofold test: the model's `ask_user` call runs the host's tool.
- Claude test: `mcp__ahp__ask_user` is not in the offered tools.
- The sdk, agent-claude and agent-cofold suites pass, one at a time.

## Resume
