import { createECDH } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { createHost } from '../../sdk/src/host.js';
import { fileResources } from '../../sdk/src/resources/resources.js';
import { loadPlugins } from '../../server/src/plugins.js';
import { echo } from '../../../examples/echo/agent.js';
import { deviceStore, pushProvider } from '../src/provider.js';
import { loadVapid } from '../src/vapid.js';
import type { PushProvider } from '../src/provider.js';
import type { HostOptions } from '../../sdk/src/types/host.js';
import type { Peer } from '../../sdk/src/types/rpc.js';
import type { Write } from '../../sdk/src/types/resources.js';
import { posix } from '../../../tools/posix.ts';

/*
 * The `push:` scheme, over the devices one daemon keeps.
 *
 * The provider is asked directly for what a registration is, and the plugin is
 * loaded once to show the daemon advertises the scheme and serves a write
 * through it: what a client does to register a phone is the protocol's own
 * `resourceWrite`, so that is the road the last test takes.
 */

const REPO = join(import.meta.dirname, '../../..');
const SOURCE = './packages/push/src/index.ts';
const TOKEN = 'ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]';
/** The public key of a fixed P-256 private key, a point a browser could give. */
const P256DH = (() => {
  const pair = createECDH('prime256v1');
  pair.setPrivateKey(Buffer.alloc(32, 7));
  return pair.getPublicKey().toString('base64url');
})();
const AUTH = Buffer.alloc(16, 9).toString('base64url');
const WEB = { platform: 'web', endpoint: 'https://fcm.googleapis.com/wp/one', keys: { p256dh: P256DH, auth: AUTH } };

/** A temporary directory removed after the test that made it. */
let loose: string | undefined;
afterEach(() => {
  if (loose !== undefined) rmSync(loose, { recursive: true, force: true });
  loose = undefined;
});

/** A directory of this test's own, kept until the test ends. */
const dir = (): string => (loose ??= mkdtempSync(join(tmpdir(), 'ahpd-push-')));

/** One write's body, as a client sends it. */
const body = (said: unknown): Write => ({ data: typeof said === 'string' ? said : JSON.stringify(said), encoding: 'utf-8' });

/** A provider over a store in a directory of this test's own, and its problems. */
const over = (onProblem: (line: string) => void = () => {}): PushProvider =>
  pushProvider({ store: deviceStore(dir(), onProblem) });

/** A host's options with one backend, so the plugin is provably extra. */
const base = (where: string): HostOptions => ({
  path: where,
  agents: [{ ...echo({ path: where, pace: 0 }), provider: 'base', displayName: 'Base backend' }],
  resources: fileResources(),
});

const peer = (): Peer => ({
  send: () => {}, notify: () => {}, request: async () => ({}), answered: () => {}, close: () => {},
});

it('keeps a device a client registered, and reads it back', async () => {
  const provider = over();
  await provider.write('push://devices/phone-1', body({ token: TOKEN, platform: 'ios', lang: 'pt-BR' }), undefined, 'phone');

  const read = await provider.read('push://devices/phone-1');
  expect(read.contentType).toBe('application/json');
  // The token is write-only, so a read answers the device without it, with
  // the client that registered it as the connection named it.
  expect(JSON.parse(read.data)).toEqual({ platform: 'ios', lang: 'pt-BR', client: 'phone' });

  expect(await provider.list('push://')).toEqual([{ name: 'devices', type: 'directory' }]);
  expect(await provider.list('push://devices')).toEqual([{ name: 'phone-1', type: 'file' }]);
  const resolved = await provider.resolve('push://devices/phone-1');
  expect(resolved).toMatchObject({ uri: 'push://devices/phone-1', type: 'file' });
});

// A POSIX mode, which Windows has none of.

it.skipIf(!posix)('writes the devices at a mode only their owner may read', async () => {
  const where = dir();
  const provider = pushProvider({ store: deviceStore(where, () => {}) });
  await provider.write('push://devices/phone-1', body({ token: TOKEN, platform: 'android' }), undefined, 'phone');
  expect(statSync(join(where, 'push-devices.json')).mode & 0o777).toBe(0o600);
});

