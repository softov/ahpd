import { WAIT_MS } from '../../../tools/wait.ts';
import { loggerOf } from '@ahpd/sdk';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import es from '../i18n/es.json' with { type: 'json' };
import pt from '../i18n/pt.json' with { type: 'json' };
import { apply } from '../src/plugin.js';
import { ENDPOINT, RECEIPTS, createSender } from '../src/send.js';
import type { EventHandler, EventName, HostEventOf } from '../../sdk/src/types/events.js';
import type { PluginHost } from '../../sdk/src/types/plugin.js';
import type { Owner } from '../../sdk/src/types/usage.js';

/*
 * The push plugin, against a service that is a stub.
 *
 * The plugin is applied to a host that records the handlers it registers and
 * answers the plugin's own connection, so each case is what the plugin meets:
 * the daemon listening, the session list the host answers, and the root
 * channel's notifications, without a backend and without a socket. The
 * endpoint is `globalThis.fetch`, replaced for the length of a test, because
 * that is the one thing the senders take from the world.
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

/** The protocol's status bits: idle, failed, running, and running while waiting on a person. */
const IDLE = 1;
const FAILED = 2;
const RUNNING = 8;
const WAITING = 24;

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

/** What the host is, for one case. */
interface HostSays {
  /** Whether people sign in here. */
  hasUsers?: boolean;
  /** Whose each session is, as `sessionOwner` answers. */
  owners?: Map<string, Owner>;
}

/** One host, as a plugin sees it: the members this plugin reads, the handlers it registers, and its connection's far end. */
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
  /** Every method the plugin's connection asked, in order. */
  requests: string[];
  /** What `listSessions` answers: the sessions, or a refusal. */
  listing: { items: Record<string, unknown>[] } | Error;
  /** Fire one event at every handler the plugin registered for it. */
  fire<K extends EventName>(event: HostEventOf<K>): Promise<void>;
  /** One notification the host sends the plugin's connection. */
  say(method: string, params: Record<string, unknown>): void;
}

const node = (configDir: string, said: HostSays): Node => {
  const handlers = new Map<EventName, EventHandler[]>();
  let heard: ((message: Record<string, unknown>) => void) | undefined;
  const made: Node = {
    host: undefined as unknown as PluginHost,
    logged: [],
    problems: [],
    vault: new Map(),
    closers: [],
    requests: [],
    listing: { items: [] },
    fire: async (event) => {
      for (const handler of handlers.get(event.type) ?? []) await handler(event, made.host);
    },
    say: (method, params) => { heard?.({ jsonrpc: '2.0', method, params }); },
  };
  made.host = {
    path: configDir,
    paths: [configDir],
    version: '0.10.0',
    hostName: 'Echo',
    configDir,
    ...(said.hasUsers === undefined ? {} : { hasUsers: said.hasUsers }),
    i18n: { pt, es },
    log: loggerOf((line: string) => { made.logged.push(line); }),
    say: () => {},
    problem: (line: string) => { made.problems.push(line); },
    secret: async (name: string) => {
      const held = made.vault.get(name);
      if (held === undefined) throw new Error(`the vault holds no ${name}`);
      return held;
    },
    on: (event: EventName, handler: EventHandler) => {
      const held = handlers.get(event);
      if (held === undefined) handlers.set(event, [handler]);
      else held.push(handler);
    },
    registerResourceProvider: () => {},
    registerClose: (close: () => void | Promise<void>) => { made.closers.push(close); },
    sessionOwner: async (uri: string) => said.owners?.get(uri),
    connect: () => ({
      send: () => {},
      notify: () => {},
      request: async (method: string) => {
        made.requests.push(method);
        if (method !== 'listSessions') return {};
        if (made.listing instanceof Error) throw made.listing;
        return made.listing;
      },
      onMessage: (handle: (message: Record<string, unknown>) => void) => { heard = handle; },
      close: () => {},
    }),
  } as unknown as PluginHost;
  return made;
};

