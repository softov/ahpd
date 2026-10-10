import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { apply } from '../src/plugin.js';
import { ENDPOINT, RECEIPTS } from '../src/send.js';
import type { EventHandler, EventName, HostEventOf } from '../../sdk/src/types/events.js';
import type { PluginHost } from '../../sdk/src/types/plugin.js';

/*
 * The push plugin, against a service that is a stub.
 *
 * The plugin is applied to a host that records the handlers it registers, so
 * each case is one of the host's own moments fired at it - which is what the
 * plugin actually sees, without a backend and without a socket. The endpoint is
 * `globalThis.fetch`, replaced for the length of a test, because that is the
 * one thing this module takes from the world.
 *
 * The devices are a file written before `apply` runs, which is exactly what a
 * daemon restarting finds: a registration outlives the process that took it.
 */

/** What one request was asked, as the stub recorded it. */
interface Sent {
  url: string;
  body: unknown;
  authorization?: string;
}

/** What a service answers: a status and a body, or a network that is gone. */
type Answer = (url: string, body: unknown) => { status?: number; body?: unknown } | 'throw';

/** A temporary directory removed after the test that made it. */
let loose: string | undefined;
afterEach(() => {
  vi.unstubAllGlobals();
  if (loose !== undefined) rmSync(loose, { recursive: true, force: true });
  loose = undefined;
});

