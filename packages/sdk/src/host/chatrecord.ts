import { idOf } from '../catalog.js';
import { chatIdFor } from './channels.js';
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
  /** Every backend id a chat the store records answers to. */
  chatBackends(): Set<string>;
  /** The chats the store records for one session that are still open. */
  recordedChats(id: string): StoredChat[];
  /** Every chat the store records for one session, closed ones included. */
  heldChats(id: string): StoredChat[];
  /** One open chat of a session, as the store records it. */
  recordedChat(id: string, chatUri: string): StoredChat | undefined;
  /** Write down one chat of a session that is running, where it was opened. */
  keepChat(uri: string, chatUri: string, backendId: string | undefined, isDefault: boolean): void;
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
  /** The backend ids the recorded chats answer to, so a listing offers none as a session. */
  const chatBackends = new Set<string>();

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
      if (chat.backendId !== '' && chat.backendId !== id) chatBackends.add(chat.backendId);
      if (chat.closed === true) continue;
      chatHome.set(chat.uri, id);
      if (chat.origin !== undefined && !ctx.madeFrom.has(chat.uri)) ctx.madeFrom.set(chat.uri, chat.origin);
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

  const keepChat = (uri: string, chatUri: string, backendId: string | undefined, isDefault: boolean): void => {
    const id = idOf(uri);
    const list = stored(id);
    const at = list.findIndex((one) => one.uri === chatUri);
    const was = at < 0 ? undefined : list[at];
    const title = kept.chatTitle(id, chatUri) ?? was?.title;
    // What it was made from, read where the host keeps it: a chat is spawned
    // before its origin is written down, so the record takes it from the one
    // place both a live session and a browsed one are told it from.
    const origin = ctx.madeFrom.get(chatUri) ?? was?.origin;
    // Built field by field, so a chat that is being started is open: the mark
    // a closed one carries is not among them.
    const next: StoredChat = {
      uri: chatUri,
      // The name the backend keeps this conversation under: the id it was
      // handed, and the session's own id for the chat that is the session.
      backendId: backendId ?? was?.backendId ?? chatIdFor(uri, chatUri) ?? id,
      ...(title === undefined ? {} : { title }),
      ...(origin === undefined ? {} : { origin }),
      ...(isDefault || was?.default === true ? { default: true } : {}),
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
    if (was !== undefined && was.backendId !== next.backendId && was.backendId !== id) chatBackends.delete(was.backendId);
    if (next.backendId !== '' && next.backendId !== id) chatBackends.add(next.backendId);
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
    if (gone !== undefined && gone.backendId !== id) chatBackends.delete(gone.backendId);
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
      if (chat.backendId !== '' && chat.backendId !== id) chatBackends.delete(chat.backendId);
    }
  };

  return {
    homeId: (chat) => chatHome.get(chat),
    chatBackends: () => chatBackends,
    recordedChats, recordedChat, heldChats, keepChat, dropChat, forgetChats,
  };
}