/** Phones, by id and token, as a daemon that has run before would have left them. */
const phones = (said: Record<string, string>): Record<string, unknown> =>
  Object.fromEntries(Object.entries(said).map(([id, token]) => [id, { token, platform: 'ios' }]));

/** A service that takes every message, answering a ticket for each and an ok receipt for each ticket asked about. */
const accepted: Answer = (url, body) => (url === RECEIPTS
  ? { body: { data: Object.fromEntries((body as { ids: string[] }).ids.map((id) => [id, { status: 'ok' }])) } }
  : { body: { data: (body as { to: string }[]).map((_one, index) => ({ status: 'ok', id: `ticket-${index}` })) } });

/** The plugin, up over a stubbed service and a devices file of this test's own. */
const up = (answer: Answer, said: Record<string, unknown>, options: Record<string, unknown> = {}, host: HostSays = {}) => {
  const dir = (loose ??= mkdtempSync(join(tmpdir(), 'ahpd-push-send-')));
  writeFileSync(join(dir, 'push-devices.json'), JSON.stringify(said, null, 2));
  const { calls, request } = service(answer);
  vi.stubGlobal('fetch', request);
  const made = node(dir, host);
  apply(made.host, options);
  return Object.assign(made, {
    calls,
    sends: (): Sent[] => calls.filter((one) => one.url === ENDPOINT),
    receipts: (): Sent[] => calls.filter((one) => one.url === RECEIPTS),
    kept: (): Record<string, unknown> => JSON.parse(readFileSync(join(dir, 'push-devices.json'), 'utf8')) as Record<string, unknown>,
  });
};

/** Let what the plugin started on a notification run its course. */
const settle = async (): Promise<void> => {
  for (let round = 0; round < 10; round += 1) await new Promise<void>((done) => { setImmediate(done); });
};

/** The daemon listening, and the plugin's connection open with the host's list read. */
const listening = async (world: Node): Promise<void> => {
  await world.fire({ type: 'listening', runtime: 'node', host: '127.0.0.1', port: 9187, guarded: false });
  await settle();
  expect(world.requests).toEqual(['initialize', 'subscribe', 'listSessions']);
};

/** A session's summary, as the host lists and adds one: idle, and titled. */
const summary = (session: string, said: Record<string, unknown> = {}): Record<string, unknown> => ({
  resource: session,
  provider: 'echo',
  title: 'Fix the login',
  status: IDLE,
  createdAt: '2026-11-05T10:00:00.000Z',
  modifiedAt: '2026-11-05T10:00:00.000Z',
  ...said,
});

/** A session the root channel adds. */
const added = (world: Node, session: string, said: Record<string, unknown> = {}): void => {
  world.say('root/sessionAdded', { channel: 'ahp-root://', summary: summary(session, said) });
};

/** A change to a session's summary, as the root channel says it. */
const changed = (world: Node, session: string, changes: Record<string, unknown>): void => {
  world.say('root/sessionSummaryChanged', { channel: 'ahp-root://', session, changes });
};

/** A session the root channel adds and moves into needing input, and the send that told it. */
const told = async (world: Node & { sends(): Sent[] }, session: string): Promise<void> => {
  const before = world.sends().length;
  added(world, session);
  changed(world, session, { status: WAITING });
  await settle();
  expect(world.sends()).toHaveLength(before + 1);
};

it('tells every device when a session moves into needing input, once for the move, titled with the session', async () => {
  const world = up(accepted, phones({ 'phone-1': 'ExponentPushToken[phone]', 'phone-2': 'ExponentPushToken[tablet]' }));
  await listening(world);
  added(world, 'echo:/one');
  changed(world, 'echo:/one', { status: WAITING });
  await settle();

  const notice = { title: 'Session: Fix the login', body: 'Attention needed.', data: { uri: 'echo:/one', kind: 'needsInput' } };
  expect(world.sends().map((one) => one.body)).toEqual([[
    { to: 'ExponentPushToken[phone]', ...notice },
    { to: 'ExponentPushToken[tablet]', ...notice },
  ]]);

  // A second request while it already waits is no move; running and waiting again is.
  changed(world, 'echo:/one', { status: WAITING, modifiedAt: '2026-11-05T10:01:00.000Z' });
  await settle();
  expect(world.sends()).toHaveLength(1);
  changed(world, 'echo:/one', { status: RUNNING });
  changed(world, 'echo:/one', { status: WAITING });
  await settle();
  expect(world.sends()).toHaveLength(2);
  expect(world.problems).toEqual([]);
});

