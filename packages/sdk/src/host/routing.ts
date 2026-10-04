import { RpcError } from '../rpc.js';
import { idOf, uriFor } from '../catalog.js';
import type { Connection } from '../types/host.js';
import type { Bag } from '../types/common.js';
import {
  ROOT, AUTOMATIONS, MARKS, isRootChannel, isAutomations, schemeOf, spaceOf, baseOf,
  chatUriFor, subagentChatUri, toolCallOfSubagentChat, URI_KEYS,
} from './channels.js';
import type { ChannelKind, Space } from './channels.js';
import type { Home } from './gate.js';
import type { NameKind } from './state.js';
import type { HostContext } from './context.js';

/** Which channel a client's URI means, and how a snapshot is spelt back to the client that asked. */
export interface Routing {
  spaceHere(uri: string): Space | undefined;
  heldAs(uri: string): string;
  nameOf(id: string): string;
  ownName(uri: string): boolean;
  sessionOfChat(uri: string): string | undefined;
  sessionFor(channel: string): string;
  chatOf(uri: string): string;
  meantBy(channel: string): string;
  sessionHolding(chat: string): string | undefined;
  channelKind(channel: string): ChannelKind;
  sessionChannel(channel: string): boolean;
  homeOf(channel: string): Home | undefined;
  spelledFor(asked: string, snapshot: Record<string, unknown>): void;
  respell(uri: string, held: string, asked: string): string;
  respelledIn<T>(value: T, held: string, asked: string, key?: string): T;
  spellingOf(connection: Connection, channel: string): { held: string; asked: string } | undefined;
  answeredAs(connection: Connection, channel: string, snapshot: Record<string, unknown>): string;
  claimable(name: string, kind: NameKind): void;
  unheld(uri: string, asked?: string): void;
}

