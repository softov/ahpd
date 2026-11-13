import { idOf } from '../sessions/catalog.js';
import { chatIdFor, chatUriFor } from './channels.js';
import type { StoredChat } from '../types/sessions.js';
import type { HostContext } from './context.js';

/**
 * What this host knows about the chats of a session, and where the store is
 * read for them.
 *
 * A chat is a conversation of a session rather than a session of its own: a
 * peer chat's URI carries no session, so the only thing that says which
 * session owns `ahp-chat:/<uuid>` is what the host wrote down when the chat
 * was opened. That record is the store's `chats(id)`, keyed by the session,
 * and the other way round is the store's `sessions()` - the ids it holds. The
 * map below is built from both when this host starts, so `ahp-chat:/<uuid>` is
 * placed before anything here has listed a session and before any agent has
 * run. Recording a chat and dropping one keep it current from then on, and so
 * does every read, which costs nothing and remembers what it saw.
 *
 * A chat closed rather than deleted stays in the record marked `closed`: the
 * backend keeps its conversation, and the mark is what keeps that conversation
 * from being listed as a session of its own by the next process as well.
 */
export interface ChatRecord {
  /** The id of the session a chat this host is not holding belongs to. */
  homeId(chat: string): string | undefined;
  /** Every backend id a chat the store records answers to: the chats' backings, as VS Code calls them. */
  chatBackings(): Set<string>;
  /** The chats the store records for one session that are still open. */
  recordedChats(id: string): StoredChat[];
  /** Every chat the store records for one session, closed ones included. */
  heldChats(id: string): StoredChat[];
  /** One open chat of a session, as the store records it. */
  recordedChat(id: string, chatUri: string): StoredChat | undefined;
  /** The backend's name for the session's original chat, which may differ from its container id. */
  sessionBackendId(id: string): string;
  /**
   * Whether a chat is the session's own conversation, which a backend names by
   * the session and is handed no name of its own: the default chat derived
   * from the session's URI, or the chat its record keeps under the session's
   * id where that id is not the name the chat's URI carries. A chat moved to a
   * session named after its conversation carries that name, and keeps it.
   */
  ownChat(session: string, chatUri: string): boolean;
  /**
   * Write down one chat of a session that is running, where it was opened.
   *
   * The provider and config are the chat's own where it runs on a backend of
   * its own, and absent for a chat the session's backend serves. A call that
   * knows neither leaves what the row already says: a title written later or a
   * backend id answered at the end of a turn is the same chat, and dropping
   * what it was recorded with would start it on the session's backend next
   * time.
   */
  keepChat(
    uri: string, chatUri: string, backendId: string | undefined, isDefault: boolean,
    provider?: string, config?: Record<string, unknown>,
  ): void;
  /**
   * The values a chat of a session set for itself, as VS Code's
   * `getChatOwnConfigValues` answers them: none where it set none.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentConfigurationService.ts#L244-L248
   */
  getChatOwnConfigValues(uri: string, chatUri: string): Record<string, unknown>;
  /**
   * The values a chat set for itself written into its row, which a restart
   * starts it again with, as VS Code persists a chat's own config values with
   * the chat. None takes them off the row.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/AGENTS.md#L340
   */
  persistChatOwnConfigValues(uri: string, chatUri: string, values: Record<string, unknown>): void;
  /** Write down a session's chats in a new order, which is the order a restart rebuilds them in. */
  orderChats(uri: string, order: string[]): void;
  /** A chat a session has dropped, kept in the record or gone from it. */
  dropChat(uri: string, chatUri: string): void;
  /** Every chat of a session, gone with it. */
  forgetChats(id: string): void;
}