it('tells a failure at once, and a completion a second and a half on while the session is still completed', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  const world = up(accepted, phones({ 'phone-1': 'ExponentPushToken[phone]' }));
  await listening(world);
  added(world, 'echo:/one', { status: RUNNING });
  changed(world, 'echo:/one', { status: FAILED });
  await settle();
  expect(world.sends().map((one) => one.body)).toEqual([[
    { to: 'ExponentPushToken[phone]', title: 'Session: Fix the login', body: 'Session failed.', data: { uri: 'echo:/one', kind: 'idle' } },
  ]]);

  changed(world, 'echo:/one', { status: RUNNING });
  changed(world, 'echo:/one', { status: IDLE });
  await vi.advanceTimersByTimeAsync(1499);
  await settle();
  expect(world.sends()).toHaveLength(1);
  await vi.advanceTimersByTimeAsync(1);
  await settle();
  expect(world.sends()[1]?.body).toEqual([
    { to: 'ExponentPushToken[phone]', title: 'Session: Fix the login', body: 'Session completed.', data: { uri: 'echo:/one', kind: 'idle' } },
  ]);
});

it('tells nothing of a completion the session moves on from within a second and a half', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  const world = up(accepted, phones({ 'phone-1': 'ExponentPushToken[phone]' }));
  await listening(world);
  added(world, 'echo:/one', { status: RUNNING });
  changed(world, 'echo:/one', { status: IDLE });
  await vi.advanceTimersByTimeAsync(1000);
  // The next queued turn starts.
  changed(world, 'echo:/one', { status: RUNNING });
  await vi.advanceTimersByTimeAsync(2000);
  await settle();
  expect(world.sends()).toEqual([]);
});

it('tells nothing of the status a session is first seen at, nor of a session the list does not hold', async () => {
  const world = up(accepted, phones({ 'phone-1': 'ExponentPushToken[phone]' }));
  world.listing = { items: [summary('echo:/listed', { status: WAITING })] };
  await listening(world);
  added(world, 'echo:/added', { status: WAITING });
  changed(world, 'echo:/elsewhere', { status: WAITING });
  added(world, 'echo:/removed');
  world.say('root/sessionRemoved', { channel: 'ahp-root://', session: 'echo:/removed' });
  changed(world, 'echo:/removed', { status: WAITING });
  await settle();
  expect(world.sends()).toEqual([]);

  // The listed session is held, so its next move is told.
  changed(world, 'echo:/listed', { status: RUNNING });
  changed(world, 'echo:/listed', { status: WAITING });
  await settle();
  expect(world.sends().map((one) => one.body)).toMatchObject([[{ data: { uri: 'echo:/listed', kind: 'needsInput' } }]]);
});

it('names the session\'s workspace: its project, else its first folder', async () => {
  const world = up(accepted, phones({ 'phone-1': 'ExponentPushToken[phone]' }));
  await listening(world);
  added(world, 'echo:/one', { workingDirectories: ['file:///work/ahpd', 'file:///work/other'] });
  added(world, 'echo:/two', { project: { uri: 'file:///work/web', displayName: 'web app' }, workingDirectories: ['file:///work/web/.worktrees/x'] });
  changed(world, 'echo:/one', { status: WAITING });
  await settle();
  changed(world, 'echo:/two', { status: FAILED });
  await settle();
  expect(world.sends().map((one) => one.body)).toMatchObject([
    [{ body: 'Attention needed in ahpd.' }],
    [{ body: 'Failed in web app.' }],
  ]);
});

