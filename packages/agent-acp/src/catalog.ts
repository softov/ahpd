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

/** One row for a session this process watched, in the contract's spelling. */
const listedOf = (session: WatchedSession): Listed => ({
  id: session.id,
  title: session.title,
  createdAt: session.createdAt,
  modifiedAt: session.modifiedAt,
  workingDirectories: [session.cwd, ...session.additional].map((directory) => `file://${directory}`),
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
    workingDirectories: [info.cwd, ...(info.additionalDirectories ?? [])].map((directory) => `file://${directory}`),
  };
};

/** Whether the handshake advertised the server's own catalogue. */
const listsSessions = (agentCapabilities: AgentCapabilities | undefined): boolean =>
  agentCapabilities?.sessionCapabilities?.list !== undefined && agentCapabilities.sessionCapabilities.list !== null;

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
 * for the read, as `catalogueOf` spawns one for a list, because a read is not a
 * session and must not leave a server behind.
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
 * The sessions the server lists, or this process's own record when it cannot.
 *
 * One connection per read rather than one held open: a bridge nobody asks to
 * list spawns nothing, and a read does not leave a server behind. A server that
 * cannot be reached, or one whose listing fails, falls back to the record - a
 * catalogue read must answer, and must never take the daemon down over a
 * subprocess that did not start.
 */
export async function catalogueOf(options: AcpOptions, provider: string): Promise<Listed[]> {
  const now = new Date().toISOString();
  let connection: AcpConnection | undefined;
  try {
    connection = server(options, { update: () => {} });
    const handshake = await connection.initialize();
    if (!listsSessions(handshake.agentCapabilities)) return watchedRows(provider);
    const request: ListSessionsRequest = options.cwd === undefined ? {} : { cwd: options.cwd };
    const listed = await connection.listSessions(request);
    for (const info of listed.sessions) {
      placeOf.set(keyOf(provider, info.sessionId), info.cwd);
    }
    return listed.sessions.map((info) => listedFrom(info, now));
  }
  catch {
    return watchedRows(provider);
  }
  finally {
    connection?.close();
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
