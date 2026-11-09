/**
 * The hosts that joined this one: who may, and who has.
 *
 * A node is a name and the hash of the token its `ahpd join` presents. The token
 * is minted once and shown once, and only its hash is kept: it opens the join
 * path and no other door, so a node's own credential reaches nothing here.
 *
 * The file is read on every question rather than cached, which is what makes
 * `ahpd node rm` take a node's token away from its next connection instead of
 * from the next start. It sits beside the users file, and is found the same way,
 * so a hub names one file and both are known.
 *
 * Beside the file is the registry of who is connected now. A node keeps one
 * control socket open, on which it says `node/hello` with the folder its
 * sessions start in; a session the hub wants is one `node/open` on that socket,
 * answered by a socket the node dials back, which is held as a `NestedHost` so
 * the nested proxy reads a connection as it reads a process.
 */

import { createHash, randomBytes } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { PassThrough } from 'node:stream';
import { INVALID_PARAMS, METHOD_NOT_FOUND, RpcError, stringParam } from './rpc.js';
import { readJson, writeJsonAtomic } from './utils/jsonfile.js';
import { same } from './listen.js';
import { AGENT_RECORD_VARIABLE } from './types/computers.js';
import type { NestedHost, NestedStart, NestedStarted } from './types/computers.js';
import type { NodeChange } from './types/host.js';
import type { Connected, Raw } from './types/listen.js';
import type { Peer } from './types/rpc.js';
import type { LogLevel } from './log.js';

/** One node: its name, and the hash of the token it joins with. */
export interface NodeRecord {
  id: string;
  /** `sha256:<hex>`, which is all of the token this host keeps. */
  token?: string;
}

/** What the file holds. */
export interface NodeFile {
  nodes?: NodeRecord[];
}

/** What `fileNodes` is given. */
export interface FileNodeOptions {
  /**
   * The file.
   *
   * Absent and empty both read as no nodes, which is a hub nobody has joined yet
   * rather than a broken one. A file that is there and malformed also reads as
   * no nodes - a broken file must fail closed - and it refuses to be written
   * over, because the hand that broke it may be the hand that meant to fix it.
   */
  path: string;
  /** One line for a file that will not parse. */
  onProblem?(message: string): void;
}

/**
 * The nodes file a users file keeps its nodes beside.
 *
 * `users.json` answers `users.nodes.json`, in the same folder: the nodes file
 * has no flag and no configuration key of its own, so an operator who names the
 * people names where the nodes are kept with it.
 */
export const nodesFileOf = (users: string): string =>
  `${users.endsWith('.json') ? users.slice(0, -'.json'.length) : users}.nodes.json`;

/**
 * The stored form of a token.
 *
 * SHA-256, with no salt and no stretching, as a person's is: a token this host
 * mints is 256 random bits, so there is nothing to guess and only its hash is
 * kept.
 */
const hashOf = (token: string): string =>
  `sha256:${createHash('sha256').update(token, 'utf8').digest('hex')}`;

/**
 * A name a node may have.
 *
 * No space, because a name is a word on a line and half of a machine id, and no
 * leading dash, which a command line would read as a flag rather than a name.
 */
const NAMED = /^[^\s-][^\s]*$/u;

/** The hosts this one lets in. */
export interface Nodes {
  /** Every node, without its token. */
  list(): Promise<{ id: string }[]>;
  /**
   * Add a node, or replace the token of one that is already there.
   *
   * Answers the token itself, which is the one time it is ever readable, and
   * keeps only its hash.
   */
  add(id: string): Promise<string>;
  /** Take a node out, answering whether one was there. */
  remove(id: string): Promise<boolean>;
  /** The name of the node that token belongs to, or nothing when it belongs to none. */
  verify(token: string): Promise<string | undefined>;
}

