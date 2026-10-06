/**
 * The catalogue: what the server lists, and what this bridge watched itself.
 *
 * ACP grew a `session/list`, and where a server advertises it that list is the
 * authority on which sessions exist. Where it does not, the only honest answer
 * is the sessions this process opened and watched - not a guess at what a
 * server might have on disk somewhere. Both paths end in the same `Listed` row,
 * so a client cannot tell which one answered except by what it says.
 *
 * The registry is process-wide and keyed by provider and the server's own
 * session id, because `list()` and `transcript()` are asked on the agent, which
 * has no handle on the session `create` returned. A session is never removed
 * when it closes: the ACP server still holds the conversation and the
 * catalogue row still needs its transcript, so only the live connection goes.
 */

import type { AgentCapabilities, ContentBlock, ListSessionsRequest, SessionInfo, SessionUpdate } from '@agentclientprotocol/sdk';
import { uriOf } from '@ahpd/sdk';
import type { Listed } from '@ahpd/sdk';
import { connectAcp } from './connection.js';
import { replayedTurns } from './transcript.js';
import type { AcpConnection, AcpHandlers, AcpOptions, WatchedSession } from './types.js';

/**
 * The sessions this process watched, by provider and the server's own id.
 *
 * Keyed on both because one host serves several providers and two servers are
 * free to name a session the same thing; the pair is what the bridge actually
 * knows. A resumed session keeps whatever it already recorded rather than
 * starting the transcript over, which is why `watchSession` returns the
 * existing record when there is one.
 */
const watched = new Map<string, WatchedSession>();

/**
 * Where the server last said each of its sessions lives.
 *
 * A `session/list` carries a `cwd` for every conversation it names, and some
 * servers find a conversation by it: asked to load a session with a folder the
 * conversation never had, one of them finds nothing and replays nothing, so a
 * read that used the daemon's own folder would answer blank. Remembering what the
 * server said is what lets the read ask the way the server can answer.
 */
const placeOf = new Map<string, string>();

const keyOf = (provider: string, id: string): string => `${provider}\n${id}`;

/**
 * The JSON-RPC code the protocol's own `RequestError.resourceNotFound` carries.
 *
 * Which is how a server says a session is not there. Spelled here rather than
 * taken off the class because the bridge talks to a server over the wire and
 * only ever sees a code, and this one is the protocol's to mean that by.
 */
const NOT_FOUND = -32002;

/** The listing connection a provider holds, by the options that opened it. */
const listings = new WeakMap<AcpOptions, Listing>();

/**
 * How long a provider's listing connection waits after its last read before it
 * goes.
 *
 * A daemon is asked for the catalogue on every subscribe and on every
 * reconnect, so the connection is worth keeping between reads; a minute of
 * silence is a provider nobody is watching, and a server that outlives the
 * interest in it is a subprocess with nothing to do.
 */
const IDLE_MS = 60_000;

/** One provider's held connection to the server that lists its sessions. */
interface Listing {
  connection: AcpConnection;
  /** Armed once the last read settles, and disarmed by the next one. */
  idle?: NodeJS.Timeout;
}

/** One row for a session this process watched, in the contract's spelling. */
const listedOf = (session: WatchedSession): Listed => ({
  id: session.id,
  title: session.title,
  createdAt: session.createdAt,
  modifiedAt: session.modifiedAt,
  workingDirectories: [session.cwd, ...session.additional].map((directory) => uriOf(directory)),
});

/**
 * One row for a session the server listed.
 *
 * ACP carries one timestamp, `updatedAt`, where the contract wants a creation
 * and a modification; the same instant answers both rather than a creation
 * invented out of nothing. A session the server never titled is titled by its
 * id, which is what the reference store does with the same absence.
 */
const listedFrom = (info: SessionInfo, now: string): Listed => {
  const at = info.updatedAt ?? now;
  return {
    id: info.sessionId,
    title: info.title ?? info.sessionId,
    createdAt: at,
    modifiedAt: at,
    workingDirectories: [info.cwd, ...(info.additionalDirectories ?? [])].map((directory) => uriOf(directory)),
  };
};

/** Whether the handshake advertised the server's own catalogue. */
const listsSessions = (agentCapabilities: AgentCapabilities | undefined): boolean =>
  agentCapabilities?.sessionCapabilities?.list !== undefined && agentCapabilities.sessionCapabilities.list !== null;

/**
 * Whether the handshake advertised `session/delete`, by the options that read it.
 *
 * ACP owns the conversation, so whether there is a delete to send is the
 * server's own answer and only its handshake carries it. The agent's `delete`
 * reads this, which is why it is a getter rather than a property set once: an
 * agent built before the first listing has nothing to say yet, and a property
 * decided then would be a permanent `undefined` on a server that does support it.
 *
 * A dispose before the first `list()` therefore finds nothing and takes the
 * route a server without the capability takes, which the host logs.
 */
const deletesSessions = new WeakMap<AcpOptions, boolean>();

