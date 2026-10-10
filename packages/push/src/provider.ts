import { join } from 'node:path';
import { RpcError, absentResource, bodyText, readJsonObject, splitResource, writeJsonAtomic } from '@ahpd/sdk';
import type { Entry, Metadata, Owner, Principal, Read, ResourceProvider, SchemeDescription, Write } from '@ahpd/sdk';

/**
 * The devices a host pushes to, served as a resource scheme.
 *
 * A registration is a record under `push://devices/<install id>`: a client
 * writes one with the protocol's own `resourceWrite` and takes it out with
 * `resourceDelete`, which is the whole of the seam - decision
 * `a-device-registers-for-push-by-writing-a-resource`.
 *
 * What a record holds is the push token, the platform it belongs to and, when
 * a device asked for a language, that language. It also holds the id of the
 * client that registered it, which the host hands a provider's `write` and the
 * body cannot name: a notification goes to the devices of the client that
 * created or opened a session, so a device written by a connection that never
 * introduced itself is kept and matches no session.
 *
 * The devices are one JSON file under the daemon's own configuration folder,
 * written whole and read at load, because a token is a credential to that
 * device's notifications and nothing else on the machine has business in it.
 */

/** The scheme this provider serves. */
export const SCHEME = 'push';

/** The one segment under the scheme's root: every device is under it. */
const DEVICES = 'devices';

/**
 * When a device was registered, which this file does not keep.
 *
 * A record here is a token and a platform rather than a thing with a history,
 * and answering this read's own clock would tell a client a device changed when
 * nothing did. The epoch is the answer every store without a clock gives.
 */
const EPOCH = '1970-01-01T00:00:00.000Z';

/** The body a write to the scheme's root makes a device from. */
const MANIFEST = {
  type: 'object',
  required: ['token', 'platform'],
  properties: {
    token: { type: 'string', description: 'The Expo push token this device answers to.' },
    platform: { type: 'string', enum: ['ios', 'android'], description: 'Which service the token belongs to.' },
    lang: { type: 'string', description: 'The language the device asked for, kept with it. Notifications are worded in English.' },
  },
  additionalProperties: false,
} as const;

/** One device, as it was registered. */
export interface Device {
  /** The Expo push token. */
  token: string;
  /** Which service the token belongs to. */
  platform: 'ios' | 'android';
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
}

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
 * Three places and no leaves: the scheme's root, the `devices` directory under
 * it, and a device under that. Anything deeper names nothing, and a URI of
 * another scheme is a client that asked the wrong door rather than a resource
 * that is missing - which is what `splitResource` answers and why it is used
 * here rather than a regular expression of this file's own.
 */
type Place =
  | { at: 'root' }
  | { at: 'devices' }
  | { at: 'device'; id: string };

const placeOf = (uri: string): Place => {
  const held = splitResource(uri, SCHEME);
  if (held.id === '' && held.leaf === '') return { at: 'root' };
  if (held.id === DEVICES && held.leaf === '') return { at: 'devices' };
  if (held.id === DEVICES && held.leaf !== '' && !held.leaf.includes('/')) return { at: 'device', id: held.leaf };
  throw absentResource(SCHEME, uri);
};

/** One file's bytes, as a client reads a record: its JSON, indented. */
const asFile = (data: string): Read => ({ data, encoding: 'utf-8', contentType: 'application/json' });

/**
 * A device as a read answers it: everything but the token.
 *
 * The token is write-only, because it is a credential to the device's
 * notifications and a role that may read `push:` is not the device.
 */
const shownOf = (device: Device): Omit<Device, 'token'> => {
  const { token: _token, ...shown } = device;
  return shown;
};

