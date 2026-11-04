---
title: A waiting session names its tool, not the wait
created: 2026-11-04
refs:
  - git://f9e99b34 - the commit of ahpd the facts were checked at
  - "[code://packages/agent-claude/src/session/asking.ts#L369-L373](../../packages/agent-claude/src/session/asking.ts#L369-L373) - `displayName` is the tool's display name, and the confirmation title is `Run <displayName>?`"
  - "[code://packages/agent-claude/src/session/asking.ts#L439](../../packages/agent-claude/src/session/asking.ts#L439) - the activity becomes `Waiting on you: <displayName>` when a tool call waits for a confirmation"
  - "[code://packages/agent-cofold/src/runs.ts#L291](../../packages/agent-cofold/src/runs.ts#L291) - `reopen` sets the activity to `Waiting on you` after it replays a paused run"
  - "[code://packages/agent-cofold/src/runs.ts#L105-L106](../../packages/agent-cofold/src/runs.ts#L105-L106) - `apply`, which every live and replayed run event goes through, and which clears the activity on `run.finished`"
  - "[code://packages/agent-cofold/src/mapping.ts#L566-L574](../../packages/agent-cofold/src/mapping.ts#L566-L574) - `approval.requested`: the mapping's `displayName` and the confirmation title `Run <displayName>?`"
  - "[code://packages/agent-cofold/src/mapping.ts#L654-L673](../../packages/agent-cofold/src/mapping.ts#L654-L673) - `input.requested`: a question, with no tool name"
  - "[code://packages/agent-cofold/src/mapping.ts#L683-L690](../../packages/agent-cofold/src/mapping.ts#L683-L690) - the events that end a pause"
  - file:///github/ahpc/src/state.ts - `sessionView`: ahpc draws the status as \"waiting on you\" at the row end, and the host's activity on the second line
  - file:///github/externals/vscode/src/vs/workbench/contrib/chat/browser/agentSessions/agentHost/agentHostSessionListController.ts - VS Code shows the activity as the row's description while the session is in progress
---

# A waiting session names its tool, not the wait

While a tool call waits for a confirmation, the activity names the tool to approve, as `Approve Bash`, in agent-claude and in agent-cofold.
On 2026-11-04, Softov saw a session row in ahpc say "waiting on you" twice.
The status said it at the end of the first line, and the activity said `Waiting on you: Bash` on the second line.
Softov chose to change the text in ahpd, so that the status is the only "waiting on you".

## What others do

- VS Code 1.143.1: its Claude host sends no activity. Its session list shows the activity as the row's description while the session is in progress, beside a status icon.
- ahpc draws the status as a word at the end of the first line, and the activity on the second line.

## What ahpd has today

- agent-claude sets the activity to `Waiting on you: <displayName>` when it sends `chat/toolCallReady` on the main scope ([`code://packages/agent-claude/src/session/asking.ts#L439`](../../packages/agent-claude/src/session/asking.ts#L439)).
- `displayName` is the tool's display name, or its name ([`code://packages/agent-claude/src/session/asking.ts#L369`](../../packages/agent-claude/src/session/asking.ts#L369)).
- The confirmation title is `Run <displayName>?` ([`code://packages/agent-claude/src/session/asking.ts#L373`](../../packages/agent-claude/src/session/asking.ts#L373)).
- agent-cofold sets no activity when a live run asks for an approval. The activity stays as it was, such as `Thinking`.
- agent-cofold sets the activity to `Waiting on you` in `reopen`, after it replays a run that a restart left paused ([`code://packages/agent-cofold/src/runs.ts#L291`](../../packages/agent-cofold/src/runs.ts#L291)). This happens whether the run waits on an approval or on a question.
- Every live and replayed cofold event goes through `apply` ([`code://packages/agent-cofold/src/runs.ts#L105`](../../packages/agent-cofold/src/runs.ts#L105)).
- No test reads the text `Waiting on you`.
- No i18n catalog holds the activity text.

## Who writes

- `/github/ahpd` is on `main`, clean, at `f9e99b34`.
- No pull request is open on ahpd, so no other branch waits to change `asking.ts` or `runs.ts`.

## The change

- In agent-claude, the activity on a tool confirmation is `Approve <displayName>`.
- In agent-cofold, `apply` sets the activity to `Approve <displayName>` on `approval.requested`, live or replayed, with the mapping's `displayName`.
- `reopen` no longer sets `Waiting on you`. A replayed approval sets its own activity through `apply`.
- A test in each agent checks the activity while a confirmation waits.

## Open points

- What the cofold activity says once an approval ends. agent-claude says the tool it runs on approve, and `Thinking` on deny ([`code://packages/agent-claude/src/session/asking.ts#L693`](../../packages/agent-claude/src/session/asking.ts#L693)).
- What the activity says while a cofold question waits. Today it is `Waiting on you` after a restart, and unchanged on a live run.
