import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, expect, it } from 'vitest';
import { computerCatalogue } from '../src/catalogue.js';
import { computerProvider } from '../src/provider.js';
import { claimedOf, stateOf } from '../src/runtime.js';
import { createHost } from '../../sdk/src/host.js';
import { fileResources } from '../../sdk/src/resources/resources.js';
import { loadPlugins } from '../../server/src/plugins.js';
import { echo } from '../../../examples/echo/agent.js';
import { closeAll, keeping } from './support/closing.js';
import type { ComputerRuntime } from '../src/runtime.js';
import type { HostTool, ToolCall } from '../../sdk/src/types/host.js';
import type { ChannelHandle, PluginHost } from '../../sdk/src/types/plugin.js';
import type { Principal } from '../../sdk/src/types/users.js';

/*
 * The `x-ahpd-computers://` channel.
 *
 * The first half is the channel and the provider over a runtime that is a plain
 * object: what a subscribe answers, and what a write to a machine's state
 * sends. The second half loads the plugin over the scripted `docker`, to show
 * that a change the plugin makes on its own reaches a subscriber.
 */

const URI = 'x-ahpd-computers://';
const REPO = join(import.meta.dirname, '../../..');
const SOURCE = './packages/computer/src/index.ts';
const FIXTURE = fileURLToPath(new URL('./fixtures/docker.mjs', import.meta.url));

let loose: string | undefined;
let home: string | undefined;
afterEach(async () => {
  await closeAll();
  for (const one of [loose, home]) if (one !== undefined) rmSync(one, { recursive: true, force: true });
  loose = undefined;
  home = undefined;
});

/** A runtime that keeps its machines in a map, each running or not. */
const fake = () => {
  const held = new Map<string, Record<string, unknown>>();
  const put = (id: string, running: boolean, owner?: string): void => {
    held.set(id, {
      Name: `/${id}`,
      Image: 'debian:bookworm-slim',
      State: { Running: running, Status: running ? 'running' : 'exited' },
      // The owner is a label on the machine, as a made one carries it.
      ...(owner === undefined ? {} : { Config: { Labels: { 'ahpd.owner': owner } } }),
    });
  };
  const runtime = {
    kind: 'docker',
    list: async () => [...held.keys()].map((id) => ({ id, image: 'debian:bookworm-slim', status: 'Up', created: '' })),
    inspect: async (id: string) => held.get(id),
    // The map holds Docker's own record, so the state leaf is read from it the
    // way the runtime reads it rather than kept a second time here.
    state: async (id: string) => { const one = held.get(id); return one === undefined ? undefined : stateOf(one); },
    agents: async () => [],
    owner: async (id: string) => { const one = held.get(id); return one === undefined ? undefined : claimedOf(one); },
    run: async (spec: { name: string }) => { put(spec.name, true); return { id: spec.name, image: '', status: 'running', created: '' }; },
    start: async (id: string) => { put(id, true); },
    stop: async (id: string) => { put(id, false); },
    restart: async (id: string) => { put(id, true); },
    remove: async (id: string) => { held.delete(id); },
  } as unknown as ComputerRuntime;
  return { runtime, held, put };
};

/** A handle with these subscribers, which keeps what is sent and to whom. */
const handle = (subscribers: { client: string; reader: Principal | undefined }[]) => {
  const heard: { to: string | undefined; action: Record<string, unknown> }[] = [];
  const made: ChannelHandle = {
    publish: (_uri, action, options) => { heard.push({ to: options?.to, action }); },
    subscribers: () => subscribers,
  };
  return { made, heard };
};

const unread: PluginHost['secret'] = async () => '';

/** A reader who holds the channel's own grant, so a listing answers every machine. */
const readerOf = (id: string): Principal => ({ id, roles: [], can: (one) => one === 'computer:read' });

it('answers every machine with its state and its status', async () => {
  const { runtime, put, held } = fake();
  put('box', true);
  put('cold', false);
  const catalogue = computerCatalogue(runtime);
  const answer = await catalogue.channel.snapshot(URI, undefined, 'ana') as { records: { id: string; record: Record<string, unknown> }[] };
  expect(answer.records).toEqual([
    { id: 'box', record: { state: 'running', status: held.get('box') } },
    { id: 'cold', record: { state: 'stopped', status: held.get('cold') } },
  ]);
  expect(catalogue.channel.grant).toBe('computer:read');
});

it('answers each person only the machines they own when asked', async () => {
  const { runtime, put } = fake();
  put('ana-box', true, 'user:ana');
  put('bo-box', true, 'user:bo');
  put('spare', false);
  const provider = computerProvider(runtime, {
    image: 'debian:bookworm-slim', max: 4, label: 'ahpd.computer=1', secret: unread,
  });
  const ana = readerOf('ana');
  const bo = readerOf('bo');

  expect(await provider.list('computer://?owner=me', ana)).toEqual([{ name: 'ana-box', type: 'directory' }]);
  expect(await provider.list('computer://?owner=me', bo)).toEqual([{ name: 'bo-box', type: 'directory' }]);
  // Without the query each still sees every machine, the ownerless one included.
  expect(await provider.list('computer://', ana)).toEqual([
    { name: 'ana-box', type: 'directory' },
    { name: 'bo-box', type: 'directory' },
    { name: 'spare', type: 'directory' },
  ]);
  // With no reader there is no one for `me` to name, so the filter keeps nothing.
  expect(await provider.list('computer://?owner=me')).toEqual([]);
});