/** Whether the last handshake for these options advertised `session/delete`. */
export const deletes = (options: AcpOptions): boolean => deletesSessions.get(options) === true;

/** Whether these capabilities said the server supports `session/delete`. */
const deletesOf = (agentCapabilities: AgentCapabilities | undefined): boolean =>
  agentCapabilities?.sessionCapabilities?.delete !== undefined && agentCapabilities.sessionCapabilities.delete !== null;

/** The rows the watched sessions answer with, in the order they were opened. */
export const watchedRows = (provider: string): Listed[] =>
  [...watched.values()].filter((one) => one.provider === provider).map(listedOf);

/** Watch one session, creating the record or refreshing the one already held. */
export function watchSession(fields: {
  provider: string;
  id: string;
  cwd: string;
  additional: string[];
  title: string;
  /** The updates a load replayed, which are the session's earlier turns. */
  replay?: SessionUpdate[];
}): WatchedSession {
  const at = new Date().toISOString();
  const known = watched.get(keyOf(fields.provider, fields.id));
  if (known !== undefined) {
    known.cwd = fields.cwd;
    known.additional = fields.additional;
    if (fields.title !== '') known.title = fields.title;
    known.modifiedAt = at;
    prepend(known, fields.replay ?? [], at);
    return known;
  }
  const created: WatchedSession = {
    provider: fields.provider,
    id: fields.id,
    cwd: fields.cwd,
    additional: fields.additional,
    title: fields.title,
    createdAt: at,
    modifiedAt: at,
    turns: [],
  };
  watched.set(keyOf(fields.provider, fields.id), created);
  prepend(created, fields.replay ?? [], at);
  return created;
}

/**
 * Put a server's replay in front of the turns this process watched.
 *
 * What `session/load` sends is the conversation that was already had, so it
 * belongs ahead of anything watched since. A record that already holds turns is
 * left alone: every one of them came from an earlier replay or from this
 * process watching, so a second load is saying the same conversation again and
 * putting it in would read as one happening twice.
 */
function prepend(session: WatchedSession, replay: SessionUpdate[], at: string): void {
  if (replay.length === 0 || session.turns.length > 0) return;
  session.turns.push(...replayedTurns(replay, at));
}

/** One watched session, or nothing when this process never opened it. */
export function watchedSession(provider: string, id: string): WatchedSession | undefined {
  return watched.get(keyOf(provider, id));
}

/**
 * Ask the server to delete a session, and drop what this process knew of it.
 *
 * Only a server whose handshake advertised `sessionCapabilities.delete` can be
 * asked, and a server that has not been asked has no delete to send - which is
 * what `deletes` answers, and why the agent's `delete` is absent until the
 * handshake has been read.
 *
 * Both kinds of row go the same way. A session this process watched is the
 * bridge's own, but one the server listed is the server's, and the server is
 * what holds the conversation in either case; a bridge that only deleted what
 * it had opened would leave every listed row behind to be listed again.
 *
 * The record goes with the request, and so does the folder the listing
 * remembered. `catalogue` falls back to this record whenever the server lists
 * nothing, so a delete that removed the conversation but kept the row would
 * leave a catalogue offering a session no server can load - and a later read of
 * the same id would ask a server to load a session that is not there.
 *
 * A session the server says it does not have is deleted: the request refuses
 * with `resourceNotFound`, which is the protocol's own way of saying the thing
 * is not there, and a session deleted twice has to be one the bridge carries
 * out. Anything else is raised, because a conversation that would not go is a
 * delete that did not happen.
 */
export async function forgetSession(options: AcpOptions, provider: string, id: string): Promise<void> {
  const held = listingFor(options);
  try {
    await held.connection.deleteSession(id);
  }
  catch (error) {
    if ((error as { code?: unknown }).code !== NOT_FOUND) throw error;
  }
  finally {
    watched.delete(keyOf(provider, id));
    placeOf.delete(keyOf(provider, id));
    idleClose(options, held);
  }
}

/**
 * One ACP server spawned for a read, with the handlers it was given.
 *
 * The spawn is spelled once because a read and a session must reach the same
 * program the same way, and a read that spelled it differently would be a
 * bridge that answered from a server the operator never configured.
 */
const server = (options: AcpOptions, handlers: AcpHandlers): AcpConnection => connectAcp({
  command: options.command,
  ...(options.args === undefined ? {} : { args: options.args }),
  ...(options.env === undefined ? {} : { env: options.env }),
  ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
  handlers,
});

/**
 * One session this process never watched, asked of the server that still has it.
 *
 * ACP keeps the conversation and hands it back through `session/load`, so a
 * session opened after a restart is read by replaying it: the same updates a
 * live turn would have mapped, split into the turns they were. One connection
 * for the read, because a read is not a session and must not leave a server
 * behind.
 *
 * The load asks for the folder the server last said this conversation lives in,
 * because a server that keeps a conversation by its folder finds nothing when
 * asked with the daemon's. What the list said is the only answer to that this
 * bridge has, so the configuration's own folder is the fallback and the
 * daemon's is the last one.
 *
 * Undefined where the server cannot be asked - it never started, its handshake
 * did not advertise `loadSession`, or it holds no such conversation - which is
 * the same answer as for a session no server has, rather than an empty one.
 */
