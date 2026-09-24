import { RpcError } from '@ahpd/sdk';
import type { Entry, Metadata, Read, ResourceProvider, SchemeDescription, Write } from '@ahpd/sdk';
import { bodyText, MANIFEST_SCHEMA, manifestOf } from './manifest.js';
import type { Profile } from './manifest.js';
import type { ComputerRuntime } from './runtime.js';

/**
 * The `computer:` scheme.
 *
 * A machine is a directory with two files in it: `status`, which is the
 * runtime's own record of it, and `capabilities`, which is what this host can
 * be asked for. The root lists what exists.
 *
 * A write to `computer://<name>` makes one and a delete destroys it, which is
 * the person's route: the body is a JSON manifest and the URI is the name -
 * decision `the-computer-is-an-object-a-person-manages`. The three tools still
 * exist for a model, marked as needing advanced permission.
 */

/** What the provider was configured with, which `capabilities` reports. */
export interface ProviderOptions {
  /** The image a machine is made from when a call names none. */
  image: string;
  cpus?: string;
  memory?: string;
  /** How many this provider will have at once. */
  max: number;
  /** The label every machine this provider made carries. */
  label: string;
  /** Mounts every machine this provider makes carries, before the body's own. */
  mounts?: string[];
  /** The named sets a create body may pick from, by key. */
  profiles?: Record<string, Profile>;
  /** Whether a create body may name mounts of its own. Off unless an operator says so. */
  bodyMounts?: boolean;
}

/**
 * What this provider implements.
 *
 * Narrower than `ResourceProvider`, whose four read methods are optional: this
 * one has three of them and a caller holding it should not have to test for
 * what is always there.
 */
export interface ComputerProvider extends ResourceProvider {
  list(uri: string): Promise<Entry[]>;
  resolve(uri: string, followSymlinks?: boolean): Promise<Metadata>;
  read(uri: string, wanted?: string): Promise<Read>;
  write(uri: string, content: Write): Promise<void>;
  remove(uri: string, recursive?: boolean): Promise<void>;
  describe(): SchemeDescription;
}

/** A URI, split into the machine it names and the leaf under it. */
interface At {
  /** The machine's name, empty at the root. */
  id: string;
  /** `status`, `capabilities`, or empty for the machine itself. */
  leaf: string;
}

const split = (uri: string): At | undefined => {
  const match = /^([a-zA-Z][\w+.-]*):\/\/(.*)$/.exec(uri);
  if (match === null || match[1] !== 'computer') return undefined;
  const rest = match[2] ?? '';
  const slash = rest.indexOf('/');
  return slash === -1
    ? { id: rest, leaf: '' }
    : { id: rest.slice(0, slash), leaf: rest.slice(slash + 1) };
};

const absent = (uri: string): RpcError =>
  new RpcError(-32008, `No computer resource at ${uri}`);

/** A machine's directory, or the file under it. */
const isDirectory = (at: At): boolean => at.leaf === '';

const at = (uri: string): At => {
  const held = split(uri);
  if (held === undefined) throw new RpcError(-32009, `${uri} is not a computer: URI`);
  return held;
};

/** When a machine or a leaf was made, as a URI's metadata wants it. */
const moment = (created: string | undefined): string => {
  if (created === undefined) return new Date(0).toISOString();
  const when = new Date(created);
  return Number.isNaN(when.getTime()) ? new Date(0).toISOString() : when.toISOString();
};

