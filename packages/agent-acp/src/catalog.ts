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

import { RequestError } from '@agentclientprotocol/sdk';
import type { AgentCapabilities, SessionInfo, SessionUpdate } from '@agentclientprotocol/sdk';
import { bag, uriOf } from '@ahpd/sdk';
import type { Bag, Listed, SessionMachine } from '@ahpd/sdk';
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

/**
 * Where each session the server listed ran, by provider and the server's id.
 *
 * A listing reads one server per machine, and a session that ran in a machine
 * is loaded and deleted there too: a `session/load` that reached this host
 * would find nothing, because the conversation is the store of the server
 * inside the machine. What a listing learned is kept until a delete forgets
 * it, so a replay or a find of a listed row reaches the machine the same way
 * the listing did.
 */
const machineOf = new Map<string, SessionMachine>();

/**
 * The machines and host the last listing of one record was asked for.
 *
 * A find is the same listing a call to `list` is, and it is not handed the
 * machines itself. Kept here by the record that asked, so a find reads where
 * the listing read, and answers the row that listing would have answered.
 */
const locations = new WeakMap<AcpOptions, { machines?: SessionMachine[]; host?: boolean }>();

/**
 * The records whose host listing failed while they kept no session.
 *
 * The command may exist only in a machine, so a host listing of one is a
 * failure that says nothing about the server. Asked again at every read it
 * would spawn and fail a subprocess each time, with a line each: kept here
 * instead, so the record answers from the watched rows until it changes,
 * which a new record changes by being a new object.
 */
const failedOnHost = new WeakSet<AcpOptions>();

/**
 * The machine lines one record has already said.
 *
 * A listing runs at every client connect, while a machine that is stopped,
 * suspended or gone stays so for as long as the record lives. Kept per record
 * and machine, as the host failure above is, so each line is said once rather
 * than at every listing. A new record is a new object and says it again, which
 * is what a machine started or made since the last record needs.
 *
 * `saidOnMachine` holds the line about a machine that cannot be listed, and
 * `failedOnMachine` the line about a listing that failed. Two sets, so a
 * machine that starts later still says why its listing fails.
 */
const saidOnMachine = new WeakMap<AcpOptions, Set<string>>();
const failedOnMachine = new WeakMap<AcpOptions, Set<string>>();

/** Whether this record has not yet said a line of this kind about this machine. */
const firstWordOn = (said: WeakMap<AcpOptions, Set<string>>, options: AcpOptions, machine: string): boolean => {
  const machines = said.get(options) ?? new Set<string>();
  said.set(options, machines);
  if (machines.has(machine)) return false;
  machines.add(machine);
  return true;
};

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
 * goes, unless the record's `listingIdleMs` says otherwise: no time at all,
 * the connection closed once the read is done, as VS Code's Codex disposes of
 * the connection it opens for an action when the action ends.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/codex/codexAgent.ts#L2521-L2550
 */
const IDLE_MS = 0;

/** One provider's held connection to the server that lists its sessions. */
interface Listing {
  connection: AcpConnection;
  /** The reads in flight on it. */
  reads: number;
  /** Armed once the last read in flight settles, and disarmed by the next one. */
  idle?: NodeJS.Timeout | undefined;
}

/**
 * How long the rows a `find` read answer the finds that come after it.
 *
 * ACP 1.6.0 cannot be asked about one session, so every `find` of an id this
 * server does not have is the whole of that server's catalogue, paged to the
 * end. A client opening a run of sessions - a stale list, a link to each of
 * several conversations - asks for one id after another, and each of those is
 * that listing again unless the rows it read are kept a moment.
 *
 * Two seconds unless the record's `findFreshMs` says otherwise, which is what
 * the host's own listing throttle allowed before this path could answer by id:
 * long enough for the asks of one opening screen and short enough that a
 * session the server has just been told about is not refused for long. A
 * command that fails to start is kept the same way and for the same window,
 * because a server that did not start does not start on the next missing id
 * either, and respawning it once per id is a subprocess per subscribe to a
 * session nobody has. A window of 0 joins only the listing in flight.
 */
