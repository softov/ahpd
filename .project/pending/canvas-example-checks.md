---
title: Check that examples/canvas opens beside a chat
plans: []
---

# Check that examples/canvas opens beside a chat

The example plugin `examples/canvas` serves one page and opens it as a canvas from its tool `open_check_canvas`. Its tests pass, and a scratch daemon loads it and serves the page with 200. No client has drawn it yet. The same branch makes `--plugin` add to the config's `plugins` list. These checks need a daemon from main after the merge. A window on another machine needs the plugin's `origin` option set to the address it reaches the daemon at.

## Set up

1. Restart the daemon in your terminal with your config and `--plugin /github/ahpd/examples/canvas/plugin.json`. Leave `routes.port` unset.
2. For a window on another machine, put the plugin in the config instead: `{ "source": "/github/ahpd/examples/canvas/plugin.json", "options": { "origin": "http://<address>:<port>" } }` beside the backends, and restart without the flag.
3. Turn canvases on in the window: `chat.canvases.enabled` in VS Code, or the canvases host feature in ahpw.

## Steps

1. Read the daemon's log. Expect no line that starts `No backend is loaded`.
2. Open the plugins page in ahpw. Expect the config's backends and `example-canvas`, each loaded.
3. Open the page URL in a browser: `<origin>/plugins/example-canvas/`, or `http://127.0.0.1:<port>/plugins/example-canvas/` without `origin`. Expect the page with its "Served at" time.
4. In a chat, ask the agent to call `open_check_canvas`. Expect the page beside the chat.
5. Ask for the tool a second time. Expect the same canvas drawn again, with a new "Served at" time, and no second canvas.
6. Turn canvases off in the window, and ask for the tool again. Expect the tool to fail with `Canvases are disabled.`

## Reply

- Write "ok", or what went wrong at which step.
