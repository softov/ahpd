import { INVALID_PARAMS, RpcError } from '../rpc.js';
import { computerSource } from '../machines/computers.js';
import { isRootChannel, methodIn, parseResourceWatchChannelUri, schemeOf, servedIn } from './channels.js';
import { NEEDS, UNGATED, channelRead, ownAgentExcused, ownIn, refusalReason } from './gate.js';
import type { Grant, Principal } from '../types/users.js';
import type { ConnectionContext, HostContext } from './context.js';

/** What one connection's gate answers for a command. */
export interface Admission {
  admit(method: string, params: Record<string, unknown>): void | Promise<void>;
}

export function createAdmission(ctx: HostContext, conn: ConnectionContext): Admission {
  const { connection } = conn;
  /** The plugin channel serving a URI, if any. */
  const servedAt = (channel: string) => servedIn(ctx.options.channels, channel);
  /** The served `x-` command a request names, if any. */
  const commandOf = (method: string) => methodIn(ctx.options.methods, method);

  /**
   * What a command needs, or nothing when it needs nothing.
   *
   * Most methods are one entry in `NEEDS`. Four kinds are not:
   *
   * `subscribe` reads the channel, because `ahp-root://` is the discovery a
   * client reads to find out where to sign in and a session channel is not.
   *
   * Every resource method reads the URI's scheme, because `resourceWrite`
   * on `file:` and `resourceWrite` on a plugin's scheme are the same method
   * and not the same act. `file:` answers the plain capability, which is
   * what a role must have for a client to save the file it has open; any
   * other scheme answers the scoped one, so a role that names plain `put`
   * does not acquire a plugin's scheme by accident. That is what `HANDOFF`'s
   * pending step 9 means by scoping the gate rather than restoring it.
   */
  /**
   * The parameters a request has to spell as a string, or be refused for.
   *
   * `capabilityFor` reads these only when they are strings - `completions`
   * only when its channel is one, the file methods' URIs through a filter -
   * and `String(params.x ?? '')` in the handlers reads them whatever they
   * are. So a value sent another way was gated as something else and then
   * served as this: a channel sent as a list reached the handler with nothing
   * asked for it, and the coercion there made it the session for a caller who
   * had not been checked against it. Refused here, before any handler and
   * before any method's grants, because refusing is the one answer that
   * cannot skip a check.
   *
   * `uri`, `source` and `destination` are the three the file methods read a
   * scheme off, and are asked for only where those methods are: `createChat`
   * sends an object as its `source` and is not a file method.
   */
  const spelled = (params: Record<string, unknown>, ...names: string[]): void => {
    for (const name of names) {
      const said = params[name];
      if (said !== undefined && typeof said !== 'string')
        throw new RpcError(INVALID_PARAMS, `${name} must be a string`);
    }
  };

  /**
   * The root a resource watch channel names, or `undefined` for any other
   * channel: what to watch is in the channel's own name, read before the
   * watch it names is attached.
   */
  const watchedRoot = (channel: string): string | undefined => {
    const root = ctx.watches.get(channel)?.state.root ?? parseResourceWatchChannelUri(channel)?.root;
    return typeof root === 'string' ? root : undefined;
  };

  /** What reading a channel needs, with a plugin channel's own grant where one serves it. */
  const readOf = (channel: string): Grant =>
    channelRead(channel, ctx.channelKind(channel), servedAt(channel)?.channel.grant);

  const capabilityFor = (method: string, params: Record<string, unknown>): Grant[] | undefined => {
    if (method === 'subscribe') {
      const channel = String(params.channel ?? '');
      if (isRootChannel(channel)) return undefined;
      /*
       * A watch answers to the scheme it watches, as the
       * `createResourceWatch` that opened it did: `bot:watch` for a watch on
       * `bot://`, and `file:watch` for a `file:` root.
       */
      const root = watchedRoot(channel);
      if (root !== undefined) {
        const scheme = schemeOf(root);
        return [(scheme === '' || scheme === 'file' ? 'file:watch' : `${scheme}:watch`) as Grant];
      }
      /*
       * What the channel is spelt as and what it resolves to, both: the
       * snapshot is taken of the resolved channel, so the root under another
       * spelling is asked for what the root needs.
       */
      return [...new Set([readOf(channel), readOf(ctx.meantBy(channel))])];
    }
    /*
     * Completions in a session are the session's commands, so they need
     * what reading it does, as well as the `file:list` a path needs.
     */
    if (method === 'completions' && typeof params.channel === 'string' && params.channel !== '') {
      const channel = params.channel;
      return [...new Set<Grant>(['file:list', readOf(channel), readOf(ctx.meantBy(channel))])];
    }
    /*
     * A chat forked from another is not one started: it copies a transcript
     * out of the chat it names and continues there, which is a wider act than
     * `chat:create` and is asked for by its own operation. A side chat copies
     * nothing, so it is a `chat:create` like any other.
     */
    if (method === 'createChat') {
      const source = (typeof params.source === 'object' && params.source !== null
        ? params.source
        : {}) as Record<string, unknown>;
      if (source.kind === 'fork') return ['chat:fork'];
    }
    /*
     * A changeset is a session's, so running an operation on it writes to
     * the session as well as to its files. The file half keeps the whole
     * write group rather than one operation, because a changeset holds an
     * edit, a new file, a rename and a removal, and a client that may run
     * one of them has to be able to write them.
     */
    if (method === 'invokeChangesetOperation') return ['file:write', 'session:changes'];
    /*
     * A session naming a source is asking for a machine to be made for it,
     * which is a `computer:write` on top of the `session:create` any
     * session needs.
     * A `computer://<id>` that already exists is not a source, so a session
     * that names one needs nothing beyond `session:create`.
     */
    if (method === 'createSession') {
      const config = (typeof params.config === 'object' && params.config !== null
        ? params.config
        : {}) as Record<string, unknown>;
      if (computerSource(config.computer) !== undefined) return ['session:create', 'computer:write'];
    }
    /*
     * A move into a session that is not the chat's own writes that session as
     * well as the chat, so both are asked for. A move into a session this host
     * is to make is a `session:create` on top of the move instead, the way a
     * session naming a machine is a `computer:write` on top of it: the
     * destination does not exist, so there is nothing else to ask it for.
     *
     * Compared as sessions, because the chat's channel is a chat and the
     * destination a session: the chat's session is the one the store records
     * it under or its URI was built for, and a destination that is any other
     * session is asked for.
     */
    if (method === 'moveChat') {
      const destination = (typeof params.destination === 'object' && params.destination !== null
        ? params.destination
        : {}) as Record<string, unknown>;
      const kind = String(destination.kind ?? '');
      if (kind === 'newSession') return ['chat:move', 'session:create'];
      const to = String(destination.session ?? '');
      if (to !== '' && ctx.sessionFor(to) !== ctx.sessionFor(String(params.channel ?? '')))
        return ['chat:move', 'session:write'];
    }
    /*
     * Stopping or removing a folder's dev container destroys the machine the
     * folder is, which is `computer:write` as it is for a `computer://` delete
     * and for a session that names a source. The container's own
     * operation rides with it, so a role that may reach the relay surface and
     * not destroy a machine names the two apart.
     */
    if (method === 'vscode/devContainers/stop') return ['container:stop', 'computer:write'];
    if (method === 'vscode/devContainers/remove') return ['container:remove', 'computer:write'];
    /*
     * An `x-` command the daemon or a plugin serves needs the grant it was
     * registered with.
     */
    const command = commandOf(method);
    if (command !== undefined) return [command.method.grant];
    const plain = ownIn(NEEDS, method);
    if (plain === undefined) {
      /*
       * A method in `UNGATED` needs nothing, and one in neither table is a
       * method this host serves that nobody decided about.
       *
       * That one is refused rather than served. Read as "needs no grant", as
       * it was, an entry nobody wrote is the widest answer there is - which
       * is how `shutdown`, in neither table, came to be served to any
       * connection that had completed a handshake, and `shutdown` stops the
       * daemon. Refused by
       * omission, a method added later is one the suite names on the next run
       * instead.
       */
      if (UNGATED.has(method)) return undefined;
      throw new RpcError(-32009, `This host has classified ${method} nowhere, so it serves it to nobody`);
    }
    const at = plain.indexOf(':');
    const subject = plain.slice(0, at);
    const operation = plain.slice(at + 1);
    /*
     * Only the file subject is scoped by the URI.
     *
     * A resource method is the only one that carries a URI, and its subject
     * is the scheme that answers it, so `resourceRead` on `computer://` is
     * `computer:get` and every `usage:` URI is `usage:get`. Every other
     * method answers to its own subject, which is fixed and not something
     * the request can name.
     *
     * The scheme's grant is what a read falls back to, not what it always
     * needs: `excused` below asks the provider first.
     */
    if (subject !== 'file') return [plain];
    spelled(params, 'uri', 'source', 'destination');
    const uris = [params.uri, params.source, params.destination]
      .filter((one): one is string => typeof one === 'string');
    if (uris.length === 0) return [plain];
    const needed = new Set<Grant>();
    for (const uri of uris) {
      const scheme = schemeOf(uri);
      needed.add((scheme === '' || scheme === 'file' ? plain : `${scheme}:${operation}`) as Grant);
    }
    return [...needed];
  };

  /**
   * Whether this command is one signed-in person reading their own record.
   *
   * `user://<id>` is theirs and needs no `user:get`, because a client
   * showing a person their own account has to be able to, and a client
   * showing it to somebody else is refused by the grant as before - own
   * only, exactly as it is on `user primary`.
   */
  const ownRecord = (method: string, params: Record<string, unknown>, who: Principal): boolean => {
    if (method !== 'resourceRead') return false;
    if (typeof params.uri !== 'string') return false;
    const at = /^user:\/\/([^/]+)$/.exec(params.uri);
    if (at === null) return false;
    try {
      return decodeURIComponent(at[1] as string) === who.id;
    }
    catch {
      return false;
    }
  };

  /**
   * The operation a provider's `authorize` can excuse, by method: a read, a
   * listing and a watch, which are all reads. Nothing that writes is here.
   */
  const EXCUSED: Record<string, string> = {
    resourceRead: 'get',
    resourceList: 'list',
    createResourceWatch: 'watch',
    subscribe: 'watch',
  };

  /**
   * Which of what a command needs a scheme's own provider has said is
   * theirs.
   *
   * A scheme may open part of itself to a person without a grant of their
   * own, which is how `usage://user:ana` is read by the person it is about. Asked only
   * about a read, a listing or a watch, and only of the scheme the URI is
   * under, so it can widen what somebody sees and never what they change.
   *
   * The excuse is the operation the command is asking for rather than the
   * whole read group, because `denied` compares it against what was asked:
   * a provider that has authorized `user://ana` has said that record may be
   * read, and it has said nothing about every record beside it.
   *
   * A promise only where a provider has to be asked. Everything else is
   * answered here and now, because `admit` is at the front of every command
   * and a command no scheme is behind should not wait a turn of the loop
   * for a question nobody is going to answer.
   */
  const excusedBy = (method: string, params: Record<string, unknown>, who: Principal): Set<Grant> | Promise<Set<Grant>> => {
    /*
     * A served command may let in a caller its grant refuses, the way a
     * scheme opens part of itself. Asked only when the grant is missing, with
     * the request's own params.
     */
    const command = commandOf(method);
    if (command !== undefined) {
      const authorize = command.method.authorize;
      if (authorize === undefined || who.can(command.method.grant)) return new Set();
      return authorize.call(command.method, params, who)
        .then((admitted) => (admitted === true ? new Set<Grant>([command.method.grant]) : new Set<Grant>()));
    }
    /*
     * A plugin channel may let in a reader its grant refuses, the way a
     * scheme opens part of itself. Asked only when the grant is missing, so a
     * reader who holds it subscribes without the plugin being asked.
     */
    if (method === 'subscribe') {
      const channel = String(params.channel ?? '');
      const served = servedAt(channel);
      if (served !== undefined) {
        const authorize = served.channel.authorize;
        if (authorize === undefined || who.can(served.channel.grant)) return new Set();
        return authorize.call(served.channel, channel, who)
          .then((admitted) => (admitted === true ? new Set<Grant>([served.channel.grant]) : new Set<Grant>()));
      }
    }
    const operation = ownIn(EXCUSED, method);
    if (operation === undefined) return new Set();
    /*
     * A subscribe to a watch is asked about the root it watches, so a reader
     * a provider let open the watch may also hear it.
     */
    const watched = method === 'subscribe' ? watchedRoot(String(params.channel ?? '')) : undefined;
    if (method === 'subscribe' && watched === undefined) return new Set();
    const asked = (watched !== undefined ? [watched] : [params.uri, params.source, params.destination])
      .filter((one): one is string => typeof one === 'string')
      .map((uri) => {
        const scheme = schemeOf(uri);
        const authorize = scheme === '' ? undefined : ctx.options.resourceProviders?.[scheme]?.authorize;
        return authorize === undefined ? undefined : { uri, scheme, authorize };
      })
      .filter((one) => one !== undefined);
    if (asked.length === 0) return new Set();
    const excuse = async (): Promise<Set<Grant>> => {
      const excused = new Set<Grant>();
      for (const one of asked) {
        if (await one.authorize(one.uri, who)) {
          excused.add(`${one.scheme}:${operation}` as Grant);
        }
      }
      return excused;
    };
    return excuse();
  };

  /**
   * What the gate tells one connection about what it has not got.
   *
   * A promise of nothing means the person holds it, and it is thrown out of
   * whatever asked rather than returned, so a caller that does not await is
   * refused exactly as one that does.
   */
  const denied = (who: Principal, needed: readonly Grant[], excused: ReadonlySet<Grant>): void => {
    const missing = needed.find((one) => excused.has(one) !== true && !who.can(one));
    if (missing === undefined) return;
    // No `request` key: a role is not something a client can negotiate,
    // and the protocol says that field is omitted when no grant would
    // resolve the denial. Its absence is what tells a client to stop
    // rather than retry.
    throw new RpcError(-32009, refusalReason(who.id, missing), {});
  };

  /**
   * The users gate for one command, which throws what the client is told.
   *
   * Asked of every command at the boundary, and of each channel an
   * `initialize` or a `reconnect` subscribes to, as `subscribe`, since
   * those subscribe without passing the boundary as one. A promise only
   * where a scheme has to be asked whether the person may read before their
   * grant is required; everything else is refused or admitted before this
   * returns, so a caller that awaits a `void` has still had its answer.
   */
  const admit = (method: string, params: Record<string, unknown>): void | Promise<void> => {
    if (ctx.options.users === undefined || connection.root === true) return;
    spelled(params, 'channel');
    const needed = capabilityFor(method, params);
    if (needed === undefined || needed.length === 0) return;
    const who = connection.principal;
    if (who === undefined) {
      throw new RpcError(-32007, `Sign in to use this host`, {
        resources: [ctx.options.users.resource],
      });
    }
    /*
     * Removed since they signed in, which is a sign-in again and not
     * a role that does not cover this. The directory re-reads its
     * file on every question, so the answer is current as of this
     * command.
     */
    if (who.standing !== undefined && !who.standing()) {
      throw new RpcError(-32007, `Sign in to use this host`, {
        resources: [ctx.options.users.resource],
      });
    }
    /*
     * A plugin's own connection is excused a session or chat grant on a
     * session of an agent it registered, as a bot's plugin reads its talks.
     */
    const channel = typeof params.channel === 'string' ? params.channel : '';
    const own = needed.filter((one) => ownAgentExcused(ctx, who, channel, one));
    const excused = ownRecord(method, params, who)
      ? new Set<Grant>(['user:get'])
      : excusedBy(method, params, who);
    if (excused instanceof Promise) return excused.then((held) => { denied(who, needed, new Set([...held, ...own])); });
    denied(who, needed, new Set([...excused, ...own]));
  };

  return { admit };
}