const FIND_FRESH = 2_000;

/** The rows a find is reading, and the ones it read last. */
interface Finds {
  /** The listing in flight, so a find asking now joins it rather than starting one. */
  running: Promise<Listed[]> | undefined;
  /** When the rows landed, which is what the window above is dated by. */
  at: number;
  rows: Listed[];
}

/** The rows the last find of a provider read, by the options that read them. */
const finds = new WeakMap<AcpOptions, Finds>();

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
 * invented out of nothing. A session the server gave no time is dated at the
 * epoch, as VS Code's Codex dates a thread with none, so it sorts as the
 * oldest. A session the server never titled is listed with an empty title,
 * which a client draws as an untitled session, as VS Code lists a provider's
 * session that has no summary.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/codex/codexAgent.ts#L8202-L8204
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentService.ts#L6141-L6146
 */
const listedFrom = (info: SessionInfo): Listed => {
  const at = info.updatedAt ?? new Date(0).toISOString();
  return {
    id: info.sessionId,
    title: info.title ?? '',
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
 * reads this, which is why it is a getter rather than a property set once:
 * absent once a handshake said the server keeps its sessions, and a delete
 * that reads the handshake itself while none has been read.
 */
const deletesSessions = new WeakMap<AcpOptions, boolean>();

/**
 * Whether the last handshake for these options advertised `session/delete`,
 * and `undefined` while no handshake has been read.
 */
export const deletes = (options: AcpOptions): boolean | undefined => deletesSessions.get(options);

/** Whether these capabilities said the server supports `session/delete`. */
const deletesOf = (agentCapabilities: AgentCapabilities | undefined): boolean =>
  agentCapabilities?.sessionCapabilities?.delete !== undefined && agentCapabilities.sessionCapabilities.delete !== null;

/**
 * Whether the server behind these options advertised `session/fork`, as its
 * last handshake said, a listing's or a session's.
 *
 * What the agent's `chats.fork` is read from, so the host offers a fork only
 * for an agent whose server can make one, as VS Code's agents advertise fork
 * only where they can fork their chats. Nothing until a server has spoken.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/claude/claudeAgent.ts#L741-L742
 */
const forksSessions = new WeakMap<AcpOptions, boolean>();

/** Whether the last handshake for these options advertised `session/fork`. */
export const forks = (options: AcpOptions): boolean => forksSessions.get(options) === true;

/** Keep what one handshake said the server can do with its sessions. */
export const heardCapabilities = (options: AcpOptions, agentCapabilities: AgentCapabilities | undefined): void => {
  deletesSessions.set(options, deletesOf(agentCapabilities));
  const fork = agentCapabilities?.sessionCapabilities?.fork;
  forksSessions.set(options, fork !== undefined && fork !== null);
};

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
  /** The turns the host already held, for a resume no replay was sent for. */
  seed?: Bag[];
}): WatchedSession {
  const at = new Date().toISOString();
  const known = watched.get(keyOf(fields.provider, fields.id));
  /*
   * A watch moves no time of the record: a session opened, resumed or read is
   * not a session changed, as VS Code's Codex keeps a resume from moving its
   * thread's time. A turn moves `modifiedAt` as the reducer moves the chat's.
   */
  if (known !== undefined) {
    known.cwd = fields.cwd;
    known.additional = fields.additional;
    if (fields.title !== '') known.title = fields.title;
    prepend(known, fields.replay ?? [], at);
    hold(known, fields.seed ?? []);
    return known;
  }
  /*
   * A conversation the host already held is dated by its turns, the one
   * account of it that carries times: it began at its first turn's start and
   * last changed at its last turn's end, as the reducer dates a chat. ACP
   * lists one time, `updatedAt`, and a replay's updates carry none, so a
   * session with no held turns is dated by the moment it was made here.
   */
  const first = fields.seed?.[0];
  const last = fields.seed?.at(-1);
  const ended = typeof last?.startedAt === 'string' ? Date.parse(last.startedAt) + (typeof last.duration === 'number' ? last.duration : 0) : Number.NaN;
  const created: WatchedSession = {
    provider: fields.provider,
    id: fields.id,
    cwd: fields.cwd,
    additional: fields.additional,
    title: fields.title,
    createdAt: typeof first?.startedAt === 'string' ? first.startedAt : at,
    modifiedAt: Number.isFinite(ended) ? new Date(ended).toISOString() : at,
    turns: [],
    held: [],
  };
  watched.set(keyOf(fields.provider, fields.id), created);
  prepend(created, fields.replay ?? [], at);
  hold(created, fields.seed ?? []);
  return created;
}