// Softov 2026-10-31, "A setting per device (Recommended)".
it('keeps the person, the client and the audience a device was written with', async () => {
  const provider = over();
  await provider.write('push://devices/phone-1', body({ token: TOKEN, platform: 'ios', audience: 'device' }), 'user:ana', 'phone');
  expect(JSON.parse((await provider.read('push://devices/phone-1')).data)).toEqual({
    platform: 'ios',
    audience: 'device',
    client: 'phone',
    owner: 'user:ana',
  });
  await expect(provider.write('push://devices/phone-2', body({ token: TOKEN, platform: 'ios', audience: 'everyone' }), 'user:ana', 'phone'))
    .rejects.toThrow('push://devices/phone-2 has an audience that is not person or device');
});

it('reads a person, a client and an audience back from a device already on disk', async () => {
  const where = dir();
  writeFileSync(join(where, 'push-devices.json'), JSON.stringify({
    'phone-1': { token: TOKEN, platform: 'ios', owner: 'user:ana', client: 'phone', audience: 'person' },
  }));
  const provider = pushProvider({ store: deviceStore(where, () => {}) });
  expect(JSON.parse((await provider.read('push://devices/phone-1')).data)).toEqual({
    platform: 'ios',
    owner: 'user:ana',
    client: 'phone',
    audience: 'person',
  });
});

it('keeps a browser subscription, and reads it back without its endpoint and keys', async () => {
  const provider = over();
  await provider.write('push://devices/browser-1', body({ ...WEB, lang: 'pt-BR' }), 'user:ana', 'browser');
  expect(JSON.parse((await provider.read('push://devices/browser-1')).data)).toEqual({
    platform: 'web',
    lang: 'pt-BR',
    owner: 'user:ana',
    client: 'browser',
  });
});

it('refuses a web body that is not a subscription this host can seal a message for', async () => {
  const provider = over();
  const refused = [
    { platform: 'web' },
    { platform: 'web', endpoint: 'http://fcm.googleapis.com/wp/one', keys: WEB.keys },
    { platform: 'web', endpoint: 'not a url', keys: WEB.keys },
    { platform: 'web', endpoint: WEB.endpoint },
    { platform: 'web', endpoint: WEB.endpoint, keys: { p256dh: P256DH } },
    { platform: 'web', endpoint: WEB.endpoint, keys: { p256dh: P256DH, auth: AUTH.slice(0, 20) } },
    // 64 octets, and a p256dh is the 65-octet uncompressed point.
    { platform: 'web', endpoint: WEB.endpoint, keys: { p256dh: Buffer.alloc(64, 1).toString('base64url'), auth: AUTH } },
    // 65 octets that start as an uncompressed point and are not on the curve.
    { platform: 'web', endpoint: WEB.endpoint, keys: { p256dh: Buffer.concat([Buffer.from([0x04]), Buffer.alloc(64, 7)]).toString('base64url'), auth: AUTH } },
    // 15 octets, and an auth secret is 16.
    { platform: 'web', endpoint: WEB.endpoint, keys: { p256dh: P256DH, auth: Buffer.alloc(15, 1).toString('base64url') } },
    { platform: 'web', endpoint: WEB.endpoint, keys: { p256dh: 'not base64url!', auth: AUTH } },
  ];
  for (const said of refused) {
    await expect(provider.write('push://devices/browser-1', body(said), undefined, 'browser')).rejects.toMatchObject({ code: -32602 });
  }
  expect(await provider.list('push://devices')).toEqual([]);
});

it('serves the host public key at push://vapid, and refuses to write or delete it', async () => {
  const where = dir();
  const vapid = loadVapid(where, () => {});
  expect(vapid).toBeDefined();
  const provider = pushProvider({ store: deviceStore(where, () => {}), ...(vapid === undefined ? {} : { vapid }) });

  expect(await provider.list('push://')).toEqual([{ name: 'devices', type: 'directory' }, { name: 'vapid', type: 'file' }]);
  const read = await provider.read('push://vapid');
  expect(read.contentType).toBe('application/json');
  expect(JSON.parse(read.data)).toEqual({ publicKey: vapid?.publicKey });
  expect((await provider.resolve('push://vapid')).type).toBe('file');

  await expect(provider.write('push://vapid', body({ platform: 'web' }))).rejects.toMatchObject({ code: -32009, message: 'Permission denied: push://vapid' });
  await expect(provider.remove('push://vapid')).rejects.toMatchObject({ code: -32009, message: 'Permission denied: push://vapid' });
});