export function createChatRecord(ctx: HostContext): ChatRecord {
  const { kept } = ctx;
  // What closing a chat does to its conversation, from the host's own option:
  // read here because this is where a chat is dropped, and set here because
  // nothing before this area is built asks.
  ctx.closedChats = ctx.options.closedChats ?? 'hidden';
  /** The session each recorded chat belongs to, by the chat's own URI. */
  const chatHome = new Map<string, string>();
  /**
   * The backing each recorded chat answers to, so a listing offers none as a
   * session, as VS Code keeps a chat's backing out of its list.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/AGENTS.md#L262
   */
  const chatBackings = new Set<string>();

  /**
   * One read of the store, remembered as it is read.
   *
   * The session's own id is the session and is not a claim: the row a listing
   * offers for it is the session's own. Every other backend id a recorded chat
   * answers to is a conversation that no backend lists as a session - a closed
   * chat's included, since its conversation is still there.
   *
   * A closed chat is not a place: its URI names nothing a client can open, so
   * it is claimed and not placed. What comes back is the whole list, closed
   * rows and all, because that is what has to be written back. What a chat was
   * made from is read back from the row as well, because a chat listed into the
   * catalogue after a restart says it was forked rather than that somebody
   * opened it.
   */
  const stored = (id: string): StoredChat[] => {
    const list = kept.chats(id);
    for (const chat of list) {
      if (chat.backendId !== '' && chat.backendId !== id) chatBackings.add(chat.backendId);
      if (chat.closed === true) continue;
      chatHome.set(chat.uri, id);
      if (chat.origin !== undefined && !ctx.madeFrom.has(chat.uri)) ctx.madeFrom.set(chat.uri, chat.origin);
      if (chat.interactivity !== undefined && !ctx.chatInteractivity.has(chat.uri)) ctx.chatInteractivity.set(chat.uri, chat.interactivity);
      if (chat.tools !== undefined && !ctx.chatTools.has(chat.uri)) ctx.chatTools.set(chat.uri, chat.tools);
    }
    return list;
  };

  /*
   * The whole map, in one pass, on the way up.
   *
   * This is the one moment the store can be asked which sessions it has: every
   * later question names one. A chat opened before this process started is
   * therefore placed by the time the first client asks about it, whether or
   * not a catalogue has been listed - which is what a restart of the daemon
   * leaves behind, and what a client that reconnects to a chat of a session
   * nothing has listed is asking about.
   *
   * A session inside a machine is left out, as it is left out of the resume
   * and of the browsed session's chat list: its chats are the inner host's,
   * and one recorded here would be a row that opens onto nothing.
   */
  for (const id of kept.sessions()) {
    if (kept.nested?.(id) !== undefined) continue;
    stored(id);
  }

  const heldChats = (id: string): StoredChat[] => stored(id);
  const recordedChats = (id: string): StoredChat[] => heldChats(id).filter((one) => one.closed !== true);
  const recordedChat = (id: string, chatUri: string): StoredChat | undefined =>
    recordedChats(id).find((one) => one.uri === chatUri);
  // The original chat is the one the record marks default, which a minted
  // default chat needs, or the chat derived from the session in a record
  // written before default chats were minted.
  const sessionBackendId = (id: string): string => {
    const chats = heldChats(id);
    const original = chats.find((one) => one.default === true) ?? chats.find((one) => one.uri === chatUriFor(ctx.nameOf(id)));
    return original?.backendId ?? id;
  };

  const keepChat = (
    uri: string, chatUri: string, backendId: string | undefined, isDefault: boolean,
    provider?: string, config?: Record<string, unknown>,
  ): void => {
    const id = idOf(uri);
    const list = stored(id);
    const at = list.findIndex((one) => one.uri === chatUri);
    const was = at < 0 ? undefined : list[at];
    const title = kept.chatTitle(id, chatUri) ?? was?.title;
    // What it was made from, read where the host keeps it: a chat is spawned
    // before its origin is written down, so the record takes it from the one
    // place both a live session and a browsed one are told it from.
    const origin = ctx.madeFrom.get(chatUri) ?? was?.origin;
    // How a person may use it and the tools it alone is offered, read from the
    // same place for the same reason.
    const interactivity = ctx.chatInteractivity.get(chatUri) ?? was?.interactivity;
    const tools = ctx.chatTools.get(chatUri) ?? was?.tools;
    // The backend of its own this chat runs on, if it is not the session's,
    // and the config it runs on there. A call that names neither is one about
    // a chat that has not changed backend, so the row keeps what it had.
    const served = provider ?? was?.provider;
    const settings = config ?? was?.config;
    // Built field by field, so a chat that is being started is open: the mark
    // a closed one carries is not among them.
    const next: StoredChat = {
      uri: chatUri,
      // The name the backend keeps this conversation under: the id it was
      // handed, and the session's own id for the chat that is the session.
      backendId: backendId ?? was?.backendId ?? chatIdFor(uri, chatUri) ?? id,
      ...(served === undefined ? {} : { provider: served }),
      ...(settings === undefined ? {} : { config: settings }),
      ...(was?.configValues === undefined ? {} : { configValues: was.configValues }),
      ...(title === undefined ? {} : { title }),
      ...(origin === undefined ? {} : { origin }),
      ...(interactivity === undefined ? {} : { interactivity }),
      ...(tools === undefined ? {} : { tools }),
      ...(isDefault || was?.default === true ? { default: true } : {}),
      ...(was?.wake === undefined ? {} : { wake: was.wake }),
    };
    // A copy of every entry, because the store's own objects are what a read
    // answers and one of them is about to move.
    const moved = list.map((one) => {
      const copy = { ...one };
      if (isDefault && copy.uri !== chatUri) delete copy.default;
      return copy;
    });
    if (at < 0) moved.push(next);
    else moved[at] = next;
    kept.setChats(id, moved);
    chatHome.set(chatUri, id);
    // A conversation renamed - a fork's new id, or a backend that named its own
    // - is not the one this host claimed under the old name.
    if (was !== undefined && was.backendId !== next.backendId && was.backendId !== id) chatBackings.delete(was.backendId);
    if (next.backendId !== '' && next.backendId !== id) chatBackings.add(next.backendId);
  };

  const getChatOwnConfigValues = (uri: string, chatUri: string): Record<string, unknown> =>
    ({ ...recordedChat(idOf(uri), chatUri)?.configValues });

  const persistChatOwnConfigValues = (uri: string, chatUri: string, values: Record<string, unknown>): void => {
    const id = idOf(uri);
    const list = stored(id);
    if (!list.some((one) => one.uri === chatUri)) return;
    // A copy of every entry, as `keepChat` writes them, with this one's values
    // put on or taken off.
    kept.setChats(id, list.map((one) => {
      if (one.uri !== chatUri) return { ...one };
      const { configValues: _was, ...rest } = one;
      return Object.keys(values).length === 0 ? rest : { ...rest, configValues: { ...values } };
    }));
  };

  /**
   * A session's chats written down in a new order.
   *
   * Only the order changes: every field of every row is what it was, and a row
   * the given order does not name keeps the place it holds. Those are the
   * chats the session has closed, which are not chats the catalogue lists, and
   * a move is about where the chats are. The order is the one the next process
   * starts them again in, which is what a reorder has to survive to be a
   * reorder rather than a thing a client drew once.
   */
  const orderChats = (uri: string, order: string[]): void => {
    const id = idOf(uri);
    const rows = stored(id);
    const byUri = new Map(rows.map((one) => [one.uri, one]));
    const moved: StoredChat[] = [];
    let next = 0;
    for (const one of rows) {
      // A row the order does not name is where it was, and the next name in
      // the order takes the place of the one this row is.
      const wanted = order[next];
      const taken = wanted === undefined ? undefined : byUri.get(wanted);
      if (one.closed === true || taken === undefined) moved.push(one);
      else { moved.push(taken); next += 1; }
    }
    // Anything the order names that no open row did is appended, so a name in
    // the order is never silently dropped.
    for (; next < order.length; next += 1) {
      const left = byUri.get(order[next] as string);
      if (left !== undefined) moved.push(left);
    }
    kept.setChats(id, moved);
  };

  /**
   * A chat a session has dropped.
   *
   * Under `closedChats: 'hidden'`, which is the default, the conversation stays
   * in the backend and this host keeps claiming it: the row is marked closed
   * rather than dropped, so the claim is built again by the next process and
   * the conversation is never listed as a session of its own. Under `delete`
   * the row goes and the claim with it, and the caller deletes what the
   * backend holds of it.
   */
  const dropChat = (uri: string, chatUri: string): void => {
    const id = idOf(uri);
    const gone = recordedChat(id, chatUri);
    const rows = stored(id);
    const at = rows.findIndex((one) => one.uri === chatUri);
    const held = rows[at];
    if (ctx.closedChats === 'hidden' && held !== undefined) {
      rows[at] = {
        uri: held.uri,
        backendId: held.backendId,
        ...(held.provider === undefined ? {} : { provider: held.provider }),
        ...(held.config === undefined ? {} : { config: held.config }),
        ...(held.title === undefined ? {} : { title: held.title }),
        ...(held.origin === undefined ? {} : { origin: held.origin }),
        closed: true,
      };
      kept.setChats(id, rows);
      chatHome.delete(chatUri);
      return;
    }
    kept.setChats(id, rows.filter((one) => one.uri !== chatUri));
    chatHome.delete(chatUri);
    // And the claim, because this host does not know the conversation was a
    // chat and the backend is about to hold nothing of it: what it lists of
    // that id is a session this host has no record of, which is one to offer.
    if (gone !== undefined && gone.backendId !== id) chatBackings.delete(gone.backendId);
  };

  /**
   * Every chat of a session, let go with it.
   *
   * For the teardown, where the store's own record goes in one call and every
   * chat of the session goes with it - the closed ones included, whose claims
   * would otherwise outlive the record that explains them. Read before that
   * call, so what this host is holding about the session is read from the
   * record it is about to drop.
   */
  const forgetChats = (id: string): void => {
    for (const chat of stored(id)) {
      chatHome.delete(chat.uri);
      if (chat.backendId !== '' && chat.backendId !== id) chatBackings.delete(chat.backendId);
    }
  };

  const ownChat = (session: string, chatUri: string): boolean => {
    const id = idOf(session);
    const named = chatIdFor(session, chatUri);
    if (named === undefined) return true;
    // The chat the record keeps under the session's id, or the session's
    // default chat under the name the session's own backend minted for it.
    return named !== id && heldChats(id).some((one) => one.uri === chatUri
      && (one.backendId === id || (one.default === true && one.provider === undefined)));
  };

  return {
    homeId: (chat) => chatHome.get(chat),
    chatBackings: () => chatBackings,
    recordedChats, recordedChat, sessionBackendId, ownChat, heldChats, keepChat, getChatOwnConfigValues, persistChatOwnConfigValues,
    orderChats, dropChat, forgetChats,
  };
}
