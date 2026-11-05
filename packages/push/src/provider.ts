import { ECDH, createHash } from 'node:crypto';
import { join } from 'node:path';
import { RpcError, absentResource, bodyText, readJsonObject, splitResource, writeJsonAtomic } from '@ahpd/sdk';
import type { Entry, Metadata, Owner, Principal, Read, ResourceProvider, SchemeDescription, Write } from '@ahpd/sdk';
import type { Vapid } from './vapid.js';

/**
 * The devices a host pushes to, served as a resource scheme.
 *
 * A registration is a record under `push://devices/<install id>`: a client
 * writes one with the protocol's own `resourceWrite` and takes it out with
 * `resourceDelete`, which is the whole of the seam. A phone registers an Expo
 * token; a browser registers the subscription its push service gave it, an
 * endpoint and the two keys a message to it is encrypted with.
 *
 * What a record holds is the platform it belongs to, the person and client it
 * was registered by, and, when a device asked for a language, that language.
 * The client is the host's, as the connection named it, and the body cannot
 * name it: a device with no setting hears the sessions of the client that
 * opened the session or, when its person is the session's owner, the person's.
 *
 * The devices are one JSON file under the daemon's own configuration folder,
 * written whole and read at load, because a token and a subscription are
 * credentials to that device's notifications and nothing else on the machine
 * has business in them. The host's VAPID key pair is read the same way and
 * served read-only at `push://vapid`, which is where a browser takes the public
 * key its subscription is made for.
 */

/** The scheme this provider serves. */
export const SCHEME = 'push';

/** The one segment under the scheme's root: every device is under it. */
const DEVICES = 'devices';

/** The read-only record that holds the host's VAPID public key. */
const VAPID = 'vapid';

/**
 * The push services of Safari, Chrome, Firefox and Edge.
 *
 * An endpoint comes from a client, and a host that sent to any address a client
 * named would be a host that can be told to make a request anywhere. A pattern
 * of `*.<domain>` matches every host under that domain.
 */
export const WEB_PUSH_HOSTS = [
  '*.push.apple.com',
  'fcm.googleapis.com',
  'updates.push.services.mozilla.com',
  '*.notify.windows.com',
] as const;

/** The part of a registration both kinds of device share. */
interface Kept {
  /**
   * The language the device asked for, where the client named one.
   *
   * Kept as the device gave it and read by nobody yet: a notification is worded
   * in English, and this is what a sender that words one per device would read.
   */
  lang?: string;
  /**
   * The client that registered it, as it gave its id at `initialize`.
   *
   * Absent when the connection that wrote it never introduced itself, which is
   * a device kept and sent nothing: what a device hears is the sessions of the
   * client that registered it.
   */
  client?: string;
  /**
   * The person the registration was written for, as the host named them.
   *
   * Absent on a host with no users directory, and on a connection that is
   * neither a person nor the root one. A device with no person hears only the
   * sessions of its own client, because nobody else's sessions can be shown to
   * be its person's.
   */
  owner?: Owner;
  /**
   * Which sessions it hears about. Absent means `person`.
   *
   * The person's sessions are every session whose owner the host names the
   * same, plus every session this device's own client created or opened.
   */
  audience?: Audience;
}

/** A phone or a tablet, which Expo reaches through its token. */
export interface ExpoDevice extends Kept {
  /** The Expo push token. */
  token: string;
  /** Which service the token belongs to. */
  platform: 'ios' | 'android';
}

/** The two keys a browser's subscription is encrypted with, as base64url. */
export interface SubscriptionKeys {
  /** The browser's public key, 65 octets: the uncompressed P-256 point. */
  p256dh: string;
  /** The 16-octet authentication secret the browser made with it. */
  auth: string;
}

/** A browser, which its push service reaches through the subscription's endpoint. */
export interface WebDevice extends Kept {
  /** Which service the subscription belongs to. */
  platform: 'web';
  /** The capability URL the push service accepts a message at. */
  endpoint: string;
  /** The keys a message to this subscription is encrypted with. */
  keys: SubscriptionKeys;
}

/** One device, as it was registered. */
export type Device = ExpoDevice | WebDevice;