it('answers a channel asked with owner=me only the machines the reader owns', async () => {
  const { runtime, put, held } = fake();
  put('box', true, 'user:ana');
  put('cold', false, 'user:bo');
  const catalogue = computerCatalogue(runtime);
  const ana = readerOf('ana');

  const mine = await catalogue.channel.snapshot(`${URI}?owner=me`, ana, 'ana') as { records: { id: string; record: Record<string, unknown> }[] };
  expect(mine.records).toEqual([{ id: 'box', record: { state: 'running', status: held.get('box') } }]);
  // The plain channel is still every machine she may read.
  const every = await catalogue.channel.snapshot(URI, ana, 'bo') as { records: { id: string }[] };
  expect(every.records.map((one) => one.id)).toEqual(['box', 'cold']);
});

it('sends changed with the new state after a write to computer://box/state', async () => {
  const { runtime, put } = fake();
  put('box', true);
  const catalogue = computerCatalogue(runtime);
  const provider = computerProvider(runtime, {
    image: 'debian:bookworm-slim', max: 2, label: 'ahpd.computer=1', secret: unread,
  });
  const { made, heard } = handle([{ client: 'ana', reader: undefined }]);
  catalogue.bind(made);
  await catalogue.channel.snapshot(URI, undefined, 'ana');

  await provider.write('computer://box/state', { data: 'stopped', encoding: 'utf-8' });
  await catalogue.refresh();
  expect(heard.map((one) => [one.to, one.action.type, one.action.id, (one.action.record as { state?: string } | undefined)?.state]))
    .toEqual([['ana', 'x-ahpd-computers/changed', 'box', 'stopped']]);

  // A make and a destroy through the provider are an added and a removed.
  await provider.write('computer://web', { data: '', encoding: 'utf-8' });
  await provider.delete('computer://box');
  await catalogue.refresh();
  expect(heard.slice(1).map((one) => `${String(one.action.type)} ${String(one.action.id)}`))
    .toEqual(['x-ahpd-computers/added web', 'x-ahpd-computers/removed box']);
});

it('sends a reader without computer:read nothing', async () => {
  const { runtime, put } = fake();
  put('box', true);
  const catalogue = computerCatalogue(runtime);
  const none: Principal = { id: 'bo', roles: [], can: () => false };
  const { made, heard } = handle([{ client: 'bo', reader: none }]);
  catalogue.bind(made);
  expect(await catalogue.channel.authorize?.(URI, none)).toBe(false);
  expect(await catalogue.channel.snapshot(URI, none, 'bo')).toEqual({ records: [] });
  put('web', true);
  await catalogue.refresh();
  expect(heard).toEqual([]);
});

it('tells a subscriber of a machine the plugin makes and releases on its own', async () => {
  loose = mkdtempSync(join(tmpdir(), 'ahpd-computer-catalogue-'));
  home = mkdtempSync(join(tmpdir(), 'ahpd-computer-catalogue-config-'));
  const { options, problems } = await loadPlugins(
    [{ name: SOURCE, options: { command: process.execPath, args: [FIXTURE], env: { DOCKER_FAKE_STATE: join(loose, 'docker.json') } } }],
    {
      base: {
        path: '/tmp/computer-catalogue',
        agents: [{ ...echo({ path: '/tmp/computer-catalogue', pace: 0 }), provider: 'base', displayName: 'Base backend' }],
        resources: fileResources(),
      },
      configDir: home,
      cwd: REPO,
      log: () => {},
    },
  );
  keeping(options);
  expect(problems).toEqual([]);
  const host = createHost(options);
  keeping(options, host);
  const seen: { method: string; params: Record<string, any> }[] = [];
  const client = host.accept({
    send: () => {}, request: async () => ({}), answered: () => {}, close: () => {},
    notify: (method, params) => { seen.push({ method, params: params as Record<string, any> }); },
  });
  await client.handle({ method: 'initialize', params: { clientId: 'probe', protocolVersions: ['0.9.0'] } });
  expect(await client.handle({ method: 'subscribe', params: { channel: URI } })).toMatchObject({ snapshot: { state: { records: [] } } });

  /** Each action on the channel so far, as `verb id state`. */
  const heard = () => seen
    .filter((one) => one.method === 'action' && one.params.channel === URI)
    .map((one) => `${String(one.params.action.type).split('/').pop()} ${String(one.params.action.id)}${one.params.action.record === undefined ? '' : ` ${String(one.params.action.record.state)}`}`);
  const until = async (count: number): Promise<void> => {
    for (let i = 0; i < 400 && heard().length < count; i++) await new Promise((done) => { setTimeout(done, 10); });
  };

  // The tools a model calls go through the same wrapper a disposable machine's
  // timer removes by.
  const tool = (name: string) => (options.tools ?? []).find((one) => one.definition.name === name) as HostTool;
  await tool('request_disposable_computer').run({ name: 'box' }, {} as ToolCall);
  await until(1);
  expect(heard()).toEqual(['added box running']);
  await tool('release_computer').run({ id: 'box' }, {} as ToolCall);
  await until(2);
  expect(heard()).toEqual(['added box running', 'removed box']);
}, 30000);
