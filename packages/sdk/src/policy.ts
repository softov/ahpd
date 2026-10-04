/**
 * The `policy:` scheme.
 *
 * One URI is one row and the scheme's root is a directory of them, exactly as
 * `people.ts` serves `user:`, `team:`, `project:` and `role:` - decision
 * `policies-are-a-scheme-clients-edit`. A client edits policies the way it edits
 * people: it reads the manifest, draws a form, writes a body and reads it back.
 *
 * This is another door onto the `Policies` port, not a second set of rules. A
 * body the port would refuse is refused here with the same sentence, because
 * `checkPolicy` is what the port itself calls.
 *
 * Whether a row binds is not this scheme's business: a host is told to check
 * through `policiesCheck`, and `decide` does the checking.
 */

import { checkPolicy } from './policies.js';
import { RpcError } from './rpc.js';
import type { Entry, Metadata, Read, ResourceProvider, SchemeDescription, Write } from './types/resources.js';
import type { Policies } from './types/policies.js';

/** The scheme, which is also its grant subject. */
const SCHEMES = ['policy'] as const;

/** What this provider implements: all of `ResourceProvider`'s members but nothing optional. */
export interface PolicyProvider extends ResourceProvider {
  list(uri: string): Promise<Entry[]>;
  resolve(uri: string, followSymlinks?: boolean): Promise<Metadata>;
  read(uri: string, wanted?: string): Promise<Read>;
  write(uri: string, content: Write): Promise<void>;
  remove(uri: string, recursive?: boolean): Promise<void>;
  describe(): SchemeDescription;
}

/** A URI, split into the row it names and the leaf under it. */
interface At {
  /** The row's id, empty at the root. */
  id: string;
  /** Empty for every row here, because nothing is under one. */
  leaf: string;
}

const splitFor = (scheme: Scheme) => (uri: string): At => {
  const match = /^([a-zA-Z][\w+.-]*):\/\/(.*)$/.exec(uri);
  if (match === null || match[1] !== scheme) throw new RpcError(-32609, `${uri} is not a ${scheme}: URI`);
  const rest = match[2] ?? '';
  const slash = rest.indexOf('/');
  return slash === -1 ? { id: rest, leaf: '' } : { id: rest.slice(0, slash), leaf: rest.slice(slash + 1) };
};

/** One of the schemes, which is also its grant subject. */
type Scheme = typeof SCHEMES[number];

/**
 * When a row was written, which this directory does not keep.
 *
 * The store holds no timestamp for a policy, and inventing one would be a
 * client told a row changed when nothing did.
 */
const moment = '1970-01-01T00:00:00.000Z';

/** One manifest field that is a line of text. */
const line = (title: string, description: string): Record<string, unknown> =>
  ({ type: 'string', title, description });

/** One manifest field that is a list of text. */
const lines = (title: string, description: string): Record<string, unknown> =>
  ({ type: 'array', title, description, items: { type: 'string' } });

/** The row a read answers with: its JSON, indented, as every other scheme writes one. */
const asFile = (data: string): Read =>
  ({ data, encoding: 'utf-8', contentType: 'application/json' });

const TITLE = 'Policies';
const ABOUT = 'Who may use which agent, model and computer, and how much.';

const manifest: Record<string, unknown> = {
  type: 'object',
  properties: {
    scope: line('Scope', 'Who the row is about: `all`, `user:<id>`, `team:<id>` or `project:<team>:<project>`.'),
    kind: line('Kind', 'What it is about: `model` for a proxy call, `agent` for a harness this host runs, `computer` for a machine.'),
    effect: line('Effect', '`allow` or `deny`. Any matching deny wins over any allow.'),
    match: {
      title: 'Match',
      description: 'What it applies to. Values of one type are alternatives and values of different types must all hold. A type left out allows any value of it.',
      type: 'object',
      properties: {
        model: lines('Models', '`<maker>/<name>`, where `*` stands for any run of characters within the value.'),
        proxy: lines('Proxies', 'Which provider the model may be called through. `model` rows only.'),
        agent: lines('Agents', 'The harness, as `claude`, `pi`, `cofold` or `acp:<server>`.'),
        computer: lines('Computers', 'The machine, as the `computers` port names it.'),
      },
    },
    limits: {
      title: 'Limits',
      description: 'How much may be used. Every limit must have room.',
      type: 'array',
      items: {
        type: 'object',
        properties: {
          amount: { type: 'number', minimum: 0, title: 'Amount', description: 'How much, in the measure. Never negative.' },
          measure: line('Measure', '`usd`, `tokens`, `calls`, `turns`, `hours` or `sessions`, of the ones the kind takes.'),
          period: line('Period', '`day`, `week`, `month` or `total`.'),
          pool: line('Pool', '`shared` for one total for the group, `each` for one per member.'),
        },
      },
    },
    pool: line('Pool', 'A name several rows draw from one total under.'),
    cap: { type: 'boolean', title: 'Cap', description: 'Count usage without charging it.' },
    from: line('From', 'When the row starts, as an ISO 8601 instant or a `YYYY-MM-DD` day.'),
    until: line('Until', 'When the row ends, as an ISO 8601 instant or a `YYYY-MM-DD` day. A bare day includes all of it.'),
  },
  required: ['scope', 'kind', 'effect', 'match'],
};

