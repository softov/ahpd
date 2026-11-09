import { loggerOf } from '../src/log.js';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fileResources } from '../src/resources/resources.js';
import { foldHostOptions, pluginHost } from '../src/plugins/plugins.js';
import { sdkVersion } from '../src/version.js';
import type { HostOptions, HostTool } from '../src/types/host.js';
import type { LoaderContext, PluginHost } from '../src/types/plugin.js';
import {
  actions, claude, createHost, echo, hello, machine, peer, resetSdk, settle,
} from './support/host.js';

vi.mock('@anthropic-ai/claude-agent-sdk', async () => (await import('./support/claude-sdk.js')).fake);

beforeEach(resetSdk);

/*
 * A live fold, on a host already running.
 *
 * A daemon that loads or unloads a plugin while it runs has a new set of
 * options, and `replace` is where that set reaches a host that already has
 * sessions. What is checked is what a client notices: the tools a session is
 * told it has, the agents, channels and methods the root advertises, and that
 * a store the host was built over is refused rather than swapped.
 */

/** This test's own folder, as the host's: a summary names only a folder that is there. */
const HERE = dirname(fileURLToPath(import.meta.url));

/** What the root state says, in the parts these cases read. */
interface RootState {
  agents: { provider: string }[];
  _meta: Record<string, unknown>;
}

/** What `initialize` answers, in the parts these cases read. */
interface Ready {
  snapshots: { state: RootState }[];
}

const context = (): LoaderContext => ({
  path: HERE, paths: [HERE], version: sdkVersion(), hostName: 'test', configDir: HERE, log: loggerOf(() => {}), say: () => {},
});

/** A plugin's contribution, as `apply` would have made it. */
const contributed = (name: string, register: (host: PluginHost) => void) => {
  const { host, contribution } = pluginHost(name, context());
  register(host);
  return contribution;
};

const tool = (name: string): HostTool => ({
  definition: { name, description: `${name} tool`, inputSchema: { type: 'object', properties: {} } },
  run: () => name,
});

const base = (): HostOptions => ({ path: HERE, agents: [claude({ paths: [HERE] })], ...machine() });

/** A client of `host`, introduced under `id` and watching the root. */
async function clientOf(host: ReturnType<typeof createHost>, id: string) {
  const p = peer();
  const client = host.accept(p);
  const ready = await client.handle(hello(['0.9.0'], { clientId: id, initialSubscriptions: ['ahp-root://'] })) as Ready;
  return { p, client, ready };
}

/** What the root says now, read by a client of its own. */
async function rootOf(host: ReturnType<typeof createHost>, id: string): Promise<RootState> {
  const { ready } = await clientOf(host, id);
  return ready.snapshots[0]!.state;
}

/** The names on the last `session/serverToolsChanged` a peer was sent. */
const toldTools = (p: ReturnType<typeof peer>, channel: string): string[] => {
  const told = actions(p, channel).filter((one) => one.action.type === 'session/serverToolsChanged');
  const last = told.at(-1);
  return last === undefined ? [] : (last.action.tools as { name: string }[]).map((one) => one.name);
};

