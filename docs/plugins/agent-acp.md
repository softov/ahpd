# @ahpd/agent-acp

<!--@include: ../../packages/agent-acp/README.md{2,}-->

A new session box draws Approvals as a picker when the harness knows its modes. A shipped row takes the list from the agent's own source, named in a comment on the row. Codex comes from its adapter's `AgentMode` class, Gemini from `buildAvailableModes`, and Qwen from its `APPROVAL_MODE_INFO`. A row whose agent's modes nobody has found keeps a text box. The modes a session's server offers are that session's own: its config reports them as the read-only `availableApprovalModes`, as VS Code's Copilot agent reports the approval modes its session may take.