it('serves no push://vapid when the host has no pair', async () => {
  const provider = over();
  expect(await provider.list('push://')).toEqual([{ name: 'devices', type: 'directory' }]);
  await expect(provider.read('push://vapid')).rejects.toMatchObject({ code: -32008 });
  await expect(provider.resolve('push://vapid')).rejects.toMatchObject({ code: -32008 });
});

it('re-registers a device, and a rotated token is the one kept', async () => {
  const where = dir();
  const provider = pushProvider({ store: deviceStore(where, () => {}) });
  await provider.write('push://devices/phone-1', body({ token: TOKEN, platform: 'ios' }), undefined, 'phone');
  await provider.write('push://devices/phone-1', body({ token: 'ExponentPushToken[rotated]', platform: 'ios' }), undefined, 'phone');
  expect(JSON.parse(readFileSync(join(where, 'push-devices.json'), 'utf8'))).toMatchObject({ 'phone-1': { token: 'ExponentPushToken[rotated]' } });
  expect(await provider.list('push://devices')).toEqual([{ name: 'phone-1', type: 'file' }]);
});

it('refuses a body that is not a device', async () => {
  const provider = over();
  const refused = [
    'not json at all',
    '[]',
    '"a string"',
    '{}',
    { token: '' },
    { token: '   ', platform: 'ios' },
    { token: TOKEN },
    { token: TOKEN, platform: 'web' },
    { token: TOKEN, platform: 'ios', lang: 3 },
    { token: TOKEN, platform: 'ios', lang: '' },
  ];
  for (const said of refused) {
    await expect(provider.write('push://devices/phone-1', body(said), undefined, 'phone')).rejects.toMatchObject({ code: -32602 });
  }
  expect(await provider.list('push://devices')).toEqual([]);
});

it('refuses a write that names no device, and one to a device already there', async () => {
  const provider = over();
  await expect(provider.write('push://', body({ token: TOKEN, platform: 'ios' }))).rejects.toMatchObject({ code: -32009, message: 'Permission denied: push://' });
  await expect(provider.write('push://devices', body({ token: TOKEN, platform: 'ios' }))).rejects.toMatchObject({ code: -32009, message: 'Permission denied: push://devices' });
  await expect(provider.write('push://devices/a/b', body({ token: TOKEN, platform: 'ios' }))).rejects.toMatchObject({ code: -32008 });

  await provider.write('push://devices/phone-1', body({ token: TOKEN, platform: 'ios' }), undefined, 'phone');
  await expect(provider.write('push://devices/phone-1', {
    ...body({ token: TOKEN, platform: 'ios' }), createOnly: true,
  })).rejects.toMatchObject({ code: -32010 });
});

it('removes a device, and answers nothing is there the second time', async () => {
  const provider = over();
  await provider.write('push://devices/phone-1', body({ token: TOKEN, platform: 'ios' }), undefined, 'phone');
  await provider.remove('push://devices/phone-1');
  expect(await provider.list('push://devices')).toEqual([]);
  await expect(provider.read('push://devices/phone-1')).rejects.toMatchObject({ code: -32008 });
  await expect(provider.remove('push://devices/phone-1')).rejects.toMatchObject({ code: -32008 });
  await expect(provider.remove('push://devices')).rejects.toMatchObject({ code: -32009, message: 'Permission denied: push://devices' });
});

it('refuses to resolve a device that is not there, and answers no times the file does not keep', async () => {
  const where = dir();
  const vapid = loadVapid(where, () => {});
  const provider = pushProvider({ store: deviceStore(where, () => {}), ...(vapid === undefined ? {} : { vapid }) });
  await expect(provider.resolve('push://devices/phone-1')).rejects.toMatchObject({ code: -32008 });

  await provider.write('push://devices/phone-1', body({ token: TOKEN, platform: 'ios' }), undefined, 'phone');
  for (const uri of ['push://', 'push://devices', 'push://devices/phone-1', 'push://vapid']) {
    const resolved = await provider.resolve(uri);
    expect(resolved).not.toHaveProperty('mtime');
    expect(resolved).not.toHaveProperty('ctime');
  }
});