/**
 * Keep the turns the host already held, when the record has none of its own.
 *
 * A resume is answered without a replay, so this is the only record of the
 * conversation this process will have: what the host held when it asked. A
 * record that already holds turns, watched or replayed, is left alone - a
 * `session/load` replay is the server's own account of the same conversation,
 * and keeping the host's as well would put every turn in twice.
 */
function hold(session: WatchedSession, seed: Bag[]): void {
  if (seed.length === 0 || session.turns.length > 0 || session.held.length > 0) return;
  session.held = [...seed];
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
 * asked, so the handshake is read first, on the connection the request goes
 * out on, as ACP has a client check the `initialize` answer before
 * `session/delete`. A server it shows keeping its sessions is sent nothing: the
 * delete says in the log that the server keeps its copy, as the host says for
 * an agent with no delete, and resolves, the agent's `delete` absent from then.
 * https://agentclientprotocol.com/protocol/v1/session-delete
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
export async function forgetSession(options: AcpOptions, provider: string, id: string, machine?: SessionMachine): Promise<void> {
  if (machine !== undefined) {
    await forgetInMachine(options, provider, id, machine);
    return;
  }
  const held = listingFor(options);
  try {
    await deleteThrough(held.connection, options, provider, id);
  }
  finally {
    idleClose(options, held);
  }
}

/**
 * One session deleted from a server that ran in a machine.
 *
 * The conversation is the store of the server inside the machine, so the
 * delete goes to a server spawned there the way the session's own was, rather
 * than to the listing server on this host, which never held it. That server is
 * spawned for this one delete and stopped after it.
 *
 * A machine the port no longer has took the conversation with it, so the
 * delete is done; a port that cannot reach its runtime throws, and so does the
 * delete.
 */
async function forgetInMachine(options: AcpOptions, provider: string, id: string, machine: SessionMachine): Promise<void> {
  const connection = await serverIn(options, machine, { update: () => {} });
  if (connection === undefined) {
    options.log?.(`${provider}: computer://${machine.id} is gone, and ${id} with it`);
    forgotten(options, provider, id);
    return;
  }
  try {
    await deleteThrough(connection, options, provider, id);
  }
  finally {
    await connection.close();
  }
}

/**
 * One server spawned inside a machine, or nothing when the port no longer has
 * that machine.
 *
 * The spawn is spelled as a session's own is, in `session/opening.ts`: the
 * record's command and its environment, and no `cwd`, because the session's
 * folder is this host's and the port uses the machine's own when none is
 * named. Every read that reaches a machine goes through here, so a listing, a
 * replay and a delete reach the same program the same way.
 */
async function serverIn(options: AcpOptions, machine: SessionMachine, handlers: AcpHandlers): Promise<AcpConnection | undefined> {
  const spawn = await machine.computers.how(machine.id, {
    command: options.command,
    ...(options.args === undefined ? {} : { args: options.args }),
    ...(options.env === undefined ? {} : { env: options.env }),
  });
  if (spawn === undefined) return undefined;
  return connectAcp({
    command: spawn.command,
    args: spawn.args,
    ...(spawn.env === undefined ? {} : { env: spawn.env }),
    ...(spawn.cwd === undefined ? {} : { cwd: spawn.cwd }),
    handlers,
    ...(options.log === undefined ? {} : { log: options.log }),
    ...(options.exitGraceMs === undefined ? {} : { exitGraceMs: options.exitGraceMs }),
    ...(options.stderrBytes === undefined ? {} : { stderrBytes: options.stderrBytes }),
    ...(options.killGraceMs === undefined ? {} : { killGraceMs: options.killGraceMs }),
  });
}

/** The handshake, then `session/delete` where the server advertises it, over one connection. */
async function deleteThrough(connection: AcpConnection, options: AcpOptions, provider: string, id: string): Promise<void> {
  const handshake = await connection.initialize();
  heardCapabilities(options, handshake.agentCapabilities);
  if (deletes(options) !== true) {
    options.log?.(`${provider} keeps its own copy of a deleted session, so it may be listed again`);
    return;
  }
  try {
    await connection.deleteSession(id);
  }
  catch (error) {
    if ((error as { code?: unknown }).code !== NOT_FOUND) throw error;
  }
  finally {
    forgotten(options, provider, id);
  }
}

/**
 * This process's records of a deleted session, gone.
 *
 * The rows a find read are a moment old, and a delete is the one change they
 * cannot have: kept over it, a find right after a delete would answer the
 * session the server has just dropped, and the host would offer it again. They
 * go, so the next find lists the server again.
 */
const forgotten = (options: AcpOptions, provider: string, id: string): void => {
  finds.delete(options);
  watched.delete(keyOf(provider, id));
  placeOf.delete(keyOf(provider, id));
  machineOf.delete(keyOf(provider, id));
};

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
  ...(options.log === undefined ? {} : { log: options.log }),
  ...(options.exitGraceMs === undefined ? {} : { exitGraceMs: options.exitGraceMs }),
  ...(options.stderrBytes === undefined ? {} : { stderrBytes: options.stderrBytes }),
  ...(options.killGraceMs === undefined ? {} : { killGraceMs: options.killGraceMs }),
});

