---
title: An ACP agent in a folder nobody trusted
domain: host
status: built
priority: medium
created: 2026-10-06
revalidated: 2026-10-06
requires:
  - plans/host/66-a-session-honours-the-folders-vscode-trusts-p1-the-host-declares-keeps-and-asks/plan.md
refs:
  - "[code://packages/agent-acp/src/presets.ts#L23-L56](../../../../packages/agent-acp/src/presets.ts#L23-L56) - `AcpPreset`, where the flag goes"
  - "[code://packages/agent-acp/src/session/opening.ts#L300](../../../../packages/agent-acp/src/session/opening.ts#L300) - the agent spawned with `cwd`"
  - "[code://packages/agent-acp/src/session/opening.ts#L379-L414](../../../../packages/agent-acp/src/session/opening.ts#L379-L414) - `session/new` and `session/load` with `cwd` and the host's `mcpServers`"
---

## Goal

An ACP session in a folder that is not trusted is refused with a sentence naming the folder. A preset that says the agent honours trust itself is the exception. Either way, no external agent gets a folder it will load hooks and settings from unchecked.

## Reconnaissance

ahpd reads no project file for an ACP agent. It passes `cwd` and the host's own `mcpServers`. The agent (codex, gemini, opencode, pi-acp) loads its own project files from `cwd` as it chooses. ACP has no trust field.

## Decisions locked in

| What | Source | Task |
| --- | --- | --- |
| Refused in an untrusted folder unless the preset declares `honoursTrust: true` | Softov, 2026-10-06, asked "An ACP agent loads its own project config, which ahpd cannot see. In an untrusted folder:": "Refuse unless preset says"; the flag's name `(defaulted: a boolean on AcpPreset beside machine, read the same from a person's own preset)` | 01 |

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - An ACP session in an untrusted folder](task-01-an-acp-session-in-an-untrusted-folder.md) | done | p1 task 03 |

## Resume state

- **Done so far:** every task is done, reviewed on 2026-10-06.
- **Next action:** none.
- **Open questions:** none.
- **Watch out for:** a preset that runs pi through ACP has pi's own `projectTrust`, which ahpd does not reach here. No shipped row sets `honoursTrust`. On a host with no people directory the sender's push decides ([the decision](../../../decisions/the-sender-decides-on-a-host-with-no-people.md)). An ACP session there starts in a folder that connection pushed, and the host refuses it everywhere else.

## Final verification checklist

- [ ] The task's case fails first and passes after.
- [ ] `plans/index.md` updated.