export function fileNodes(options: FileNodeOptions): Nodes {
  /** One line for a file that will not parse, said whenever it is read. */
  const told = (message: string): void => { options.onProblem?.(message); };

  /**
   * What the file says, and whether it said nothing because it is broken.
   *
   * Not there, or there and unopenable, is no nodes: a hub that nobody has
   * joined, and a path the daemon's own account cannot open. Neither is a broken
   * file, which is what says a change may still be written over it.
   */
  const read = (): { nodes: NodeRecord[]; broken: boolean } => {
    const outcome = readJson(options.path);
    if (!outcome.ok && outcome.kind !== 'not-json') return { nodes: [], broken: false };
    if (!outcome.ok) {
      /*
       * An empty file is one nobody has written to yet, and `JSON.parse` refuses
       * it the same way it refuses a broken one. So the file itself is looked at
       * here before the refusal below.
       */
      let text = '';
      try { text = readFileSync(options.path, 'utf8'); }
      catch { /* it went between the two reads, which leaves no nodes */ }
      if (text.trim() === '') return { nodes: [], broken: false };
      told(`${options.path} is not a nodes file (${outcome.error instanceof Error ? outcome.error.message : String(outcome.error)}); no node can join`);
      return { nodes: [], broken: true };
    }
    try {
      const parsed = outcome.value;
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error('not an object');
      const held = (parsed as { nodes?: unknown }).nodes;
      // A file holding no `nodes` key is one with nothing in it yet, which is
      // where a hub starts rather than a file to refuse.
      if (held === undefined) return { nodes: [], broken: false };
      if (!Array.isArray(held)) throw new Error('nodes is not a list');
      const nodes = held.map((one): NodeRecord => {
        if (typeof one !== 'object' || one === null || Array.isArray(one)) throw new Error('a node is not an object');
        const entry = one as Partial<NodeRecord>;
        if (typeof entry.id !== 'string' || entry.id === '') throw new Error('a node has no id');
        // A node with no token can never join, which is a file to fix rather
        // than one to read with half of it dropped.
        if (typeof entry.token !== 'string' || entry.token === '') throw new Error(`node ${entry.id} has no token`);
        return { id: entry.id, token: entry.token };
      });
      return { nodes, broken: false };
    }
    catch (error) {
      told(`${options.path} is not a nodes file (${error instanceof Error ? error.message : String(error)}); no node can join`);
      return { nodes: [], broken: true };
    }
  };

  /** Replace the file, atomically, refusing to clobber one that will not parse. */
  const write = (nodes: NodeRecord[]): void => {
    if (read().broken) throw new Error(`${options.path} is not a nodes file; fix it before changing which nodes join`);
    // Owner-only, by the default of `writeJsonAtomic`: the file holds the hashes
    // of the tokens that let other hosts in.
    writeJsonAtomic(options.path, { nodes });
  };

  return {
    list: async () => read().nodes.map((one) => ({ id: one.id })),

    add: async (id) => {
      if (!NAMED.test(id)) throw new Error(`${id} cannot name a node: it may not hold a space or begin with a dash`);
      const { nodes } = read();
      const token = randomBytes(32).toString('base64url');
      const record: NodeRecord = { id, token: hashOf(token) };
      // A node that is already there keeps its place and loses its old token,
      // which is what adding it again is for: a token is rotated, not doubled.
      const kept = nodes.some((one) => one.id === id)
        ? nodes.map((one) => (one.id === id ? record : one))
        : [...nodes, record];
      write(kept);
      return token;
    },

    remove: async (id) => {
      const { nodes } = read();
      const kept = nodes.filter((one) => one.id !== id);
      if (kept.length === nodes.length) return false;
      write(kept);
      return true;
    },

    verify: async (token) => {
      if (token === '') return undefined;
      const hash = hashOf(token);
      /*
       * Every hash is compared, and the answer is kept rather than returned, so
       * which node matched is not something the clock tells.
       */
      let found: string | undefined;
      for (const one of read().nodes) {
        if (one.token !== undefined && same(one.token, hash)) found = one.id;
      }
      return found;
    },
  };
}

/**
 * The path a node joins on, and the path every one of its sessions' sockets is.
 *
 * One path for both, told apart by the `data` the session's socket names: a
 * hub puts this path behind the nodes' own tokens, and everything else on the
 * port stays the clients'.
 */
export const JOIN_PATH = '/join';

/**
 * The oldest `ahpd` a node may run and be one of this hub's.
 *
 * `0.14.1` is the release that names a nested session by its inner transcript,
 * which is what a resume by id reads back. An older node names it
 * `<provider>:/<id>`, so a session there cannot be resumed after either side
 * restarts - refused at the join, in one sentence, rather than at that restart.
 */
const OLDEST_AHPD = '0.14.1';

/** How long a node has to answer `node/open`, and to dial the socket it was asked for. */
const OPEN_ANSWER_MS = 10_000;
const OPEN_SOCKET_MS = 20_000;

/**
 * How long a session waits for a node that is not connected now.
 *
 * A node's control socket drops when the node's `ahpd join` restarts, and it
 * dials again with a backoff of up to a minute. A session resumed in that
 * window is one a short wait brings back, rather than one that fails at the
 * least useful moment of its life.
 */
const RECONNECT_WAIT_MS = 10_000;

