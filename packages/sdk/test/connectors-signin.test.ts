import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { connectorsChannel } from '../src/connectors/channel.js';
import { adaptersChannel } from '../src/connectors/adapters.js';
import { createHost } from '../src/host.js';
import { fileUsers } from '../src/access/users.js';
import { fileResources } from '../src/resources/resources.js';
import { memoryRecords } from '../src/resources/records.js';
import { servedRecords } from '../src/resources/recordschannel.js';
import { pluginHost } from '../src/plugins/plugins.js';
import { echo } from '../../../examples/echo/agent.js';
import type { Adapter, Connector, DeviceSignInPoll, ServedAdapter } from '../src/types/connectors.js';
import type { LoaderContext } from '../src/types/plugin.js';
import type { RecordCollection } from '../src/types/records.js';
import type { Users } from '../src/types/users.js';
import type { Vault } from '../src/types/vault.js';

/*
 * A connector that is made by signing in to its provider.
 *
 * The host builds the PKCE values, keeps the verifier and the put's params in
 * memory under a state, and answers a URL. The finish takes the code, asks the
 * put's owner checks again, exchanges the code through the adapter, and runs
 * the put with the key in the field the adapter named.
 *
 * A state is its starter's and is used once. No answer, row, error or problem
 * line carries the code, the verifier or the key.
 */

const SIGNIN = 'x-ahpd/connectors/signin';
const FINISH = 'x-ahpd/connectors/signin-finish';
const CONNECTORS = 'x-ahpd-connectors://';
const ADAPTERS = 'x-ahpd-adapters://';
const ROOT = 'ahp-root://';

/** The key the fake provider answers, which no answer may carry before the vault. */
const KEY = 'sk-exchanged-1';

/** The code a person pastes, which no answer may echo. */
const CODE = 'the-pasted-code';

/** What the fake device provider shows, and what it keeps to itself. */
const DEVICE_CODE = 'WDJB-MJHT';
const DEVICE_URL = 'https://vendor.test/device';
const DEVICE_HANDLE = 'the-device-handle';
const DEVICE_INTERVAL = 5;
const DEVICE_EXPIRES = 900;

/** The token and account a device approval answers, which no answer carries before the vault. */
const DEVICE_TOKEN = 'dt-exchanged-1';
const DEVICE_ACCOUNT = 'cy@example.test';

type Bag = Record<string, any>;

/** The vendor's schema: a target a person fills in and a secret the exchange fills. */
const VENDOR_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    target: { type: 'string' },
    secret: { type: 'string', secret: true },
  },
  required: ['target', 'secret'],
};

/** The device vendor's schema: a target, the token, and the account the approval names. */
const DEVICE_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    target: { type: 'string' },
    token: { type: 'string', secret: true },
    account: { type: 'string' },
  },
  required: ['target', 'token'],
};

/** What the fake device provider keeps of the sign-in, and what a test may change. */
interface Device {
  starts: number;
  polls: string[];
  expires: number;
  switchAccount: boolean;
  answer(handle: string): Promise<DeviceSignInPoll>;
}

/** The subset of JSON Schema the form uses, as the daemon's checker reads it. */
const check = (value: unknown, schema: Bag, label: string): void => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error(`${label} must be an object`);
  const given = value as Bag;
  const properties = (schema['properties'] ?? {}) as Bag;
  for (const name of (schema['required'] ?? []) as string[]) {
    if (given[name] === undefined) throw new Error(`${label}.${name} is required`);
  }
  for (const [name, one] of Object.entries(properties) as [string, Bag][]) {
    if (given[name] === undefined) continue;
    if (one['type'] === 'string' && typeof given[name] !== 'string') throw new Error(`${label}.${name} must be text`);
  }
  for (const name of Object.keys(given)) {
    if (!(name in properties)) throw new Error(`${label}.${name} is not a field`);
  }
};

/** A vault that is a map. */
const made = (): Vault & { held: Map<string, string> } => {
  const held = new Map<string, string>();
  return {
    held,
    get: async (name) => held.get(name),
    set: async (name, value) => { held.set(name, value); },
    delete: async (name) => held.delete(name),
    list: async () => [...held.keys()].sort(),
  };
};

