---
title: The test agent reads what was said
domain: acp
status: planned
priority: high
created: 2026-11-12
revalidated: 2026-11-12
requires: []
changes: []
creates: []
refs:
  - git://b4ad32951 - the commit of ahpd this plan was checked at
  - "[code://packages/agent-acp/test/fixtures/acp-server.mjs#L552-L557](../../../../packages/agent-acp/test/fixtures/acp-server.mjs#L552-L557) - `textOf` joins every text block of the prompt"
  - "[code://packages/agent-acp/test/fixtures/acp-server.mjs#L785-L798](../../../../packages/agent-acp/test/fixtures/acp-server.mjs#L785-L798) - `promptScript` picks scripts by words in that text"
  - "[code://packages/agent-acp/src/session/turn.ts#L317-L325](../../../../packages/agent-acp/src/session/turn.ts#L317-L325) - `blocksFor` puts the host's instructions first, as their own block"
  - "[code://packages/agent-acp/test/fixtures/acp-server.mjs#L1474-L1510](../../../../packages/agent-acp/test/fixtures/acp-server.mjs#L1474-L1510) - `paint` releases its terminal without waiting for it"
  - "[code://packages/sdk/src/host/terminals.ts#L584-L588](../../../../packages/sdk/src/host/terminals.ts#L584-L588) - release ends a command that has not exited, as ACP says"
---

## Goal

The test agent runs only the scripts that the person's words name.
Today the host's instructions open the first prompt, and their words start `term`, `ask` and `write` too.
On the Windows check, `paint` then stopped on a permission and left two more files.
`paint` also waits for its terminal, so in a machine the command runs before the release ends it.

## Reconnaissance

The files read and the patterns to reuse are the `refs` in the frontmatter, each with its note.

### Searches performed

- `rg "terminal/release" packages/agent-acp/test/fixtures/acp-server.mjs` - four releases. `brief` waits; `release` ends `sleep 30` on purpose; `term` waits; `paint` does not.
- Docker's events on the Windows check: no `exec_create` for `echo painted`, because the release killed `docker exec` as it started.

### Runtime path

```
prompt -> blocksFor: [instructions, what was said] -> fixture textOf -> promptScript word match
```

### Gaps

- The fixture cannot tell the instructions from what was said.

## Answers

| What | Source | Task |
| --- | --- | --- |
| The fixture matches words only in the last text block | Softov, 2026-11-12: "Only the last text block" | 01 |
| `paint` waits for its terminal's exit before it releases it | `(defaulted: ACP release kills a running command, so a wait is the only way the command runs)` | 01 |
| The last text block stays the rule, though an attachment's text comes after the person's; attachment cases name their files for the script | Softov, 2026-11-12: "Keep last text block" | 01 |
| The host's release keeps ending a running command | [code://packages/sdk/src/host/terminals.ts#L584-L588](../../../../packages/sdk/src/host/terminals.ts#L584-L588) | - |

## Proposed architecture

- **Data flow** - `textOf` returns the text of the last text block; `paint` calls `terminal/wait_for_exit` before `terminal/release`.
- **Layer responsibilities** - agent-acp test fixture only.
- **Source-of-truth files** - [`code://packages/agent-acp/test/fixtures/acp-server.mjs`](../../../../packages/agent-acp/test/fixtures/acp-server.mjs)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - The fixture reads the last block](task-01-the-fixture-reads-the-last-block.md) | implemented | - |

## Risks and tradeoffs

- A test that puts its word in an earlier block stops matching - the suite run finds it.

## Resume state

- **Done so far:** task 01 implemented, 2026-11-12; see [implemented.md](implemented.md).
- **Next action:** review and merge the PR, then the [Windows check](../../../pending/windows-machine-paths-checks.md). The plan closes as `built` on Softov's word.
- **Open questions:** none.
- **Watch out for:** an attachment adds its text block after the person's text, so that block is the last one rather than what was said. The new case needs a terminal, so it is in the turn test rather than the blocks harness.

## Final verification checklist

- [ ] A first prompt `paint` with host instructions runs only `paint`.
- [ ] The agent-acp suite passes.
- [ ] The [Windows check](../../../pending/windows-machine-paths-checks.md) shows only `acp-server.mjs` and `painted.txt`.
