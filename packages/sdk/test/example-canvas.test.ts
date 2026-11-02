import { describe, expect, it } from 'vitest';
import { createHost, ROOT } from '../src/host.js';
import { foldHostOptions, pluginHost, raise, routeOf } from '../src/plugins/plugins.js';
import { fileResources } from '../src/resources/resources.js';
import { sdkVersion } from '../src/version.js';
import { echo } from '../../../examples/echo/agent.js';
import { apply, name, originOf } from '../../../examples/canvas/index.js';
import type { CanvasState } from '@microsoft/agent-host-protocol';
import type { ToolCall } from '../src/types/host.js';
import type { LoaderContext } from '../src/types/plugin.js';
import type { Peer } from '../src/types/rpc.js';

/*
 * examples/canvas, folded over a host the way the daemon loads it.
 *
 * Its route serves the page, and its tool opens that page as a canvas on the
 * chat it is called from, at the address the daemon bound.
 */

const DIR = '/tmp/example-canvas';

const context = (): LoaderContext => ({
  path: DIR, paths: [DIR], version: sdkVersion(), hostName: 'test', configDir: DIR, log: () => {}, say: () => {},
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

describe('originOf', () => {
  it('opens any interface on loopback, and brackets an IPv6 address', () => {
    expect(originOf('0.0.0.0', 8080)).toBe('http://127.0.0.1:8080');
    expect(originOf('::', 8080)).toBe('http://127.0.0.1:8080');
    expect(originOf('192.168.0.10', 8080)).toBe('http://192.168.0.10:8080');
    expect(originOf('::1', 8080)).toBe('http://[::1]:8080');
  });
});

describe('open_check_canvas', () => {
  it('is refused before the daemon has an address', async () => {
    const { open } = await made();
    await expect(async () => open()).rejects.toThrow('The daemon has no address yet');
  });

  it('opens the page on the calling chat at the bound address', async () => {
    const { client, chat, contribution, open } = await made();
    await raise(contribution.events, { type: 'listening', runtime: 'node', host: '0.0.0.0', port: 9187, guarded: false });

    const answer = JSON.parse(await open() as string) as { resource: string; url: string };
    expect(answer.url).toBe('http://127.0.0.1:9187/plugins/example-canvas/');

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
    const posted = await handler(new Request('http://127.0.0.1:9187/plugins/example-canvas/', { method: 'POST' }));
    expect(posted.status).toBe(405);
    expect(posted.headers.get('allow')).toBe('GET');
  });
});
