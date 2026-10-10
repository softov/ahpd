/**
 * One directory of records, served as a resource scheme.
 *
 * The four schemes of `people.ts` and the one of `policy.ts` are this provider
 * over a different store: a record is a file whose bytes are its JSON, the
 * scheme's root is a directory of them, and there is no leaf under a record and
 * no directory but the root. The URI and the body are read once here and what a
 * record is made of is the store's own business, which is what `Records`
 * separates - so a person and a policy are served by one set of rules rather
 * than two that have to be kept in step.
 *
 * The split, the refusal, the file answer and the body decoder are also what
 * `computer` and `usage` take, because both read a URI, refuse one that names
 * nothing and answer a read with JSON. Neither is a directory of records, so
 * each keeps its own leaves and asks for these parts rather than the provider.
 */

import { INVALID_PARAMS, RpcError } from './rpc.js';
import type { Entry, Metadata, Read, ResourceProvider, SchemeDescription, Write } from './types/resources.js';

/**
 * What one of these providers implements.
 *
 * Narrower than `ResourceProvider`, whose members are all but `read` optional:
 * each of these schemes has all of them, so a caller holding one should not
 * have to test for what is always there.
 */
export interface RecordsProvider extends ResourceProvider {
  list(uri: string): Promise<Entry[]>;
  resolve(uri: string, followSymlinks?: boolean): Promise<Metadata>;
  read(uri: string, wanted?: string): Promise<Read>;
  write(uri: string, content: Write): Promise<void>;
  remove(uri: string, recursive?: boolean): Promise<void>;
  describe(): SchemeDescription;
}

/**
 * One scheme's records, as five questions about them.
 *
 * Every scheme answers the same five, so nothing below the interface has to
 * know which one it is serving: the URI and the body are read once, and what a
 * record is made of is the scheme's own business.
 */
export interface Records {
  /** What the scheme is called on screen. */
  readonly title: string;
  /** One line about what a record is. */
  readonly description: string;
  /** The body a write to the scheme's root makes something from. */
  readonly manifest: Record<string, unknown>;
  /** Every record's id, in the order the file lists them. */
  ids(): Promise<string[]>;
  /** One record as it stands, or nothing when the directory holds none. */
  find(id: string): Promise<Record<string, unknown> | undefined>;
  /**
   * Name one, or edit the one already there.
   *
   * `was` is the record the provider read before this write, when it read one:
   * a scheme whose row is a whole document merged with the body needs the row
   * that is there, and the provider has already read it to answer `createOnly`.
   */
  put(id: string, body: Record<string, unknown>, was?: Record<string, unknown>): Promise<void>;
  /** Take one out. `true` when one was there. */
  drop(id: string): Promise<boolean>;
}

/** A URI, split into the record it names, the leaf under it and what it asked. */
export interface At {
  /** The record's id, empty at the root. */
  id: string;
  /** Empty for every record here, because nothing is under one. */
  leaf: string;
  /** The text after `?`, which no scheme here reads and `usage` does. */
  query: string;
}

/**
 * Where a URI points, or a refusal saying which scheme it is not.
 *
 * One reader for every scheme, so `x://a/b?q=1` is read the same way wherever
 * it arrives: the id is the first path segment, the leaf is the rest and the
 * query is everything after the mark. A URI of another scheme, or one with no
 * `//`, is `-32602` - a client that asked the wrong door, not a resource that
 * is missing - and the sentence names the scheme it should have used.
 */
export const splitResource = (uri: string, scheme: string): At => {
  const match = /^([a-zA-Z][\w+.-]*):\/\/(.*)$/.exec(uri);
  if (match === null || match[1] !== scheme) throw new RpcError(INVALID_PARAMS, `${uri} is not a ${scheme}: URI`);
  const rest = match[2] ?? '';
  const mark = rest.indexOf('?');
  const path = mark === -1 ? rest : rest.slice(0, mark);
  const slash = path.indexOf('/');
  return {
    id: slash === -1 ? path : path.slice(0, slash),
    leaf: slash === -1 ? '' : path.slice(slash + 1),
    query: mark === -1 ? '' : rest.slice(mark + 1),
  };
};

/** A URI naming nothing under this scheme, as the refusal every scheme gives. */
export const absentResource = (scheme: string, uri: string): RpcError =>
  new RpcError(-32008, `No ${scheme} resource at ${uri}`);

/** A record as a client reads it: its JSON, indented, as every other scheme writes one. */
export const asFile = (data: string): Read =>
  ({ data, encoding: 'utf-8', contentType: 'application/json' });

/** A write body as text, whatever encoding it arrived in. */
export const bodyText = (content: Write): string =>
  (content.encoding === 'base64' ? Buffer.from(content.data, 'base64').toString('utf8') : content.data);

/**
 * A write's body, decoded and parsed, or a refusal saying what a body is.
 *
 * An empty body is an empty object rather than a refusal, so a client that
 * writes nothing to name a record means exactly that. `what` is what the
 * sentence calls the record, so a client reading a refusal reads the scheme's
 * own word for it.
 */
