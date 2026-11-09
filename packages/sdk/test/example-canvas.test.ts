import { loggerOf } from '../src/log.js';
import { networkInterfaces } from 'node:os';
import { describe, expect, it } from 'vitest';
import { createHost, ROOT } from '../src/host.js';
import { foldHostOptions, pluginHost, raise, routeOf } from '../src/plugins/plugins.js';
import { fileResources } from '../src/resources/resources.js';
import { sdkVersion } from '../src/version.js';
import { echo } from '../../../examples/echo/agent.js';
import { apply, name, originsOf } from '../../../examples/canvas/index.js';
import type { CanvasState } from '@microsoft/agent-host-protocol';
import type { ToolCall } from '../src/types/host.js';
import type { LoaderContext } from '../src/types/plugin.js';
import type { Peer } from '../src/types/rpc.js';

/*
 * examples/canvas, folded over a host the way the daemon loads it.
 *
 * Its route serves the page, and its tool opens that page as a canvas on the
 * chat it is called from, at an address the daemon bound.
 */

const DIR = '/tmp/example-canvas';

const context = (): LoaderContext => ({
  path: DIR, paths: [DIR], version: sdkVersion(), hostName: 'test', configDir: DIR, log: loggerOf(() => {}), say: () => {},
});

const peer = (): Peer => ({
  send: () => {}, notify: () => {}, request: async () => ({}), answered: () => {}, close: () => {},
});

/** A host with the example folded over it, canvases on, and one live chat. */
async function made(options: Record<string, unknown> = {}) {
  const { host: plugin, contribution } = pluginHost(name, context());
  await apply(plugin, options);
  const folded = foldHostOptions({
    path: DIR,
    agents: [echo({ path: DIR, pace: 0 })],
    resources: fileResources(),
  }, [contribution]);
  const host = createHost(folded.options);
  const client = host.accept(peer());
  await client.handle({
    method: 'initialize',
    params: { clientId: 'probe', protocolVersions: ['1.0.0'], initialSubscriptions: [ROOT] },
  });
  await client.handle({
    method: 'dispatchAction',
    params: { channel: ROOT, action: { type: 'root/configChanged', config: { canvasesEnabled: true } } },
  });
  const uri = 'ahp-session:/one';
  await client.handle({ method: 'createSession', params: { channel: uri, provider: 'echo' } });
  const session = await client.handle({ method: 'subscribe', params: { channel: uri } }) as {
    snapshot: { state: { defaultChat: string } };
  };
  const chat = session.snapshot.state.defaultChat;
  const tool = contribution.tools.find((one) => one.definition.name === 'open_check_canvas');
  if (tool === undefined) throw new Error('the example registered no open_check_canvas');
  const at = { session: uri, chat } as ToolCall;
  return { client, chat, contribution, routes: folded.routes, open: () => tool.run({}, at) };
}

/*
 * VS Code's agent host lists a server's addresses from its bind:
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/serverUrls.ts#L16-L48
 */
describe('originsOf', () => {
  const loopback = { address: '127.0.0.1', netmask: '255.0.0.0', family: 'IPv4', mac: '00:00:00:00:00:00', internal: true, cidr: '127.0.0.1/8' } as const;
  const lan = { address: '192.168.0.10', netmask: '255.255.255.0', family: 'IPv4', mac: '02:00:00:00:00:01', internal: false, cidr: '192.168.0.10/24' } as const;
  const linkLocal = { address: 'fe80::1', netmask: 'ffff:ffff:ffff:ffff::', family: 'IPv6', mac: '02:00:00:00:00:01', internal: false, cidr: 'fe80::1/64', scopeid: 2 } as const;
  const interfaces = { lo: [loopback], eth0: [lan, linkLocal] };

  it('gives a wildcard bind localhost and each external IPv4 address beside it, as VS Code lists a server', () => {
    const both = { local: ['http://localhost:8080'], network: ['http://192.168.0.10:8080'] };
    expect(originsOf('0.0.0.0', 8080, interfaces)).toEqual(both);
    expect(originsOf('::', 8080, interfaces)).toEqual(both);
    expect(originsOf('0.0.0.0', 8080, { lo: [loopback] })).toEqual({ local: ['http://localhost:8080'], network: [] });
  });

  it('gives a loopback bind local alone and any other address as a network one, an IPv6 address in brackets', () => {
    expect(originsOf('::1', 8080, interfaces)).toEqual({ local: ['http://[::1]:8080'], network: [] });
    expect(originsOf('127.0.0.1', 8080, interfaces)).toEqual({ local: ['http://127.0.0.1:8080'], network: [] });
    expect(originsOf('192.168.0.10', 8080, interfaces)).toEqual({ local: [], network: ['http://192.168.0.10:8080'] });
  });
});

