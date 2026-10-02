---
title: cofold speaks ACP through papo, so it runs both as an SDK and as an ACP agent
created: 2026-10-02
---

Softov, 2026-10-02: "papo is the cli/tui for cofold. if necessary could wire acp in it also. so cofold could work as sdk and acp like claude."

ahpd runs cofold in process through its SDK ([`agent-cofold`](../../packages/agent-cofold)).
Claude can be run both ways: through its SDK (`agent-claude`) and as an ACP agent (`agent-acp` with an adapter).
If papo, cofold's CLI and TUI, had an `--acp` mode that served the Agent Client Protocol on stdio, cofold would be the same: an SDK for hosts that embed it, and an ACP agent for any ACP client (Zed, ahpd's `agent-acp`, VS Code's ACP support) without one.

## What it gives

- cofold in a machine without ahpd's code in it: the machine runs `papo --acp`, and `agent-acp` speaks to it like any ACP agent ([plan container/05](../plans/container/05-an-agent-in-a-machine-p2-an-acp-agent-says-what-its-machine-needs)).
- cofold in editors that speak ACP, which is cofold's reach, not only ahpd's.
- A second path that checks the first: what `agent-cofold` maps and what papo's ACP mode sends should match.

## Questions it leaves

- Whether this belongs in papo or in a small `cofold-acp` binary beside it; it is cofold's work, so cofold's plans decide.
- Which ACP features it serves first: sessions, prompts, permission requests, then `plan` updates ([agents report their plan](agents-report-their-plan.md)), modes and resume.
- Whether ahpd then keeps both `agent-cofold` and cofold through `agent-acp`, as it does for Claude.
