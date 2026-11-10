---
title: An ACP agent shows its account on its agent
created: 2026-11-09
refs:
  - "[code://packages/agent-claude/src/views.ts](../../packages/agent-claude/src/views.ts) - `AGENT_VIEW`, the view a Claude agent shows with its account and plan usage"
  - "[code://packages/agent-acp/src/connection.ts](../../packages/agent-acp/src/connection.ts) - where agent-acp reads the Codex account for `vscode.codexAccount`"
  - git://45983f869 - the commit where host/99's check by hand did not find VS Code's account menu
---

host/99 gives VS Code's account menu the Codex account, but on 2026-11-09 Softov did not find that menu in VS Code.
A Claude agent already shows its account and plan usage as a view on its agent, which ahpw draws.
agent-acp can show the Codex account the same way, so a person sees it in any client that draws a view.
Related: plan host/99, and [the brief on a Claude login's account](../briefs/a-claude-login-shows-its-account-and-plan.md).
