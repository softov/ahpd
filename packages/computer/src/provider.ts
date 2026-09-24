import { RpcError } from '@ahpd/sdk';
import type { Entry, Metadata, Read, ResourceProvider, SchemeDescription, Write } from '@ahpd/sdk';
import { MANIFEST_SCHEMA, manifestOf } from './manifest.js';
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
    manifest: MANIFEST_SCHEMA({ runtime: runtime.kind, image: options.image }),
  }, null, 2);

  /** One machine's two files, as listing entries. */
  const leaves = (): Entry[] => [
    { name: 'status', type: 'file' },
    { name: 'capabilities', type: 'file' },
  ];

  const asFile = (data: string): Read =>
    ({ data, encoding: 'utf-8', contentType: 'application/json' });

  return {
    describe: (): SchemeDescription => ({
      title: 'Computer',
      description: 'A machine a session can run in.',
      manifest: MANIFEST_SCHEMA({ runtime: runtime.kind, image: options.image }),
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
      const body = held.leaf === 'status' ? JSON.stringify(found, null, 2) : capabilities();
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
      if (held.id === '' || !isDirectory(held)) {
        throw new RpcError(-32602, `${uri} is not a name for a new computer; write to computer://<name>`);
      }
      const spec = manifestOf(held.id, content, {
        runtime: runtime.kind,
        image: options.image,
        ...(options.cpus === undefined ? {} : { cpus: options.cpus }),
        ...(options.memory === undefined ? {} : { memory: options.memory }),
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
