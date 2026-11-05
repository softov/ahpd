---
title: A session with no folder works in a scratch folder
created: 2026-11-05
refs:
  - git://fad25f77 - the commit of ahpd the facts were checked at, the merge of #241
  - git://4b2def04 - MayCXC's commit that gives an ACP, cofold or pi session with no folder a scratch folder
  - "[code://packages/sdk/src/sessions/scratch.ts#L19-L23](../../packages/sdk/src/sessions/scratch.ts#L19-L23) - `ensureWorkspacelessScratchDir`, which makes `<home>/.copilot/chats/<session id>`"
  - "[code://packages/agent-acp/src/session.ts#L70](../../packages/agent-acp/src/session.ts#L70) - ACP uses the scratch folder after the plugin's own `cwd`"
  - "[code://packages/agent-cofold/src/session.ts#L105](../../packages/agent-cofold/src/session.ts#L105) - cofold uses the scratch folder"
  - "[code://packages/agent-pi/src/session.ts#L132](../../packages/agent-pi/src/session.ts#L132) - pi uses the scratch folder"
  - "[code://packages/agent-claude/src/claude.ts#L188-L194](../../packages/agent-claude/src/claude.ts#L188-L194) - Claude uses the first of the plugin's `paths`"
  - "[code://packages/agent-claude/src/claude.ts#L224-L230](../../packages/agent-claude/src/claude.ts#L224-L230) - Claude's `workingDirectory`, which falls back to that path"
  - "[code://packages/agent-cofold/test/agent-cofold-tools.test.ts#L946-L966](../../packages/agent-cofold/test/agent-cofold-tools.test.ts#L946-L966) - a cofold case that makes a scratch folder in the real home"
  - https://github.com/microsoft/vscode/blob/d1a91b3af8869c37d4757aa959f0859b59c33265/src/vs/platform/agentHost/common/workspacelessScratchDir.ts#L9-L20 - VS Code's root for chats with no workspace, `<home>/.copilot/chats`
  - https://github.com/microsoft/vscode/blob/d1a91b3af8869c37d4757aa959f0859b59c33265/src/vs/platform/agentHost/node/workspacelessScratchDir.ts#L9-L15 - VS Code makes `<home>/.copilot/chats/<session id>`, shared by its agent harnesses
  - https://github.com/microsoft/vscode/blob/d1a91b3af8869c37d4757aa959f0859b59c33265/src/vs/platform/agentHost/node/agentService.ts#L7415-L7430 - VS Code releases the scratch folders whose chat is gone
---

# A session with no folder works in a scratch folder

Softov wants this behaviour on record, so that a later plan can decide on it. Since #241, a session that a client gives no folder works in a folder of its own under the person's home, as VS Code does. Before #241, such a session worked in the daemon's folder.

## What others do

VS Code gives a chat with no workspace the folder `<home>/.copilot/chats/<session id>`, and every agent harness in VS Code shares that folder. VS Code records each scratch folder in its database. It removes the folder when its chat is deleted, and at startup it releases the folders whose chat is gone.

## What ahpd has today

- `ensureWorkspacelessScratchDir` makes `<home>/.copilot/chats/<session id>`, with the session id as one path segment.
- The ACP, cofold and pi backends use this folder for a session with no folder. ACP uses the plugin's own `cwd` first.
- The Claude backend does not use it. A Claude session with no folder works in the first of the plugin's `paths`.
- No code in ahpd removes a scratch folder. A folder stays after its session is disposed.
- The folder is under `.copilot`, the root VS Code names. ahpd keeps its other data under its own XDG folders.
- The scratch cases for ACP, cofold and pi move `HOME` and `USERPROFILE` to a temporary folder. One cofold case, "keeps the tools for a session with no working directory", moves neither. A test run makes its folder in the real home.

## Who writes

- MayCXC's fork writes the backends and the scratch helper. His branch `host/20261105-0210-the-server-follows-the-audit` is not checked against this brief.
- Any change to the folder name also changes a session that VS Code opens on the same machine, because VS Code uses the same folder.

## The change

- To be decided. This brief records the behaviour only.

## Open points

- Should Claude use the scratch folder too, as the other three backends do?
- Should the host remove a session's scratch folder when the session is disposed, as VS Code removes it with its chat?
- Should ahpd keep VS Code's `.copilot` root, or use a folder under its own data folder?
- Should the cofold case move the home, as the other scratch cases do?