/** A service that answers what `answer` says, and records what it was asked. */
const service = (answer: Answer) => {
  const calls: Sent[] = [];
  const request = (async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    const body: unknown = JSON.parse(String(init?.body ?? 'null'));
    const authorization = new Headers(init?.headers).get('authorization');
    calls.push({ url, body, ...(authorization === null ? {} : { authorization }) });
    const said = answer(url, body);
    if (said === 'throw') throw new Error('the network is gone');
    return new Response(JSON.stringify(said.body ?? {}), {
      status: said.status ?? 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as unknown as typeof fetch;
  return { calls, request };
};

/** One host, as a plugin sees it: the few members this plugin reads, and the handlers it registers. */
interface Node {
  host: PluginHost;
  /** Every line the plugin logged. */
  logged: string[];
  /** Every line the plugin said a person should read. */
  problems: string[];
  /** What `host.secret` answers, by name; a name that is not here throws. */
  vault: Map<string, string>;
  /** Fire one event at every handler the plugin registered for it. */
  fire<K extends EventName>(event: HostEventOf<K>): Promise<void>;
}

const node = (configDir: string, hostName: string): Node => {
  const handlers = new Map<EventName, EventHandler[]>();
  const logged: string[] = [];
  const problems: string[] = [];
  const vault = new Map<string, string>();
  const host = {
    path: configDir,
    paths: [configDir],
    version: '0.10.0',
    hostName,
    configDir,
    log: (line: string) => { logged.push(line); },
    say: () => {},
    problem: (line: string) => { problems.push(line); },
    secret: async (name: string) => {
      const held = vault.get(name);
      if (held === undefined) throw new Error(`the vault holds no ${name}`);
      return held;
    },
    on: (event: EventName, handler: EventHandler) => {
      const held = handlers.get(event);
      if (held === undefined) handlers.set(event, [handler]);
      else held.push(handler);
    },
    registerResourceProvider: () => {},
  } as unknown as PluginHost;
  return {
    host,
    logged,
    problems,
    vault,
    fire: async (event) => {
      for (const handler of handlers.get(event.type) ?? []) await handler(event, host);
    },
  };
};

/** The devices file, as a daemon that has run before would have left it. */
const devices = (said: Record<string, { client: string; token: string }>): Record<string, unknown> =>
  Object.fromEntries(Object.entries(said).map(([id, one]) => [id, { token: one.token, platform: 'ios', client: one.client }]));

/** A service that takes every message, answering a ticket for each. */
const accepted: Answer = (_url, body) => ({
  body: { data: (body as { to: string }[]).map((_one, index) => ({ status: 'ok', id: `ticket-${index}` })) },
});

/** The plugin, up over a stubbed service and a devices file of this test's own. */
const up = (answer: Answer, said: Record<string, unknown>, options: Record<string, unknown> = {}, hostName = 'Echo') => {
  const dir = (loose ??= mkdtempSync(join(tmpdir(), 'ahpd-push-send-')));
  writeFileSync(join(dir, 'push-devices.json'), JSON.stringify(said, null, 2));
  const { calls, request } = service(answer);
  vi.stubGlobal('fetch', request);
  const made = node(dir, hostName);
  apply(made.host, options);
  return {
    ...made,
    calls,
    sends: (): Sent[] => calls.filter((one) => one.url === ENDPOINT),
    receipts: (): Sent[] => calls.filter((one) => one.url === RECEIPTS),
    kept: (): Record<string, unknown> => JSON.parse(readFileSync(join(dir, 'push-devices.json'), 'utf8')) as Record<string, unknown>,
  };
};

/** A session, opened by the clients named. */
const openedBy = async (world: { fire: Node['fire'] }, session: string, ...clients: string[]): Promise<void> => {
  for (const [index, client] of clients.entries()) {
    await world.fire(index === 0
      ? { type: 'session_start', session, provider: 'echo', client }
      : { type: 'session_opened', session, client });
  }
};

/** The session, waiting on one request. */
const waiting = async (world: { fire: Node['fire'] }, session: string, id: string, kind = 'chatInput'): Promise<void> =>
  world.fire({ type: 'input_needed_set', session, chat: `${session}/chat`, id, kind } as HostEventOf<'input_needed_set'>);

it('tells every device whose client created or opened the session, and no other', async () => {
  const world = up(accepted, devices({
    'phone-1': { client: 'phone', token: 'ExponentPushToken[phone]' },
    'phone-2': { client: 'tablet', token: 'ExponentPushToken[tablet]' },
    'phone-3': { client: 'laptop', token: 'ExponentPushToken[laptop]' },
  }));
  expect(world.problems).toEqual([]);
  await openedBy(world, 'echo:/one', 'phone', 'tablet');
  await waiting(world, 'echo:/one', 'q1');

  // One request, one message per device, and the laptop's client is in no part
  // of this session so its device hears nothing.
  expect(world.sends()).toHaveLength(1);
  expect(world.sends()[0]?.body).toEqual([
    {
      to: 'ExponentPushToken[phone]',
      title: 'Echo',
      body: 'A session is waiting for your answer',
      data: { uri: 'echo:/one', kind: 'chatInput' },
    },
    {
      to: 'ExponentPushToken[tablet]',
      title: 'Echo',
      body: 'A session is waiting for your answer',
      data: { uri: 'echo:/one', kind: 'chatInput' },
    },
  ]);
});

it('names the daemon in the title, or what the option says', async () => {
  const world = up(accepted, devices({ 'phone-1': { client: 'phone', token: 'ExponentPushToken[phone]' } }), { title: 'Build box' }, 'Echo');
  await openedBy(world, 'echo:/one', 'phone');
  await waiting(world, 'echo:/one', 'q1');
  expect(world.sends()[0]?.body).toMatchObject([{ title: 'Build box' }]);
});

it('asks for approval where a tool is waiting for one', async () => {
  const world = up(accepted, devices({ 'phone-1': { client: 'phone', token: 'ExponentPushToken[phone]' } }));
  await openedBy(world, 'echo:/one', 'phone');
  await waiting(world, 'echo:/one', 'q1', 'toolConfirmation');
  expect(world.sends()[0]?.body).toMatchObject([
    { body: 'A session is waiting for your approval', data: { uri: 'echo:/one', kind: 'toolConfirmation' } },
  ]);
});

it('sends nothing for a tool a client is running, because nobody is being asked', async () => {
  const world = up(accepted, devices({ 'phone-1': { client: 'phone', token: 'ExponentPushToken[phone]' } }));
  await openedBy(world, 'echo:/one', 'phone');
  await waiting(world, 'echo:/one', 'q1', 'toolClientExecution');
  expect(world.sends()).toEqual([]);
});

it('sends once for a pair, and again for the same id of another session', async () => {
  const world = up(accepted, devices({ 'phone-1': { client: 'phone', token: 'ExponentPushToken[phone]' } }));
  await openedBy(world, 'echo:/one', 'phone');
  await openedBy(world, 'echo:/two', 'phone');
  await waiting(world, 'echo:/one', 'q1');
  // The protocol's action is an upsert, so the same entry is set again.
  await waiting(world, 'echo:/one', 'q1');
  expect(world.sends()).toHaveLength(1);
  // An id is the backend's, so two sessions may share one.
  await waiting(world, 'echo:/two', 'q1');
  expect(world.sends()).toHaveLength(2);
});

it('sends nothing when a wait is over, and forgets the pair so the next one is new', async () => {
  const world = up(accepted, devices({ 'phone-1': { client: 'phone', token: 'ExponentPushToken[phone]' } }));
  await openedBy(world, 'echo:/one', 'phone');
  await waiting(world, 'echo:/one', 'q1');
  await world.fire({ type: 'input_needed_removed', session: 'echo:/one', id: 'q1' });
  expect(world.sends()).toHaveLength(1);
  await waiting(world, 'echo:/one', 'q1');
  expect(world.sends()).toHaveLength(2);
});

it('reads the receipts of the previous send, and none before the first', async () => {
  const world = up(accepted, devices({ 'phone-1': { client: 'phone', token: 'ExponentPushToken[phone]' } }));
  await openedBy(world, 'echo:/one', 'phone');
  await waiting(world, 'echo:/one', 'q1');
  expect(world.receipts()).toEqual([]);

  await waiting(world, 'echo:/one', 'q2');
  expect(world.receipts()).toHaveLength(1);
  expect(world.receipts()[0]?.body).toEqual({ ids: ['ticket-0'] });
  // Read before this send's POST, which is what makes it the previous one's.
  expect(world.calls.map((one) => one.url)).toEqual([ENDPOINT, RECEIPTS, ENDPOINT]);
});

it('forgets a device Expo no longer knows', async () => {
  const world = up((url) => (url === ENDPOINT
    ? { body: { data: [{ status: 'ok', id: 'ticket-0' }] } }
    : { body: { data: { 'ticket-0': { status: 'error', details: { error: 'DeviceNotRegistered' } } } } }),
  devices({
    'phone-1': { client: 'phone', token: 'ExponentPushToken[phone]' },
    'phone-2': { client: 'tablet', token: 'ExponentPushToken[tablet]' },
  }));
  await openedBy(world, 'echo:/one', 'phone', 'tablet');
  await waiting(world, 'echo:/one', 'q1');
  await waiting(world, 'echo:/one', 'q2');

  expect(Object.keys(world.kept())).toEqual(['phone-2']);
  expect(world.logged.some((line) => line.includes('no longer registered with Expo'))).toBe(true);
});

it('reads a token the vault holds, and sends nothing when it holds none', async () => {
  const world = up(accepted, devices({ 'phone-1': { client: 'phone', token: 'ExponentPushToken[phone]' } }), {
    accessToken: { $secret: 'host:expo' },
  });
  await openedBy(world, 'echo:/one', 'phone');
  await waiting(world, 'echo:/one', 'q1');
  expect(world.sends()).toEqual([]);
  expect(world.logged).toHaveLength(1);
  expect(world.logged[0]).toContain('accessToken');
  // The pair was seen, so the same entry set again is still the same wait.
  await waiting(world, 'echo:/one', 'q1');
  expect(world.sends()).toEqual([]);

  // The next wait, once the vault holds it, goes out with the token.
  world.vault.set('host:expo', 'ExpoToken abc');
  await waiting(world, 'echo:/one', 'q2');
  expect(world.sends()).toHaveLength(1);
  expect(world.sends()[0]?.authorization).toBe('Bearer ExpoToken abc');
});

it('a service that answers an error is logged, and the next wait still sends', async () => {
  let broken = true;
  const world = up((url) => (broken && url === ENDPOINT ? { status: 500 } : accepted(url, [])), devices({
    'phone-1': { client: 'phone', token: 'ExponentPushToken[phone]' },
  }));
  await openedBy(world, 'echo:/one', 'phone');
  await waiting(world, 'echo:/one', 'q1');
  expect(world.logged.some((line) => line.includes('500'))).toBe(true);

  broken = false;
  await waiting(world, 'echo:/one', 'q2');
  expect(world.sends()).toHaveLength(2);
});

it('a receipt read that fails is logged, and its own send still goes out', async () => {
  let broken = false;
  const world = up((url) => (broken && url === RECEIPTS ? 'throw' : accepted(url, [{ to: 'x' }])), devices({
    'phone-1': { client: 'phone', token: 'ExponentPushToken[phone]' },
  }));
  await openedBy(world, 'echo:/one', 'phone');
  await waiting(world, 'echo:/one', 'q1');

  broken = true;
  await waiting(world, 'echo:/one', 'q2');
  expect(world.logged.some((line) => line.includes('could not be reached'))).toBe(true);
  expect(world.sends()).toHaveLength(2);
});

it('carries a hundred messages to a request, and the rest in another', async () => {
  const many: Record<string, { client: string; token: string }> = {};
  for (let at = 0; at < 101; at += 1) many[`phone-${String(at)}`] = { client: `c${String(at)}`, token: `ExponentPushToken[${String(at)}]` };
  const world = up(accepted, devices(many));
  await openedBy(world, 'echo:/one', ...Object.keys(many).map((id) => `c${id.slice('phone-'.length)}`));
  await waiting(world, 'echo:/one', 'q1');

  expect(world.sends()).toHaveLength(2);
  expect((world.sends()[0]?.body as unknown[]).length).toBe(100);
  expect((world.sends()[1]?.body as unknown[]).length).toBe(1);
});