/** The body a write to the scheme's root makes a device from. */
const EXPO_BODY = {
  type: 'object',
  required: ['token', 'platform'],
  properties: {
    token: { type: 'string', description: 'The Expo push token this device answers to.' },
    platform: { type: 'string', enum: ['ios', 'android'], description: 'Which service the token belongs to.' },
    lang: { type: 'string', description: 'The language the device asked for, kept with it. Notifications are worded in English.' },
    audience: { type: 'string', enum: ['person', 'device'], description: 'Which sessions the device hears about. Every session of its person unless this says device.' },
  },
  additionalProperties: false,
} as const;

const WEB_BODY = {
  type: 'object',
  required: ['platform', 'endpoint', 'keys'],
  properties: {
    platform: { type: 'string', enum: ['web'], description: 'A browser, reached through its push service.' },
    endpoint: { type: 'string', description: 'The endpoint a subscription gave, at an https address of a push service the host allows.' },
    keys: {
      type: 'object',
      required: ['p256dh', 'auth'],
      properties: {
        p256dh: { type: 'string', description: 'The browser public key, the 65-octet uncompressed point in base64url.' },
        auth: { type: 'string', description: 'The 16-octet authentication secret in base64url.' },
      },
      additionalProperties: false,
    },
    lang: { type: 'string', description: 'The language the device asked for, kept with it. Notifications are worded in English.' },
    audience: { type: 'string', enum: ['person', 'device'], description: 'Which sessions the device hears about. Every session of its person unless this says device.' },
  },
  additionalProperties: false,
} as const;

const MANIFEST = {
  oneOf: [EXPO_BODY, WEB_BODY],
} as const;

/**
 * Which sessions a device hears about.
 *
 * `person` is every session its person created or opened, and `device` is only
 * the ones the client that registered it created or opened. A device without a
 * setting is a `person` device, which is what a registration written before
 * this setting existed becomes.
 */
export type Audience = 'person' | 'device';

/**
 * The devices one daemon keeps.
 *
 * Read once, when the daemon starts, and written through from then on - the way
 * every other store here is kept.
 */
export interface DeviceStore {
  /** Every device's id, in the order the file lists them. */
  ids(): string[];
  /** One device, or nothing when the id has none. */
  get(id: string): Device | undefined;
  /** Keep one device, replacing what the id held. */
  put(id: string, device: Device): void;
  /** Take one out. `true` when one was there. */
  remove(id: string): boolean;
}

/**
 * Where one URI points, or the refusal a URI of another scheme is owed.
 *
 * The scheme's root, the `devices` directory under it, a device under that, and
 * the one read-only record beside `devices`. Anything deeper names nothing, and
 * a URI of another scheme is a client that asked the wrong door rather than a
 * resource that is missing - which is what `splitResource` answers and why it is
 * used here rather than a regular expression of this file's own.
 */
type Place =
  | { at: 'root' }
  | { at: 'devices' }
  | { at: 'device'; id: string }
  | { at: 'vapid' };

const placeOf = (uri: string): Place => {
  const held = splitResource(uri, SCHEME);
  if (held.id === '' && held.leaf === '') return { at: 'root' };
  if (held.id === DEVICES && held.leaf === '') return { at: 'devices' };
  if (held.id === DEVICES && held.leaf !== '' && !held.leaf.includes('/')) return { at: 'device', id: held.leaf };
  if (held.id === VAPID && held.leaf === '') return { at: 'vapid' };
  throw absentResource(SCHEME, uri);
};

/** One file's bytes, as a client reads a record: its JSON, indented. */
const asFile = (data: string): Read => ({ data, encoding: 'utf-8', contentType: 'application/json' });

/**
 * What a read of one device answers: everything but what reaches it.
 *
 * A token is write-only, because it is a credential to the device's
 * notifications and a role that may read `push:` is not the device. A web
 * subscription's endpoint and keys are the same kind of secret: the endpoint is
 * a capability URL and the keys are what a message to it is sealed with.
 */
const shownOf = (device: Device): Record<string, unknown> => {
  if (device.platform === 'web') {
    const { endpoint: _endpoint, keys: _keys, ...shown } = device;
    return shown;
  }
  const { token: _token, ...shown } = device;
  return shown;
};

/**
 * A device's version token, which a write's `ifMatch` is checked against.
 *
 * The hash of the record as it is kept, token and keys included, so a device
 * registered again with a rotated token has a new one; the digest does not
 * give the credential back.
 */
const etagOf = (device: Device): string =>
  createHash('sha256').update(JSON.stringify(device), 'utf8').digest('base64url');

