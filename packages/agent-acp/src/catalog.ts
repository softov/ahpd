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

import type { AgentCapabilities, ListSessionsRequest, SessionInfo } from '@agentclientprotocol/sdk';
import type { Listed } from '@ahpd/sdk';
import { connectAcp } from './connection.js';
import type { AcpConnection, AcpOptions, WatchedSession } from './types.js';

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
}): WatchedSession {
  const at = new Date().toISOString();
  const known = watched.get(keyOf(fields.provider, fields.id));
  if (known !== undefined) {
    known.cwd = fields.cwd;
    known.additional = fields.additional;
    if (fields.title !== '') known.title = fields.title;
    known.modifiedAt = at;
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
  return created;
}

/** One watched session, or nothing when this process never opened it. */
export function watchedSession(provider: string, id: string): WatchedSession | undefined {
  return watched.get(keyOf(provider, id));
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
    connection = connectAcp({
      command: options.command,
      ...(options.args === undefined ? {} : { args: options.args }),
      ...(options.env === undefined ? {} : { env: options.env }),
      ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
      handlers: { update: () => {} },
    });
    const handshake = await connection.initialize();
    if (!listsSessions(handshake.agentCapabilities)) return watchedRows(provider);
    const request: ListSessionsRequest = options.cwd === undefined ? {} : { cwd: options.cwd };
    const listed = await connection.listSessions(request);
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
