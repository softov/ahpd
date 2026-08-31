/** The protocol server: channels, subscriptions and requests. */

import type { Agent } from './agent.js';
import type { Entry, Metadata, Read, ResourceChange, WatchOptions, Watcher, Write as WriteContent } from './resources.js';
import type { Terminal, TerminalOptions } from './terminals.js';
import type { ChangesetSource } from './changes.js';
import type { Peer, Request } from './rpc.js';

/**
 * What a host can say about a directory beyond its path.
 *
 * Injected rather than built in. The interesting answers come from outside the
 * protocol - a branch is a `git` subprocess, and `git` is a binary that may
 * not be installed - and a host embedded in something that already knows them
 * should not have them read a second time. A host given none says only what a
 * path alone can tell it, which is the project's name.
 */
export interface DirectoryFacts {
  /**
   * What is known about a directory now, as the session's `_meta`.
   *
   * Synchronous and cheap, because it is asked for every description of every
   * session - a catalogue of a hundred rows asks a hundred times. Anything
   * that has to be fetched is fetched by `refresh` and cached here.
   *
   * The keys are the protocol's: `git` is the well-known one, and anything of
   * an implementation's own belongs under a namespace.
   */
  meta(dir: string): Record<string, unknown> | undefined;
  /**
   * Look again, answering whether anything actually moved.
   *
   * Asked once per served directory at startup and again whenever a turn
   * ends. Only a true answer reaches a client, so a directory that has not
   * changed costs nothing but the look.
   */
  refresh?(dir: string): Promise<boolean>;
}

/**
 * The files a client may read through this host.
 *
 * A port, for the same reason `DirectoryFacts` is one: reading a directory is
 * `node:fs` on one runtime and something else on another, and a host embedded
 * in an editor may already have the file open. `roots` arrives per call rather
 * than being captured, because a backend may learn of a directory after the
 * host started and the answer has to move with it.
 *
 * A host given none serves no `resource*` command at all - `-32601`, the same
 * answer it gives for anything else it does not have - and completes no `@`.
 */
export interface ResourceStore {
  /** One directory's entries. */
  list(uri: string, roots: string[], ): Promise<Entry[]>;
  /** One file's bytes, or the range of them that was asked for. */
  read(uri: string, roots: string[], wanted?: string): Promise<Read>;
  /** What a URI is, without reading it. */
  resolve(uri: string, roots: string[], followSymlinks?: boolean): Promise<Metadata>;
  /** Paths under `base` that start with what is typed. */
  complete(typed: string, base: string, roots: string[], limit?: number): Promise<string[]>;

  /*
   * The half that writes.
   *
   * Every one is optional and they are optional together: a store that has
   * none is a read-only filesystem, and the host answers `-32601` for each,
   * which is a different thing from refusing a particular path. `fileResources()`
   * has them all; a store over something that cannot be written - an archive,
   * a read-only mount, a fixture - simply leaves them out and says so by
   * omission rather than by throwing on every call.
   *
   * The host has already checked the client's `resourceRequest` grant before
   * any of these is reached. What is left to each is the path check, which is
   * a store's own business because only it knows what a path means.
   */

  /** Write, create or splice one file. */
  write?(uri: string, roots: string[], content: WriteContent): Promise<void>;
  /** Remove a file, or a directory when `recursive`. */
  remove?(uri: string, roots: string[], recursive?: boolean): Promise<void>;
  /** Make a directory, and the parents it needs. */
  mkdir?(uri: string, roots: string[]): Promise<void>;
  /** Rename, within the served directories on both ends. */
  move?(source: string, destination: string, roots: string[], failIfExists?: boolean): Promise<void>;
  /** Copy, within the served directories on both ends. */
  copy?(source: string, destination: string, roots: string[], failIfExists?: boolean): Promise<void>;

