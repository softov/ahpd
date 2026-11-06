import { createECDH, createHash, createPublicKey, verify } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { deviceStore, pushProvider } from '../src/provider.js';
import { loadVapid } from '../src/vapid.js';
import { encrypt, vapidHeader, createWebSender } from '../src/webpush.js';
import type { Vapid } from '../src/vapid.js';

/*
 * The web sender: encryption, the VAPID header and the answers a push service
 * gives.
 *
 * The vector is RFC 8291 appendix A, kept as the RFC prints it, because the
 * whole of the encryption is only proven right by reproducing a body another
 * implementation made. The rest is a stub service, so what a case reads is the
 * request the sender made and the device it removed.
 */

/** RFC 8291 appendix A, every value as the RFC prints it in base64url. */
const RFC = {
  asPrivate: 'yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw',
  asPublic: 'BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8',
  uaPrivate: 'q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94',
  uaPublic: 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
  auth: 'BTBZMqHH6r4Tts7J_aSIgg',
  salt: 'DGv6ra1nlYgDCS1FRnbzlw',
  plain: 'When I grow up, I want to be a watermelon',
  body: 'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN',
};

/** A temporary directory removed after the test that made it. */
let loose: string | undefined;
afterEach(() => {
  if (loose !== undefined) rmSync(loose, { recursive: true, force: true });
  loose = undefined;
});

/** A directory of this test's own, kept until the test ends. */
const dir = (): string => (loose ??= mkdtempSync(join(tmpdir(), 'ahpd-webpush-')));

/** A pair the host could have made, for the cases about the protocol around the encryption. */
const pair = (): Vapid => loadVapid(dir(), () => {}) as Vapid;

it('seals a message as RFC 8291 appendix A does, byte for byte', () => {
  // The vector's two halves are each a key pair, which is the first check that
  // the values below are the RFC's and not two strings that look like them.
  const as = createECDH('prime256v1');
  as.setPrivateKey(Buffer.from(RFC.asPrivate, 'base64url'));
  expect(as.getPublicKey().toString('base64url')).toBe(RFC.asPublic);
  const ua = createECDH('prime256v1');
  ua.setPrivateKey(Buffer.from(RFC.uaPrivate, 'base64url'));
  expect(ua.getPublicKey().toString('base64url')).toBe(RFC.uaPublic);

  const body = encrypt(Buffer.from(RFC.plain, 'utf8'), {
    salt: Buffer.from(RFC.salt, 'base64url'),
    asPrivate: Buffer.from(RFC.asPrivate, 'base64url'),
    asPublic: Buffer.from(RFC.asPublic, 'base64url'),
    uaPublic: Buffer.from(RFC.uaPublic, 'base64url'),
    authSecret: Buffer.from(RFC.auth, 'base64url'),
  });
  expect(body.toString('base64url')).toBe(RFC.body);
});

it('signs a VAPID token the push service can check', () => {
  const vapid = pair();
  const now = new Date('2026-10-31T00:00:00Z');
  const header = vapidHeader({ aud: 'https://fcm.googleapis.com', vapid, sub: 'mailto:ops@example.com', now });

  const said = /^vapid t=([^,]+), k=(.+)$/.exec(header);
  expect(said).not.toBeNull();
  const token = said?.[1] ?? '';
  expect(said?.[2]).toBe(vapid.publicKey);

  const [head, claims, signature] = token.split('.');
  expect(JSON.parse(Buffer.from(head ?? '', 'base64url').toString('utf8'))).toEqual({ typ: 'JWT', alg: 'ES256' });
  const payload = JSON.parse(Buffer.from(claims ?? '', 'base64url').toString('utf8')) as { aud: string; exp: number; sub: string };
  expect(payload).toMatchObject({ aud: 'https://fcm.googleapis.com', sub: 'mailto:ops@example.com' });
  expect(payload.exp).toBe(Math.floor(now.getTime() / 1000) + 12 * 60 * 60);

  const checked = verify('sha256', Buffer.from(`${head ?? ''}.${claims ?? ''}`, 'utf8'), {
    key: createPublicKey(vapid.privateKey),
    dsaEncoding: 'ieee-p1363',
  }, Buffer.from(signature ?? '', 'base64url'));
  expect(checked).toBe(true);
});

/** One request, as the stub service recorded it. */
interface Sent {
  url: string;
  headers: Headers;
  body: Buffer;
  redirect: RequestInit['redirect'];
}

/** A service that answers one status, and records what it was asked. */
const service = (status: number) => {
  const calls: Sent[] = [];
  const request = (async (input: unknown, init?: RequestInit) => {
    calls.push({ url: String(input), headers: new Headers(init?.headers), body: Buffer.from(init?.body as Uint8Array), redirect: init?.redirect });
    return new Response('', { status });
  }) as unknown as typeof fetch;
  return { calls, request };
};

/** The keys a subscription gave: the RFC's own user agent point, and a 16-octet secret. */
const UA_PUBLIC = RFC.uaPublic;
const UA_AUTH = Buffer.alloc(16, 0x22).toString('base64url');

