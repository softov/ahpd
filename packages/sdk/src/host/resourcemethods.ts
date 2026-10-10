import { INTERNAL_ERROR, INVALID_PARAMS, RpcError } from '../rpc.js';
import { notServed } from '../resources.js';
import { Status } from '../catalog.js';
import { need } from './common.js';
import { schemeOf } from './channels.js';
import type { WriteMode } from '../types/resources.js';
import type { ConnectionContext, HostContext } from './context.js';

/**
 * Which store serves a URI, and the methods a client calls to reach one.
 *
 * `file:` is the store the host was given and anything else is a scheme a
 * plugin registered, so every `resource*` method asks `storeFor` first and a
 * scheme nobody serves is refused rather than read.
 */
export interface ResourceMethods {
  /** Which store serves a URI, read by the gate and by every method here. */
  storeFor: ConnectionContext['storeFor'];
  /** The methods themselves, spread into `handlers`. */
  methods: Record<string, (params: Record<string, unknown>) => Promise<unknown>>;
}

export function createResourceMethods(ctx: HostContext, conn: ConnectionContext): ResourceMethods {
  const { connection } = conn;
  const {
    bringBackOf, followOf, changesetAt, contentMoved, dispatch, fire, inFlight, lastError, log, operationContext, opKey,
    options, ownerFor, recordPullRequest, refreshFacts, statusOf, watches, wroteThrough,
  } = ctx;

/**
 * Where a write may be placed, as the protocol's `ResourceWriteMode` has them.
 *
 * Written out here because this is the one place a *client's* string has to be
 * checked against the vocabulary rather than assigned to it - and the list is
 * held to the protocol's by the type on the next line, so it cannot drift.
 */
const WRITE_MODES: string[] = ['truncate', 'append', 'insert'] satisfies WriteMode[];

/**
 * `-32011`, for an operation whose folder is not in the state it was read in.
 *
 * The protocol's own `Conflict`: a changeset was read, something moved
 * underneath it, and the verb the client is asking for no longer applies to
 * what it was shown - which is exactly a machine whose commit is not on the
 * branch yet.
 */
const CONFLICT = -32011;

  /**
   * Which store serves a URI.
   *
   * `file:` is the store the host was given, and anything else is a scheme
   * a plugin registered under `resourceProviders`. A scheme nobody serves
   * falls through to that same store, which is where the sentence about a
   * foreign scheme is written - so an unserved URI reads as somebody
   * else's rather than as a host that forgot it.
   *
   * A URI a connected client published never reaches here: the relay in
   * `handle` answers it before any handler, which is the order that keeps
   * a plugin from shadowing a client's own resources.
   */
  const storeFor = (uri: string) => {
    const scheme = schemeOf(uri);
    if (scheme === '' || scheme === 'file') return options.resources;
    const provider = options.resourceProviders?.[scheme];
    // A scheme nobody serves is not the file store's to read, and it is
    // not a permission answer either: the host has nothing for it, which
    // is `-32601` - decision `a-scheme-nobody-serves-is-not-a-permission-error`.
    if (provider === undefined) throw notServed(uri);
    return provider;
  };

  return { storeFor, methods: {
    resourceList: async (params) => {
      const uri = String(params.uri ?? '');
      const store = storeFor(uri);
      return { entries: await need(need(store, 'resourceList').list, 'resourceList')(uri, connection.principal) };
    },
    resourceRead: async (params) => {
      const uri = String(params.uri ?? '');
      // The `before` side of an edit is not a file on disk - it is what a
      // file used to be - so the changeset source is asked before the
      // scheme is: it answers only for the URIs it minted, and a scheme a
      // plugin registered is asked after it.
      const own = await options.changes?.read?.(uri);
      if (own) return own;
      return await need(need(storeFor(uri), 'resourceRead').read, 'resourceRead')(
        uri,
        typeof params.encoding === 'string' ? params.encoding : undefined,
        connection.principal,
      );
    },
    /**
     * Tell me when that changes.
     *
     * The client gets a channel back and subscribes to it; there is no
     * dispose command, and the last `unsubscribe` is what releases the
     * watcher. Gated the way `resourceRead` is rather than the way a write
     * is: watching is a read, and a client already able to read a
     * directory learns nothing new by being told when it moved.
     */
    createResourceWatch: async (params) => {
      const uri = String(params.uri ?? '');
      const store = need(storeFor(uri), 'createResourceWatch');
      const start = need(store.watch, 'createResourceWatch');
      const items = (value: unknown): string[] => {
        const held = (typeof value === 'object' && value !== null ? value : {}) as { items?: unknown };
        return Array.isArray(held.items) ? held.items.filter((one): one is string => typeof one === 'string') : [];
      };
      const recursive = params.recursive === true;
      const excludes = items(params.excludes);
      const includes = items(params.includes);
      const channel = `ahp-resource-watch:/${crypto.randomUUID()}`;
      const watcher = await start.call(store, uri, { recursive, excludes, includes }, (changes) => {
        // Only if it still exists: a batch can be in flight when the last
        // subscriber leaves, and dispatching to a released channel is a
        // client being told about a watch it has forgotten.
        if (!watches.has(channel)) return;
        dispatch(channel, { type: 'resourceWatch/changed', changes: { items: changes } });
      });
      watches.set(channel, {
        watcher,
        owner: connection,
        opened: false,
        state: {
          root: uri,
          recursive,
          ...(excludes.length > 0 ? { excludes: { items: excludes } } : {}),
          ...(includes.length > 0 ? { includes: { items: includes } } : {}),
        },
      });
      log(`${connection.clientId} is watching ${uri}${recursive ? ' and under it' : ''}`);
      return { channel };
    },
    /*
     * The write half of `resource*`.
     *
     * Every one takes the same gate, and it is the store's: the path is
     * checked there, because only it knows what a path means - and it
     * resolves the parent rather than the target, so a symlink pointing
     * out of the served set cannot be written through.
     *
     * `need` twice, because there are two ways not to have this: a host
     * given no `resources` port at all, and one given a store that only
     * reads. Both answer `-32601`, which is what the protocol has for a
     * method that is not here, and neither is a refusal about a path.
     */
    resourceWrite: async (params) => {
      const uri = String(params.uri ?? '');
      const encoding = params.encoding === 'base64' ? 'base64' as const : 'utf-8' as const;
      /*
       * Whose the write is, handed on to the store, and who is asking.
       *
       * The `file:` store has no use for either. A plugin's scheme may: what a
       * write makes is sometimes charged to whoever asked, and a machine
       * made by a `computer:` write is up from then on - decision
       * `a-machine-is-owned-by-whoever-created-it-and-pays-for-its-up-time`.
       *
       * The client is the connection's own id, which is what tells a provider
       * *which* of a person's windows wrote: a `push:` device is registered by
       * the phone that holds the token, and a record without this would send
       * every device on the host every notification.
       *
       * The reader is the same one `resourceRead` hands over, and it is here
       * for the other direction: nothing excuses a write, so a provider that
       * has to decide what may be written - a `bot:` for a team, say - is
       * given the only thing that says what the writer belongs to.
       */
      const owner = ownerFor(connection);
      const writer = connection.clientId;
      await need(need(storeFor(uri), 'resourceWrite').write, 'resourceWrite')(uri, {
        data: String(params.data ?? ''),
        encoding,
        /*
         * Checked rather than cast, and it changes no behaviour.
         *
         * A client's string used to go straight into a field the rest of
         * this codebase reads as one of three words, so `mode: 'overwrite'`
         * reached the store typed as something it was not. The store's
         * fallback happens to be `truncate`, so nothing was ever visibly
         * wrong - which is the whole reason it survived. This is the same
         * defect as a hand-copied vocabulary, one layer in: a value the
         * compiler believes is a `WriteMode` and is not.
         */
        ...(WRITE_MODES.includes(String(params.mode)) ? { mode: String(params.mode) as WriteMode } : {}),
        ...(typeof params.position === 'number' ? { position: params.position } : {}),
        ...(params.createOnly === true ? { createOnly: true } : {}),
        ...(typeof params.ifMatch === 'string' ? { ifMatch: params.ifMatch } : {}),
      }, owner, writer === '' ? undefined : writer, connection.principal);
      void fire({ type: 'resource_write', uri });
      log(`${connection.clientId} wrote ${uri}`);
      wroteThrough(uri);
      return {};
    },
    resourceDelete: async (params) => {
      const uri = String(params.uri ?? '');
      /*
       * Whose the delete is, and who is asking, the pair a write carries.
       *
       * The `file:` store has no use for either. A plugin's scheme may: a
       * delete takes one of its objects away for good, and a scheme that
       * decides who may change one - a `bot:` in a team, say - decides with
       * the same writer here as there.
       */
      const owner = ownerFor(connection);
      await need(need(storeFor(uri), 'resourceDelete').remove, 'resourceDelete')(
        uri, params.recursive === true, owner, connection.principal,
      );
      log(`${connection.clientId} removed ${uri}`);
      wroteThrough(uri);
      return {};
    },
    resourceMkdir: async (params) => {
      const uri = String(params.uri ?? '');
      await need(need(storeFor(uri), 'resourceMkdir').mkdir, 'resourceMkdir')(uri);
      wroteThrough(uri);
      return {};
    },
    /*
     * Both ends are the store's business, including the source.
     *
     * The source is emptied and the destination is filled, so a store that
     * can write one and not the other refuses the half it cannot do. A
     * `copy` reads the source, which the read half already allows inside a
     * served directory.
     *
     * Two different schemes are refused rather than attempted: neither
     * provider could carry out the other's half, which is the same answer
     * two different clients already get for a cross-client move.
     */
    resourceMove: async (params) => {
      const source = String(params.source ?? '');
      const destination = String(params.destination ?? '');
      const held = storeFor(source);
      if (held !== storeFor(destination)) throw new RpcError(INVALID_PARAMS, `${source} and ${destination} are served by different providers`);
      await need(need(held, 'resourceMove').move, 'resourceMove')(
        source, destination, params.failIfExists === true,
      );
      log(`${connection.clientId} moved ${source} to ${destination}`);
      wroteThrough(source);
      wroteThrough(destination);
      return {};
    },
    resourceCopy: async (params) => {
      const source = String(params.source ?? '');
      const destination = String(params.destination ?? '');
      const held = storeFor(destination);
      if (storeFor(source) !== held) throw new RpcError(INVALID_PARAMS, `${source} and ${destination} are served by different providers`);
      await need(need(held, 'resourceCopy').copy, 'resourceCopy')(
        source, destination, params.failIfExists === true,
      );
      wroteThrough(destination);
      return {};
    },
    /**
     * May I read this, may I write it.
     *
     * The negotiated form of the question, and a client that asks is told
     * yes for any `file:` URI, the way the reference host answers it:
     * there is no person at a daemon to prompt, and the connection token
     * has already decided who may be here.
     *
     * It grants nothing, because there is nothing left to grant: the write
     * half is served to any connection, and the read half always was. The
     * answer is kept because the protocol has the method and a client that
     * asks deserves the same answer the reference gives, and the ask is
     * logged so a host operator can see it.
     */
    resourceRequest: async (params) => {
      const uri = String(params.uri ?? '');
      if (!uri.startsWith('file://')) throw new RpcError(-32009, `This host does not mediate ${uri}`);
      // Neither flag is a read, which is what the protocol tells receivers
      // to make of a request that sets nothing.
      const write = params.write === true;
      log(`${connection.clientId} may ${write ? 'write' : 'read'} ${uri}`);
      return {};
    },
    /**
     * Run one of the verbs a changeset advertised.
     *
     * Three gates, and none of them is a flag on this host: the id has to
     * be one this changeset offers *now*, the target has to be a kind that
     * operation accepts, and the session must not be mid-turn. The list is
     * the access model - a client can invoke nothing that was not already
     * put in front of it. An operation that writes is not gated on a
     * `resourceRequest`, because the resource half is not either.
     */
    invokeChangesetOperation: async (params) => {
      const channel = String(params.channel ?? '');
      const at = changesetAt(channel);
      if (!at) throw new RpcError(-32001, `No changeset at ${channel}`);
      const source = need(options.changes, 'invokeChangesetOperation');
      const operationId = String(params.operationId ?? '');
      const context = operationContext(at.owner, at.dir);
      const offered = (source.operations?.(at.dir, at.owner, at.scope, context) ?? [])
        .find((one) => one.id === operationId);
      if (!offered)
        throw new RpcError(INVALID_PARAMS, `No operation called ${operationId} on ${channel}`);

      const raw = params.target as Record<string, unknown> | undefined;
      const target = raw !== undefined && typeof raw === 'object'
        ? {
          kind: raw.kind === 'range' ? 'range' as const : 'resource' as const,
          resource: String(raw.resource ?? ''),
          ...(raw.side === 'before' || raw.side === 'after' ? { side: raw.side as 'before' | 'after' } : {}),
          ...(typeof raw.range === 'object' && raw.range !== null
            ? { range: raw.range as { startLine: number; endLine: number } }
            : {}),
        }
        : undefined;
      // No target is the changeset itself, which is how the protocol says
      // a changeset-scoped invocation.
      const kind = target?.kind ?? 'changeset';
      if (!offered.scopes.includes(kind))
        throw new RpcError(INVALID_PARAMS, `${operationId} cannot be invoked on a ${kind}`);

      // Refused rather than queued. The agent is writing to this tree, and
      // an operation that rewrote a file underneath it would be racing the
      // thing whose work the changeset is about.
      // `-32004`, which the protocol has for exactly this: the operation
      // requires no active turn and there is one. `-32002` is
      // `ProviderNotFound`, so a client branching on the code was told to
      // try another provider when what it should do is wait.
      if ((statusOf(at.owner) & Status.InProgress) !== 0)
        throw new RpcError(-32004, `${at.owner} is mid-turn`);

      /*
       * And what the machine committed, before anything acts on the folder.
       *
       * The agent's commits are in a git directory of the machine's own until
       * ahpd fetches them - decision
       * `a-machine-commits-in-its-own-repository-and-the-host-fetches-it` - so
       * an operation running first would act on a changeset that does not hold
       * the work the turn just did.
       *
       * Where the work could not be moved onto the branch the operation is
       * refused rather than run: something of the host's is in the way - a
       * commit of a person's, or staged changes - and what the operation would
       * commit is not what the machine wrote. Under a ref of ahpd's own the
       * work is kept, and a look at the branch picks it up.
       */
      const brought = await bringBackOf(at.owner);
      if (brought?.waiting !== undefined) {
        throw new RpcError(CONFLICT, `the work of ${at.owner} waits in ${brought.waiting}: nothing acts on ${at.dir} until it is on the branch`);
      }

      const key = opKey(channel, operationId);
      inFlight.add(key);
      lastError.delete(key);
      dispatch(channel, { type: 'changeset/operationStatusChanged', operationId, status: 'running' });
      try {
        const meta = typeof params._meta === 'object' && params._meta !== null ? params._meta as Record<string, unknown> : undefined;
        const result = await need(source.invoke, 'invokeChangesetOperation').call(source, {
          ...context,
          dir: at.dir,
          session: at.owner,
          scope: at.scope,
          operationId,
          ...(target !== undefined ? { target } : {}),
          ...(meta !== undefined ? { meta } : {}),
        });
        inFlight.delete(key);
        dispatch(channel, { type: 'changeset/operationStatusChanged', operationId, status: 'idle' });
        // Before the refresh, so GitHub's later answer is what survives.
        if (result.pullRequest !== undefined) recordPullRequest(at.owner, at.dir, result.pullRequest);
        // Something wrote to the tree, so every changeset of this session
        // is now describing a directory that has moved. The catalogue
        // first, because `refresh` is what makes the next read fresh.
        refreshFacts(at.dir);
        await options.changes?.refresh?.(at.dir).catch(() => false);
        await contentMoved(at.owner);
        /*
         * And where the operation left the branch, the machine is handed it.
         *
         * The fetch above brought the machine's own work to the host; this is
         * the other direction - a commit, a checkout, a discard or a revert has
         * moved the host's branch, its index, or both, and a machine still at
         * where it was would run its next turn against a history the folder it
         * shares is no longer in - decision
         * `a-machine-commits-in-its-own-repository-and-the-host-fetches-it`. A
         * machine that could not be moved is a line in the log and nothing
         * else: the operation has already happened, and it is the machine's
         * next turn that is one branch behind.
         */
        await followOf(at.owner);
        return {
          ...(result.message !== undefined ? { message: result.message } : {}),
          // What the operation produced, when it produced something worth
          // opening. A pull request a push made is the case: the operation
          // succeeded, and the useful part of it is a page somewhere.
          ...(result.followUp !== undefined ? { followUp: result.followUp } : {}),
        };
      }
      catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        inFlight.delete(key);
        lastError.set(key, message);
        dispatch(channel, {
          type: 'changeset/operationStatusChanged',
          operationId,
          status: 'error',
          error: { message },
        });
        log(`${operationId} on ${channel} failed: ${message}`);
        // With the source's code and data when it chose them: a refusal
        // the reference client branches on is more than its message.
        const chosen = error as { code?: unknown; data?: unknown };
        if (typeof chosen.code === 'number') throw new RpcError(chosen.code, message, chosen.data);
        throw new RpcError(INTERNAL_ERROR, message);
      }
    },
    resourceResolve: async (params) => {
      const uri = String(params.uri ?? '');
      return await need(need(storeFor(uri), 'resourceResolve').resolve, 'resourceResolve')(
        uri,
        params.followSymlinks !== false,
      );
    },
  } };
}
