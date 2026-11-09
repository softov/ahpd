import { createCipheriv, createECDH, createHash, hkdfSync, randomBytes, sign } from 'node:crypto';
import { reason } from '@ahpd/sdk';
import type { Vapid } from './vapid.js';
import type { LogLevel } from '@ahpd/sdk';

/**
 * Web Push, as this plugin sends it.
 *
 * A message to a browser is one request to the endpoint its subscription gave.
 * The body is RFC 8291: the payload sealed with AES-128-GCM under a key both
 * ends derive from an ECDH secret, the browser's own authentication secret and
 * a salt, and wrapped in the RFC 8188 `aes128gcm` record the service passes
 * through without reading. The request is signed with the host's VAPID pair,
 * which is what tells the push service which host is sending.
 *
 * Everything here fails quietly, as the Expo sender does: a service that is
 * down or refuses a message is one line to the daemon's log. The one answer
 * worth acting on is 404 or 410, which says the subscription is gone and the
 * device with it.
 *
 * `node:crypto` alone is enough for both halves, which is why the package has
 * no runtime dependency: `createECDH`, `hkdfSync`, `aes-128-gcm` and an ES256
 * signature in `ieee-p1363` are the whole of what the protocol needs.
 */

/** The record size of the content coding, which RFC 8291 section 4 fixes. */
const RECORD_SIZE = 4096;

/**
 * How long a push service keeps a message for a browser that is not connected,
 * in seconds: four weeks, the web-push library's default.
 * https://github.com/web-push-libs/web-push/blob/master/src/web-push-lib.js
 */
export const TTL = 2_419_200;

/** The delimiter that says a record is the last of a message. */
const LAST_RECORD = 0x02;

/** The value of `Content-Encoding` for a message encrypted this way. */
export const CONTENT_ENCODING = 'aes128gcm';

/** What one message is encrypted with. */
export interface EncryptOptions {
  /** The salt of one message, which is fresh for each and which the key derives from. */
  salt: Buffer;
  /** The application server's private scalar, 32 octets. */
  asPrivate: Buffer;
  /** The application server's public point, 65 octets. */
  asPublic: Buffer;
  /** The user agent's public point, 65 octets. */
  uaPublic: Buffer;
  /** The user agent's authentication secret, 16 octets. */
  authSecret: Buffer;
  /** The record size, where it is not the 4096 RFC 8291 names. */
  recordSize?: number;
}

/**
 * One message, sealed for a subscription.
 *
 * The steps are RFC 8291 sections 3.3 and 3.4: derive the shared secret, mix in
 * the browser's authentication secret and both public keys to get the input key
 * material, then derive the content key and nonce from that with the salt. The
 * result is the RFC 8188 header - salt, record size, key id and the application
 * server's public point - followed by one record.
 */
export const encrypt = (plaintext: Buffer, options: EncryptOptions): Buffer => {
  const recordSize = options.recordSize ?? RECORD_SIZE;

  const ecdh = createECDH('prime256v1');
  ecdh.setPrivateKey(options.asPrivate);
  const shared = ecdh.computeSecret(options.uaPublic);

  const authInfo = Buffer.concat([Buffer.from('WebPush: info\0', 'utf8'), options.uaPublic, options.asPublic]);
  const ikm = Buffer.from(hkdfSync('sha256', shared, options.authSecret, authInfo, 32));
  const cek = Buffer.from(hkdfSync('sha256', ikm, options.salt, Buffer.from('Content-Encoding: aes128gcm\0', 'utf8'), 16));
  const nonce = Buffer.from(hkdfSync('sha256', ikm, options.salt, Buffer.from('Content-Encoding: nonce\0', 'utf8'), 12));

  const cipher = createCipheriv('aes-128-gcm', cek, nonce);
  const sealed = Buffer.concat([
    cipher.update(Buffer.concat([plaintext, Buffer.from([LAST_RECORD])])),
    cipher.final(),
    cipher.getAuthTag(),
  ]);

  const header = Buffer.alloc(16 + 4 + 1 + options.asPublic.length);
  options.salt.copy(header, 0);
  header.writeUInt32BE(recordSize, 16);
  header.writeUInt8(options.asPublic.length, 20);
  options.asPublic.copy(header, 21);
  return Buffer.concat([header, sealed]);
};

/** What one VAPID header is signed from. */
export interface VapidSignOptions {
  /** The origin of the endpoint, which is the JWT's audience. */
  aud: string;
  /** The pair to sign with. */
  vapid: Vapid;
  /** A contact URI, sent as the `sub` claim where the host names one. */
  sub?: string;
  /** The clock, which a test may fix. */
  now?: Date;
}

/** How long a VAPID JWT is good for. */
const VAPID_LIFETIME = 12 * 60 * 60;

/**
 * The `Authorization` header of one request.
 *
 * RFC 8292 section 3.2: a JWT signed with ES256 over the host's key pair, and
 * the public key beside it so the push service can check the signature.
 */
