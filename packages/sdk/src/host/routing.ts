import { AhpErrorCodes } from '@microsoft/agent-host-protocol';
import { RpcError } from '../rpc.js';
import { idOf, uriFor } from '../sessions/catalog.js';
import type { Connection } from '../types/host.js';
import type { Bag } from '../types/common.js';
import {
  ROOT, isRootChannel, isAutomations, automationsChannel, schemeOf, spaceOf, baseOf,
  chatOfCanvas, chatUriFor, subagentChatUri, toolCallOfSubagentChat, shapedSession,
} from './channels.js';
import type { ChannelKind, Space } from './channels.js';
import type { Home } from './gate.js';
import type { NameKind } from './state.js';
import type { HostContext } from './context.js';

/** Which channel a client's URI means, and what each client is shown of the sessions and chats here. */
export interface Routing {
  spaceHere(uri: string): Space | undefined;
  nameOf(id: string): string;
  keepName(id: string): void;
  sessionOfChat(uri: string): string | undefined;
  sessionFor(channel: string): string;
  meantBy(channel: string): string;
  sessionHolding(chat: string): string | undefined;
  channelKind(channel: string): ChannelKind;
  sessionChannel(channel: string): boolean;
  homeOf(channel: string): Home | undefined;
  answeredAs(connection: Connection, channel: string, snapshot: Record<string, unknown>): string;
  visible(connection: Connection, channel: string): boolean;
  sessionVisible(connection: Connection, session: string, defaultChat?: string): boolean;
  chatShown(connection: Connection, chat: unknown, session: string): boolean;
  claimable(name: string, kind: NameKind): void;
  unheld(uri: string): void;
  openedBy(channel: string, client: string): void;
}

