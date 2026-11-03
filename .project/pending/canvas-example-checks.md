---
title: Check that examples/canvas opens beside a chat
plans: []
---

# Check that examples/canvas opens beside a chat

The example plugin `examples/canvas` is on main. It serves one page and opens it as a canvas from its tool `open_check_canvas`. On 2026-11-03 a test daemon loaded it with no `No backend is loaded` line, and `/plugins/example-canvas/` answered 200 with its "Served at" time. No client has drawn it yet.

## Set up

1. Start a test daemon with the canvas plugin:

```bash
source <(git -C /github/ahpd fetch -q origin && git -C /github/ahpd show origin/main:.project/pending/test-daemon.sh) agent-claude examples/canvas/plugin.json
ahpd plugin install @ahpd/web && ahpd restart
```

2. Add the entry the script prints to `chat.remoteAgentHosts` in VS Code's `settings.json`, set `"chat.remoteAgentHostsEnabled": true`, and reload the window.
3. Turn on `chat.canvases.enabled` in VS Code.

## Steps

1. Open http://127.0.0.1:39200/plugins/web/, sign in with `check-token`, and open the plugins page. Expect `agent-claude` and `example-canvas`, each loaded.
2. In a VS Code chat on `ahpd-check`, ask the agent to call `open_check_canvas`. Expect the page beside the chat.
3. Ask for the tool a second time. Expect the same canvas drawn again, with a new "Served at" time, and no second canvas.
4. Turn canvases off in the window, and ask for the tool again. Expect the tool to fail with `Canvases are disabled.`

## Reply

- Write "pass", or what went wrong at which step.
- Stop the test daemon with `ahpd stop`.
