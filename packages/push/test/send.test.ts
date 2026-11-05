import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { apply } from '../src/plugin.js';
import { ENDPOINT, RECEIPTS, createSender } from '../src/send.js';
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

/** Fifteen minutes, which Expo says to wait before reading a send's receipts. */
const QUARTER_HOUR = 15 * 60 * 1000;

/** A temporary directory removed after the test that made it. */
let loose: string | undefined;
afterEach(() => {
  vi.useRealTimers();
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
  /** Every function the plugin registered for the host's close. */
  closers: (() => void | Promise<void>)[];
  /** Fire one event at every handler the plugin registered for it. */
  fire<K extends EventName>(event: HostEventOf<K>): Promise<void>;
}

const node = (configDir: string, hostName: string): Node => {
  const handlers = new Map<EventName, EventHandler[]>();
  const logged: string[] = [];
  const problems: string[] = [];
  const vault = new Map<string, string>();
  const closers: (() => void | Promise<void>)[] = [];
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
    registerClose: (close: () => void | Promise<void>) => { closers.push(close); },
    sessionOwner: async () => undefined,
  } as unknown as PluginHost;
  return {
    host,
    logged,
    problems,
    vault,
    closers,
    fire: async (event) => {
      for (const handler of handlers.get(event.type) ?? []) await handler(event, host);
    },
  };
};

/** The devices file, as a daemon that has run before would have left it. */
const devices = (said: Record<string, { client: string; token: string }>): Record<string, unknown> =>
  Object.fromEntries(Object.entries(said).map(([id, one]) => [id, { token: one.token, platform: 'ios', client: one.client }]));

/** A service that takes every message, answering a ticket for each and an ok receipt for each ticket asked about. */
const accepted: Answer = (url, body) => (url === RECEIPTS
  ? { body: { data: Object.fromEntries((body as { ids: string[] }).ids.map((id) => [id, { status: 'ok' }])) } }
  : { body: { data: (body as { to: string }[]).map((_one, index) => ({ status: 'ok', id: `ticket-${index}` })) } });

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

it('logs a kept record that is not a device, and raises no problem for it', async () => {
  const world = up(accepted, {
    'phone-1': { token: 'ExponentPushToken[phone]', platform: 'ios', client: 'phone' },
    'phone-2': { platform: 'ios' },
  });
  expect(world.problems).toEqual([]);
  expect(world.logged).toHaveLength(1);
  expect(world.logged[0]).toContain('phone-2 is not a device; its registration was left out');
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

it('reads a send\'s receipts fifteen minutes after it', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  const world = up(accepted, devices({ 'phone-1': { client: 'phone', token: 'ExponentPushToken[phone]' } }));
  await openedBy(world, 'echo:/one', 'phone');
  await waiting(world, 'echo:/one', 'q1');

  await vi.advanceTimersByTimeAsync(QUARTER_HOUR - 1);
  expect(world.receipts()).toEqual([]);
  await vi.advanceTimersByTimeAsync(1);
  expect(world.receipts().map((one) => one.body)).toEqual([{ ids: ['ticket-0'] }]);
});

it('forgets a device its receipt says Expo no longer knows, with no send after it', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  const world = up((url) => (url === ENDPOINT
    ? { body: { data: [{ status: 'ok', id: 'ticket-0' }, { status: 'ok', id: 'ticket-1' }] } }
    : { body: { data: { 'ticket-0': { status: 'error', details: { error: 'DeviceNotRegistered' } }, 'ticket-1': { status: 'ok' } } } }),
  devices({
    'phone-1': { client: 'phone', token: 'ExponentPushToken[phone]' },
    'phone-2': { client: 'tablet', token: 'ExponentPushToken[tablet]' },
  }));
  await openedBy(world, 'echo:/one', 'phone', 'tablet');
  await waiting(world, 'echo:/one', 'q1');
  expect(Object.keys(world.kept())).toEqual(['phone-1', 'phone-2']);

  await vi.advanceTimersByTimeAsync(QUARTER_HOUR);
  await vi.waitFor(() => { expect(Object.keys(world.kept())).toEqual(['phone-2']); });
  expect(world.logged.some((line) => line.includes('no longer registered with Expo'))).toBe(true);
});

it('says a ticket Expo has no receipt for fifteen minutes on', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  const world = up((url) => (url === ENDPOINT ? accepted(url, [{ to: 'x' }]) : { body: { data: {} } }), devices({
    'phone-1': { client: 'phone', token: 'ExponentPushToken[phone]' },
  }));
  await openedBy(world, 'echo:/one', 'phone');
  await waiting(world, 'echo:/one', 'q1');

  await vi.advanceTimersByTimeAsync(QUARTER_HOUR);
  await vi.waitFor(() => {
    expect(world.logged).toEqual(['push: Expo has no receipt for the notification to ExponentPushToken[phone] fifteen minutes on']);
  });
  expect(Object.keys(world.kept())).toEqual(['phone-1']);
});