/** What the fake provider keeps of one sign-in. */
interface Vendor {
  challenge: string;
  state: string;
  calls: { code: string; verifier: string }[];
  answer(code: string, verifier: string): Promise<string>;
}

const vendorState = (): Vendor => ({
  challenge: '',
  state: '',
  calls: [],
  answer: async () => KEY,
});

/** What an adapter was opened with. */
interface Opened {
  id: string;
  owner: string;
  config: Record<string, unknown>;
}

let home: string;
let usersFile: string;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'ahpd-signin-'));
  usersFile = join(home, 'users.json');
  writeUsers(['connector:list', 'connector:put', 'connector:remove']);
});
afterEach(() => { rmSync(home, { recursive: true, force: true }); });

/** The users file, with the grants `writer` holds, so a test can take one away. */
const writeUsers = (writer: string[]): void => {
  writeFileSync(usersFile, JSON.stringify({
    roles: { writer, teamer: ['connector:list', 'connector:put', 'connector:remove'] },
    users: [
      { id: 'cy', roles: ['writer'] },
      { id: 'di', roles: ['teamer'] },
    ],
  }));
};

type Host = ReturnType<typeof createHost>;

/** A host serving both channels over a vendor adapter with a sign-in and one without. */
async function served() {
  const collection: RecordCollection = await memoryRecords().collection('connectors', { format: 'json' });
  const opened: Opened[] = [];
  const problems: string[] = [];
  const vault = made();
  const vendor = vendorState();
  const device: Device = {
    starts: 0,
    polls: [],
    expires: DEVICE_EXPIRES,
    switchAccount: false,
    answer: async () => ({ wait: DEVICE_INTERVAL }),
  };
  const adapters: Record<string, ServedAdapter> = {
    vendor: {
      name: 'vendor',
      title: 'Vendor',
      description: 'An account that signs in.',
      by: 'vendor',
      schema: VENDOR_SCHEMA,
      capabilities: [],
      open: (connector: Connector) => {
        opened.push({ id: connector.id, owner: connector.owner, config: connector.config });
      },
      check: async () => ({ result: 'ok' }),
      signIn: {
        title: 'Sign in with Vendor',
        field: 'secret',
        url: (challenge: string, state: string) => {
          vendor.challenge = challenge;
          vendor.state = state;
          return `https://vendor.test/auth?challenge=${challenge}&state=${state}`;
        },
        exchange: async (code: string, verifier: string) => {
          vendor.calls.push({ code, verifier });
          return vendor.answer(code, verifier);
        },
      },
    },
    plain: {
      name: 'plain',
      title: 'Plain',
      description: 'An account with no sign-in.',
      by: 'plain',
      // A plugin written before `secret`: the host keeps `writeOnly` as the vault's.
      schema: { type: 'object', properties: { secret: { type: 'string', writeOnly: true } }, required: ['secret'] },
      capabilities: [],
      open: () => {},
    },
    device: {
      name: 'device',
      title: 'Device',
      description: 'An account that signs in on another device.',
      by: 'device',
      schema: DEVICE_SCHEMA,
      capabilities: [],
      open: (connector: Connector) => {
        opened.push({ id: connector.id, owner: connector.owner, config: connector.config });
      },
      check: async () => ({ result: 'ok' }),
      signIn: {
        flow: 'device',
        title: 'Sign in with Device',
        field: 'token',
        account: 'account',
        get switchAccount(): boolean {
          return device.switchAccount;
        },
        start: async () => {
          device.starts += 1;
          return {
            code: DEVICE_CODE,
            url: DEVICE_URL,
            expires: device.expires,
            interval: DEVICE_INTERVAL,
            handle: DEVICE_HANDLE,
          };
        },
        poll: async (handle: string) => {
          device.polls.push(handle);
          return await device.answer(handle);
        },
      },
    },
  };
  const connectors = connectorsChannel({
    collection,
    adapters: () => adapters,
    vault: () => vault,
    check,
    onProblem: (line) => { problems.push(line); },
  });
  const lists = adaptersChannel({ adapters: () => adapters });
  const wire = servedRecords('ahpd', [connectors.channel, lists.channel], connectors.methods);
  const users = fileUsers({ path: usersFile });
  const host = createHost({
    path: home,
    agents: [{ ...echo({ path: home, pace: 0 }), provider: 'base', displayName: 'Base' }],
    resources: fileResources(),
    channels: wire.channels,
    methods: wire.methods,
    users,
  });
  return { host, users, collection, adapters, opened, problems, vault, vendor, device, close: async () => { await host.close(); } };
}