/**
 * One session this process never watched, asked of the server that still has it.
 *
 * ACP keeps the conversation and hands it back through `session/load`, so a
 * session opened after a restart is read by replaying it: the same updates a
 * live turn would have mapped, split into the turns they were. One connection
 * for the read, because a read is not a session and must not leave a server
 * behind, and the turn that follows loads again rather than reusing it: a
 * connection's capabilities are fixed by the handlers it is spawned with, and
 * a read has no session to give it file, terminal or permission handlers.
 *
 * The load asks for the folder the server last said this conversation lives in,
 * because a server that keeps a conversation by its folder finds nothing when
 * asked with the daemon's. After a restart no list has said one, so the folder
 * the host recorded for the session comes next, then the configuration's own
 * folder, and the daemon's is the last one.
 *
 * `machine` is where the session ran, when the listing that named it said so:
 * the conversation is that machine's server's store, so the load is asked
 * there. A machine the port no longer has is a session no server holds, the
 * same answer as a load that found nothing; a port that cannot reach its
 * runtime throws, as the session's own spawn did.
 *
 * Undefined where the handshake did not advertise `loadSession` or the server
 * answers that it holds no such conversation, ACP's resource not found, the
 * same answer as for a session no server has. A server that does not start and
 * a load that fails otherwise raise the failure to the caller, as VS Code's
 * read of a session it knows lets one through.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/copilot/copilotAgent.ts#L7933-L7939
 */
export async function loadedSession(
  options: AcpOptions,
  provider: string,
  id: string,
  recorded?: string,
  machine?: SessionMachine,
): Promise<WatchedSession | undefined> {
  const held = watchedSession(provider, id);
  if (held !== undefined) return held;
  const replay: SessionUpdate[] = [];
  let connection: AcpConnection | undefined;
  try {
    connection = machine === undefined
      ? server(options, { update: (_sessionId, update) => { replay.push(update); } })
      : await serverIn(options, machine, { update: (_sessionId, update) => { replay.push(update); } });
    if (connection === undefined) return undefined;
    const handshake = await connection.initialize();
    if (handshake.agentCapabilities?.loadSession !== true) return undefined;
    const cwd = placeOf.get(keyOf(provider, id)) ?? recorded ?? options.cwd ?? process.cwd();
    const loaded = await connection.loadSession({ sessionId: id, cwd, mcpServers: [] }).then(
      () => true,
      (why: unknown) => {
        if (bag(why).code === RequestError.resourceNotFound().code) return false;
        throw why;
      },
    );
    if (!loaded) return undefined;
    // A load names no title, so the record holds none, as an untitled row is listed.
    return watchSession({ provider, id, cwd, additional: [], title: '', replay });
  }
  finally {
    connection?.close();
  }
}