/** One message about `session`, waiting on a person unless `kind` says otherwise. */
const message = (session: string, kind = 'chatInput') => ({
  id: 'browser-1',
  endpoint: 'https://fcm.googleapis.com/wp/one',
  keys: { p256dh: UA_PUBLIC, auth: UA_AUTH },
  title: 'Echo',
  body: 'A session is waiting for your answer',
  data: { uri: session, kind },
  session,
  urgency: kind === 'turnComplete' ? ('normal' as const) : ('high' as const),
});

it('posts a sealed message with the headers a push service reads', async () => {
  const { calls, request } = service(201);
  const logged: string[] = [];
  const sender = createWebSender({ log: (line) => { logged.push(line); }, gone: () => {}, vapid: pair(), request });
  await sender.send([message('echo:/one')]);

  expect(logged).toEqual([]);
  expect(calls).toHaveLength(1);
  const sent = calls[0] as Sent;
  expect(sent.url).toBe('https://fcm.googleapis.com/wp/one');
  expect(sent.headers.get('content-encoding')).toBe('aes128gcm');
  expect(sent.headers.get('content-type')).toBe('application/octet-stream');
  expect(sent.headers.get('ttl')).toBe('2419200');
  expect(sent.headers.get('urgency')).toBe('high');
  expect(sent.headers.get('topic')).toBe(createHash('sha256').update('echo:/one', 'utf8').digest('base64url').slice(0, 32));
  expect(sent.headers.get('authorization')).toMatch(/^vapid t=[^,]+, k=[A-Za-z0-9_-]+$/);

  // The record is the salt, the record size, the key id and one sealed record.
  expect(sent.body.subarray(16, 20).readUInt32BE(0)).toBe(4096);
  expect(sent.body[20]).toBe(65);
  expect(sent.body[21]).toBe(0x04);
});

it('sends a finished turn with normal urgency', async () => {
  const { calls, request } = service(201);
  const sender = createWebSender({ log: () => {}, gone: () => {}, vapid: pair(), request });
  await sender.send([message('echo:/one', 'turnComplete')]);
  expect(calls[0]?.headers.get('urgency')).toBe('normal');
});

it('removes a device its push service answers 410 for, and keeps one it answers 500 for', async () => {
  const gone: string[] = [];
  const logged: string[] = [];
  const sender = createWebSender({
    log: (line) => { logged.push(line); },
    gone: (id) => { gone.push(id); },
    vapid: pair(),
    request: service(410).request,
  });
  await sender.send([message('echo:/one')]);
  expect(gone).toEqual(['browser-1']);
  expect(logged).toHaveLength(1);
  expect(logged[0]).toContain('browser-1');

  const kept: string[] = [];
  const other = createWebSender({
    log: () => {},
    gone: (id) => { kept.push(id); },
    vapid: pair(),
    request: service(500).request,
  });
  await other.send([message('echo:/one')]);
  expect(kept).toEqual([]);
});

it('removes a device its push service answers 404 for', async () => {
  const gone: string[] = [];
  const sender = createWebSender({ log: () => {}, gone: (id) => { gone.push(id); }, vapid: pair(), request: service(404).request });
  await sender.send([message('echo:/one')]);
  expect(gone).toEqual(['browser-1']);
});

it('logs a message it cannot seal, and still sends the next one', async () => {
  const { calls, request } = service(201);
  const logged: string[] = [];
  const sender = createWebSender({ log: (line) => { logged.push(line); }, gone: () => {}, vapid: pair(), request });
  // 65 octets that start as an uncompressed point and are not on the curve.
  const bad = { ...message('echo:/one'), id: 'browser-0', keys: { p256dh: Buffer.concat([Buffer.from([0x04]), Buffer.alloc(64, 7)]).toString('base64url'), auth: UA_AUTH } };
  await expect(sender.send([bad, message('echo:/one')])).resolves.toBeUndefined();
  expect(logged).toHaveLength(1);
  expect(logged[0]).toContain('browser-0');
  expect(calls).toHaveLength(1);
});

it('refuses to follow a redirect', async () => {
  const { calls, request } = service(201);
  const sender = createWebSender({ log: () => {}, gone: () => {}, vapid: pair(), request });
  await sender.send([message('echo:/one')]);
  expect(calls[0]?.redirect).toBe('error');
});

it('refuses an endpoint on a host the provider does not allow', async () => {
  const where = dir();
  const provider = pushProvider({ store: deviceStore(where, () => {}), webPushHosts: ['fcm.googleapis.com', '*.push.apple.com'] });
  const write = (endpoint: string) => provider.write('push://devices/browser-1', {
    data: JSON.stringify({ platform: 'web', endpoint, keys: { p256dh: UA_PUBLIC, auth: UA_AUTH } }),
    encoding: 'utf-8',
  });

  await expect(write('https://evil.example/wp/one')).rejects.toMatchObject({ code: -32602 });
  await expect(write('https://push.apple.com/wp/one')).rejects.toMatchObject({ code: -32602 });
  await write('https://web.push.apple.com/wp/one');
  await write('https://fcm.googleapis.com/wp/one');
});