/** A client signed in as `id`. */
const as = async (host: Host, users: Users, id: string) => {
  const token = await users.mint(id);
  const client = host.accept({
    send: () => {}, request: async () => ({}), answered: () => {}, close: () => {}, notify: () => {},
  });
  await client.handle({
    method: 'initialize', params: { clientId: id, protocolVersions: ['0.9.0'], initialSubscriptions: [ROOT] },
  });
  await client.handle({ method: 'authenticate', params: { channel: ROOT, resource: users.resource.resource, token } });
  const call = async (method: string, params: Bag) => client.handle({ method, params }).then(
    (result) => ({ result: result as Bag }),
    (error: { code: number; message: string }) => ({ code: error.code, message: error.message }),
  );
  /** Every row a subscribe to `channel` answered, by id. */
  const rows = async (channel = CONNECTORS): Promise<Record<string, Bag>> => {
    const answer = await call('subscribe', { channel }) as Bag;
    if (answer['result'] === undefined) throw new Error(`subscribe refused: ${JSON.stringify(answer)}`);
    const records = (answer['result'] as Bag)['snapshot'].state.records as { id: string; record: Bag }[];
    return Object.fromEntries(records.map((one) => [one.id, one.record]));
  };
  return { call, rows, close: () => { client.close(); } };
};

/** Start a sign-in as `cy` and answer the state and URL it gave. */
const started = async (cy: Awaited<ReturnType<typeof as>>, id = 'ci'): Promise<{ state: string; url: string }> => {
  const answer = await cy.call(SIGNIN, {
    id, adapter: 'vendor', owner: 'user:cy', title: 'CI', config: { target: 'bot://motion' },
  });
  if (!('result' in answer)) throw new Error(`the start refused: ${JSON.stringify(answer)}`);
  const result = answer.result;
  return { state: result['state'] as string, url: result['url'] as string };
};

/** Start a device sign-in as `cy`, and answer its state and the answer a client shows. */
const startedDevice = async (
  cy: Awaited<ReturnType<typeof as>>,
  config: Bag = { target: 'bot://motion' },
  id = 'dc',
): Promise<{ state: string; result: Bag }> => {
  const answer = await cy.call(SIGNIN, { id, adapter: 'device', owner: 'user:cy', title: 'Device CI', config });
  if (!('result' in answer)) throw new Error(`the device start refused: ${JSON.stringify(answer)}`);
  return { state: answer.result['state'] as string, result: answer.result };
};

/** A context for a registration the host refuses before anything loads. */
const CONTEXT: LoaderContext = {
  path: '/tmp/signin',
  paths: ['/tmp/signin'],
  version: '0.0.0',
  hostName: 'host',
  configDir: '/tmp/signin',
  log: () => {},
  say: () => {},
};

it('signs in: the start answers a URL and a state, and the finish stores the exchanged key', async () => {
  const { host, users, collection, opened, vault, vendor, problems, close } = await served();
  const cy = await as(host, users, 'cy');

  const { state, url } = await started(cy);
  // The URL is the adapter's own, made from the challenge and the state.
  expect(url).toBe(`https://vendor.test/auth?challenge=${vendor.challenge}&state=${state}`);
  expect(state).toHaveLength(43);

  expect(await cy.call(FINISH, { state, code: CODE })).toMatchObject({
    result: { id: 'ci', adapter: 'vendor', owner: 'user:cy', title: 'CI', state: 'ready' },
  });

  const verifier = vendor.calls[0]?.verifier ?? '';
  expect(vendor.calls).toEqual([{ code: CODE, verifier }]);
  // The verifier is 32 bytes, its S256 challenge is what the vendor saw, and no URL carries it.
  expect(verifier).toHaveLength(43);
  expect(vendor.challenge).toBe(createHash('sha256').update(verifier).digest('base64url'));
  expect(url).not.toContain(verifier);

  // The key is the vault's, the record keeps a reference, and the adapter opens with the value.
  expect(await vault.get('user:cy/connector/ci/secret')).toBe(KEY);
  expect(opened.at(-1)?.config).toEqual({ target: 'bot://motion', secret: KEY });
  const stored = await collection.get('ci');
  expect(stored?.['config']).toEqual({ target: 'bot://motion', secret: { $secret: 'user:cy/connector/ci/secret' } });

  // Neither a row, an answer nor a problem line carries the code, the verifier or the key.
  const rows = JSON.stringify(await cy.rows());
  for (const secret of [KEY, verifier, CODE, state]) {
    expect(rows).not.toContain(secret);
    expect(JSON.stringify(stored)).not.toContain(secret);
  }
  expect(problems).toEqual([]);
  await close();
});