export const vapidHeader = (options: VapidSignOptions): string => {
  const now = options.now ?? new Date();
  const exp = Math.floor(now.getTime() / 1000) + VAPID_LIFETIME;
  const head = Buffer.from(JSON.stringify({ typ: 'JWT', alg: 'ES256' }), 'utf8').toString('base64url');
  const claims = Buffer.from(JSON.stringify({
    aud: options.aud,
    exp,
    ...(options.sub === undefined ? {} : { sub: options.sub }),
  }), 'utf8').toString('base64url');
  const unsigned = `${head}.${claims}`;
  const signature = sign('sha256', Buffer.from(unsigned, 'utf8'), { key: options.vapid.privateKey, dsaEncoding: 'ieee-p1363' });
  return `vapid t=${unsigned}.${Buffer.from(signature).toString('base64url')}, k=${options.vapid.publicKey}`;
};

/** One notification, as a browser's subscription takes it. */
export interface WebMessage {
  /** The device this is for, which a gone answer removes. */
  id: string;
  /** The subscription's endpoint. */
  endpoint: string;
  /** The subscription's keys, as base64url. */
  keys: { p256dh: string; auth: string };
  /** What the browser draws above the text. */
  title: string;
  /** The text itself. */
  body: string;
  /** What the service worker reads when the notification is opened. */
  data: Record<string, unknown>;
  /** The session this is about, whose hash is the `Topic`. */
  session: string;
  /** How the service should treat the message: a wait is high, a finished turn normal. */
  urgency: 'high' | 'normal';
}

/** What a web sender is built with. */
export interface WebSendOptions {
  /** One line per failure, for the daemon's log. */
  log(line: string, level?: LogLevel): void;
  /** A device whose subscription a push service no longer knows. */
  gone(id: string): void;
  /** The host's key pair, which every request is signed with. */
  vapid: Vapid;
  /** A contact URI sent as the VAPID `sub` claim. */
  contact?: string;
  /** The request function, which is `fetch` unless a test says otherwise. */
  request?: typeof fetch;
  /** The clock, which a test may fix. */
  now?: () => Date;
  /** The salt of one message, which a test may fix. */
  salt?: () => Buffer;
  /** The key pair one message is encrypted with, which a test may fix. */
  pair?: () => { privateKey: Buffer; publicKey: Buffer };
}

/** Sends to browsers, one request each. */
export interface WebSender {
  send(messages: WebMessage[]): Promise<void>;
}

/** The `Topic` header: the session's hash, cut to the 32 characters a topic holds. */
const topicOf = (session: string): string => createHash('sha256').update(session, 'utf8').digest('base64url').slice(0, 32);

/** A fresh key pair for one message, as the two values `encrypt` takes. */
const ephemeral = (): { privateKey: Buffer; publicKey: Buffer } => {
  const pair = createECDH('prime256v1');
  pair.generateKeys();
  return { privateKey: pair.getPrivateKey(), publicKey: pair.getPublicKey() };
};

/**
 * A sender over the push services a host's browsers subscribed to.
 *
 * Each message is its own request, because each is sealed for one subscription
 * and none of them share a key. A message that fails is logged and the next one
 * still goes out; this never throws.
 */
export const createWebSender = (options: WebSendOptions): WebSender => {
  const request = options.request ?? fetch;
  const now = options.now ?? (() => new Date());
  const salt = options.salt ?? (() => randomBytes(16));
  const pair = options.pair ?? ephemeral;

  const sendOne = async (message: WebMessage): Promise<void> => {
    let aud: string;
    try {
      aud = new URL(message.endpoint).origin;
    }
    catch (error) {
      options.log(`${message.id} has an endpoint that is not a URL: ${reason(error)}`, 'warn');
      return;
    }

    let sealed: Buffer;
    let authorization: string;
    try {
      const keys = pair();
      const payload = Buffer.from(JSON.stringify({ title: message.title, body: message.body, data: message.data }), 'utf8');
      sealed = encrypt(payload, {
        salt: salt(),
        asPrivate: keys.privateKey,
        asPublic: keys.publicKey,
        uaPublic: Buffer.from(message.keys.p256dh, 'base64url'),
        authSecret: Buffer.from(message.keys.auth, 'base64url'),
      });
      authorization = vapidHeader({
        aud,
        vapid: options.vapid,
        ...(options.contact === undefined ? {} : { sub: options.contact }),
        now: now(),
      });
    }
    catch (error) {
      options.log(`a message for ${message.id} could not be sealed: ${reason(error)}`, 'error');
      return;
    }

    let response: Response;
    try {
      response = await request(message.endpoint, {
        method: 'POST',
        // A redirect could lead to a host that `webPushHosts` does not allow.
        redirect: 'error',
        headers: {
          authorization,
          'content-encoding': CONTENT_ENCODING,
          'content-type': 'application/octet-stream',
          ttl: String(TTL),
          urgency: message.urgency,
          topic: topicOf(message.session),
        },
        body: sealed,
      });
    }
    catch (error) {
      options.log(`the push service could not be reached for ${message.id}: ${reason(error)}`, 'error');
      return;
    }

    // RFC 8030 section 7.3: 404 and 410 say the subscription is gone.
    if (response.status === 404 || response.status === 410) {
      options.log(`the push service no longer knows ${message.id}; the device was removed`);
      options.gone(message.id);
      return;
    }
    if (!response.ok) options.log(`the push service answered ${response.status} for ${message.id}`, 'warn');
  };

  return {
    send: async (messages) => {
      for (const message of messages) await sendOne(message);
    },
  };
};