export function createRouting(ctx: HostContext): Routing {
  const { agents, claims, sessions, byChat, subagents, owners, names } = ctx;

  /**
   * `spaceOf`, and a scheme that names a provider here is a session's: a
   * session is held as `<provider>:/<id>`, and one a backend keeps on disk
   * has that name before anything has listed it.
   */
  const spaceHere = (uri: string): Space | undefined => (agents.has(schemeOf(uri)) ? 'session' : spaceOf(uri));

  const heldAs = (uri: string): string => {
    if (sessions.has(uri) || owners.has(uri)) return uri;
    const held = claims.get(uri);
    if (held !== undefined) return held.kind === 'session' ? held.of : uri;
    // Only a session URI is read for its id: `ahp-terminal:/x`, `file:///x`
    // and a session whose id is `x` are three channels.
    if (ownName(uri)) return uri;
    const named = nameOf(idOf(uri));
    return sessions.has(named) || owners.has(named) ? named : uri;
  };
  /**
   * The name this host publishes a session under, by the id inside it.
   *
   * `<provider>:/<id>`, the provider as the *scheme*, whether the session was
   * created here, resumed or listed from a backend's disk: VS Code builds a
   * session URI that way and reads the provider back off the scheme. The id is
   * the identity and the scheme is whose it is, so any other spelling a client
   * used, `ahp-session:/<id>` included, resolves through `heldAs`.
   */
  const nameOf = (id: string): string => names.get(id) ?? uriFor(id);
  /**
   * Whether a URI is a channel that is its own name and never a session's:
   * a terminal or a watch this host holds under whatever name it was given,
   * and, for a name nothing here holds, one in a space other than a
   * session's (`spaceOf`) - a chat is resolved as a chat, not read for a
   * session's id. None of them is read for a session's id.
   */
  const ownName = (uri: string): boolean => {
    const held = claims.get(uri);
    if (held !== undefined) return held.kind === 'terminal' || held.kind === 'watch';
    const space = spaceHere(uri);
    return space !== undefined && space !== 'session';
  };

  /**
   * The session a chat URI belongs to, in either spelling.
   *
   * The new shape carries it; the old one is named after it. Undefined for
   * anything that is not a chat URI at all. Both authorities carry the same
   * encoding, so which kind of chat it is only decides where the id ends.
   */
  const sessionOfChat = (uri: string): string | undefined => {
    if (uri.startsWith('ahp-chat://')) {
      const [chatId, ...rest] = uri.slice('ahp-chat://'.length).split('/');
      const encoded = rest.join('/');
      /*
       * A worker's chat: the session is the middle segment and the tool call
       * follows it. The call is opaque, so the session is read before the
       * first one and never after.
       */
      if (chatId === 'subagent') {
        try {
          const session = Buffer.from(rest[0] ?? '', 'base64url').toString('utf8');
          return session.includes(':') && rest.length >= 2 ? session : undefined;
        }
        catch { return undefined; }
      }
      if (chatId !== 'default' || encoded === '') return undefined;
      try {
        const session = Buffer.from(encoded, 'base64url').toString('utf8');
        return session.includes(':') ? session : undefined;
      }
      catch { return undefined; }
    }
    if (uri.startsWith('ahp-chat:/')) return nameOf(idOf(uri));
    return undefined;
  };

  /**
   * The chat a URI means, whichever spelling it was written in.
   *
   * A chat this host is actually holding under that exact name answers for
   * itself - a second chat's URI is the client's own and is not derived from
   * anything. Everything else is a first chat, named either way.
   */
  const sessionFor = (channel: string): string => heldAs(sessionOfChat(channel) ?? channel);

  const chatOf = (uri: string): string => {
    if (byChat.has(uri)) return uri;
    // A worker's chat is its own conversation, never the session's default:
    // resolving one to the other would send its actions to the lead chat.
    // Judged by the authority rather than by what is held, because a worker
    // read back from a transcript is a real chat this host serves too. A
    // running session's worker is named the way that session is held, as its
    // default chat is below, so a worker chat spelt from a client's alias of
    // it is the same chat.
    const callId = toolCallOfSubagentChat(uri);
    if (callId !== undefined) {
      const owning = sessionOfChat(uri);
      const named = owning === undefined ? undefined : heldAs(owning);
      return named !== undefined && sessions.has(named) ? subagentChatUri(named, callId) : uri;
    }
    const session = sessionOfChat(uri);
    if (session === undefined) return uri;
    return sessions.get(heldAs(session))?.defaultChat ?? chatUriFor(session);
  };

  /**
   * The channel a client's URI means here, in either family.
   *
   * A chat is resolved as a chat and a session as a session; anything else -
   * the root, a terminal, a watch - is already its own name. What comes back
   * is the name this host dispatches under, which is what a subscription has
   * to be keyed by; the name the client used is remembered as an alias so it
   * is also what the client is told.
   */
  const meantBy = (channel: string): string => {
    // A name claimed as a terminal or a watch is that thing's own name.
    const held = claims.get(channel)?.kind;
    if (held === 'terminal' || held === 'watch') return channel;
    // Nested under a session, so it is resolved the way the session it hangs
    // off is: a client that opened the row under its own spelling dispatches
    // annotations under that spelling too.
    if (channel.endsWith(MARKS)) return `${heldAs(channel.slice(0, -MARKS.length))}${MARKS}`;
    if (isAutomations(channel)) return AUTOMATIONS;
    if (isRootChannel(channel)) return ROOT;
    return sessionOfChat(channel) !== undefined ? chatOf(channel) : heldAs(channel);
  };

  /**
   * A *session's* snapshot, answered under the name the client asked about.
   *
   * The resource is the easy half. The hard half is that a chat URI contains
   * its session's URI, so a session answered under a name other than the one
   * this host holds it by offers chat names built from the held name - while
   * the client subscribed to the ones it computed from its own. It then holds
   * a subscription nothing refers to and a `defaultChat` nothing is subscribed
   * to, and draws an empty conversation with no error at all, which is the
   * worst way for this to fail.
   *
   * For sessions only. A chat asked for under an alias may resolve to a
   * *different* chat - `default` is a role, and the default moves - and there
   * the client is told the name of the chat it actually landed on.
   */
  const spelledFor = (asked: string, snapshot: Record<string, unknown>): void => {
    // Read before it is overwritten: it is the name this host holds the
    // session under, and the prefix every URI built from it carries.
    const meant = typeof snapshot.resource === 'string' ? snapshot.resource : asked;
    snapshot.resource = asked;
    const state = snapshot.state;
    if (typeof state !== 'object' || state === null) return;
    const bag = state as Record<string, unknown>;
    if (typeof bag.resource === 'string') bag.resource = asked;
    const moved = (uri: unknown): unknown => (typeof uri === 'string' ? respell(uri, meant, asked) : uri);
    /*
     * A changeset's URI is built from the session's, so a template is the
     * other name in disguise.
     *
     * This is how the held spelling escaped. A client resolves a changeset
     * channel back to the session that owns it, so a template naming
     * `ahp-session:/x` teaches a client that asked about `claude:/x` a second
     * name for the same session - and it then addresses the session, its chat
     * and its annotations under *that* one. Which of the two the renderer
     * ends up on is whichever subscription landed first, which is why the
     * conversation drew sometimes and not others.
     */
    if (Array.isArray(bag.changesets))
      bag.changesets = bag.changesets.map((one) => {
        if (typeof one !== 'object' || one === null) return one;
        const template = (one as Record<string, unknown>).uriTemplate;
        return typeof template === 'string' && template.startsWith(`${meant}/`)
          ? { ...(one as Record<string, unknown>), uriTemplate: moved(template) }
          : one;
      });
    if (bag.defaultChat !== undefined) bag.defaultChat = moved(bag.defaultChat);
    if (Array.isArray(bag.chats))
      bag.chats = bag.chats.map((chat) => {
        if (typeof chat !== 'object' || chat === null) return chat;
        const row = chat as Record<string, unknown>;
        const origin = row.origin as Record<string, unknown> | undefined;
        // A worker's origin names the chat its call is in, which is one of
        // this session's too.
        const from = origin?.chat !== undefined ? { origin: { ...origin, chat: moved(origin.chat) } } : {};
        return { ...row, resource: moved(row.resource), ...from };
      });
    // The chat each waiting request is answered on, which a client dispatches
    // to as it reads it.
    if (Array.isArray(bag.inputNeeded))
      bag.inputNeeded = bag.inputNeeded.map((one) => {
        if (typeof one !== 'object' || one === null) return one;
        const request = one as Record<string, unknown>;
        return request.chat === undefined ? request : { ...request, chat: moved(request.chat) };
      });
    /*
     * And the link on the call that spawned a worker, so the two ends of it
     * say the same thing under one spelling.
     *
     * Only when this session has worker chats at all, so an ordinary
     * transcript pays nothing for it: the protocol requires the chat's origin
     * and the call's `subagent` content to name each other, and a client that
     * compared them after this rename would otherwise find two URIs for one
     * conversation.
     */
    const hasWorker = Array.isArray(bag.chats)
      && (bag.chats as Bag[]).some((chat) => toolCallOfSubagentChat(String((chat as Bag)?.resource ?? '')) !== undefined);
    if (hasWorker && Array.isArray(bag.turns)) bag.turns = respelledIn(bag.turns, meant, asked);
  };

  /**
   * One URI of a session, in another spelling of that session.
   *
   * The rules a snapshot and an action are respelled by: the session URI
   * itself, anything built under it (`<session>/changeset/<scope>`,
   * `<session>/annotations`), and a chat derived from it - its default chat,
   * or a worker's, which keeps its own authority and call id while the
   * session inside it moves. A chat a client named itself is that client's
   * name and stays as it was written, and so does a chat of another session.
   */
  const respell = (uri: string, held: string, asked: string): string => {
    if (uri === held) return asked;
    if (uri.startsWith(`${held}/`)) return `${asked}${uri.slice(held.length)}`;
    if (!uri.startsWith('ahp-chat:')) return uri;
    const owning = sessionOfChat(uri);
    if (owning === undefined || owning === uri || idOf(owning) !== idOf(asked)) return uri;
    const callId = toolCallOfSubagentChat(uri);
    return callId === undefined ? chatUriFor(asked) : subagentChatUri(asked, callId);
  };

  /**
   * A value with every URI in it respelled, as a copy; the value itself is
   * left alone.
   *
   * A URI is a string under a key in `URI_KEYS`, or in an array under one.
   * Any other string - a message, a tool's input or output, a title - is
   * somebody's words, and stays as written even where it names the session.
   */
  const respelledIn = <T>(value: T, held: string, asked: string, key?: string): T => {
    if (typeof value === 'string') return (key !== undefined && URI_KEYS.has(key) ? respell(value, held, asked) : value) as T;
    if (Array.isArray(value)) return value.map((one) => respelledIn(one, held, asked, key)) as T;
    if (typeof value === 'object' && value !== null) {
      return Object.fromEntries(Object.entries(value).map(([name, one]) => [name, respelledIn(one, held, asked, name)])) as T;
    }
    return value;
  };

  /**
   * The session a connection knows by another name, for a channel of it.
   *
   * The held session behind a session, chat or annotations channel, and the
   * name this connection used for it: its alias of the session, or the
   * session inside its alias of the chat. Nothing for a connection that uses
   * the held name, and nothing for a channel that is not a session's.
   */
  const spellingOf = (connection: Connection, channel: string): { held: string; asked: string } | undefined => {
    if (connection.aliases.size === 0) return undefined;
    const bare = (uri: string): string => (uri.endsWith(MARKS) ? uri.slice(0, -MARKS.length) : uri);
    const held = sessionHolding(channel) ?? sessionOfChat(channel) ?? bare(channel);
    if (ownName(held)) return undefined;
    const alias = connection.aliases.get(channel);
    const asked = connection.aliases.get(held)
      ?? (alias === undefined ? undefined : sessionOfChat(alias) ?? bare(alias));
    return asked !== undefined && asked !== held && idOf(asked) === idOf(held) ? { held, asked } : undefined;
  };

  /**
   * A snapshot taken for a channel a client named, answered in its name.
   *
   * The channel the snapshot was taken of is the one this host dispatches
   * under; the one the client named is recorded as its alias on this
   * connection and the snapshot is respelled into it. What comes back is the
   * held name, which is what a replay is keyed by.
   */
  const answeredAs = (connection: Connection, channel: string, snapshot: Record<string, unknown>): string => {
    const meant = meantBy(channel);
    if (meant !== channel) connection.aliases.set(meant, channel);
    if (sessionOfChat(channel) === undefined) {
      if (meant !== channel) spelledFor(channel, snapshot);
      return meant;
    }
    if (meant !== channel) snapshot.resource = channel;
    /*
     * A chat's own state names its session's other chats - where a fork came
     * from, a worker's link on the call that spawned it - and those are
     * respelled the way an action on this chat is, whether the chat itself
     * was asked for by an alias or by a name a client gave it.
     */
    const spelling = spellingOf(connection, meant);
    if (spelling !== undefined && typeof snapshot.state === 'object' && snapshot.state !== null) {
      const state = snapshot.state as Record<string, unknown>;
      snapshot.state = {
        ...respelledIn(state, spelling.held, spelling.asked),
        ...(state.resource === undefined ? {} : { resource: state.resource }),
      };
    }
    return meant;
  };

  /** The session a chat of this host's belongs to, lead or worker. */
  const sessionHolding = (chat: string): string | undefined =>
    byChat.get(chat)?.uri ?? subagents.get(chat)?.session;
  /**
   * What the users gate reads a channel as: a session's - the session, a
   * chat of it, its annotations or one of its changesets - a terminal's, or
   * something else.
   *
   * Read from `claims` for a name this host holds, or whose session channel
   * (`baseOf`) it holds, and otherwise from the name's space (`spaceOf`).
   * Every other channel is a session's: a session is held under its
   * provider's scheme, `claude:/<id>`, which says nothing about it being one,
   * and a session a backend keeps on disk is named before anything here has
   * listed it. Asked for a subscribe and for a dispatch alike, synchronously.
   * The gate may be stricter than the handler behind it, never looser: a
   * channel that turns out to be nothing is refused there anyway.
   */
  const channelKind = (channel: string): ChannelKind => {
    const held = claims.get(channel) ?? claims.get(baseOf(channel));
    if (held !== undefined) return held.kind === 'terminal' ? 'terminal' : held.kind === 'watch' ? 'other' : 'session';
    const space = spaceHere(channel);
    return space === 'terminal' ? 'terminal' : space === 'own' ? 'other' : 'session';
  };
  /** Whether `channelKind` reads a channel as a session's. */
  const sessionChannel = (channel: string): boolean => channelKind(channel) === 'session';
  /** The kind of channel a channel is, as `ACTION_HOMES` names it, or nothing an action belongs on. */
  const homeOf = (channel: string): Home | undefined => {
    if (isRootChannel(channel)) return 'root';
    if (channel.startsWith('ahp-automation')) return 'automations';
    const kind = channelKind(channel);
    if (kind !== 'other') return kind;
    return claims.get(channel)?.kind === 'watch' || schemeOf(channel) === 'ahp-resource-watch' ? 'watch' : undefined;
  };

  /**
   * Refuse a name for a new session, chat, terminal or relayed watch that
   * `claims` already holds, as it is or as the session channel it hangs off
   * (`baseOf`), that resolves to a session running or listed here, or that
   * falls in a space (`spaceOf`) this host keeps for another kind. A
   * relayed watch may be named in `ahp-resource-watch:`, as this host's own
   * are.
   */
  const claimable = (name: string, kind: NameKind): void => {
    const space = spaceHere(name);
    const fits = space === undefined || space === kind || (kind === 'watch' && schemeOf(name) === 'ahp-resource-watch');
    if (!fits)
      throw new RpcError(-32003, `${name} is a name this host keeps for ${space === 'own' ? 'its own channels' : `${space}s`}`);
    for (const one of new Set([name, baseOf(name)])) {
      const held = claims.get(one);
      if (held !== undefined) throw new RpcError(-32003, `${name} is already a ${held.kind} here`);
      const as = heldAs(one);
      if (sessions.has(as) || owners.has(as)) throw new RpcError(-32003, `${name} names the session ${as}`);
    }
  };

  /**
   * Refuse a new session whose id is already a session here, running or
   * listed, under any scheme: the id is what its flags, config, marks and
   * titles are kept by. Refused too when the name it would be held under, or
   * the one the client asked for, is not `claimable`. Asked before anything
   * is made for the new one - a
   * worktree, a machine, the choices recorded for it - so a refusal leaves
   * nothing behind.
   *
   * A session recorded for an agent this host is not serving is refused the
   * same way it is refused to open: it is a conversation of its own, and one
   * made over its id here would write this host's harness over the record of
   * which harness it is.
   */
  const unheld = (uri: string, asked = uri): void => {
    const name = nameOf(idOf(uri));
    if (sessions.has(name) || owners.has(name))
      throw new RpcError(-32003, `${idOf(uri)} is already held as ${name}`);
    const waiting = ctx.waitingFor(idOf(uri));
    if (waiting !== undefined) throw new RpcError(-32002, `${waiting} is not loaded on this host`);
    for (const one of new Set([name, uri, asked])) claimable(one, 'session');
  };

  return {
    spaceHere, heldAs, nameOf, ownName, sessionOfChat, sessionFor, chatOf, meantBy,
    sessionHolding, channelKind, sessionChannel, homeOf, spelledFor, respell, respelledIn,
    spellingOf, answeredAs, claimable, unheld,
  };
}