it('sends an adapter its signIn as its title and field, and never its halves', async () => {
  const { host, users, close } = await served();
  const cy = await as(host, users, 'cy');

  const rows = await cy.rows(ADAPTERS);
  expect(rows['vendor']?.['signIn']).toEqual({ title: 'Sign in with Vendor', field: 'secret', flow: 'code' });
  expect(rows['device']?.['signIn']).toEqual({ title: 'Sign in with Device', field: 'token', flow: 'device' });
  expect(rows['plain']).not.toHaveProperty('signIn');
  // A row carries no function.
  expect(JSON.stringify(rows)).not.toContain('vendor.test');
  await close();
});

it('refuses a state this host never made, and never echoes it', async () => {
  const { host, users, close } = await served();
  const cy = await as(host, users, 'cy');

  const refused = await cy.call(FINISH, { state: 'no-such-state', code: CODE });
  expect(refused).toMatchObject({ code: -32602 });
  expect(JSON.stringify(refused)).not.toContain('no-such-state');
  await close();
});

it('uses a state once', async () => {
  const { host, users, close } = await served();
  const cy = await as(host, users, 'cy');
  const { state } = await started(cy);

  expect(await cy.call(FINISH, { state, code: CODE })).toMatchObject({ result: { id: 'ci' } });
  expect(await cy.call(FINISH, { state, code: CODE })).toMatchObject({ code: -32602 });
  await close();
});

it('refuses another caller\'s state, and leaves it for its starter', async () => {
  const { host, users, vendor, close } = await served();
  const cy = await as(host, users, 'cy');
  const di = await as(host, users, 'di');
  const { state } = await started(cy);

  expect(await di.call(FINISH, { state, code: CODE })).toMatchObject({ code: -32009 });
  // A stranger could not burn it: the call never reached the vendor.
  expect(vendor.calls).toEqual([]);
  expect(await cy.call(FINISH, { state, code: CODE })).toMatchObject({ result: { id: 'ci' } });
  await close();
});

it('refuses an expired state', async () => {
  const { host, users, vendor, close } = await served();
  const cy = await as(host, users, 'cy');
  const { state } = await started(cy);
  const later = Date.now() + 10 * 60 * 1000 + 1;

  vi.useFakeTimers();
  try {
    vi.setSystemTime(later);
    expect(await cy.call(FINISH, { state, code: CODE })).toMatchObject({ code: -32602 });
  } finally {
    vi.useRealTimers();
  }
  // An expired state is gone, and the vendor was never called.
  expect(vendor.calls).toEqual([]);
  expect(await cy.call(FINISH, { state, code: CODE })).toMatchObject({ code: -32602 });
  await close();
});

it('refuses an adapter with no sign-in, and a start that does not fit the form', async () => {
  const { host, users, close } = await served();
  const cy = await as(host, users, 'cy');

  expect(await cy.call(SIGNIN, { id: 'p', adapter: 'plain', owner: 'user:cy', config: { secret: 'x' } }))
    .toMatchObject({ code: -32602 });
  // The target is required, and the secret the sign-in fills is held rather than demanded.
  expect(await cy.call(SIGNIN, { id: 'ci', adapter: 'vendor', owner: 'user:cy', config: {} }))
    .toMatchObject({ code: -32602 });
  await close();
});