export async function loadedSession(
  options: AcpOptions,
  provider: string,
  id: string,
): Promise<WatchedSession | undefined> {
  const held = watchedSession(provider, id);
  if (held !== undefined) return held;
  const replay: SessionUpdate[] = [];
  let connection: AcpConnection | undefined;
  try {
    connection = server(options, { update: (_sessionId, update) => { replay.push(update); } });
    const handshake = await connection.initialize();
    if (handshake.agentCapabilities?.loadSession !== true) return undefined;
    const cwd = placeOf.get(keyOf(provider, id)) ?? options.cwd ?? process.cwd();
    await connection.loadSession({ sessionId: id, cwd, mcpServers: [] });
    return watchSession({ provider, id, cwd, additional: [], title: id, replay });
  }
  catch {
    return undefined;
  }
  finally {
    connection?.close();
  }
}

/**
 * The listing connection this provider holds, or a new one.
 *
 * Keyed by the options rather than by the provider, because one process can
 * register the same provider twice with two different commands and each is its
 * own server. The options are the registration's own object, so the key is that
 * and nothing has to be spelled a second time to be equal to it.
 */
const listingFor = (options: AcpOptions): Listing => {
  const known = listings.get(options);
  if (known !== undefined) return known;
  const held: Listing = { connection: server(options, { update: () => {} }) };
  listings.set(options, held);
  // A server that is gone cannot answer the next read, so it is not kept.
  void held.connection.ended.then(() => { dropListing(options, held); });
  return held;
};

/** Let a provider go of its listing connection, and stop the timer that would. */
const dropListing = (options: AcpOptions, held: Listing): void => {
  if (listings.get(options) !== held) return;
  listings.delete(options);
  if (held.idle !== undefined) clearTimeout(held.idle);
  void held.connection.close();
};

/** Arm the close of a connection nobody has read from in a minute. */
const idleClose = (options: AcpOptions, held: Listing): void => {
  if (listings.get(options) !== held) return;
  if (held.idle !== undefined) clearTimeout(held.idle);
  const timer = setTimeout(() => { dropListing(options, held); }, IDLE_MS);
  timer.unref();
  held.idle = timer;
};

/**
 * The sessions the server lists, or this process's own record when it cannot.
 *
 * One connection for the whole catalogue rather than one per read: a client
 * subscribes to a chat by asking for the list, and spawning a server for each
 * of those is a subprocess per subscribe for a catalogue that has not changed.
 * It goes a minute after the last read, so a provider nobody is watching costs
 * nothing, and it is dropped at once when the server behind it dies.
 *
 * The pages are followed to the end, because `session/list` is paged and a
 * server holding more than one page of conversations is otherwise a bridge that
 * reports a list of only the ones it happened to be shown. A server that cannot
 * be reached, or one whose listing fails, falls back to the record - a
 * catalogue read must answer, and must never take the daemon down over a
 * subprocess that did not start.
 */
export async function catalogueOf(options: AcpOptions, provider: string): Promise<Listed[]> {
  const now = new Date().toISOString();
  const held = listingFor(options);
  try {
    const handshake = await held.connection.initialize();
    /*
     * What the server said it can do, kept for the agent's `delete` rather than
     * for this read: the handshake is the only place `session/delete` is ever
     * advertised, and this is the one call that reads it every time.
     */
    deletesSessions.set(options, deletesOf(handshake.agentCapabilities));
    if (!listsSessions(handshake.agentCapabilities)) return watchedRows(provider);
    const sessions: SessionInfo[] = [];
    let cursor: string | undefined;
    for (;;) {
      const request: ListSessionsRequest = {
        ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
        ...(cursor === undefined ? {} : { cursor }),
      };
      const page = await held.connection.listSessions(request);
      sessions.push(...page.sessions);
      // A cursor handed back twice is a server that would page forever.
      if (page.nextCursor === undefined || page.nextCursor === null || page.nextCursor === cursor) break;
      cursor = page.nextCursor;
    }
    for (const info of sessions) {
      placeOf.set(keyOf(provider, info.sessionId), info.cwd);
    }
    return sessions.map((info) => listedFrom(info, now));
  }
  catch {
    dropListing(options, held);
    return watchedRows(provider);
  }
  finally {
    idleClose(options, held);
  }
}

/**
 * Where this backend keeps a session's own state file.
 *
 * Nowhere: the ACP server owns the conversation and this bridge writes no file
 * of its own. Undefined is the contract's real answer for a backend that keeps
 * none, rather than a path to something that does not exist.
 */
export function stateFile(_id: string, _directory: string): string | undefined {
  return undefined;
}