describe('open_check_canvas', () => {
  /*
   * A canvas whose source is not there yet is opened without a url, and drawn
   * again once it is, as VS Code's host does:
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/copilot/copilotAgentSession.ts#L5196-L5226
   */
  it('opens without a url before the daemon listens, and draws the url in once it does', async () => {
    const { client, contribution, open } = await made();
    const answer = JSON.parse(await open() as string) as { resource: string; url?: string };
    expect(answer.url).toBeUndefined();
    const before = await client.handle({ method: 'subscribe', params: { channel: answer.resource } }) as { snapshot: { state: CanvasState } };
    expect(before.snapshot.state).toEqual({ instanceId: 'check', extensionId: 'example-canvas', canvasId: 'check', title: 'Example canvas' });

    await raise(contribution.events, { type: 'listening', runtime: 'node', host: '192.168.0.10', port: 9187, guarded: false });
    const after = await client.handle({ method: 'subscribe', params: { channel: answer.resource } }) as { snapshot: { state: CanvasState } };
    expect(after.snapshot.state.url).toBe('http://192.168.0.10:9187/plugins/example-canvas/');
  });

  it('opens the page at an external address for a daemon bound to every interface', async () => {
    const { contribution, open } = await made();
    await raise(contribution.events, { type: 'listening', runtime: 'node', host: '0.0.0.0', port: 9187, guarded: false });
    // The machine's first external IPv4 address, which a window elsewhere on its network opens, else localhost.
    const external = Object.values(networkInterfaces()).flatMap((each) => each ?? []).find((one) => one.family === 'IPv4' && !one.internal);
    const answer = JSON.parse(await open() as string) as { url: string };
    expect(answer.url).toBe(`http://${external?.address ?? 'localhost'}:9187/plugins/example-canvas/`);
  });

  it('opens the page on the calling chat at the bound address', async () => {
    const { client, chat, contribution, open } = await made();
    await raise(contribution.events, { type: 'listening', runtime: 'node', host: '192.168.0.10', port: 9187, guarded: false });

    const answer = JSON.parse(await open() as string) as { resource: string; url: string };
    expect(answer.url).toBe('http://192.168.0.10:9187/plugins/example-canvas/');

    const listed = await client.handle({ method: 'subscribe', params: { channel: chat } }) as {
      snapshot: { state: { canvases?: { resource: string }[] } };
    };
    expect(listed.snapshot.state.canvases).toEqual([{ resource: answer.resource }]);
    const canvas = await client.handle({ method: 'subscribe', params: { channel: answer.resource } }) as {
      snapshot: { state: CanvasState };
    };
    expect(canvas.snapshot.state).toEqual({
      instanceId: 'check', extensionId: 'example-canvas', canvasId: 'check', title: 'Example canvas', url: answer.url,
    });
  });
});

describe('the origin option', () => {
  it('starts the URL, before and after the daemon binds', async () => {
    const { contribution, open } = await made({ origin: 'https://ahpd.example.test:8443/ignored/path' });
    const first = JSON.parse(await open() as string) as { url: string };
    expect(first.url).toBe('https://ahpd.example.test:8443/plugins/example-canvas/');

    await raise(contribution.events, { type: 'listening', runtime: 'node', host: '0.0.0.0', port: 9187, guarded: false });
    const second = JSON.parse(await open() as string) as { url: string };
    expect(second.url).toBe(first.url);
  });
});

describe('the route', () => {
  it('serves the page at its prefix and nothing else', async () => {
    const { routes } = await made();
    const served = routeOf(routes, '/plugins/example-canvas/');
    expect(served?.by).toBe('example-canvas');
    const handler = served!.handler;

    const page = await handler(new Request('http://127.0.0.1:9187/plugins/example-canvas/'));
    expect(page.status).toBe(200);
    expect(page.headers.get('content-type')).toBe('text/html; charset=utf-8');
    expect(await page.text()).toContain('<h1>Example canvas</h1>');

    expect((await handler(new Request('http://127.0.0.1:9187/plugins/example-canvas/other'))).status).toBe(404);
  });

  /*
   * A general-purpose server answers HEAD as GET without the content, and a
   * 405 names every method the resource takes:
   * https://www.rfc-editor.org/rfc/rfc9110#section-9.3.2
   */
  it('answers HEAD as GET without the page, and names both in a 405', async () => {
    const { routes } = await made();
    const handler = routeOf(routes, '/plugins/example-canvas/')!.handler;
    const head = await handler(new Request('http://127.0.0.1:9187/plugins/example-canvas/', { method: 'HEAD' }));
    expect(head.status).toBe(200);
    expect(head.headers.get('content-type')).toBe('text/html; charset=utf-8');
    expect(await head.text()).toBe('');
    const posted = await handler(new Request('http://127.0.0.1:9187/plugins/example-canvas/', { method: 'POST' }));
    expect(posted.status).toBe(405);
    expect(posted.headers.get('allow')).toBe('GET, HEAD');
  });
});
