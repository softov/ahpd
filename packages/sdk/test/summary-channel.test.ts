import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { recordsChannel } from '../src/resources/recordschannel.js';
import { summaryChannel, SUMMARY_DELAY_MS } from '../src/summary/channel.js';
import { holds } from '../src/access/users.js';
import type { RecordsSource } from '../src/resources/recordschannel.js';
import type { ChannelHandle, ChannelSubscriber, PublishOptions } from '../src/types/plugin.js';
import type { Grant, Principal } from '../src/types/users.js';

/*
 * The summary over two in-memory lists: plugins, read by `plugin:list`, and
 * connectors, where `connector:list` reads only the rows `mayRead` lets in.
 * Each case subscribes readers through `snapshot`, changes a store, refreshes
 * its list, and moves the clock to read what each client was sent.
 */

const URI = 'x-ahpd-summary://';

type Rows = Record<string, Record<string, unknown>>;

/** A source over rows a case edits in place. */
const source = (rows: Rows): RecordsSource => ({
  ids: async () => Object.keys(rows),
  find: async (id) => (rows[id] === undefined ? undefined : { ...rows[id] }),
});

/** A reader holding these grants. */
const person = (id: string, grants: Grant[]): Principal => ({
  id,
  roles: ['r'],
  grants,
  can: (grant: Grant) => holds(new Set<string>(grants), grant),
});

/** A handle with these subscribers, and every summary it was handed, by client. */
const fakeHandle = (subscribers: ChannelSubscriber[]) => {
  const heard: { client: string | undefined; action: Record<string, unknown> }[] = [];
  const handle: ChannelHandle = {
    publish: (uri, action, options: PublishOptions = {}) => {
      expect(uri).toBe(URI);
      heard.push({ client: options.to, action });
    },
    subscribers: () => subscribers,
  };
  const of = (client: string): Record<string, unknown>[] => heard.filter((one) => one.client === client).map((one) => one.action);
  return { handle, heard, of };
};

let plugins: Rows;
let connectors: Rows;

/** The two lists and a summary over them. */
const build = () => {
  const pluginList = recordsChannel('x-ahpd-plugins', source(plugins), { grant: 'plugin:list' });
  const connectorList = recordsChannel('x-ahpd-connectors', source(connectors), {
    grant: 'connector:list',
    alsoGrant: 'connector:all',
    mayReadEveryReader: true,
    mayRead: (id, reader) => reader.can('connector:all') || (reader.can('connector:list') && connectors[id]?.owner === reader.id),
  });
  pluginList.bind(fakeHandle([]).handle);
  connectorList.bind(fakeHandle([]).handle);
  const summary = summaryChannel([
    { name: 'plugins', list: pluginList, state: 'state', alerts: true },
    { name: 'connectors', list: connectorList, state: 'state', alerts: true },
  ]);
  return { pluginList, connectorList, summary };
};

beforeEach(() => {
  vi.useFakeTimers();
  plugins = {
    a: { state: 'ready', title: 'Alpha', alerts: [{ level: 'error', text: 'Down' }, { level: 'notice', text: 'New' }] },
    b: { state: 'error', alerts: [] },
  };
  connectors = {
    ana: { state: 'open', owner: 'ana', alerts: [{ level: 'warning', text: 'Slow' }] },
    bo: { state: 'failed', owner: 'bo', alerts: [{ level: 'error', text: 'Refused' }, { level: 'warning', text: 'Slow' }] },
  };
});

afterEach(() => {
  vi.useRealTimers();
});

it('answers each area with its channel, its total, its states and its alerts grouped by text with their rows', async () => {
  const { summary } = build();
  expect(await summary.channel.snapshot(URI, undefined, 'root')).toEqual({
    areas: {
      plugins: {
        channel: 'x-ahpd-plugins://',
        total: 2,
        states: { ready: 1, error: 1 },
        // A row's title names it where it has one.
        alerts: [
          { level: 'error', text: 'Down', count: 1, rows: [{ id: 'a', title: 'Alpha' }] },
          { level: 'notice', text: 'New', count: 1, rows: [{ id: 'a', title: 'Alpha' }] },
        ],
      },
      connectors: {
        channel: 'x-ahpd-connectors://',
        total: 2,
        states: { open: 1, failed: 1 },
        // Worst level first; two rows saying one text are one group.
        alerts: [
          { level: 'error', text: 'Refused', count: 1, rows: [{ id: 'bo', title: 'bo' }] },
          { level: 'warning', text: 'Slow', count: 2, rows: [{ id: 'ana', title: 'ana' }, { id: 'bo', title: 'bo' }] },
        ],
      },
    },
  });
});