/** The numeric parts of a version, up to the first part that is not a number. */
const numbered = (version: string): number[] =>
  (version.trim().match(/^\d+(?:\.\d+)*/u)?.[0] ?? '0').split('.').map((part) => Number(part));

/** Whether a version is at least another, a missing part read as zero. */
const atLeast = (held: string, oldest: string): boolean => {
  const one = numbered(held);
  const other = numbered(oldest);
  for (let i = 0; i < Math.max(one.length, other.length); i++) {
    const left = one[i] ?? 0;
    const right = other[i] ?? 0;
    if (left !== right) return left > right;
  }
  return true;
};

/** One node whose control socket is open, and the folder its sessions start in. */
interface Live {
  node: string;
  peer: Peer;
  /** What its `node/hello` said, or nothing before it said anything. */
  workdir?: string;
}

/** One session a node was asked for, waiting for the socket it dials back. */
interface Opening {
  node: string;
  settle(error: Error | undefined, started?: NestedStarted): void;
  timer: ReturnType<typeof setTimeout>;
}

/** The session a socket's URL names, or nothing when it is a control socket. */
const sessionOf = (url: string | undefined): string | undefined => {
  const asked = /[?&]data=([^&]*)/u.exec(url ?? '');
  if (asked?.[1] === undefined) return undefined;
  try { return decodeURIComponent(asked[1]); }
  catch { return ''; } // A name nothing can read is a socket nothing asked for.
};

/** What `liveNodes` is given. */
export interface LiveOptions {
  /** The file `ahpd node add` wrote, which says who may join. */
  file: Nodes;
  /** One line worth keeping: a session a node would not open. Nothing is said without one. */
  log?(line: string, level?: LogLevel): void;
  /**
   * How long `connect` waits for a node that is not connected now, in
   * milliseconds. Default `RECONNECT_WAIT_MS`; a test names a shorter one.
   */
  reconnectMs?: number;
}

/**
 * The nodes that are connected to this host now, and the sessions they serve.
 *
 * The file says who may join; this says who has. A node is connected once its
 * control socket has said `node/hello`, which is the moment its working
 * directory is known and a session there can be asked for.
 */
export interface LiveNodes extends Nodes {
  /** Every node connected now, with the folder each serves sessions in. */
  joined(): { id: string; workdir: string }[];
  /** The connection a node's socket is, once the door has said whose it is. */
  accept(node: string, peer: Peer, url?: string): Connected | Raw;
  /**
   * A host inside the node, over the socket it opens for this session.
   *
   * `undefined` is "there is no node with that name", the answer the port gives
   * every other machine. A node of the file that is not connected throws.
   */
  connect(id: string, asked: NestedStart): Promise<NestedStarted | undefined>;
  /**
   * Called on each join and each departure, and once for every node already
   * connected when the watch is taken.
   *
   * The replay is what lets a watcher that starts after a node joined still
   * charge the node's whole stretch: a watcher sees the node exactly as it is
   * at that moment, then follows it.
   */
  watch(onChange: (change: NodeChange) => void): { close(): void };
  /** Take a node's connection away, which is what removing it on a served hub does. */
  drop(id: string): void;
}

/**
 * A session's socket, as the host inside the node.
 *
 * The proxy reads this as a process: what it writes to `stdin` is one message
 * to the node, and every message from the node is a line on `stdout`. A socket
 * has no exit code, so the end is said as `exit` and as `close`, which are the
 * two events the proxy listens for, and a kill is the socket closed.
 */
const hostOver = (peer: Peer): { host: NestedHost; raw: Raw } => {
  const events = new EventEmitter();
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  let ended = false;
  const end = (code: number | null, signal: string | null): void => {
    if (ended) return;
    ended = true;
    stdout.end();
    stderr.end();
    // Both, in this order: a process that closed had exited first, and the
    // proxy reads either as the host being gone.
    events.emit('exit', code, signal);
    events.emit('close', code, signal);
  };
  /*
   * A line written to the host is one message. The socket carries frames and
   * not a stream, so the write is cut where the transport ends its lines - and
   * a peer that cannot write a frame it did not build sends nothing, which is
   * a listener older than the join path.
   */
  stdin.on('data', (chunk: Buffer | string) => {
    for (const line of String(chunk).split('\n')) {
      if (line.trim() === '') continue;
      peer.raw?.(line);
    }
  });
  const host = {
    stdin,
    stdout,
    stderr,
    on: events.on.bind(events),
    kill: (signal?: NodeJS.Signals | number) => {
      end(null, signal === undefined ? null : String(signal));
      peer.close();
      return true;
    },
  } as unknown as NestedHost;
  return {
    host,
    raw: {
      raw: (text) => { if (!ended) stdout.write(text.endsWith('\n') ? text : `${text}\n`); },
      close: () => { end(null, null); },
    },
  };
};