export function createRouting(ctx: HostContext): Routing {
  const { agents, claims, sessions, byChat, subagents, owners, names, homeId, fire } = ctx;

  /**
   * `spaceOf`, and a scheme that names a provider here is a session's: that was
   * the name of every session before this host named one `ahp-session:`, an old
   * session keeps it, and an older VS Code window creates one under it.
   */
  const spaceHere = (uri: string): Space | undefined => (agents.has(schemeOf(uri)) ? 'session' : spaceOf(uri));

  /**
   * The name this host publishes a session under, by the id inside it.
   *
   * The name a listing or a start gave the session's row, the name the store
   * kept for it before anything here listed it, or `ahp-session:/<id>` for an
   * id nothing has named. One name per session, which is the `resource` its
   * row and every notification about it carry; a client that names the
   * session another way is answered under the name it used, through
   * `meantBy` and the alias `answeredAs` keeps.
   */
  const nameOf = (id: string): string => names.get(id) ?? ctx.kept.uri?.(id) ?? uriFor(id);

  /**
   * Keep the name a session is published under in its row.
   *
   * Asked once this host has written a record for a session no start wrote
   * one for, a row a client marked or configured from the catalogue: the row
   * then holds the name its clients were given beside what was written, so a
   * restart lists the session under that name - decision
   * `a-new-session-is-held-under-the-protocols-uri`. A row that holds its name
   * already keeps it.
   */
  const keepName = (id: string): void => {
    if (ctx.kept.uri?.(id) === undefined) ctx.kept.setUri?.(id, nameOf(id));
  };

  /**
   * The chat a session hands a client that names none: the running session's,
   * or the one its record marks as the default. Nothing for a session that
   * records none, and nothing for a name that is no session here.
   */
  const defaultChatOf = (session: string): string | undefined =>
    sessions.get(session)?.defaultChat
      ?? (owners.has(session) ? ctx.recordedChats(idOf(session)).find((one) => one.default === true)?.uri : undefined);

  /**
   * The session a default or a worker chat's URI belongs to, under the name
   * this host publishes that session by.
   *
   * A chat URI carries the session it was minted for, and a session has a name
   * for every scheme it answers to: the reference host derives a chat from
   * each identity of a session - its registered URI, `ahp-session:/<id>` and
   * `<provider>:/<id>` - and gives that chat the session it was derived for,
   * while the session's record agrees about its default chat. So the session
   * is read by the id inside the URI, and the spelling is a name rather than a
   * second session. A worker's chat belongs to the session it was opened in,
   * by the same id.
   * https://github.com/microsoft/vscode/blob/58a595f76bdc150460d7e0d279d26cc6fc577b0a/src/vs/platform/agentHost/node/agentHostChatOwnershipService.ts#L226-L242
   * https://github.com/microsoft/vscode/blob/58a595f76bdc150460d7e0d279d26cc6fc577b0a/src/vs/platform/agentHost/node/agentHostChatOwnershipService.ts#L264-L287
   */
  const sessionOfChat = (uri: string): string | undefined => {
    const minted = shapedSession(uri);
    if (minted === undefined) return undefined;
    const session = nameOf(idOf(minted));
    const callId = toolCallOfSubagentChat(uri);
    if (callId !== undefined) return subagentChatUri(minted, callId) === uri ? session : undefined;
    if (chatUriFor(minted) !== uri) return undefined;
    // The session's record agrees while its default chat is the one derived
    // from a spelling of its own id; a session that moved its default to a
    // chat of its own owns no derived chat.
    const recorded = defaultChatOf(session);
    const from = recorded === undefined ? undefined : shapedSession(recorded);
    return recorded === undefined || (from !== undefined && chatUriFor(from) === recorded && idOf(from) === idOf(minted))
      ? session
      : undefined;
  };

  /**
   * The session a chat belongs to: the one the store records it under, or the
   * one its URI was built for. A channel that is no chat of a session here
   * comes back as it is.
   */
  const sessionFor = (channel: string): string => {
    const home = homeId(channel);
    return home === undefined ? sessionOfChat(channel) ?? channel : nameOf(home);
  };

  /**
   * The channel a client's URI means here.
   *
   * A terminal or a watch is the URI the client named. The root is one channel
   * under `ahp-root://` and under the `ahp-root:` a client prints after parsing
   * it, and the automations catalogue under any authority it was given.
   *
   * A session is one channel under every spelling of its id, and so is a chat
   * derived from one: the reference host answers a session under each identity
   * it has and derives that session's chat from each of them, so a spelling is
   * a name for the channel rather than a second channel. The name the client
   * used is remembered as an alias, so it is also what the client is told.
   * https://github.com/microsoft/vscode/blob/58a595f76bdc150460d7e0d279d26cc6fc577b0a/src/vs/platform/agentHost/node/agentHostChatOwnershipService.ts#L264-L287
   * https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/common/state/sessionState.ts#L894-L898
   */
  const meantBy = (channel: string): string => {
    if (isAutomations(channel)) return automationsChannel(channel);
    if (isRootChannel(channel)) return ROOT;
    // A session channel, and its marks and changesets with it, by the id in it.
    const base = baseOf(channel);
    if (spaceHere(base) === 'session') {
      const published = names.get(idOf(base)) ?? ctx.kept.uri?.(idOf(base));
      return published === undefined ? channel : `${published}${channel.slice(base.length)}`;
    }
    const session = sessionOfChat(channel);
    if (session === undefined || session === shapedSession(channel)) return channel;
    const callId = toolCallOfSubagentChat(channel);
    if (callId !== undefined) return subagentChatUri(session, callId);
    return defaultChatOf(session) ?? chatUriFor(session);
  };

  /**
   * Whether an older VS Code window can see a chat in a session: its URI is
   * shaped and was minted for that session, whichever spelling of the id it
   * carries. Such a window reads a chat's session out of its URI, so a chat
   * moved here from another session keeps the URI it was minted under and
   * stays out of its sight in the session it moved to, as the reference host
   * hides a chat whose recorded origin is another session.
   * https://github.com/microsoft/vscode/blob/58a595f76bdc150460d7e0d279d26cc6fc577b0a/src/vs/platform/agentHost/node/protocolServerHandler.ts#L4344-L4351
   */
  const shownToOlder = (chat: unknown, session: string): boolean => {
    if (typeof chat !== 'string') return false;
    const minted = shapedSession(chat);
    return minted !== undefined && idOf(minted) === idOf(session);
  };

  /**
   * Whether a connection may see a session.
   *
   * An older VS Code window for sessions sees none in the `ahp-session:`
   * scheme, and one for chats sees none whose default chat it cannot see.
   * Every other client sees every session. `defaultChat` stands in for the
   * recorded one, for a row read before the session runs.
   * https://github.com/microsoft/vscode/blob/58a595f76bdc150460d7e0d279d26cc6fc577b0a/src/vs/platform/agentHost/node/protocolServerHandler.ts#L4320-L4332
   */
  const sessionVisible = (connection: Connection, session: string, defaultChat?: string): boolean => {
    if (connection.legacySessionUris === true && schemeOf(session) === 'ahp-session') return false;
    if (connection.legacyChatUris !== true) return true;
    const shown = defaultChat ?? defaultChatOf(session);
    return shown === undefined || shownToOlder(shown, session);
  };

  /**
   * Whether a connection may see a channel: a chat by the session that holds
   * it and by its own URI, anything else as a session. Asked only for an older
   * VS Code window; every other client sees every channel.
   * https://github.com/microsoft/vscode/blob/58a595f76bdc150460d7e0d279d26cc6fc577b0a/src/vs/platform/agentHost/node/protocolServerHandler.ts#L4334-L4340
   */
  const visible = (connection: Connection, channel: string): boolean => {
    if (connection.legacySessionUris !== true && connection.legacyChatUris !== true) return true;
    if (spaceOf(channel) !== 'chat') return sessionVisible(connection, channel);
    const home = homeId(channel);
    const owner = sessionHolding(channel) ?? (home === undefined ? sessionOfChat(channel) : nameOf(home));
    if (connection.legacyChatUris === true
      && (shapedSession(channel) === undefined || (owner !== undefined && !shownToOlder(channel, owner)))) return false;
    return sessionVisible(connection, owner ?? channel);
  };

  /**
   * Whether a connection may see a chat of a session: every chat, or for an
   * older VS Code window for chats a shaped one that names the session.
   * https://github.com/microsoft/vscode/blob/58a595f76bdc150460d7e0d279d26cc6fc577b0a/src/vs/platform/agentHost/node/protocolServerHandler.ts#L4352-L4355
   */
  const chatShown = (connection: Connection, chat: unknown, session: string): boolean =>
    connection.legacyChatUris !== true || shownToOlder(chat, session);

  /**
   * A snapshot taken for a channel a client named, answered to that client.
   *
   * The channel the snapshot was taken of is the one this host dispatches
   * under. A host channel the client named in another spelling is recorded
   * as its alias on this connection and the snapshot is answered in that
   * spelling. A session's chats are the ones this connection may see. What
   * comes back is the held name, which is what a replay is keyed by. The
   * client now holds the state this host holds for the channel, which a replay
   * to it later builds on.
   * https://github.com/microsoft/vscode/blob/58a595f76bdc150460d7e0d279d26cc6fc577b0a/src/vs/platform/agentHost/node/protocolServerHandler.ts#L4403-L4409
   */
  const answeredAs = (connection: Connection, channel: string, snapshot: Record<string, unknown>): string => {
    const meant = meantBy(channel);
    ctx.heldStates.get(meant)?.baselines.add(connection.clientId);
    const owing = ctx.lapsed.get(connection.clientId);
    if (owing?.delete(meant) === true && owing.size === 0) ctx.lapsed.delete(connection.clientId);
    if (meant !== channel) {
      connection.aliases.set(meant, channel);
      snapshot.resource = channel;
    }
    const state = snapshot.state;
    if (connection.legacyChatUris === true && typeof state === 'object' && state !== null && Array.isArray((state as Bag).chats)) {
      const bag = state as Bag;
      snapshot.state = { ...bag, chats: (bag.chats as Bag[]).filter((chat) => chatShown(connection, chat.resource, meant)) };
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
   * Every other channel is a session's: a session may be held under its
   * provider's scheme, `claude:/<id>`, which says nothing about it being one,
   * and a session a backend keeps on disk is named before anything here has
   * listed it. Asked for a subscribe and for a dispatch alike, synchronously.
   * The gate may be stricter than the handler behind it, never looser: a
   * channel that turns out to be nothing is refused there anyway.
   */
  const channelKind = (channel: string): ChannelKind => {
    /*
     * A canvas is its chat's, whether or not this host still holds the canvas.
     * The resource carries the chat in base64url, so a client asking about one
     * that is gone is asked the same question a client asking about the chat
     * is - and the answer is the session that holds it, not `other`.
     */
    const canvasChat = chatOfCanvas(channel);
    if (canvasChat !== undefined) return channelKind(canvasChat);
    const held = claims.get(channel) ?? claims.get(baseOf(channel));
    if (held !== undefined) return held.kind === 'terminal' ? 'terminal' : held.kind === 'watch' ? 'other' : 'session';
    const space = spaceHere(channel);
    return space === 'terminal' ? 'terminal' : space === 'own' || space === 'plugin' ? 'other' : 'session';
  };
  /** Whether `channelKind` reads a channel as a session's. */
  const sessionChannel = (channel: string): boolean => channelKind(channel) === 'session';

  /**
   * The client and session pairs a `session_opened` has already been raised
   * for.
   *
   * Raised once per pair rather than once per subscribe, because one opening
   * is one client with one session in front of them: a client subscribes to a
   * session and then to a chat of it, reconnects, or a window subscribes
   * twice, and a plugin told each time would reach the same device three
   * times.
   */
  const opened = new Set<string>();

  /**
   * Note that a client is in a session, and say so the first time.
   *
   * Called from every subscription - the command and the two handshakes that
   * subscribe on their way in - because a client that arrives with its
   * subscription in `initialize` has opened the session as surely as one that
   * asks afterwards. A channel that is no session's, or one this host does not
   * hold, is nothing to note: only a session a plugin could reach with a
   * message is worth one.
   */
  const openedBy = (channel: string, client: string): void => {
    if (client === '') return;
    // A session's own channel, or the session a chat, an annotation or a
    // changeset of it belongs to. `baseOf` is what keeps a session's marks
    // from being raised as a session of their own.
    const session = spaceOf(channel) === 'chat' ? sessionFor(channel) : baseOf(channel);
    if (spaceOf(session) === 'chat' || !sessionChannel(session)) return;
    const key = `${session}\u0000${client}`;
    if (opened.has(key)) return;
    opened.add(key);
    void fire({ type: 'session_opened', session, client });
  };
  /** The kind of channel a channel is, as `ACTION_HOMES` names it, or nothing an action belongs on. */
  const homeOf = (channel: string): Home | undefined => {
    if (isRootChannel(channel)) return 'root';
    if (channel.startsWith('ahp-automation')) return 'automations';
    const kind = channelKind(channel);
    if (kind !== 'other') return kind;
    return claims.get(channel)?.kind === 'watch' || schemeOf(channel) === 'ahp-resource-watch' ? 'watch' : undefined;
  };

  /**
   * Refuse a name for a new session, chat or terminal that `claims` already
   * holds, as it is or as the session channel it hangs off (`baseOf`), that is
   * a session running or listed here, or that falls in a space (`spaceOf`)
   * this host keeps for another kind.
   */
  const claimable = (name: string, kind: NameKind): void => {
    const space = spaceHere(name);
    const fits = space === undefined || space === kind;
    if (!fits)
      throw new RpcError(-32003, `${name} is a name this host keeps for ${space === 'own' ? 'its own channels' : space === 'plugin' ? 'plugin channels' : `${space}s`}`);
    for (const one of new Set([name, baseOf(name)])) {
      const held = claims.get(one);
      if (held !== undefined) throw new RpcError(-32003, `${name} is already a ${held.kind} here`);
      if (sessions.has(one) || owners.has(one)) throw new RpcError(-32003, `${name} names the session ${one}`);
    }
  };

  /**
   * Refuse a new session whose id is already a session here, running or
   * listed, under any scheme: the id is what its flags, config, marks and
   * titles are kept by. Refused too when its URI, or the name the store keeps
   * for its id, is not `claimable`. Asked before anything is made for the new
   * one - a worktree, a machine, the choices recorded for it - so a refusal
   * leaves nothing behind.
   *
   * A session recorded for an agent this host is not serving is refused the
   * same way it is refused to open, as the reference host's restore refuses a
   * session it finds no agent for: it is a conversation of its own, and one
   * made over its id here would write this host's harness over the record of
   * which harness it is.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentService.ts#L14103-L14108
   */
  const unheld = (uri: string): void => {
    const name = nameOf(idOf(uri));
    if (sessions.has(name) || owners.has(name))
      throw new RpcError(-32003, `${idOf(uri)} is already held as ${name}`);
    if (ctx.waitingFor(idOf(uri)) !== undefined) throw new RpcError(AhpErrorCodes.SessionNotFound, `No agent for session: ${name}`);
    for (const one of new Set([name, uri])) claimable(one, 'session');
  };

  return {
    spaceHere, nameOf, keepName, sessionOfChat, sessionFor, meantBy, sessionHolding, channelKind, sessionChannel, homeOf,
    answeredAs, visible, sessionVisible, chatShown, claimable, unheld, openedBy,
  };
}