/** Whether a string is base64url, which is how both browser keys arrive. */
const BASE64URL = /^[A-Za-z0-9_-]+={0,2}$/;

/** Whether `key` is an uncompressed P-256 point, the only key RFC 8291 seals a message for. */
const isPoint = (key: Buffer): boolean => {
  if (key.length !== 65 || key[0] !== 0x04) return false;
  try {
    ECDH.convertKey(key, 'prime256v1');
    return true;
  }
  catch {
    return false;
  }
};

/** The two keys of a subscription, or nothing when what was there is not a pair of them. */
const keysOf = (said: unknown): SubscriptionKeys | undefined => {
  if (typeof said !== 'object' || said === null || Array.isArray(said)) return undefined;
  const one = said as Record<string, unknown>;
  const p256dh = one['p256dh'];
  const auth = one['auth'];
  if (typeof p256dh !== 'string' || !BASE64URL.test(p256dh)) return undefined;
  if (typeof auth !== 'string' || !BASE64URL.test(auth)) return undefined;
  if (!isPoint(Buffer.from(p256dh, 'base64url'))) return undefined;
  if (Buffer.from(auth, 'base64url').length !== 16) return undefined;
  return { p256dh, auth };
};

/** The fields of a registration both kinds of device keep, as they were found. */
const keptCommon = (one: Record<string, unknown>): Kept => {
  const lang = one['lang'];
  const client = one['client'];
  const owner = one['owner'];
  const audience = one['audience'];
  return {
    ...(typeof lang === 'string' ? { lang } : {}),
    ...(typeof client === 'string' ? { client } : {}),
    ...(typeof owner === 'string' && owner !== '' ? { owner: owner as Owner } : {}),
    ...(audience === 'person' || audience === 'device' ? { audience } : {}),
  };
};

/** A device read back from the file, or nothing when what was there is not one. */
const kept = (said: unknown): Device | undefined => {
  if (typeof said !== 'object' || said === null || Array.isArray(said)) return undefined;
  const one = said as Record<string, unknown>;
  const common = keptCommon(one);
  const platform = one['platform'];
  if (platform === 'ios' || platform === 'android') {
    const token = one['token'];
    if (typeof token !== 'string' || token === '') return undefined;
    return { token, platform, ...common };
  }
  if (platform === 'web') {
    const endpoint = one['endpoint'];
    const keys = keysOf(one['keys']);
    if (typeof endpoint !== 'string' || endpoint === '' || keys === undefined) return undefined;
    return { platform, endpoint, keys, ...common };
  }
  return undefined;
};

/**
 * The devices under one configuration folder.
 *
 * `onProblem` is told about each record that could not be used, one line each,
 * and the store keeps everything else. A file that is there and is not JSON is
 * said without the parser's own words, because what it choked on is a push
 * token and a token is a credential.
 */
export const deviceStore = (configDir: string, onProblem: (line: string) => void): DeviceStore => {
  const file = join(configDir, 'push-devices.json');
  const devices = new Map<string, Device>();

  const read = readJsonObject(file);
  if (read.ok) {
    for (const [id, said] of Object.entries(read.value)) {
      const one = kept(said);
      if (one === undefined) {
        onProblem(`${file}: ${id} is not a device; its registration was left out`);
        continue;
      }
      devices.set(id, one);
    }
  }
  else if (read.kind === 'unreadable') {
    onProblem(`${file} could not be read (${read.code ?? 'unknown'}); no device is registered`);
  }
  else if (read.kind === 'not-json') {
    onProblem(`${file} is not JSON; no device is registered`);
  }
  else if (read.kind === 'not-object') {
    onProblem(`${file} does not hold an object; no device is registered`);
  }

  /** Written whole, beside itself and renamed over, at a mode only its owner may read. */
  const written = (): void => { writeJsonAtomic(file, Object.fromEntries(devices)); };

  return {
    ids: () => [...devices.keys()],
    get: (id) => devices.get(id),
    put: (id, device) => {
      devices.set(id, device);
      written();
    },
    remove: (id) => {
      const gone = devices.delete(id);
      if (gone) written();
      return gone;
    },
  };
};

/** What a provider is built from. */
export interface PushProviderOptions {
  /** Where the devices are kept. */
  store: DeviceStore;
  /** The host's VAPID pair, when it has one, whose public key is served at `push://vapid`. */
  vapid?: Vapid;
  /** The hosts a browser's endpoint may be at. The default is every push service of a major browser. */
  webPushHosts?: readonly string[];
}

