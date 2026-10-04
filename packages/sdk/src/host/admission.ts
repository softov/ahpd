import { RpcError } from '../rpc.js';
import { computerSource } from '../computers.js';
import { isRootChannel, schemeOf } from './channels.js';
import type { ChannelKind } from './channels.js';
import { NEEDS, refusalReason } from './gate.js';
import type { Grant, Principal } from '../types/users.js';
import type { ConnectionContext, HostContext } from './context.js';

/** What one connection's gate answers for a command. */
export interface Admission {
  admit(method: string, params: Record<string, unknown>): void | Promise<void>;
}

export function createAdmission(ctx: HostContext, conn: ConnectionContext): Admission {
  const { connection } = conn;

  /** What reading a channel of each kind needs. */
  const read: Record<ChannelKind, Grant> = { session: 'session:read', terminal: 'terminal:read', other: 'file:read' };
  /**
   * What a command needs, or nothing when it needs nothing.
   *
   * Most methods are one entry in `NEEDS`. Two kinds are not:
   *
   * `subscribe` reads the channel, because `ahp-root://` is the discovery a
   * client reads to find out where to sign in and a session channel is not.
   *
   * Every resource method reads the URI's scheme, because `resourceWrite`
   * on `file:` and `resourceWrite` on a plugin's scheme are the same method
   * and not the same act. `file:` answers the plain capability, which is
   * what a role must have for a client to save the file it has open; any
   * other scheme answers the scoped one, so a role that names plain `write`
   * does not acquire a plugin's scheme by accident. That is what `HANDOFF`'s
   * pending step 9 means by scoping the gate rather than restoring it.
   */
  const capabilityFor = (method: string, params: Record<string, unknown>): Grant[] | undefined => {
    if (method === 'subscribe') {
      const channel = String(params.channel ?? '');
      if (isRootChannel(channel)) return undefined;
      if (channel.startsWith('ahp-automations')) return ['automation:read'];
      /*
       * What the channel is spelt as and what it resolves to, both: the
       * snapshot is taken of the resolved channel, so a spelling that
       * reads as something else cannot reach a session. Anything that is
       * neither a session's nor a terminal's - a file, a resource watch,
       * one another client relays - needs what `createResourceWatch`
       * required to hand a watch over.
       */
      return [...new Set([read[ctx.channelKind(channel)], read[ctx.channelKind(ctx.meantBy(channel))]])];
    }
    /*
     * Completions in a session are the session's commands, so they need
     * what reading it does, as well as the `file:read` a path needs.
     */
    if (method === 'completions' && typeof params.channel === 'string' && params.channel !== '') {
      const channel = params.channel;
      return [...new Set<Grant>(['file:read', read[ctx.channelKind(channel)], read[ctx.channelKind(ctx.meantBy(channel))]])];
    }
    /*
     * A changeset is a session's, so running an operation on it writes to
     * the session as well as to its files.
     */
    if (method === 'invokeChangesetOperation') return ['file:write', 'session:write'];
    /*
     * A session naming a source is asking for a machine to be made for it,
     * which is a `computer:write` on top of the `session:write` any
     * session needs - decision
     * `a-machine-made-for-a-session-counts-against-max-and-needs-computer-write`.
     * A `computer://<id>` that already exists is not a source, so a session
     * that names one needs nothing beyond `session:write`.
     */
    if (method === 'createSession') {
      const config = (typeof params.config === 'object' && params.config !== null
        ? params.config
        : {}) as Record<string, unknown>;
      if (computerSource(config.computer) !== undefined) return ['session:write', 'computer:write'];
    }
    const plain = NEEDS[method];
    if (plain === undefined) return undefined;
    const at = plain.indexOf(':');
    const subject = plain.slice(0, at);
    const verb = plain.slice(at + 1);
    /*
     * Only the file subject is scoped by the URI.
     *
     * A resource method is the only one that carries a URI, and its subject
     * is the scheme that answers it, so `resourceRead` on `computer://` is
     * `computer:read` and every `usage:` URI is `usage:read`. Every other
     * method answers to its own area, which is a fixed subject and not
     * something the request can name.
     *
     * The scheme's grant is what a read falls back to, not what it always
     * needs: `excused` below asks the provider first.
     */
    if (subject !== 'file') return [plain];
    const uris = [params.uri, params.source, params.destination]
      .filter((one): one is string => typeof one === 'string');
    if (uris.length === 0) return [plain];
    const needed = new Set<Grant>();
    for (const uri of uris) {
      const scheme = schemeOf(uri);
      needed.add((scheme === '' || scheme === 'file' ? plain : `${scheme}:${verb}`) as Grant);
    }
    return [...needed];
  };

  /**
   * Whether this command is one signed-in person reading their own record.
   *
   * `user://<id>` is theirs and needs no `user:read`, because a client
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
   * Which of what a command needs a scheme's own provider has said is
   * theirs.
   *
   * A scheme may open part of itself to a person without a grant of their
   * own, which is how `usage://user:ana` is read by the person it is about
   * - decision `a-scheme-provider-may-authorize-a-read-itself`. Asked only
   * about a read or a listing, and only of the scheme the URI is under, so
   * it can widen what somebody sees and never what they change.
   *
   * A promise only where a provider has to be asked. Everything else is
   * answered here and now, because `admit` is at the front of every command
   * and a command no scheme is behind should not wait a turn of the loop
   * for a question nobody is going to answer.
   */
  const excusedBy = (method: string, params: Record<string, unknown>, who: Principal): Set<Grant> | Promise<Set<Grant>> => {
    if (method !== 'resourceRead' && method !== 'resourceList') return new Set();
    const asked = [params.uri, params.source, params.destination]
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
          excused.add(`${one.scheme}:read` as Grant);
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
     * command - decision `a-role-is-read-on-every-command`.
     */
    if (who.standing !== undefined && !who.standing()) {
      throw new RpcError(-32007, `Sign in to use this host`, {
        resources: [ctx.options.users.resource],
      });
    }
    const excused = ownRecord(method, params, who)
      ? new Set<Grant>(['user:read'])
      : excusedBy(method, params, who);
    if (excused instanceof Promise) return excused.then((held) => { denied(who, needed, held); });
    denied(who, needed, excused);
  };

  return { admit };
}