it('counts only the rows each reader may read, and leaves out an area they may not open', async () => {
  const { summary } = build();
  const ana = person('ana', ['connector:list']);
  const state = await summary.channel.snapshot(URI, ana, 'ana') as { areas: Record<string, unknown> };
  // No `plugin:list`, so no plugins entry, not a zero.
  expect(Object.keys(state.areas)).toEqual(['connectors']);
  expect(state.areas.connectors).toEqual({
    channel: 'x-ahpd-connectors://',
    total: 1,
    states: { open: 1 },
    alerts: [{ level: 'warning', text: 'Slow', count: 1, rows: [{ id: 'ana', title: 'ana' }] }],
  });
  // A grant that opens the list with no row to read is an entry of zero.
  const cy = person('cy', ['connector:list']);
  expect((await summary.channel.snapshot(URI, cy, 'cy') as { areas: Record<string, unknown> }).areas)
    .toEqual({ connectors: { channel: 'x-ahpd-connectors://', total: 0, states: {}, alerts: [] } });
});

it('sends one summary a second after the first change, with every change made in that second', async () => {
  const { pluginList, connectorList, summary } = build();
  const { handle, of } = fakeHandle([{ client: 'root', reader: undefined }]);
  summary.bind(handle);
  await summary.channel.snapshot(URI, undefined, 'root');

  plugins.b = { state: 'ready', alerts: [] };
  await pluginList.refresh();
  connectors.bo = { state: 'open', owner: 'bo', alerts: [] };
  await connectorList.refresh();
  await vi.advanceTimersByTimeAsync(SUMMARY_DELAY_MS - 1);
  expect(of('root')).toEqual([]);

  await vi.advanceTimersByTimeAsync(1);
  expect(of('root')).toHaveLength(1);
  expect(of('root')[0]).toMatchObject({
    type: 'x-ahpd-summary/changed',
    areas: {
      plugins: { total: 2, states: { ready: 2 } },
      connectors: { total: 2, states: { open: 2 }, alerts: [{ level: 'warning', text: 'Slow', count: 1 }] },
    },
  });
});

it('sends at most once a second while changes keep coming', async () => {
  const { pluginList, summary } = build();
  const { handle, of } = fakeHandle([{ client: 'root', reader: undefined }]);
  summary.bind(handle);
  await summary.channel.snapshot(URI, undefined, 'root');

  for (let step = 0; step < 30; step += 1) {
    plugins[`p${step}`] = { state: 'ready', alerts: [] };
    await pluginList.refresh();
    await vi.advanceTimersByTimeAsync(100);
  }
  await vi.advanceTimersByTimeAsync(SUMMARY_DELAY_MS);
  expect(of('root')).toHaveLength(3);
  expect(of('root').at(-1)).toMatchObject({ areas: { plugins: { total: 32 } } });
});

it('sends a reader nothing when their summary did not move', async () => {
  const { pluginList, connectorList, summary } = build();
  const ana = person('ana', ['connector:list']);
  const { handle, of } = fakeHandle([{ client: 'ana', reader: ana }, { client: 'root', reader: undefined }]);
  summary.bind(handle);
  await summary.channel.snapshot(URI, ana, 'ana');
  await summary.channel.snapshot(URI, undefined, 'root');

  // A row whose alerts did not move sends nobody anything, and so does one alert said twice by one row.
  plugins.b = { ...plugins.b, version: '2' };
  connectors.ana = { ...connectors.ana, alerts: [{ level: 'warning', text: 'Slow' }, { level: 'warning', text: 'Slow' }] };
  await pluginList.refresh();
  await connectorList.refresh();
  await vi.advanceTimersByTimeAsync(SUMMARY_DELAY_MS);
  expect(of('ana')).toEqual([]);
  expect(of('root')).toEqual([]);

  // Bo's connector fails again: root's counts move, and ana cannot read it.
  connectors.bo = { ...connectors.bo, alerts: [{ level: 'error', text: 'Refused' }, { level: 'error', text: 'Expired' }] };
  await connectorList.refresh();
  await vi.advanceTimersByTimeAsync(SUMMARY_DELAY_MS);
  expect(of('ana')).toEqual([]);
  expect(of('root')).toHaveLength(1);
});

it('sends a reader the summary again after left, and stops hearing the areas at stop', async () => {
  const { pluginList, summary } = build();
  const { handle, of } = fakeHandle([{ client: 'root', reader: undefined }]);
  summary.bind(handle);
  await summary.channel.snapshot(URI, undefined, 'root');
  summary.channel.left?.('root');
  plugins.a = { ...plugins.a, title: 'Renamed' };
  await pluginList.refresh();
  await vi.advanceTimersByTimeAsync(SUMMARY_DELAY_MS);
  // Nothing moved, but the client was forgotten, so it is sent the summary whole.
  expect(of('root')).toHaveLength(1);

  summary.stop();
  plugins.c = { state: 'ready' };
  await pluginList.refresh();
  await vi.advanceTimersByTimeAsync(SUMMARY_DELAY_MS);
  expect(of('root')).toHaveLength(1);
});

it('refuses any URI but the summary', async () => {
  const { summary } = build();
  await expect(summary.channel.snapshot(`${URI}x`, undefined, 'root')).rejects.toMatchObject({ code: -32001 });
  expect(await summary.channel.authorize?.(URI, person('bo', []))).toBe(true);
});
