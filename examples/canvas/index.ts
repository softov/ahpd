import { networkInterfaces } from 'node:os';
import { routePrefix } from '@ahpd/sdk';
import type { CanvasState } from '@microsoft/agent-host-protocol';
import type { Plugin } from '@ahpd/sdk';

/**
 * A plugin that opens a canvas on the chat its tool is called from.
 *
 * One route serves the page at `/plugins/example-canvas/`, and one tool,
 * `open_check_canvas`, opens that page as a canvas on the calling chat. The
 * page's URL is the `origin` option when it is set, and is otherwise built
 * from the address the daemon bound, a network one where there is one, so a
 * window on another machine can load it.
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
const WILDCARD = new Set(['0.0.0.0', '::', '0000:0000:0000:0000:0000:0000:0000:0000', '']);

/** A bound address that only this machine reaches. */
const LOOPBACK = new Set(['localhost', '127.0.0.1', '::1', '0000:0000:0000:0000:0000:0000:0000:0001']);

/** One origin, with brackets around an IPv6 address. */
const httpOrigin = (host: string, port: number): string => `http://${host.includes(':') ? `[${host}]` : host}:${port}`;

/**
 * The page's origins for an address the daemon bound, as VS Code's agent host
 * lists a server's: a wildcard bind is `localhost` on this machine and each
 * external IPv4 address beside it, a loopback bind is local alone, and any
 * other address is a network one.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/serverUrls.ts#L16-L48
 */
export const originsOf = (host: string, port: number, interfaces: ReturnType<typeof networkInterfaces> = networkInterfaces()): { local: string[]; network: string[] } => {
  if (!WILDCARD.has(host)) {
    return LOOPBACK.has(host) ? { local: [httpOrigin(host, port)], network: [] } : { local: [], network: [httpOrigin(host, port)] };
  }
  const network = new Set<string>();
  for (const one of Object.values(interfaces).flatMap((each) => each ?? [])) {
    if (one.family === 'IPv4' && !one.internal) network.add(httpOrigin(one.address, port));
  }
  return { local: [httpOrigin('localhost', port)], network: [...network] };
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
  /** The canvases opened before the page had a URL, by chat, to be drawn again with it. */
  const opened = new Map<string, string>();
  const stateOf = (): CanvasState => ({
    instanceId: INSTANCE,
    extensionId: name,
    canvasId: 'check',
    title: 'Example canvas',
    ...(url === undefined ? {} : { url }),
  });
  if (url === undefined) {
    host.on('listening', (event) => {
      const origins = originsOf(event.host, event.port);
      const origin = origins.network[0] ?? origins.local[0];
      if (origin === undefined) return;
      url = `${origin}${PREFIX}`;
      // A canvas opened before the page had a URL takes it now, as VS Code
      // draws a canvas again once its source is there.
      for (const resource of opened.values()) host.updateCanvas(resource, stateOf());
      opened.clear();
    });
  }

  /*
   * GET, and HEAD as GET without the page, which every general-purpose
   * server answers; any other method is 405 with the two it takes.
   * https://www.rfc-editor.org/rfc/rfc9110#section-9.3.2
   */
  host.registerRoute(async (request) => {
    const path = new URL(request.url).pathname;
    if (path !== PREFIX) return new Response('Not found', { status: 404 });
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response('Method not allowed', { status: 405, headers: { allow: 'GET, HEAD' } });
    }
    const headers = { 'content-type': 'text/html; charset=utf-8' };
    return new Response(request.method === 'HEAD' ? null : page(new Date()), { headers });
  });

  /*
   * A canvas whose page has no URL yet is opened without one, which is how the
   * protocol says its source is not there, and it is drawn again with the URL
   * once the daemon listens:
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/copilot/copilotAgentSession.ts#L5196-L5226
   */
  host.registerTool({
    definition: {
      name: 'open_check_canvas',
      title: 'Open Check Canvas',
      description: 'Open the example canvas beside this chat. Answer: the canvas resource and its URL.',
      inputSchema: { type: 'object', properties: {} },
    },
    run: (_input, at) => {
      const resource = host.openCanvas(at.chat, stateOf());
      if (url === undefined) opened.set(at.chat, resource);
      return JSON.stringify({ resource, url });
    },
  });
};