it('drops the receipt reads still to come when the host closes', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  const world = up(accepted, devices({ 'phone-1': { client: 'phone', token: 'ExponentPushToken[phone]' } }));
  expect(world.closers).toHaveLength(1);
  await openedBy(world, 'echo:/one', 'phone');
  await waiting(world, 'echo:/one', 'q1');

  for (const close of world.closers) await close();
  await vi.advanceTimersByTimeAsync(QUARTER_HOUR);
  expect(world.receipts()).toEqual([]);
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

it('sends again after one second and then two while Expo answers a 5xx, logs a send still refused, and the next wait still sends', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  let broken = true;
  const world = up((url, body) => (broken && url === ENDPOINT ? { status: 503 } : accepted(url, body)), devices({
    'phone-1': { client: 'phone', token: 'ExponentPushToken[phone]' },
  }));
  await openedBy(world, 'echo:/one', 'phone');
  const first = waiting(world, 'echo:/one', 'q1');

  await vi.advanceTimersByTimeAsync(0);
  expect(world.sends()).toHaveLength(1);
  await vi.advanceTimersByTimeAsync(999);
  expect(world.sends()).toHaveLength(1);
  await vi.advanceTimersByTimeAsync(1);
  expect(world.sends()).toHaveLength(2);
  await vi.advanceTimersByTimeAsync(1999);
  expect(world.sends()).toHaveLength(2);
  await vi.advanceTimersByTimeAsync(1);
  await first;
  expect(world.sends()).toHaveLength(3);
  expect(world.logged).toEqual(['push: the push service answered 503']);

  broken = false;
  await waiting(world, 'echo:/one', 'q2');
  expect(world.sends()).toHaveLength(4);
});

it('reads receipts once: a read the network fails is logged and not made again', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  const world = up((url, body) => (url === RECEIPTS ? 'throw' : accepted(url, body)), devices({
    'phone-1': { client: 'phone', token: 'ExponentPushToken[phone]' },
  }));
  await openedBy(world, 'echo:/one', 'phone');
  await waiting(world, 'echo:/one', 'q1');

  await vi.advanceTimersByTimeAsync(QUARTER_HOUR);
  await vi.waitFor(() => { expect(world.logged).toEqual(['push: the push service could not be reached: the network is gone']); });
  await vi.advanceTimersByTimeAsync(QUARTER_HOUR);
  expect(world.receipts()).toHaveLength(1);
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

/** The session's turn, ended as `status` says, on `chat` or the session's own. */
const ended = async (world: { fire: Node['fire'] }, session: string, status: 'complete' | 'cancelled' = 'complete', chat = `${session}/chat`): Promise<void> =>
  world.fire({ type: 'turn_end', session, chat, turn: 't1', status });

it('tells the devices in a session when its own chat finishes a turn', async () => {
  const world = up(accepted, devices({
    'phone-1': { client: 'phone', token: 'ExponentPushToken[phone]' },
    'phone-2': { client: 'laptop', token: 'ExponentPushToken[laptop]' },
  }));
  await openedBy(world, 'echo:/one', 'phone');
  await ended(world, 'echo:/one');
  expect(world.sends()[0]?.body).toEqual([
    { to: 'ExponentPushToken[phone]', title: 'Echo', body: 'A session finished', data: { uri: 'echo:/one', kind: 'turnComplete' } },
  ]);
});

it('sends nothing for a stopped turn or a worker chat', async () => {
  const world = up(accepted, devices({ 'phone-1': { client: 'phone', token: 'ExponentPushToken[phone]' } }));
  await openedBy(world, 'echo:/one', 'phone');
  await ended(world, 'echo:/one', 'cancelled');
  await ended(world, 'echo:/one', 'complete', 'ahp-chat://subagent/ZWNobzovb25l/call-1');
  expect(world.sends()).toEqual([]);
});

/** One message to the phone a token names. */
const toPhone = (token: string) => ({ to: token, title: 'Echo', body: 'A session finished', data: {} });

it('sends again after one second and then two when the network or a 429 failed the send', async () => {
  const answers: ReturnType<Answer>[] = ['throw', { status: 429 }];
  const { calls, request } = service((url, body) => answers.shift() ?? accepted(url, body));
  const waits: number[] = [];
  const logged: string[] = [];
  const sender = createSender({ log: (line) => { logged.push(line); }, gone: () => {}, request, wait: async (ms) => { waits.push(ms); } });
  await sender.send([toPhone('ExponentPushToken[phone]')]);

  expect(calls.map((one) => one.url)).toEqual([ENDPOINT, ENDPOINT, ENDPOINT]);
  expect(waits).toEqual([1000, 2000]);
  expect(logged).toEqual([]);
  sender.close();
});

it('asks Expo for a send\'s receipts three hundred to a request', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  const { calls, request } = service((url, body) => (url === ENDPOINT
    ? { body: { data: (body as { to: string }[]).map((one) => ({ status: 'ok', id: `ticket-${one.to}` })) } }
    : accepted(url, body)));
  const logged: string[] = [];
  const sender = createSender({ log: (line) => { logged.push(line); }, gone: () => {}, request });
  const messages = Array.from({ length: 301 }, (_one, at) => toPhone(`ExponentPushToken[${String(at)}]`));
  await sender.send(messages);
  expect(calls.filter((one) => one.url === ENDPOINT).map((one) => (one.body as unknown[]).length)).toEqual([100, 100, 100, 1]);

  await vi.advanceTimersByTimeAsync(QUARTER_HOUR);
  const asked = (): string[][] => calls.filter((one) => one.url === RECEIPTS).map((one) => (one.body as { ids: string[] }).ids);
  await vi.waitFor(() => { expect(asked().map((ids) => ids.length)).toEqual([300, 1]); });
  expect(asked().flat()).toEqual(messages.map((one) => `ticket-${one.to}`));
  expect(logged).toEqual([]);
});