/**
 * One of these providers, with every member of the scheme it needs.
 *
 * Narrower than `ResourceProvider`, whose members but `read` are optional: this
 * scheme has all of them, so a caller holding one should not have to test for
 * what is always there.
 */
export interface PushProvider extends ResourceProvider {
  list(uri: string): Promise<Entry[]>;
  resolve(uri: string, followSymlinks?: boolean): Promise<Metadata>;
  read(uri: string, wanted?: string): Promise<Read>;
  write(uri: string, content: Write, owner?: Owner, client?: string, reader?: Principal): Promise<void>;
  remove(uri: string, recursive?: boolean, owner?: Owner, reader?: Principal): Promise<void>;
  describe(): SchemeDescription;
}

/** Whether a host matches one of a list of patterns, where `*.<domain>` matches every host under it. */
const hostAllowed = (host: string, patterns: readonly string[]): boolean => {
  const said = host.toLowerCase();
  return patterns.some((pattern) => {
    const held = pattern.trim().toLowerCase();
    if (held === '') return false;
    return held.startsWith('*.') ? said.endsWith(held.slice(1)) : said === held;
  });
};

/** The device a write's body describes, or the refusal a body that is not one is owed. */
const deviceOf = (uri: string, content: Write, webPushHosts: readonly string[]): Device => {
  let said: unknown;
  try {
    said = JSON.parse(bodyText(content));
  }
  catch {
    throw new RpcError(-32602, `${uri} is made from JSON, an object with a token or a subscription`);
  }
  if (typeof said !== 'object' || said === null || Array.isArray(said)) {
    throw new RpcError(-32602, `${uri} is made from a JSON object, with a token or a subscription`);
  }
  const body = said as Record<string, unknown>;

  const lang = body['lang'];
  if (lang !== undefined && (typeof lang !== 'string' || lang.trim() === '')) {
    throw new RpcError(-32602, `${uri} has a lang that is not a language`);
  }
  const audience = body['audience'];
  if (audience !== undefined && audience !== 'person' && audience !== 'device') {
    throw new RpcError(-32602, `${uri} has an audience of person or device`);
  }
  const common: Kept = {
    ...(typeof lang === 'string' ? { lang } : {}),
    ...(audience === 'person' || audience === 'device' ? { audience } : {}),
  };

  const platform = body['platform'];
  if (platform === 'ios' || platform === 'android') {
    const token = body['token'];
    if (typeof token !== 'string' || token.trim() === '') {
      throw new RpcError(-32602, `${uri} needs a token: a device is registered with its push token`);
    }
    return { token, platform, ...common };
  }

  if (platform === 'web') {
    const endpoint = body['endpoint'];
    if (typeof endpoint !== 'string' || endpoint.trim() === '') {
      throw new RpcError(-32602, `${uri} needs an endpoint: a browser is registered with its subscription`);
    }
    let address: URL;
    try {
      address = new URL(endpoint);
    }
    catch {
      throw new RpcError(-32602, `${uri} has an endpoint that is not a URL`);
    }
    if (address.protocol !== 'https:') {
      throw new RpcError(-32602, `${uri} has an endpoint that is not https`);
    }
    if (!hostAllowed(address.hostname, webPushHosts)) {
      throw new RpcError(-32602, `${uri} has an endpoint at ${address.hostname}, which is not a push service this host allows`);
    }
    const keys = keysOf(body['keys']);
    if (keys === undefined) {
      throw new RpcError(-32602, `${uri} needs keys: the browser's p256dh of 65 octets and auth of 16, in base64url`);
    }
    return { platform, endpoint, keys, ...common };
  }

  throw new RpcError(-32602, `${uri} needs a platform of ios, android or web`);
};

/**
 * The `push:` scheme, over the devices one daemon keeps.
 *
 * The root and the `devices` directory are readable and nothing else: a write
 * names a device, and a device is written whole, so there is nothing to make
 * under the root and nothing under a device.
 */