export function liveNodes(options: LiveOptions): LiveNodes {
  /** The control socket of every node that has one open. */
  const kept = new Map<string, Live>();
  /** Every session a node was asked for and has not dialled back yet. */
  const opening = new Map<string, Opening>();
  /** The nodes a watcher has already been told are here. */
  const announced = new Set<string>();
  /** Everyone following the nodes that come and go. */
  const watchers = new Set<(change: NodeChange) => void>();

  /**
   * Tell every watcher one change, and remember where it left the node.
   *
   * A watcher that throws is not allowed to stop the one after it: a node
   * joining is this registry's work, and a stream of up time that breaks is
   * not a reason to stop admitting nodes.
   */
  const announce = (change: NodeChange): void => {
    if (change.joined) announced.add(change.id);
    else announced.delete(change.id);
    for (const one of [...watchers]) {
      try {
        one(change);
      }
      catch (error: unknown) {
        options.log?.(`a node watch failed on ${change.id}: ${error instanceof Error ? error.message : String(error)}`, 'error');
      }
    }
  };

  /** Fail every session this node was asked for that has not dialled yet. */
  const abandoned = (node: string, said: string): void => {
    for (const [id, asked] of [...opening]) {
      if (asked.node !== node) continue;
      opening.delete(id);
      clearTimeout(asked.timer);
      asked.settle(new Error(said));
    }
  };

  /**
   * Wait, up to `ms`, for a node to have a control socket that said hello.
   *
   * The answer is whether it arrived, not the connection: the caller reads the
   * connection itself, so a node that arrived and went in the same breath is
   * answered by the same question it started with.
   */
  const arrives = (id: string, ms: number): Promise<boolean> => new Promise((resolve) => {
    let settled = false;
    const done = (there: boolean): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      watchers.delete(listen);
      resolve(there);
    };
    const listen = (change: NodeChange): void => {
      if (change.id === id && change.joined) done(true);
    };
    const timer = setTimeout(() => { done(false); }, ms);
    (timer as unknown as { unref?(): void }).unref?.();
    watchers.add(listen);
    // A node that joined between the question and this line is here, and the
    // watch that was taken a moment too late would otherwise wait the bound.
    if (kept.get(id)?.workdir !== undefined) done(true);
  });

  /** The control socket: one per node, replaced when the node dials again. */
  const control = (node: string, peer: Peer): Connected => {
    const held: Live = { node, peer };
    const before = kept.get(node);
    kept.set(node, held);
    // A node that joined again before its old socket was noticed gone: the old
    // one is dropped here, and its close is not the node going.
    if (before !== undefined) before.peer.close();
    return {
      handle: async (request) => {
        if (request.method !== 'node/hello') {
          throw new RpcError(METHOD_NOT_FOUND, `${request.method} is not a node method`);
        }
        const versions = request.params['versions'];
        const ahpd = typeof versions === 'object' && versions !== null && typeof (versions as { ahpd?: unknown }).ahpd === 'string'
          ? (versions as { ahpd: string }).ahpd
          : undefined;
        if (ahpd === undefined) throw new RpcError(INVALID_PARAMS, 'node/hello must carry versions.ahpd');
        if (!atLeast(ahpd, OLDEST_AHPD)) {
          throw new RpcError(-32000, `This node runs ahpd ${ahpd}, and this hub needs ${OLDEST_AHPD} or newer to resume its sessions by id. Update ahpd on the node.`);
        }
        // The folder is the node's, and a session there starts in it: a path
        // this host names is a path on this host.
        held.workdir = stringParam(request.params, 'workdir', 'the folder sessions start in');
        // A node that said hello on the socket it already had, or that dialled
        // again, is one node: the stretch it is charged for does not restart.
        if (!announced.has(node)) announce({ id: node, joined: true, workdir: held.workdir });
        return { node, workdir: held.workdir };
      },
      close: () => {
        // A socket the node already replaced is not the node going.
        if (kept.get(node) !== held) return;
        kept.delete(node);
        abandoned(node, `node ${node} closed its connection`);
        announce({ id: node, joined: false });
      },
    };
  };

  /** The socket a session was asked for: it is the host inside the node. */
  const session = (node: string, id: string, peer: Peer): Raw => {
    const asked = opening.get(id);
    if (asked === undefined || asked.node !== node) {
      // A socket for a session this hub never asked this node for. Closed, and
      // nothing is read from it either way.
      peer.close();
      return { raw: () => { /* closed already */ }, close: () => { /* nothing was held */ } };
    }
    opening.delete(id);
    clearTimeout(asked.timer);
    const held = hostOver(peer);
    const workdir = kept.get(node)?.workdir;
    asked.settle(undefined, { host: held.host, ...(workdir === undefined ? {} : { workingDirectory: workdir }) });
    return held.raw;
  };

  const connect = async (id: string, asked: NestedStart): Promise<NestedStarted | undefined> => {
    let live = kept.get(id);
    if (live?.workdir === undefined) {
      // An id of no node of this hub is another port's to answer: a machine
      // this one does not serve rather than a node that is not here.
      const known = await options.file.list();
      if (!known.some((one) => one.id === id)) return undefined;
      /*
       * A node of the file that has no control socket is one whose `ahpd join`
       * is dialling again, most of the time: it is waited for, so a session
       * resumed the moment its node restarts comes back rather than failing
       * into a sentence nobody chose.
       */
      const wait = Math.max(0, options.reconnectMs ?? RECONNECT_WAIT_MS);
      const there = await arrives(id, wait);
      if (!there) throw new Error(`node ${id} is not connected: it did not join within ${String(wait)}ms`);
      live = kept.get(id);
    }
    if (live?.workdir === undefined) throw new Error(`node ${id} is not connected`);
    /*
     * The name the node dials back with, which is this hub's to choose: it is
     * one session, not one machine, and a node may carry many at once. It is
     * random rather than counted, so a socket for a session an earlier join
     * asked for is not one this join answers.
     */
    const open = randomBytes(8).toString('hex');
    let settle: (error: Error | undefined, started?: NestedStarted) => void = () => { /* set below */ };
    const arrived = new Promise<NestedStarted>((resolve, reject) => {
      settle = (error, started) => {
        if (error !== undefined) reject(error);
        else resolve(started as NestedStarted);
      };
    });
    const timer = setTimeout(() => {
      opening.delete(open);
      settle(new Error(`node ${id} answered for session ${open} and never dialled its socket`));
    }, OPEN_SOCKET_MS);
    (timer as unknown as { unref?(): void }).unref?.();
    opening.set(open, { node: id, settle, timer });
    try {
      // The plugins the node's host loads, and nothing about where: the node's
      // own folder is where its sessions start, and the answer to this is the
      // node saying it started one. A record agent's record goes without its
      // secrets, since a node is handed nothing of this host's vault.
      await live.peer.request('node/open', {
        id: open,
        plugins: asked.plugins,
        ...(asked.record === undefined ? {} : { env: { [AGENT_RECORD_VARIABLE]: JSON.stringify(asked.record.bare) } }),
      }, OPEN_ANSWER_MS);
    }
    catch (error: unknown) {
      opening.delete(open);
      clearTimeout(timer);
      const said = error instanceof Error ? error.message : String(error);
      options.log?.(`node ${id} did not open a session: ${said}`, 'error');
      throw new Error(`node ${id} did not open a session: ${said}`);
    }
    return arrived;
  };

  /** Take a node's connection away, and fail the sessions it had not dialled yet. */
  const drop = (id: string): void => {
    const held = kept.get(id);
    kept.delete(id);
    held?.peer.close();
    abandoned(id, `node ${id} was removed from this hub`);
    // Said here as well as at the close, because a socket that is being
    // closed may not have said it went yet.
    if (announced.has(id)) announce({ id, joined: false });
  };

  return {
    list: () => options.file.list(),
    // A replaced token is refused from now on, so the connection it opened goes
    // with it, and the node joins again with the new one.
    add: async (id) => {
      const token = await options.file.add(id);
      drop(id);
      return token;
    },
    remove: async (id) => {
      const gone = await options.file.remove(id);
      if (gone) drop(id);
      return gone;
    },
    verify: (token) => options.file.verify(token),

    joined: () => [...kept.values()].flatMap((one) => (one.workdir === undefined ? [] : [{ id: one.node, workdir: one.workdir }])),

    accept: (node, peer, url) => {
      const asked = sessionOf(url);
      return asked === undefined ? control(node, peer) : session(node, asked, peer);
    },

    connect,

    watch: (onChange) => {
      // Where the node is now, so a watcher that starts late still sees the
      // whole stretch rather than only what happens after it arrived.
      for (const one of [...kept.values()]) {
        if (one.workdir !== undefined) onChange({ id: one.node, joined: true, workdir: one.workdir });
      }
      watchers.add(onChange);
      return { close: () => { watchers.delete(onChange); } };
    },

    drop,
  };
}