it('asks the owner\'s rule at the start, as a put does', async () => {
  const { host, users, close } = await served();
  const cy = await as(host, users, 'cy');

  expect(await cy.call(SIGNIN, {
    id: 'ci', adapter: 'vendor', owner: 'user:di', config: { target: 'bot://motion' },
  })).toMatchObject({ code: -32009 });
  await close();
});

it('refuses a finish by a caller who lost connector:put, and takes it when the grant returns', async () => {
  const { host, users, close } = await served();
  const cy = await as(host, users, 'cy');
  const { state } = await started(cy);

  writeUsers(['connector:list']);
  expect(await cy.call(FINISH, { state, code: CODE })).toMatchObject({ code: -32009 });

  // The grant is asked again, so the state was not spent by a refusal.
  writeUsers(['connector:list', 'connector:put', 'connector:remove']);
  expect(await cy.call(FINISH, { state, code: CODE })).toMatchObject({ result: { id: 'ci' } });
  await close();
});

it('keeps ten started sign-ins for one caller, and drops the oldest', async () => {
  const { host, users, close } = await served();
  const cy = await as(host, users, 'cy');
  const states: string[] = [];
  for (let n = 0; n < 10; n += 1) states.push((await started(cy, `ci-${String(n)}`)).state);
  const eleventh = await started(cy, 'ci-10');

  expect(await cy.call(FINISH, { state: states[0]!, code: CODE })).toMatchObject({ code: -32602 });
  expect(await cy.call(FINISH, { state: eleventh.state, code: CODE })).toMatchObject({ result: { id: 'ci-10' } });
  await close();
});

it('answers a failed exchange with the vendor\'s status alone', async () => {
  const { host, users, vendor, close } = await served();
  const cy = await as(host, users, 'cy');
  const { state } = await started(cy);
  vendor.answer = async () => { throw new Error('HTTP 400'); };

  expect(await cy.call(FINISH, { state, code: CODE })).toMatchObject({
    code: -32603, message: 'Sign in with Vendor answered HTTP 400',
  });
  await close();
});

it('never carries the code, the verifier or the key in a refused exchange', async () => {
  const { host, users, vendor, close } = await served();
  const cy = await as(host, users, 'cy');
  const { state } = await started(cy);
  vendor.answer = async (_code: string, verifier: string) => {
    throw new Error(`the vendor refused ${verifier} and ${KEY}`);
  };

  const refused = await cy.call(FINISH, { state, code: CODE });
  expect(refused).toMatchObject({ code: -32603, message: 'Sign in with Vendor did not finish the sign-in' });
  const verifier = vendor.calls[0]?.verifier ?? '';
  expect(verifier).not.toBe('');
  for (const secret of [KEY, verifier, CODE]) expect(JSON.stringify(refused)).not.toContain(secret);
  await close();
});

it('starts a device sign-in, and its finish waits until the person approves', async () => {
  const { host, users, collection, opened, vault, device, problems, close } = await served();
  const cy = await as(host, users, 'cy');
  vi.useFakeTimers();
  try {
    const { state, result } = await startedDevice(cy);
    // The client sees the code, the URL and the timing, and never the handle.
    expect(result).toMatchObject({ code: DEVICE_CODE, url: DEVICE_URL, expires: DEVICE_EXPIRES });
    expect(result['state']).toHaveLength(43);
    expect(JSON.stringify(result)).not.toContain(DEVICE_HANDLE);

    const finished = cy.call(FINISH, { state });
    // No record exists before the approval.
    expect(await collection.get('dc')).toBeUndefined();
    expect(await cy.rows()).not.toHaveProperty('dc');

    await vi.advanceTimersByTimeAsync(DEVICE_INTERVAL * 1000);
    expect(device.polls).toEqual([DEVICE_HANDLE]);
    device.answer = async () => ({ wait: 2 });
    await vi.advanceTimersByTimeAsync(DEVICE_INTERVAL * 1000);
    expect(device.polls).toHaveLength(2);
    expect(await collection.get('dc')).toBeUndefined();

    device.answer = async () => ({ values: { token: DEVICE_TOKEN, account: DEVICE_ACCOUNT } });
    await vi.advanceTimersByTimeAsync(2000);
    expect(await finished).toMatchObject({
      result: { id: 'dc', adapter: 'device', owner: 'user:cy', title: 'Device CI', state: 'ready' },
    });
  } finally {
    vi.useRealTimers();
  }
  // The token is the vault's, and the account stays in the record.
  expect(await vault.get('user:cy/connector/dc/token')).toBe(DEVICE_TOKEN);
  const stored = await collection.get('dc');
  expect(stored?.['config']).toEqual({
    target: 'bot://motion',
    token: { $secret: 'user:cy/connector/dc/token' },
    account: DEVICE_ACCOUNT,
  });
  expect(opened.at(-1)?.config).toEqual({ target: 'bot://motion', token: DEVICE_TOKEN, account: DEVICE_ACCOUNT });
  // Neither a row, a record nor a problem line carries the handle or the token.
  const rows = JSON.stringify(await cy.rows());
  for (const secret of [DEVICE_HANDLE, DEVICE_TOKEN]) {
    expect(rows).not.toContain(secret);
    expect(JSON.stringify(stored)).not.toContain(secret);
  }
  expect(problems).toEqual([]);
  await close();
});