export function computerProvider(runtime: ComputerRuntime, options: ProviderOptions): ComputerProvider {
  const capabilities = (): string => JSON.stringify({
    ...runtime.capabilities(),
    defaultImage: options.image,
    limits: {
      ...(options.cpus === undefined ? {} : { cpus: options.cpus }),
      ...(options.memory === undefined ? {} : { memory: options.memory }),
    },
    max: options.max,
    /*
     * The create body, as the schema `describe` advertises too, so what a
     * client reads here and what it reads off the handshake cannot drift.
     */
    manifest: MANIFEST_SCHEMA({
      runtime: runtime.kind,
      image: options.image,
      ...(options.profiles === undefined ? {} : { profiles: options.profiles }),
      ...(options.bodyMounts === undefined ? {} : { bodyMounts: options.bodyMounts }),
    }),
  }, null, 2);

  /** One machine's files, as listing entries. */
  const leaves = (): Entry[] => [
    { name: 'status', type: 'file' },
    { name: 'capabilities', type: 'file' },
    { name: 'stats', type: 'file' },
    { name: 'state', type: 'file' },
  ];

  /**
   * What a machine is using, with the cores it was limited to.
   *
   * The runtime reports a percentage of one core's time, which says nothing on
   * its own: 150% is busy on two cores and impossible on one. `NanoCpus` is
   * what the machine was actually given, so it travels beside the number a
   * gauge is drawn from.
   *
   * A machine that is not running has no usage, and that is an empty body
   * rather than zeroes - a dial reading zero says idle, which is not the same
   * as stopped.
   */
  /**
   * What a machine is doing, as one word a client can also write back.
   *
   * A resource scheme has four verbs and none of them is `restart`, so the
   * action is a *write to what the machine is*: reading `state` answers
   * `running` or `stopped`, and writing one of `running`, `stopped` or
   * `restarted` puts it there. That keeps starting a machine inside the same
   * `computer:write` grant that makes and destroys one, with no new method for
   * a gate to be taught about - decision `a-grant-is-a-subject-and-a-verb`.
   */
  const STATES = ['running', 'stopped', 'restarted'] as const;

  /*
   * Answered in the words the write takes, not the runtime's own.
   *
   * It used to answer `docker`'s status, which is a longer vocabulary than the
   * three below: a client that read `exited` and wrote it back was refused its
   * own reading. The runtime's word is not lost - `status` is its whole record
   * and `State.Status` is in it - but this leaf is the one a client round-trips,
   * so it says only what it will accept.
   */
  const stateOf = (found: Record<string, unknown>): string => {
    const state = (typeof found.State === 'object' && found.State !== null
      ? found.State
      : {}) as Record<string, unknown>;
    return state.Running === true ? 'running' : 'stopped';
  };

  const statsOf = async (id: string, found: Record<string, unknown>): Promise<string> => {
    const used = await runtime.stats(id);
    if (used === undefined) return JSON.stringify({ running: false }, null, 2);
    const host = (typeof found.HostConfig === 'object' && found.HostConfig !== null
      ? found.HostConfig
      : {}) as Record<string, unknown>;
    const nano = typeof host.NanoCpus === 'number' && host.NanoCpus > 0 ? host.NanoCpus : undefined;
    return JSON.stringify({
      running: true,
      ...used,
      cpu: { ...used.cpu, ...(nano === undefined ? {} : { cores: nano / 1e9 }) },
    }, null, 2);
  };

  const asFile = (data: string): Read =>
    ({ data, encoding: 'utf-8', contentType: 'application/json' });

  return {
    describe: (): SchemeDescription => ({
      title: 'Computer',
      description: 'A machine a session can run in.',
      manifest: MANIFEST_SCHEMA({
        runtime: runtime.kind,
        image: options.image,
        ...(options.profiles === undefined ? {} : { profiles: options.profiles }),
        ...(options.bodyMounts === undefined ? {} : { bodyMounts: options.bodyMounts }),
      }),
    }),

    list: async (uri) => {
      const held = at(uri);
      if (!isDirectory(held)) throw absent(uri);
      if (held.id === '') {
        return (await runtime.list()).map((one) => ({ name: one.id, type: 'directory' as const }));
      }
      // A machine that is not there is not a directory either.
      if (await runtime.inspect(held.id) === undefined) throw absent(uri);
      return leaves();
    },

    resolve: async (uri) => {
      const held = at(uri);
      if (held.id === '') {
        return { uri, type: 'directory', mtime: moment(undefined), ctime: moment(undefined) };
      }
      const found = await runtime.inspect(held.id);
      if (found === undefined) throw absent(uri);
      const created = moment(typeof found.Created === 'string' ? found.Created : undefined);
      if (isDirectory(held)) {
        return { uri, type: 'directory', mtime: created, ctime: created };
      }
      if (!leaves().some((one) => one.name === held.leaf)) throw absent(uri);
      const body = held.leaf === 'status' ? JSON.stringify(found, null, 2)
        : held.leaf === 'stats' ? await statsOf(held.id, found)
          : held.leaf === 'state' ? `${stateOf(found)}\n`
            : capabilities();
      return {
        uri,
        type: 'file',
        size: Buffer.byteLength(body, 'utf8'),
        mtime: created,
        ctime: created,
      };
    },

    read: async (uri) => {
      const held = at(uri);
      if (isDirectory(held)) {
        throw new RpcError(-32008, `${uri} is a directory; read ${uri}/status`);
      }
      const found = await runtime.inspect(held.id);
      if (found === undefined) throw absent(uri);
      if (held.leaf === 'status') return asFile(JSON.stringify(found, null, 2));
      if (held.leaf === 'capabilities') return asFile(capabilities());
      if (held.leaf === 'stats') return asFile(await statsOf(held.id, found));
      if (held.leaf === 'state') {
        return { data: `${stateOf(found)}\n`, encoding: 'utf-8', contentType: 'text/plain' };
      }
      throw absent(uri);
    },

    /**
     * A machine is made here.
     *
     * The body is the manifest and the URI is the name, so a client that
     * writes twice with `createOnly` gets `-32010` and one that writes over a
     * machine without it is refused the same way: a machine is not a file and
     * has nothing to splice.
     */
    write: async (uri, content) => {
      const held = at(uri);
      /*
       * A write to `state` acts on the machine rather than making one.
       *
       * Checked before the name check below, because `computer://box/state` is
       * a leaf and not a name for a new machine: without this it would be
       * refused as a bad name, which says nothing about what was asked.
       */
      if (held.leaf === 'state') {
        if (await runtime.inspect(held.id) === undefined) throw absent(uri);
        const said = bodyText(content).trim().toLowerCase();
        if (!STATES.includes(said as typeof STATES[number])) {
          throw new RpcError(-32602, `A computer's state is one of ${STATES.join(', ')}, and that body says ${said || 'nothing'}`);
        }
        if (said === 'running') await runtime.start(held.id);
        else if (said === 'stopped') await runtime.stop(held.id);
        else await runtime.restart(held.id);
        return;
      }
      if (held.leaf !== '') throw new RpcError(-32602, `${uri} is not something to write; write to computer://<name> or computer://<name>/state`);
      if (held.id === '' || !isDirectory(held)) {
        throw new RpcError(-32602, `${uri} is not a name for a new computer; write to computer://<name>`);
      }
      const spec = manifestOf(held.id, content, {
        runtime: runtime.kind,
        image: options.image,
        ...(options.cpus === undefined ? {} : { cpus: options.cpus }),
        ...(options.memory === undefined ? {} : { memory: options.memory }),
        ...(options.mounts === undefined ? {} : { mounts: options.mounts }),
        ...(options.profiles === undefined ? {} : { profiles: options.profiles }),
        ...(options.bodyMounts === undefined ? {} : { bodyMounts: options.bodyMounts }),
      });
      if (await runtime.inspect(held.id) !== undefined) {
        throw new RpcError(-32010, `${held.id} is already a computer; destroy it or choose another name`);
      }
      const existing = await runtime.list();
      if (existing.length >= options.max) {
        throw new RpcError(-32602, `This host holds ${options.max} computers already, and ${held.id} would be one more`);
      }
      try {
        await runtime.run({ ...spec, label: options.label });
      }
      catch (error) {
        throw new RpcError(-32603, error instanceof Error ? error.message : String(error));
      }
    },

    /**
     * A machine is destroyed here.
     *
     * A leaf under a machine is not a thing to delete, and the root is a
     * listing: both are refused rather than passed to the runtime as a name.
     */
    remove: async (uri) => {
      const held = at(uri);
      if (held.id === '' || !isDirectory(held)) {
        throw new RpcError(-32602, `${uri} is not a computer to destroy; delete computer://<name>`);
      }
      if (await runtime.inspect(held.id) === undefined) throw absent(uri);
      try {
        await runtime.remove(held.id);
      }
      catch (error) {
        throw new RpcError(-32603, error instanceof Error ? error.message : String(error));
      }
    },
  };
}