/** A device read back from the file, or nothing when what was there is not one. */
const kept = (said: unknown): Device | undefined => {
  if (typeof said !== 'object' || said === null || Array.isArray(said)) return undefined;
  const one = said as Record<string, unknown>;
  const token = one['token'];
  if (typeof token !== 'string' || token === '') return undefined;
  const platform = one['platform'];
  if (platform !== 'ios' && platform !== 'android') return undefined;
  const lang = one['lang'];
  const client = one['client'];
  return {
    token,
    platform,
    ...(typeof lang === 'string' ? { lang } : {}),
    ...(typeof client === 'string' ? { client } : {}),
  };
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

/** The device a write's body describes, or the refusal a body that is not one is owed. */
const deviceOf = (uri: string, content: Write): Device => {
  let said: unknown;
  try {
    said = JSON.parse(bodyText(content));
  }
  catch {
    throw new RpcError(-32602, `${uri} is made from JSON, an object with a token and a platform`);
  }
  if (typeof said !== 'object' || said === null || Array.isArray(said)) {
    throw new RpcError(-32602, `${uri} is made from a JSON object, with a token and a platform`);
  }
  const body = said as Record<string, unknown>;
  const token = body['token'];
  if (typeof token !== 'string' || token.trim() === '') {
    throw new RpcError(-32602, `${uri} needs a token: a device is registered with its push token`);
  }
  const platform = body['platform'];
  if (platform !== 'ios' && platform !== 'android') {
    throw new RpcError(-32602, `${uri} needs a platform of ios or android`);
  }
  const lang = body['lang'];
  if (lang !== undefined && (typeof lang !== 'string' || lang.trim() === '')) {
    throw new RpcError(-32602, `${uri} has a lang that is not a language`);
  }
  return { token, platform, ...(typeof lang === 'string' ? { lang } : {}) };
};

/**
 * The `push:` scheme, over the devices one daemon keeps.
 *
 * The root and the `devices` directory are readable and nothing else: a write
 * names a device, and a device is written whole, so there is nothing to make
 * under the root and nothing under a device.
 */
export const pushProvider = (options: PushProviderOptions): PushProvider => {
  const { store } = options;
  const description: SchemeDescription = {
    title: 'Push',
    description: 'The devices a host tells when a session needs a person.',
    manifest: MANIFEST,
  };

  return {
    describe: () => description,

    list: async (uri) => {
      const place = placeOf(uri);
      if (place.at === 'root') return [{ name: DEVICES, type: 'directory' }];
      if (place.at === 'devices') return store.ids().map((id): Entry => ({ name: id, type: 'file' }));
      throw absentResource(SCHEME, uri);
    },

    /**
     * A device that is not there still has the shape of one.
     *
     * What a client drawing a registration form needs before it writes
     * anything, and the same answer the records of `people` and `policy` give:
     * the URI names a device whether or not one has been registered under it
     * yet, and a write is what makes the difference.
     */
    resolve: async (uri) => {
      const place = placeOf(uri);
      if (place.at !== 'device') return { uri, type: 'directory', mtime: EPOCH, ctime: EPOCH } as Metadata;
      const held = store.get(place.id);
      const body = held === undefined ? '' : JSON.stringify(shownOf(held), null, 2);
      return {
        uri,
        type: 'file',
        size: Buffer.byteLength(body, 'utf8'),
        // No etag: a device is registered whole and re-registering one is how a
        // rotated token arrives, so there is no lost update to guard against.
        mtime: EPOCH,
        ctime: EPOCH,
      } as Metadata;
    },

    read: async (uri) => {
      const place = placeOf(uri);
      if (place.at !== 'device') throw absentResource(SCHEME, uri);
      const held = store.get(place.id);
      if (held === undefined) throw absentResource(SCHEME, uri);
      return asFile(JSON.stringify(shownOf(held), null, 2));
    },

    /**
     * A device is registered here, and re-registered here.
     *
     * The body is the token and the platform; the client id is not the body's
     * to name but the connection's, which is what makes a device the property
     * of the client that wrote it. `createOnly` is the protocol's own word for
     * refusing a device that is already there, and it is honoured because a
     * client that asked for it is a client that did not mean to overwrite a
     * sibling's registration.
     */
    write: async (uri, content, _owner, client) => {
      const place = placeOf(uri);
      if (place.at !== 'device') {
        throw new RpcError(-32602, `${uri} is not a device; write to ${SCHEME}://${DEVICES}/<id>`);
      }
      const held = store.get(place.id);
      if (content.createOnly === true && held !== undefined) {
        throw new RpcError(-32010, `${place.id} is already a device here; edit it or choose another id`);
      }
      const device = deviceOf(uri, content);
      store.put(place.id, { ...device, ...(client === undefined || client === '' ? {} : { client }) });
    },

    /**
     * A device is taken out here.
     *
     * The other road that changes what this scheme holds, and the one a client
     * takes when a person turns notifications off, so it is a device's whole id
     * or nothing: there are no children to take with a flag.
     */
    remove: async (uri) => {
      const place = placeOf(uri);
      if (place.at !== 'device') {
        throw new RpcError(-32602, `${uri} is not a device to delete; delete ${SCHEME}://${DEVICES}/<id>`);
      }
      if (!store.remove(place.id)) throw absentResource(SCHEME, uri);
    },
  };
};