it('makes the connector after the caller that started it leaves', async () => {
  const { host, users, device, vault, close } = await served();
  const first = await as(host, users, 'cy');
  vi.useFakeTimers();
  try {
    await startedDevice(first, { target: 'bot://away' }, 'away');
    first.close();
    device.answer = async () => ({ values: { token: DEVICE_TOKEN, account: DEVICE_ACCOUNT } });
    await vi.advanceTimersByTimeAsync(DEVICE_INTERVAL * 1000);
  } finally {
    vi.useRealTimers();
  }
  const later = await as(host, users, 'cy');
  expect(await later.rows()).toHaveProperty('away');
  expect(await vault.get('user:cy/connector/away/token')).toBe(DEVICE_TOKEN);
  await close();
});

it('ends the finish with the vendor\'s status alone when the poll refuses', async () => {
  const { host, users, device, collection, close } = await served();
  const cy = await as(host, users, 'cy');
  vi.useFakeTimers();
  try {
    const { state } = await startedDevice(cy);
    device.answer = async () => { throw new Error('HTTP 400'); };
    const finished = cy.call(FINISH, { state });
    await vi.advanceTimersByTimeAsync(DEVICE_INTERVAL * 1000);
    const refused = await finished;
    expect(refused).toMatchObject({ code: -32603, message: 'Sign in with Device answered HTTP 400' });
    expect(JSON.stringify(refused)).not.toContain(DEVICE_HANDLE);
  } finally {
    vi.useRealTimers();
  }
  expect(await collection.get('dc')).toBeUndefined();
  await close();
});

it('ends the finish when the code expires', async () => {
  const { host, users, device, close } = await served();
  device.expires = 30;
  const cy = await as(host, users, 'cy');
  vi.useFakeTimers();
  try {
    const { state } = await startedDevice(cy);
    const finished = cy.call(FINISH, { state });
    await vi.advanceTimersByTimeAsync(30_000);
    expect(await finished).toMatchObject({ code: -32602, message: 'This sign-in has expired; start it again' });
  } finally {
    vi.useRealTimers();
  }
  await close();
});

it('refuses another caller the device sign-in, and leaves it for its starter', async () => {
  const { host, users, device, close } = await served();
  const cy = await as(host, users, 'cy');
  const di = await as(host, users, 'di');
  vi.useFakeTimers();
  try {
    const { state } = await startedDevice(cy);
    expect(await di.call(FINISH, { state })).toMatchObject({ code: -32009 });
    expect(device.polls).toEqual([]);
    device.answer = async () => ({ values: { token: DEVICE_TOKEN, account: DEVICE_ACCOUNT } });
    const finished = cy.call(FINISH, { state });
    await vi.advanceTimersByTimeAsync(DEVICE_INTERVAL * 1000);
    expect(await finished).toMatchObject({ result: { id: 'dc' } });
  } finally {
    vi.useRealTimers();
  }
  await close();
});

