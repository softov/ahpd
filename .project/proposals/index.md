---
title: Upstream proposals
---

Issues worth opening on somebody else's tracker, one file each, written so they can be pasted rather than re-derived from a review.
Each names the repository it targets and the evidence it rests on, read at VS Code `832cf23c5` (2026-09-19), the protocol repository `8549827`, and the published `@microsoft/agent-host-protocol` 0.9.0.
Every file here is a draft: nothing has been filed, and the `Filed` column is the record of it.

| Proposal | Target | Filed |
| --- | --- | --- |
| [Well-known `_meta` keys carry behaviour the spec says belongs in typed fields](agent-host-protocol-meta-keys.md) | `microsoft/agent-host-protocol` | no |
| [The shipped JSON Schemas close no object, so an invented key validates clean](agent-host-protocol-open-schemas.md) | `microsoft/agent-host-protocol` | no |
| [Extension methods have no convention a host that is not VS Code can follow](agent-host-protocol-extension-methods.md) | `microsoft/agent-host-protocol` | no |
| [A plan is a tool call inside one turn, so no client can hold it between turns](agent-host-protocol-plan-channel.md) | `microsoft/agent-host-protocol` | no |
| [A host cannot report how full a chat's context window is](agent-host-protocol-context-usage.md) | `microsoft/agent-host-protocol` | no |
| [The standalone host prints its connection token on stdout while keeping it out of its log file](vscode-token-on-stdout.md) | `microsoft/vscode` | no |
| [A synced customization bundle reaches Claude as a plugin named by its revision nonce](vscode-synced-plugin-has-no-claude-name.md) | `microsoft/vscode` | no |