export const pushProvider = (options: PushProviderOptions): PushProvider => {
  const { store, vapid } = options;
  const webPushHosts = options.webPushHosts ?? WEB_PUSH_HOSTS;
  const description: SchemeDescription = {
    title: 'Push',
    description: 'The devices a host tells when a session needs a person, and the public key a browser subscribes with.',
    manifest: MANIFEST,
  };

  /** The one record beside `devices`: the public key of the host's pair. */
  const vapidFile = (): string => JSON.stringify({ publicKey: vapid?.publicKey ?? '' }, null, 2);

  return {
    describe: () => description,

    list: async (uri) => {
      const place = placeOf(uri);
      if (place.at === 'root') {
        return [
          { name: DEVICES, type: 'directory' },
          ...(vapid === undefined ? [] : [{ name: VAPID, type: 'file' as const }]),
        ];
      }
      if (place.at === 'devices') return store.ids().map((id): Entry => ({ name: id, type: 'file' }));
      throw absentResource(SCHEME, uri);
    },

    /**
     * What one place is, as the spec's `resourceResolve` answers it.
     *
     * A device that is not registered is `NotFound`, which the spec makes a
     * MUST over any success standing in for one. The file keeps no times, so
     * none is answered: the spec gives `mtime` and `ctime` only when known.
     * https://github.com/microsoft/agent-host-protocol/blob/spec/v1.0.0/types/common/commands.ts#L1022-L1024
     */
    resolve: async (uri) => {
      const place = placeOf(uri);
      if (place.at === 'vapid') {
        if (vapid === undefined) throw absentResource(SCHEME, uri);
        return { uri, type: 'file', size: Buffer.byteLength(vapidFile(), 'utf8') };
      }
      if (place.at !== 'device') return { uri, type: 'directory' };
      const held = store.get(place.id);
      if (held === undefined) throw absentResource(SCHEME, uri);
      return {
        uri,
        type: 'file',
        size: Buffer.byteLength(JSON.stringify(shownOf(held), null, 2), 'utf8'),
        etag: etagOf(held),
      };
    },

    read: async (uri) => {
      const place = placeOf(uri);
      if (place.at === 'vapid') {
        if (vapid === undefined) throw absentResource(SCHEME, uri);
        return asFile(vapidFile());
      }
      if (place.at !== 'device') throw absentResource(SCHEME, uri);
      const held = store.get(place.id);
      if (held === undefined) throw absentResource(SCHEME, uri);
      return asFile(JSON.stringify(shownOf(held), null, 2));
    },

    /**
     * A device is registered here, and re-registered here.
     *
     * The body is the token and the platform, or a browser's endpoint and keys;
     * the client id is not the body's to name but the connection's, which is
     * what makes a device the property of the client that wrote it. `createOnly`
     * is the protocol's own word for refusing a device that is already there,
     * and it is honoured because a client that asked for it is a client that
     * did not mean to overwrite a sibling's registration. `ifMatch` is the
     * other: a device whose version token is not the one named is refused
     * `Conflict`, and so is one that is not there, because the caller believed
     * it held the token of one that is, as VS Code's file resources refuse it.
     * The public key and the scheme's two directories are no device, and a
     * write to one is `PermissionDenied` in those resources' words.
     * https://github.com/microsoft/agent-host-protocol/blob/spec/v1.0.0/types/common/commands.ts#L724-L726
     * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/resourceProviders/fileSystemResources.ts#L201-L207
     */
    write: async (uri, content, owner, client) => {
      const place = placeOf(uri);
      if (place.at !== 'device') throw new RpcError(-32009, `Permission denied: ${uri}`);
      const held = store.get(place.id);
      if (content.createOnly === true && held !== undefined) {
        throw new RpcError(-32010, `${place.id} is already a device here; edit it or choose another id`);
      }
      if (content.ifMatch !== undefined && (held === undefined || etagOf(held) !== content.ifMatch)) {
        throw new RpcError(-32011, `ifMatch precondition failed for: ${uri}`);
      }
      const device = deviceOf(uri, content, webPushHosts);
      store.put(place.id, {
        ...device,
        ...(client === undefined || client === '' ? {} : { client }),
        ...(owner === undefined ? {} : { owner }),
      });
    },

    /**
     * A device is taken out here.
     *
     * The other road that changes what this scheme holds, and the one a client
     * takes when a person turns notifications off, so it is a device's whole id
     * or nothing: there are no children to take with a flag. The public key
     * and the two directories are `PermissionDenied`, as a write to them is.
     */
    remove: async (uri) => {
      const place = placeOf(uri);
      if (place.at !== 'device') throw new RpcError(-32009, `Permission denied: ${uri}`);
      if (!store.remove(place.id)) throw absentResource(SCHEME, uri);
    },
  };
};