it('answers a device\'s etag, and refuses a write whose ifMatch is not it', async () => {
  const provider = over();
  await provider.write('push://devices/phone-1', body({ token: TOKEN, platform: 'ios' }), undefined, 'phone');
  const first = (await provider.resolve('push://devices/phone-1')).etag ?? '';
  expect(first).not.toBe('');

  // The token the write read is the current one, so the rotated token is kept.
  await provider.write('push://devices/phone-1', { ...body({ token: 'ExponentPushToken[rotated]', platform: 'ios' }), ifMatch: first }, undefined, 'phone');
  const second = (await provider.resolve('push://devices/phone-1')).etag;
  expect(second).not.toBe(first);

  // A write that read the device before that one is refused, and changes nothing.
  await expect(provider.write('push://devices/phone-1', { ...body({ token: TOKEN, platform: 'ios' }), ifMatch: first }, undefined, 'phone'))
    .rejects.toMatchObject({ code: -32011, message: 'ifMatch precondition failed for: push://devices/phone-1' });
  expect((await provider.resolve('push://devices/phone-1')).etag).toBe(second);

  // An ifMatch on a device that is not there names one the caller believed was.
  await expect(provider.write('push://devices/phone-2', { ...body({ token: TOKEN, platform: 'ios' }), ifMatch: 'anything' }, undefined, 'phone'))
    .rejects.toMatchObject({ code: -32011 });
  expect(await provider.list('push://devices')).toEqual([{ name: 'phone-1', type: 'file' }]);
});

it('keeps a device whose writer is nobody, and it belongs to no person', async () => {
  const where = dir();
  const provider = pushProvider({ store: deviceStore(where, () => {}) });
  await provider.write('push://devices/phone-1', body({ token: TOKEN, platform: 'ios' }));
  expect(JSON.parse((await provider.read('push://devices/phone-1')).data)).toEqual({ platform: 'ios' });
});

it('reports a file it cannot use, and says nothing it read out of it', async () => {
  const where = dir();
  writeFileSync(join(where, 'push-devices.json'), `{ "phone": { "token": "${TOKEN}", `);
  const problems: string[] = [];
  const provider = pushProvider({ store: deviceStore(where, (line) => { problems.push(line); }) });
  expect(await provider.list('push://devices')).toEqual([]);
  expect(problems).toHaveLength(1);
  // The parser's own words quote what it choked on, and a token is a credential.
  expect(problems[0]).not.toContain(TOKEN);
  expect(problems[0]).toContain('is not JSON');
});

it('loads as a plugin, advertises push, and serves a registration through the host', async () => {
  const where = dir();
  const { options, loaded, problems } = await loadPlugins([{ name: SOURCE, options: {} }], {
    base: base(where), configDir: where, cwd: REPO, log: () => {},
  });
  expect(problems).toEqual([]);
  expect(loaded.map((one) => one.name)).toEqual(['push']);

  const host = createHost(options);
  try {
    const client = host.accept(peer());
    const ready = await client.handle({
      method: 'initialize',
      params: { clientId: 'phone', protocolVersions: ['0.9.0'] },
    }) as { _meta?: Record<string, unknown> };

    // What a client reads to know this host serves push, and what it may ask of it.
    expect(ready._meta?.['ahpd.resourceProviders']).toMatchObject({
      push: {
        title: 'Push',
        root: 'push://',
        operations: ['get', 'list', 'resolve', 'put', 'delete'],
      },
    });

    await client.handle({
      method: 'resourceWrite',
      params: { channel: 'ahp-root://', uri: 'push://devices/phone-1', data: JSON.stringify({ token: TOKEN, platform: 'ios' }), encoding: 'utf-8' },
    });
    const read = await client.handle({
      method: 'resourceRead', params: { channel: 'ahp-root://', uri: 'push://devices/phone-1' },
    }) as { data: string };
    // What the body said, the token held back as a credential, and the client
    // the connection introduced itself as.
    expect(JSON.parse(read.data)).toEqual({ platform: 'ios', client: 'phone' });

    // A browser reads the public key its subscription is made against here.
    const vapid = await client.handle({
      method: 'resourceRead', params: { channel: 'ahp-root://', uri: 'push://vapid' },
    }) as { data: string };
    const publicKey = (JSON.parse(vapid.data) as { publicKey: string }).publicKey;
    expect(Buffer.from(publicKey, 'base64url')).toHaveLength(65);
  }
  finally {
    await host.close();
  }
});