it('words a notice in the language its device registered with', async () => {
  const world = up(accepted, {
    'phone-1': { token: 'ExponentPushToken[pt]', platform: 'ios', lang: 'pt-BR' },
    'phone-2': { token: 'ExponentPushToken[en]', platform: 'android' },
    'phone-3': { token: 'ExponentPushToken[es]', platform: 'android', lang: 'es' },
  });
  await listening(world);
  added(world, 'echo:/one', { workingDirectories: ['file:///work/ahpd'] });
  changed(world, 'echo:/one', { status: WAITING });
  await settle();
  expect(world.sends()[0]?.body).toMatchObject([
    { to: 'ExponentPushToken[pt]', title: 'Sessão: Fix the login', body: 'Atenção necessária em ahpd.' },
    { to: 'ExponentPushToken[en]', title: 'Session: Fix the login', body: 'Attention needed in ahpd.' },
    { to: 'ExponentPushToken[es]', title: 'Sesión: Fix the login', body: 'Se requiere atención en ahpd.' },
  ]);
});

it('titles a session as VS Code does, as the root channel retitles it, with a backtick made a plain quote', async () => {
  const world = up(accepted, phones({ 'phone-1': 'ExponentPushToken[phone]' }));
  await listening(world);
  added(world, 'echo:/abcdef1234567', { title: '' });
  changed(world, 'echo:/abcdef1234567', { status: WAITING });
  await settle();
  changed(world, 'echo:/abcdef1234567', { title: 'Run `pnpm test`' });
  changed(world, 'echo:/abcdef1234567', { status: RUNNING });
  changed(world, 'echo:/abcdef1234567', { status: WAITING });
  await settle();
  expect(world.sends().map((one) => one.body)).toMatchObject([
    [{ title: 'Session: Session abcdef12' }],
    [{ title: 'Session: Run \'pnpm test\'' }],
  ]);
});

it('says a session list it cannot read, and still tells a session added after', async () => {
  const world = up(accepted, phones({ 'phone-1': 'ExponentPushToken[phone]' }));
  world.listing = new Error('plugin:push may not session:list here');
  await listening(world);
  expect(world.logged).toEqual(['push: the host\'s session list could not be read: plugin:push may not session:list here']);
  await told(world, 'echo:/one');
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

it('reads a token the vault holds, and sends nothing when it holds none', async () => {
  const world = up(accepted, phones({ 'phone-1': 'ExponentPushToken[phone]' }), {
    accessToken: { $secret: 'host:expo' },
  });
  await listening(world);
  added(world, 'echo:/one');
  changed(world, 'echo:/one', { status: WAITING });
  await settle();
  expect(world.sends()).toEqual([]);
  expect(world.logged).toHaveLength(1);
  expect(world.logged[0]).toContain('accessToken');

  // The next move, once the vault holds it, goes out with the token.
  world.vault.set('host:expo', 'ExpoToken abc');
  changed(world, 'echo:/one', { status: RUNNING });
  changed(world, 'echo:/one', { status: WAITING });
  await settle();
  expect(world.sends()).toHaveLength(1);
  expect(world.sends()[0]?.authorization).toBe('Bearer ExpoToken abc');
});

it('carries a hundred messages to a request, and the rest in another', async () => {
  const many: Record<string, string> = {};
  for (let at = 0; at < 101; at += 1) many[`phone-${String(at)}`] = `ExponentPushToken[${String(at)}]`;
  const world = up(accepted, phones(many));
  await listening(world);
  added(world, 'echo:/one');
  changed(world, 'echo:/one', { status: WAITING });
  await settle();

  expect(world.sends()).toHaveLength(2);
  expect((world.sends()[0]?.body as unknown[]).length).toBe(100);
  expect((world.sends()[1]?.body as unknown[]).length).toBe(1);
});

it('reads a send\'s receipts fifteen minutes after it', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  const world = up(accepted, phones({ 'phone-1': 'ExponentPushToken[phone]' }));
  await listening(world);
  await told(world, 'echo:/one');

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
  phones({ 'phone-1': 'ExponentPushToken[phone]', 'phone-2': 'ExponentPushToken[tablet]' }));
  await listening(world);
  await told(world, 'echo:/one');
  expect(Object.keys(world.kept())).toEqual(['phone-1', 'phone-2']);

  await vi.advanceTimersByTimeAsync(QUARTER_HOUR);
  await settle();
  expect(Object.keys(world.kept())).toEqual(['phone-2']);
  expect(world.logged.some((line) => line.includes('no longer registered with Expo'))).toBe(true);
});