export const jsonBody = (content: Write, what: string): Record<string, unknown> => {
  const text = bodyText(content);
  let parsed: unknown;
  try {
    parsed = JSON.parse(text === '' ? '{}' : text);
  }
  catch {
    throw new RpcError(INVALID_PARAMS, `A ${what} is made from a JSON object; that body is not one`);
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new RpcError(INVALID_PARAMS, `A ${what} is made from a JSON object, and that body is not one`);
  }
  return parsed as Record<string, unknown>;
};

/** One manifest field that is a line of text, as a form draws a box to type into. */
export const line = (title: string, description: string): Record<string, unknown> =>
  ({ type: 'string', title, description });

/** One manifest field that is a list of text, as a form draws a row of them. */
export const lines = (title: string, description: string): Record<string, unknown> =>
  ({ type: 'array', title, description, items: { type: 'string' } });

/**
 * When a record was made, which none of these directories keeps.
 *
 * A file holds no timestamp for a person, a team, a role or a policy, and
 * inventing one - the time of this read - would be a client told a record
 * changed when nothing did. `usage` is the same: a pool is charged rather than
 * made, and a pool nothing has been charged to has no moment at all. The epoch
 * is the answer every store without a clock gives.
 */
export const EPOCH = '1970-01-01T00:00:00.000Z';

/**
 * One scheme's records, as the resource calls a client already uses.
 *
 * A refusal the directory made is said as the call's own: every rule behind
 * `Records` is the port's, so the sentence a client gets here is the one it
 * would get from the command of the same name - this is another door onto the
 * same directory, not a second set of rules.
 */
export const recordsProvider = (scheme: string, records: Records): RecordsProvider => {
  const description: SchemeDescription = {
    title: records.title,
    description: records.description,
    manifest: records.manifest,
  };

  return {
    describe: () => description,

    list: async (uri) => {
      const at = splitResource(uri, scheme);
      if (at.leaf !== '') throw absentResource(scheme, uri);
      if (at.id !== '') throw new RpcError(-32008, `${uri} is a ${scheme}; list ${scheme}://`);
      return (await records.ids()).map((one): Entry => ({ name: one, type: 'file' }));
    },

    resolve: async (uri) => {
      const at = splitResource(uri, scheme);
      if (at.id === '') return { uri, type: 'directory', mtime: EPOCH, ctime: EPOCH } as Metadata;
      if (at.leaf !== '') throw absentResource(scheme, uri);
      const body = JSON.stringify(await records.find(at.id), null, 2);
      /*
       * `size` is the body that was there, or the body that would be: a URI
       * naming no record still has the shape of one, which is what a client
       * drawing a form before it asks for anything needs to know.
       */
      return {
        uri,
        type: 'file',
        size: Buffer.byteLength(body ?? '', 'utf8'),
        // No etag. `ifMatch` would then be a validator nothing computed, and a
        // stale one is worse than none for a record whose whole value is a read.
        mtime: EPOCH,
        ctime: EPOCH,
      } as Metadata;
    },

    read: async (uri) => {
      const at = splitResource(uri, scheme);
      if (at.id === '') throw new RpcError(-32008, `${uri} is the ${scheme} directory; read ${scheme}://<id>`);
      if (at.leaf !== '') throw absentResource(scheme, uri);
      const held = await records.find(at.id);
      if (held === undefined) throw absentResource(scheme, uri);
      return asFile(JSON.stringify(held, null, 2));
    },

    /**
     * A record is made or edited here, and the URI is its id.
     *
     * The same body either way, because a record is written whole: a field the
     * body does not name is the one the record already had, and a client that
     * read a record and wrote it back has changed nothing. The row that is
     * there is read once, and the store is handed it so a scheme that merges
     * does not have to read it again.
     */
    write: async (uri, content) => {
      const at = splitResource(uri, scheme);
      if (at.id === '') throw new RpcError(INVALID_PARAMS, `${uri} is not a name for a new ${scheme}; write to ${scheme}://<id>`);
      if (at.leaf !== '') throw new RpcError(INVALID_PARAMS, `${uri} is not something to write; a ${scheme} is written whole, at ${scheme}://<id>`);
      const was = await records.find(at.id);
      // `createOnly` is the protocol's own word for refusing one that is there.
      if (content.createOnly === true && was !== undefined) {
        throw new RpcError(-32010, `${at.id} is already a ${scheme}; edit it or choose another id`);
      }
      await records.put(at.id, jsonBody(content, scheme), was);
    },

    /**
     * A record is taken out here.
     *
     * Refused while something still names it - a membership naming a team, a
     * record holding a role - and it says who, which is the refusal the command
     * of the same name makes.
     */
    remove: async (uri) => {
      const at = splitResource(uri, scheme);
      if (at.id === '') throw new RpcError(INVALID_PARAMS, `${uri} is the ${scheme} directory; remove ${scheme}://<id>`);
      if (at.leaf !== '') throw absentResource(scheme, uri);
      if (!await records.drop(at.id)) throw absentResource(scheme, uri);
    },
  };
};
