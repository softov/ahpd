import { routePrefix } from '@ahpd/sdk';
import type { CanvasState } from '@microsoft/agent-host-protocol';
import type { Plugin } from '@ahpd/sdk';

/**
 * A plugin that opens a canvas on the chat its tool is called from.
 *
 * One route serves the page at `/plugins/example-canvas/`, and one tool,
 * `open_check_canvas`, opens that page as a canvas on the calling chat. The
 * page's URL is the `origin` option when it is set, and is otherwise built
 * from the address the daemon bound, so it opens on the daemon's own machine; a
 * remote client is then given a URL it cannot reach.
 */

/** The plugin's id, which is also the prefix its route is served under. */
export const name = 'example-canvas';

/** What a listing prints. */
export const title = 'Example canvas';

/** The path the page is served at: `/plugins/example-canvas/`. */
const PREFIX = routePrefix(name);

/** The canvas instance a chat holds; a second open on the same chat draws it again. */
const INSTANCE = 'check';

/** A bound address that means every interface, which a browser cannot open. */
const ANY = new Set(['0.0.0.0', '::', '']);

/** The page's origin for an address the daemon bound: loopback for any interface, brackets for IPv6. */
export const originOf = (host: string, port: number): string => {
  const address = ANY.has(host) ? '127.0.0.1' : host;
  return `http://${address.includes(':') ? `[${address}]` : address}:${port}`;
};

/** The page the canvas shows, with the time it was served so a reload is seen. */
export const page = (at: Date): string => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Example canvas</title>
<style>
  body { font: 16px/1.5 system-ui, sans-serif; margin: 2rem; color: #1f2328; background: #ffffff; }
  @media (prefers-color-scheme: dark) { body { color: #e6edf3; background: #0d1117; } }
  code { font-size: 0.9em; }
</style>
</head>
<body>
<h1>Example canvas</h1>
<p>A plugin served this page, and the host opened it beside the chat.</p>
<p>Served at <code>${at.toISOString()}</code>.</p>
</body>
</html>
`;

export const apply: Plugin['apply'] = (host, options) => {
  const asked = options.origin;
  /** Where the page is reached: at once from `origin`, else once the daemon has bound its port. */
  let url = typeof asked === 'string' && asked !== '' ? `${new URL(asked).origin}${PREFIX}` : undefined;
  if (url === undefined) {
    host.on('listening', (event) => {
      url = `${originOf(event.host, event.port)}${PREFIX}`;
    });
  }

  host.registerRoute(async (request) => {
    const path = new URL(request.url).pathname;
    if (path !== PREFIX) return new Response('Not found', { status: 404 });
    if (request.method !== 'GET') return new Response('Method not allowed', { status: 405, headers: { allow: 'GET' } });
    return new Response(page(new Date()), { headers: { 'content-type': 'text/html; charset=utf-8' } });
  });

  host.registerTool({
    definition: {
      name: 'open_check_canvas',
      title: 'Open Check Canvas',
      description: 'Open the example canvas beside this chat. Answer: the canvas resource and its URL.',
      inputSchema: { type: 'object', properties: {} },
    },
    run: async (_input, at) => {
      if (url === undefined) throw new Error('The daemon has no address yet, so the page has no URL.');
      const state = { instanceId: INSTANCE, extensionId: name, canvasId: 'check', title: 'Example canvas', url } satisfies CanvasState;
      const resource = await host.openCanvas(at.chat, state);
      return JSON.stringify({ resource, url });
    },
  });
};