describe('host.replace', () => {
  it('offers a tool a live fold adds, on the session already open', async () => {
    const aBase = base();
    const host = createHost(foldHostOptions(aBase, [
      contributed('alpha', (one) => one.registerTool(tool('first'))),
    ]).options);
    const { p, client } = await clientOf(host, 'live');
    await client.handle({ method: 'createSession', params: { channel: 'ahp-session:/live', provider: 'claude' } });
    const opened = await client.handle({ method: 'subscribe', params: { channel: 'ahp-session:/live' } }) as {
      snapshot: { state: { serverTools: { name: string }[] } };
    };
    expect(opened.snapshot.state.serverTools.map((one) => one.name)).toContain('first');

    const answer = host.replace(foldHostOptions(aBase, [
      contributed('alpha', (one) => { one.registerTool(tool('first')); one.registerTool(tool('second')); }),
    ]).options);

    expect(answer).toBeUndefined();
    await settle();
    expect(toldTools(p, 'ahp-session:/live')).toContain('second');
  });

  it('removes a tool, a channel and a method the fold no longer has', async () => {
    const aBase = base();
    const host = createHost(foldHostOptions(aBase, [
      contributed('demo', (one) => {
        one.registerTool(tool('kept'));
        one.registerTool(tool('gone'));
        one.registerChannel('x-demo', { grant: 'demo:read', snapshot: () => ({ items: [] }) });
        one.registerMethod('x-demo/ping', { grant: 'demo:read', handle: () => 'pong' });
      }),
    ]).options);
    const { p, client } = await clientOf(host, 'full');
    await client.handle({ method: 'createSession', params: { channel: 'ahp-session:/tools', provider: 'claude' } });
    await client.handle({ method: 'subscribe', params: { channel: 'ahp-session:/tools' } });
    const before = await rootOf(host, 'root-full');
    expect((before._meta['ahpd.channels'] as { scheme: string }[]).map((one) => one.scheme)).toEqual(['x-demo']);
    expect((before._meta['ahpd.methods'] as { method: string }[]).map((one) => one.method)).toEqual(['x-demo/ping']);

    expect(host.replace(foldHostOptions(aBase, [
      contributed('demo', (one) => one.registerTool(tool('kept'))),
    ]).options)).toBeUndefined();

    await settle();
    const told = toldTools(p, 'ahp-session:/tools');
    expect(told).toContain('kept');
    expect(told).not.toContain('gone');
    const after = await rootOf(host, 'root-thin');
    expect(after._meta).not.toHaveProperty('ahpd.channels');
    expect(after._meta).not.toHaveProperty('ahpd.methods');
  });

  it('refuses a fold that moves a port, and keeps the options it has', async () => {
    const aBase = base();
    const host = createHost(foldHostOptions(aBase, [
      contributed('demo', (one) => one.registerChannel('x-demo', { grant: 'demo:read', snapshot: () => ({ items: [] }) })),
    ]).options);

    const answer = host.replace(foldHostOptions({ ...aBase, resources: fileResources() }, []).options);

    expect(answer).toMatch(/resources is a port/);
    // Nothing moved: the channel the host already had is still advertised.
    const still = await rootOf(host, 'root-same');
    expect((still._meta['ahpd.channels'] as { scheme: string }[]).map((one) => one.scheme)).toEqual(['x-demo']);
  });

  it('keeps an agent a session still runs on, and lets it go once that session ends', async () => {
    const aBase: HostOptions = {
      ...base(),
      agents: [claude({ paths: [HERE] }), { ...echo({ path: HERE, pace: 0 }), provider: 'other' }],
    };
    const host = createHost(foldHostOptions(aBase, []).options);
    const { client } = await clientOf(host, 'holder');
    await client.handle({ method: 'createSession', params: { channel: 'ahp-session:/other', provider: 'other' } });
    const alone: HostOptions = { ...aBase, agents: [aBase.agents[0]!] };

    // The fold drops the plugin's agent. Its session is still open, so the
    // host keeps the agent rather than leaving that session on nothing.
    expect(host.replace(foldHostOptions(alone, []).options)).toBeUndefined();
    expect((await rootOf(host, 'root-kept')).agents.map((one) => one.provider)).toContain('other');

    await host.endSessionsOf('other');
    expect(host.replace(foldHostOptions(alone, []).options)).toBeUndefined();
    expect((await rootOf(host, 'root-gone')).agents.map((one) => one.provider)).not.toContain('other');
  });
});

/*
 * A host with no agent, which is what a daemon whose plugins all failed to load
 * builds - decision `the-daemon-bundles-no-agent-and-starts-without-one`. It
 * serves its root so a client can fix it, refuses each session start, and
 * serves the agent a later fold adds.
 */
describe('a host with no agent', () => {
  const empty = (): HostOptions => ({ path: HERE, agents: [], ...machine() });

  it('answers initialize and lists no agent', async () => {
    const host = createHost(empty());
    expect((await rootOf(host, 'none')).agents).toEqual([]);
  });

  it('refuses a session start, named or not', async () => {
    const host = createHost(empty());
    const { client } = await clientOf(host, 'start');
    await expect(client.handle({ method: 'createSession', params: { channel: 'ahp-session:/unnamed' } }))
      .rejects.toMatchObject({ code: -32002, message: 'No agent provider registered for: (none)' });
    await expect(client.handle({ method: 'createSession', params: { channel: 'ahp-session:/named', provider: 'claude' } }))
      .rejects.toMatchObject({ code: -32002, message: 'No agent provider registered for: claude' });
  });

  it('serves the agent a fold adds, as the one a client gets by default', async () => {
    const options = empty();
    const host = createHost(options);
    expect(host.replace({ ...options, agents: [claude({ paths: [HERE] })] })).toBeUndefined();
    await settle();
    expect((await rootOf(host, 'after')).agents.map((one) => one.provider)).toEqual(['claude']);
    const { client } = await clientOf(host, 'later');
    await client.handle({ method: 'createSession', params: { channel: 'ahp-session:/later' } });
    const opened = await client.handle({ method: 'subscribe', params: { channel: 'ahp-session:/later' } }) as {
      snapshot: { state: { provider: string } };
    };
    expect(opened.snapshot.state.provider).toBe('claude');
  });
});
