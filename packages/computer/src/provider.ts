import { RpcError } from '@ahpd/sdk';
import type { Entry, Metadata, Read, ResourceProvider } from '@ahpd/sdk';
import type { ComputerRuntime } from './runtime.js';

/**
 * The `computer:` scheme, read-only.
 *
 * A machine is a directory with two files in it: `status`, which is the
 * runtime's own record of it, and `capabilities`, which is what this host can
 * be asked for. The root lists what exists.
 *
 * Nothing here is written. A machine is made, used and released by a tool,
 * because a resource write carries a URI and a mode and can express neither an
 * image nor a limit - decision `a-machine-is-made-by-a-host-tool`.
 */

/** What the provider was configured with, which `capabilities` reports. */
export interface ProviderOptions {
  /** The image a machine is made from when a call names none. */
  image: string;
  cpus?: string;
  memory?: string;
  /** How many this provider will have at once. */
  max: number;
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
  }, null, 2);

  /** One machine's two files, as listing entries. */
  const leaves = (): Entry[] => [
    { name: 'status', type: 'file' },
    { name: 'capabilities', type: 'file' },
  ];

  const asFile = (data: string): Read =>
    ({ data, encoding: 'utf-8', contentType: 'application/json' });

  return {
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

    /*
     * Nothing above, and nothing below: no `watch`, because a machine's record
     * changes when the runtime says so and this provider is asked rather than
     * told, and no write half, because a machine is made by a tool.
     */
  };
}