  /**
   * Tell me when that changes.
   *
   * Optional on its own rather than with the write half: watching is a read,
   * and a store may perfectly well serve bytes it cannot subscribe to - a
   * remote filesystem, an archive, a fixture. A host whose store has none
   * answers `-32601` for `createResourceWatch`, and the protocol's own client
   * treats that as a reason to degrade rather than to fail.
   *
   * `onChange` is called with a *batch*, because the filesystem reports one
   * event per file and a save is several: the protocol says a server coalesces
   * them, and an empty batch MUST NOT be dispatched. Closing the returned
   * handle is the only way to stop it - there is no dispose command, and
   * `unsubscribe` is what the host turns into this call.
   */
  watch?(
    uri: string,
    roots: string[],
    options: WatchOptions,
    onChange: (changes: ResourceChange[]) => void,
  ): Promise<Watcher>;
}

/**
 * The shells this host can open.
 *
 * A port, because a terminal is a subprocess: which one, and how it is
 * spawned, is the runtime's business rather than the protocol's. A host given
 * none serves neither `createTerminal` nor `disposeTerminal`, and says so with
 * `-32601` rather than opening nothing and reporting success.
 */
export interface TerminalStore {
  /** Open one, in a directory the host has already checked. */
  create(options: TerminalOptions): Terminal;
}

/** How to construct a host. */
export interface HostOptions {
  /**
   * The directory whose sessions this host serves, on the machine it runs on.
   *
   * Also the catalogue's scope: sessions outside it are neither listed nor
   * openable.
   */
  path: string;
  /**
   * The backends this host serves.
   *
   * At least one, and each with a `provider` no other has. The first is what
   * a client gets when it names none - which is the ordinary case, since a
   * client that has read the root channel names one and one that has not
   * cannot.
   *
   * Nothing in the host knows what any of them are. `claude()` is one that
   * ships with it; anything satisfying `Agent` is another.
   */
  agents: Agent[];
  /**
   * The files a client may read, and complete an `@` into.
   *
   * Left out, no `resource*` command is served. `fileResources()` is the one
   * that ships with this package, and the daemon uses it.
   */
  resources?: ResourceStore;
  /**
   * How to open a shell.
   *
   * Left out, no terminal can be created. `shellTerminals()` is the one that
   * ships with this package, and the daemon uses it.
   */
  terminals?: TerminalStore;
  /**
   * Where the file changes a session made come from.
   *
   * Left out, no session advertises a changeset and the changes screen is
   * honestly empty rather than emptily wrong. `gitChanges()` is the one that
   * ships with this package, and the daemon uses it.
   */
  changes?: ChangesetSource;
  /**
   * What this host can say about the directories it serves.
   *
   * Left out, sessions carry their project and nothing more. `gitBranches()`
   * is the one that ships with this package, and the daemon uses it.
   */
  directories?: DirectoryFacts;
  /** Called with one line per notable event, for a log. */
  onEvent?(message: string): void;
}

/** One connected client and what it is watching. */
export interface Connection {
  /** Where to write messages for this client. */
  peer: Peer;
  /** The identifier the client gave at `initialize`. */
  clientId: string;
  /**
   * Channel URIs this client subscribed to.
   *
   * Per connection: two clients can watch one channel, and dropping one must
   * not stop the other's stream.
   */
  watching: Set<string>;
  /**
   * Resource access this client has been granted, as `read:<uri>` / `write:<uri>`.
   *
   * Per connection and never per host: `resourceRequest` is a negotiation
   * between two peers, and a grant one client talked its way into is not one
   * every other client on the port inherits. Emptied when the connection goes,
   * because it goes with the set.
   */
  grants: Set<string>;
}

/** A protocol server. One host serves many connections. */
export interface Host {
  /**
   * Take a new client and return what answers it.
   *
   * The result's `handle` answers requests; its `close` must be called when
   * the connection drops, or the client's subscriptions leak.
   */
  accept(peer: Peer): {
    /** Answer one request from this client. */
    handle(request: Request): Promise<unknown>;
    /** Drop this client's subscriptions and state. */
    close(): void;
  };
  /** How many clients are currently connected. */
  connections(): number;
}