/**
 * The listing connection this provider holds, or a new one, for one read,
 * which `idleClose` ends.
 *
 * Keyed by the options rather than by the provider, because one process can
 * register the same provider twice with two different commands and each is its
 * own server. The options are the registration's own object, so the key is that
 * and nothing has to be spelled a second time to be equal to it.
 */
const listingFor = (options: AcpOptions): Listing => {
  const known = listings.get(options);
  if (known !== undefined) {
    known.reads += 1;
    if (known.idle !== undefined) clearTimeout(known.idle);
    known.idle = undefined;
    return known;
  }
  const held: Listing = { connection: server(options, { update: () => {} }), reads: 1 };
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

/**
 * How many pages of `session/list` one listing reads at most, unless the
 * record's `sessionListMaxPages` says otherwise, so a server that never stops
 * handing back cursors cannot hold a listing for ever: VS Code's Codex agent's
 * stop for its own paged listing.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/codex/codexThreadList.ts#L15-L16
 */
const SESSION_LIST_MAX_PAGES = 50;

/** End one read, and arm the close of a connection no read is in flight on. */
const idleClose = (options: AcpOptions, held: Listing): void => {
  held.reads -= 1;
  if (listings.get(options) !== held || held.reads > 0) return;
  const idle = options.listingIdleMs ?? IDLE_MS;
  if (idle === 0) {
    dropListing(options, held);
    return;
  }
  if (held.idle !== undefined) clearTimeout(held.idle);
  const timer = setTimeout(() => { dropListing(options, held); }, idle);
  timer.unref();
  held.idle = timer;
};

/**
 * The sessions the server lists, or this process's own record when it cannot.
 *
 * The listing's connection serves every read made while it is held. It goes
 * once the read is done, as VS Code's Codex disposes of the connection it opens
 * for an action, or the record's `listingIdleMs` after the last read, and at
 * once when the server behind it dies.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/codex/codexAgent.ts#L2521-L2550
 *
 * Every session the server holds is asked for, with no folder named, as VS
 * Code's Codex agent lists every thread it holds: a conversation this host ran
 * in another folder is one of this agent's sessions all the same.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/codex/codexThreadList.ts#L34-L40
 *
 * The pages are followed to the end, because `session/list` is paged and a
 * server holding more than one page of conversations is otherwise a bridge that
 * reports a list of only the ones it happened to be shown. The cursors handed
 * back are kept, and a cursor handed back a second time, or a page past the
 * record's `sessionListMaxPages`, ends the listing with what it read and a line
 * in the log, as VS Code's Codex agent stops its own.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/codex/codexThreadList.ts#L42-L69
 *
 * A server that cannot be reached, or one whose listing fails, rejects with the
 * failure, logged, as VS Code's Codex agent answers a listing it cannot make so
 * the orchestrator asks again rather than reading an empty catalogue; the host
 * keeps the rows it last had for this agent and asks at its next read. The one
 * exception is the record that keeps no session at all: its command may exist
 * only in a machine, so a host listing of it says nothing about the server.
 * After that failure it answers from the watched rows until its record
 * changes, with one line, as the same answer for every read.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/codex/codexAgent.ts#L8043-L8052
 *
 * `machines` is where the caller kept this backend's sessions, and `host`
 * whether one of them ran here. Absent `machines` is no kept session, and the
 * listing is the host's alone, as it always was. A machine is one spawn of the
 * record's command through the port the caller built; a machine the port no
 * longer has, or one whose listing fails, contributes nothing and the rest are
 * still read. The port's `state` is asked before a machine is spawned in: only
 * a running machine is read, and a stopped, suspended or gone one answers the
 * watched rows with one line for as long as the record lives. The rows every
 * machine lists are this answer, and a watched row answers when no server
 * listed at all.
 */
export async function catalogueOf(
  options: AcpOptions,
  provider: string,
  machines?: SessionMachine[],
  host?: boolean,
): Promise<Listed[]> {
  if (machines !== undefined || host !== undefined) {
    locations.set(options, {
      ...(machines === undefined ? {} : { machines }),
      ...(host === undefined ? {} : { host }),
    });
  }
  const rows = new Map<string, Listed>();
  let listed = false;
  for (const machine of machines ?? []) {
    let connection: AcpConnection | undefined;
    try {
      /*
       * Asked before the spawn: a machine that is stopped or suspended cannot
       * run the command, and one that is gone has nothing to reach. A port
       * with no state to read is spawned in as it always was.
       */
      let state: 'running' | 'stopped' | 'suspended' | undefined;
      if (machine.computers.state === undefined) state = 'running';
      else {
        try {
          state = await machine.computers.state(machine.id);
        }
        catch (error) {
          if (firstWordOn(saidOnMachine, options, machine.id)) {
            options.log?.(`${provider}: computer://${machine.id}: its state could not be read, so its sessions come from the watched rows: ${error instanceof Error ? error.message : String(error)}`, 'error');
          }
          continue;
        }
      }
      if (state !== 'running') {
        if (firstWordOn(saidOnMachine, options, machine.id)) {
          options.log?.(`${provider}: computer://${machine.id} is ${state ?? 'gone'}, so its sessions come from the watched rows`);
        }
        continue;
      }
      connection = await serverIn(options, machine, { update: () => {} });
      if (connection === undefined) {
        if (firstWordOn(saidOnMachine, options, machine.id)) {
          options.log?.(`${provider}: computer://${machine.id} is gone, so its sessions come from the watched rows`);
        }
        continue;
      }
      const read = await listedBy(options, provider, connection, machine);
      if (read === undefined) continue;
      listed = true;
      for (const row of read) if (!rows.has(row.id)) rows.set(row.id, row);
    }
    catch (error) {
      if (firstWordOn(failedOnMachine, options, machine.id)) {
        options.log?.(`${provider}: computer://${machine.id}: session/list failed: ${error instanceof Error ? error.message : String(error)}`, 'error');
      }
    }
    finally {
      await connection?.close();
    }
  }
  const onHost = host ?? true;
  if (onHost && !failedOnHost.has(options)) {
    const held = listingFor(options);
    try {
      const read = await listedBy(options, provider, held.connection);
      if (read !== undefined) {
        listed = true;
        for (const row of read) if (!rows.has(row.id)) rows.set(row.id, row);
      }
    }
    catch (error) {
      dropListing(options, held);
      options.log?.(`${provider}: session/list failed: ${error instanceof Error ? error.message : String(error)}`, 'error');
      if (machines !== undefined) throw error;
      failedOnHost.add(options);
    }
    finally {
      idleClose(options, held);
    }
  }
  return listed ? [...rows.values()] : watchedRows(provider);
}

/**
 * The rows one server lists, or nothing when its handshake advertises no
 * catalogue.
 *
 * The pages are followed to the end, because `session/list` is paged and a
 * server holding more than one page of conversations is otherwise a bridge
 * that reports a list of only the ones it happened to be shown. The cursors
 * handed back are kept, and a cursor handed back a second time, or a page past
 * the record's `sessionListMaxPages`, ends the listing with what it read and a
 * line in the log, as VS Code's Codex agent stops its own.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/codex/codexThreadList.ts#L42-L69
 *
 * `machine` is where the server ran, when it ran in one: every session it
 * lists is remembered as that machine's, so a replay reaches the store that
 * holds the conversation rather than this host's store, which never did.
 */
const listedBy = async (
  options: AcpOptions,
  provider: string,
  connection: AcpConnection,
  machine?: SessionMachine,
): Promise<Listed[] | undefined> => {
  const handshake = await connection.initialize();
  /*
   * What the server said it can do, kept for the agent's `delete` and
   * `chats.fork` rather than for this read: the handshake is the only place
   * `session/delete` and `session/fork` are ever advertised.
   */
  heardCapabilities(options, handshake.agentCapabilities);
  if (!listsSessions(handshake.agentCapabilities)) return undefined;
  const sessions: SessionInfo[] = [];
  const seenCursors = new Set<string>();
  const pagesMost = options.sessionListMaxPages ?? SESSION_LIST_MAX_PAGES;
  let cursor: string | undefined;
  for (let pages = 1; ; pages += 1) {
    const page = await connection.listSessions(cursor === undefined ? {} : { cursor });
    sessions.push(...page.sessions);
    const nextCursor = page.nextCursor ?? undefined;
    if (nextCursor === undefined) break;
    if (seenCursors.has(nextCursor) || pages >= pagesMost) {
      options.log?.(`${provider}: session/list stopped before the end of the catalogue after ${sessions.length} sessions (at most ${pagesMost} pages); some sessions may be missing`, 'warn');
      break;
    }
    seenCursors.add(nextCursor);
    cursor = nextCursor;
  }
  for (const info of sessions) {
    placeOf.set(keyOf(provider, info.sessionId), info.cwd);
    if (machine !== undefined) machineOf.set(keyOf(provider, info.sessionId), machine);
  }
  return sessions.map(listedFrom);
};

/**
 * The machine a session the listing named ran in, or nothing where none did.
 *
 * What the caller that replays a session and the find that asks for its row
 * read to reach the store that holds it. Undefined is a session no listing has
 * named yet, which is read on this host as it always was.
 */
export const machineFor = (provider: string, id: string): SessionMachine | undefined => machineOf.get(keyOf(provider, id));

/**
 * The rows a find reads, shared with the finds asking at the same time.
 *
 * A find is the same listing `catalogueOf` does, and the only thing this adds
 * is that the asks of one client are not one listing each: a find asking while
 * one is out joins it, and a find asking inside `FIND_FRESH` of the last answer
 * is answered from it. A listing that fails answers a find from the watched
 * records, so a find never throws over a server that did not start, and that
 * answer is kept the same way a listing's rows are: the command behind it is
 * not spawned again for that window.
 */
const rowsForFind = (options: AcpOptions, provider: string): Promise<Listed[]> => {
  const known = finds.get(options);
  if (known !== undefined) {
    if (known.running !== undefined) return known.running;
    if (Date.now() - known.at < (options.findFreshMs ?? FIND_FRESH)) return Promise.resolve(known.rows);
  }
  const held: Finds = { running: undefined, at: 0, rows: [] };
  const where = locations.get(options);
  const running = catalogueOf(options, provider, where?.machines, where?.host).catch(() => watchedRows(provider)).then((rows) => {
    held.rows = rows;
    held.at = Date.now();
    return rows;
  });
  held.running = running;
  finds.set(options, held);
  const settle = (): void => { if (held.running === running) held.running = undefined; };
  void running.then(settle, settle);
  return running;
};

/**
 * One session's row, asked for by id.
 *
 * ACP 1.6.0 has no call that describes one session: `session/list` filters by
 * `cwd` and `cursor` and by nothing else, and `session/load` replays the whole
 * conversation to answer modes and config rather than a title, a time or a
 * folder. Listing is therefore the only way to a row, and it is one server's
 * listing rather than every agent the host has, which is what a missing id
 * costs here.
 *
 * The row is the row `catalogueOf` answers, and nothing else, because that is
 * the row `list` answers: a find that preferred the record of a session this
 * process is watching would answer a title or a time the listing does not have,
 * and the host would tell every client that row changed for a session that did
 * not. A server that does not list at all is answered from the watched records
 * by `catalogueOf` itself, and a listing that failed by `rowsForFind`.
 */
export async function findListed(options: AcpOptions, provider: string, id: string): Promise<Listed | undefined> {
  return (await rowsForFind(options, provider)).find((row) => row.id === id);
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