const description: SchemeDescription = { title: TITLE, description: ABOUT, manifest };

/** The provider for one store, under one scheme. */
const providerFor = (store: Policies, scheme: Scheme): PolicyProvider => {
  const split = splitFor(scheme);
  const absent = (uri: string): RpcError => new RpcError(-32008, `No ${scheme} resource at ${uri}`);

  return {
    describe: () => description,

    list: async (uri) => {
      const at = split(uri);
      if (at.leaf !== '') throw absent(uri);
      // A row is written whole, so there is nothing under one to list.
      if (at.id !== '') throw new RpcError(-32008, `${uri} is a ${scheme}; list ${scheme}://`);
      return (await store.list()).map((one): Entry => ({ name: one.id, type: 'file' }));
    },

    resolve: async (uri) => {
      const at = split(uri);
      if (at.id === '') return { uri, type: 'directory', mtime: moment, ctime: moment } as Metadata;
      if (at.leaf !== '') throw absent(uri);
      /*
       * `size` is the body that is there, or the body that would be: a URI
       * naming no row still has the shape of one, which is what a client
       * drawing a form before it asks for anything needs to know. No etag -
       * `people.ts` says why.
       */
      const body = JSON.stringify(await store.get(at.id), null, 2);
      return {
        uri,
        type: 'file',
        size: Buffer.byteLength(body ?? '', 'utf8'),
        mtime: moment,
        ctime: moment,
      } as Metadata;
    },

    read: async (uri) => {
      const at = split(uri);
      if (at.id === '') throw new RpcError(-32008, `${uri} is the ${scheme} directory; read ${scheme}://<id>`);
      if (at.leaf !== '') throw absent(uri);
      const held = await store.get(at.id);
      if (held === undefined) throw absent(uri);
      return asFile(JSON.stringify(held, null, 2));
    },

    write: async (uri, content) => {
      const at = split(uri);
      // The URI is the id, so a write to the root names nothing.
      if (at.id === '') throw new RpcError(-32602, `${uri} is not a name for a new ${scheme}; write to ${scheme}://<id>`);
      if (at.leaf !== '') throw new RpcError(-32602, `${uri} is not something to write; a ${scheme} is written whole, at ${scheme}://<id>`);
      const was = await store.get(at.id);
      // `createOnly` is the protocol's own word for refusing one that is there.
      if (content.createOnly === true && was !== undefined) {
        throw new RpcError(-32010, `${at.id} is already a ${scheme}; edit it or choose another id`);
      }
      /*
       * A field the body does not name is the one the row already had, and the
       * id is the address rather than anything the body says.
       *
       * A client that read a row and drew a form from it sends back what it
       * changed, not the whole row, and a write that dropped what it left out
       * would make every edit a rewrite.
       */
      await store.put(checkPolicy({ ...(was ?? {}), ...bodyOf(content), id: at.id }));
    },

    remove: async (uri) => {
      const at = split(uri);
      if (at.id === '') throw new RpcError(-32602, `${uri} is the ${scheme} directory; remove ${scheme}://<id>`);
      if (at.leaf !== '') throw absent(uri);
      // Nothing refuses a removal here: no membership and no record names a
      // policy, so an id nothing holds is the only way this fails.
      if (!await store.remove(at.id)) throw absent(uri);
    },
  };
};

/**
 * A write's body, decoded and parsed, or a refusal saying what a body is.
 *
 * An empty body is an empty object rather than a refusal, so a client writing
 * nothing to an id that is not there means exactly that - and the port refuses
 * it as the row it is not.
 */
function bodyOf(content: Write): Record<string, unknown> {
  const text = content.encoding === 'base64' ? Buffer.from(content.data, 'base64').toString('utf8') : content.data;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text === '' ? '{}' : text);
  }
  catch {
    throw new RpcError(-32602, 'A policy is made from a JSON object; that body is not one');
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new RpcError(-32602, 'A policy is made from a JSON object, and that body is not one');
  }
  return parsed as Record<string, unknown>;
}

/**
 * The `policy:` provider, over a store.
 *
 * One scheme, so this answers a `Record<string, PolicyProvider>` like
 * `peopleProviders` does and sits in the same `resourceProviders` map beside
 * them rather than in a second spread.
 */
export const policyProviders = (store: Policies): Record<string, PolicyProvider> =>
  Object.fromEntries(SCHEMES.map((what) => [what, providerFor(store, what)]));