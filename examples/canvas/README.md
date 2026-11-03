# A canvas from a plugin

The smallest plugin that opens a canvas. [`index.ts`](index.ts) registers a route that serves one page at `/plugins/example-canvas/`. Its tool, `open_check_canvas`, opens that page as a canvas on the chat it is called from. [`plugin.json`](plugin.json) is its manifest, and it declares both in its `contracts`.

[docs/plugins/PLUGINS.md](../../docs/plugins/PLUGINS.md#showing-a-canvas-on-a-chat) is the canvas contract in reference form.

## Run it

The tool needs an agent to call it, so load the plugin beside a backend. Name it in the daemon's config, by the path of its `plugin.json`:

```json
{ "plugins": ["@ahpd/agent-claude", { "source": "/path/to/ahpd/examples/canvas/plugin.json" }] }
```

Or add it for one run with `--plugin`, which adds to the config's `plugins` list:

```bash
node packages/server/dist/main.js --port 9200 --plugin ./examples/canvas/plugin.json
```

Then:

1. Turn canvases on in the client. In VS Code that is `chat.canvases.enabled`. The host refuses the canvas calls until a window turns `canvasesEnabled` on.
2. In a chat, ask the agent to call `open_check_canvas`. The page opens beside the chat and shows the time it was served.

A second call on the same chat draws the same canvas again, because its instance id is always `check`.

## What it assumes

The page's URL is built from the address the daemon bound, with `0.0.0.0` and `::` read as `127.0.0.1`. That URL opens on the daemon's own machine and nowhere else, so a remote window gets a canvas it cannot load.

For a window on another machine, set the `origin` option to where that window reaches the daemon. The URL then starts with it:

```json
{ "source": "/path/to/ahpd/examples/canvas/plugin.json", "options": { "origin": "https://ahpd.example.test" } }
```

The route must be served on the daemon's own port. With the daemon key `routes.port` set, plugin routes move to a listener of their own. A URL built from the bound address then answers 404, and `origin` must name the routes listener.