it('says a ticket Expo has no receipt for fifteen minutes on', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  const world = up((url) => (url === ENDPOINT ? accepted(url, [{ to: 'x' }]) : { body: { data: {} } }), phones({
    'phone-1': 'ExponentPushToken[phone]',
  }));
  await listening(world);
  await told(world, 'echo:/one');

  await vi.advanceTimersByTimeAsync(QUARTER_HOUR);
  await settle();
  expect(world.logged).toEqual(['push: Expo has no receipt for the notification to ExponentPushToken[phone] fifteen minutes on']);
  expect(Object.keys(world.kept())).toEqual(['phone-1']);
});

it('drops the receipt reads and the completed notices still to come when the host closes', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  const world = up(accepted, phones({ 'phone-1': 'ExponentPushToken[phone]' }));
  expect(world.closers).toHaveLength(1);
  await listening(world);
  await told(world, 'echo:/one');
  added(world, 'echo:/two', { status: RUNNING });
  changed(world, 'echo:/two', { status: IDLE });

  for (const close of world.closers) await close();
  await vi.advanceTimersByTimeAsync(QUARTER_HOUR);
  await settle();
  expect(world.receipts()).toEqual([]);
  expect(world.sends()).toHaveLength(1);
});

it('sends again after one second and then two while Expo answers a 5xx, logs a send still refused, and the next move still sends', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  let broken = true;
  const world = up((url, body) => (broken && url === ENDPOINT ? { status: 503 } : accepted(url, body)), phones({
    'phone-1': 'ExponentPushToken[phone]',
  }));
  await listening(world);
  await told(world, 'echo:/one');

  await vi.advanceTimersByTimeAsync(999);
  await settle();
  expect(world.sends()).toHaveLength(1);
  await vi.advanceTimersByTimeAsync(1);
  await settle();
  expect(world.sends()).toHaveLength(2);
  await vi.advanceTimersByTimeAsync(1999);
  await settle();
  expect(world.sends()).toHaveLength(2);
  await vi.advanceTimersByTimeAsync(1);
  await settle();
  expect(world.sends()).toHaveLength(3);
  expect(world.logged).toEqual(['push: the push service answered 503']);

  broken = false;
  changed(world, 'echo:/one', { status: RUNNING });
  changed(world, 'echo:/one', { status: WAITING });
  await settle();
  expect(world.sends()).toHaveLength(4);
});

it('reads receipts once: a read the network fails is logged and not made again', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  const world = up((url, body) => (url === RECEIPTS ? 'throw' : accepted(url, body)), phones({
    'phone-1': 'ExponentPushToken[phone]',
  }));
  await listening(world);
  await told(world, 'echo:/one');

  await vi.advanceTimersByTimeAsync(QUARTER_HOUR);
  await settle();
  expect(world.logged).toEqual(['push: the push service could not be reached: the network is gone']);
  await vi.advanceTimersByTimeAsync(QUARTER_HOUR);
  expect(world.receipts()).toHaveLength(1);
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
  await vi.waitFor(() => { expect(asked().map((ids) => ids.length)).toEqual([300, 1]); }, { timeout: WAIT_MS });
  expect(asked().flat()).toEqual(messages.map((one) => `ticket-${one.to}`));
  expect(logged).toEqual([]);
});
