---
title: What waits after an agent asks the person
---

# What waits after an agent asks the person

## Claude and `ask_user`

- **What waits:** a Claude session is not offered `ask_user`. VS Code's shell description names `ask_user`, and Claude has only its own question tool, `AskUserQuestion`.
- **Why:** Softov, 2026-11-03: "claude put on pending. as future change."
- **An option to check then:** rename the host tool to `AskUserQuestion`, Claude's own name, in place of `ask_user`. Softov, 2026-11-03: "maybe we rename the tool to the same as claude AskUserQuestion instead ask_user."
- **Where it goes:** a later plan in the host domain, after this plan and the agent terminal tool are built.