it('signs the same account in again, and keeps the connector\'s id', async () => {
  const { host, users, device, collection, close } = await served();
  const cy = await as(host, users, 'cy');
  vi.useFakeTimers();
  try {
    device.answer = async () => ({ values: { token: DEVICE_TOKEN, account: DEVICE_ACCOUNT } });
    const first = await startedDevice(cy);
    const one = cy.call(FINISH, { state: first.state });
    await vi.advanceTimersByTimeAsync(DEVICE_INTERVAL * 1000);
    expect(await one).toMatchObject({ result: { id: 'dc' } });

    device.answer = async () => ({ values: { token: 'dt-exchanged-2', account: DEVICE_ACCOUNT } });
    const second = await startedDevice(cy);
    const two = cy.call(FINISH, { state: second.state });
    await vi.advanceTimersByTimeAsync(DEVICE_INTERVAL * 1000);
    expect(await two).toMatchObject({ result: { id: 'dc' } });
  } finally {
    vi.useRealTimers();
  }
  expect(await collection.list()).toHaveLength(1);
  await close();
});

it('refuses another account, and takes it when the adapter switches', async () => {
  const { host, users, device, collection, close } = await served();
  const cy = await as(host, users, 'cy');
  vi.useFakeTimers();
  try {
    device.answer = async () => ({ values: { token: DEVICE_TOKEN, account: DEVICE_ACCOUNT } });
    const first = await startedDevice(cy);
    const one = cy.call(FINISH, { state: first.state });
    await vi.advanceTimersByTimeAsync(DEVICE_INTERVAL * 1000);
    expect(await one).toMatchObject({ result: { id: 'dc' } });

    device.answer = async () => ({ values: { token: 'dt-exchanged-2', account: 'other@example.test' } });
    const second = await startedDevice(cy);
    const two = cy.call(FINISH, { state: second.state });
    await vi.advanceTimersByTimeAsync(DEVICE_INTERVAL * 1000);
    expect(await two).toMatchObject({
      code: -32602,
      message: `signed in as other@example.test, this connector is ${DEVICE_ACCOUNT}`,
    });
    expect((await collection.get('dc'))?.['config']).toMatchObject({ account: DEVICE_ACCOUNT });

    device.switchAccount = true;
    const third = await startedDevice(cy);
    const three = cy.call(FINISH, { state: third.state });
    await vi.advanceTimersByTimeAsync(DEVICE_INTERVAL * 1000);
    expect(await three).toMatchObject({ result: { id: 'dc' } });
  } finally {
    vi.useRealTimers();
  }
  expect((await collection.get('dc'))?.['config']).toMatchObject({ account: 'other@example.test' });
  await close();
});

it('refuses a signIn field the schema does not keep', () => {
  const { host } = pluginHost('vendor', CONTEXT);
  const adapter: Adapter = {
    name: 'vendor',
    title: 'Vendor',
    description: 'An account that signs in.',
    schema: VENDOR_SCHEMA,
    capabilities: [],
    open: () => {},
    signIn: { title: 'Sign in', field: 'target', url: () => 'https://vendor.test/auth', exchange: async () => KEY },
  };

  expect(() => host.registerAdapter(adapter)).toThrow('marks secret');
});

it('accepts a signIn whose field is secret', () => {
  const { host } = pluginHost('vendor', CONTEXT);
  const adapter: Adapter = {
    name: 'vendor',
    title: 'Vendor',
    description: 'An account that signs in.',
    schema: VENDOR_SCHEMA,
    capabilities: [],
    open: () => {},
    signIn: { title: 'Sign in', field: 'secret', url: () => 'https://vendor.test/auth', exchange: async () => KEY },
  };

  expect(() => host.registerAdapter(adapter)).not.toThrow();
});

it('accepts a signIn whose field is marked writeOnly alone, as a plugin written before secret is', () => {
  const { host } = pluginHost('vendor', CONTEXT);
  const adapter: Adapter = {
    name: 'vendor',
    title: 'Vendor',
    description: 'An account that signs in.',
    schema: { type: 'object', properties: { secret: { type: 'string', writeOnly: true } }, required: ['secret'] },
    capabilities: [],
    open: () => {},
    signIn: { title: 'Sign in', field: 'secret', url: () => 'https://vendor.test/auth', exchange: async () => KEY },
  };

  expect(() => host.registerAdapter(adapter)).not.toThrow();
});
