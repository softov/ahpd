/** The host's filesystem, as far as a client is allowed to see it. */

import type {
  ContentEncoding, ResourceChangeType, ResourceType, ResourceWriteMode,
} from '@microsoft/agent-host-protocol';

/*
 * The vocabularies below are the protocol's own, taken as `${Enum}` rather
 * than written out.
 *
 * A template literal over a string enum is the string union it declares, so
 * `'ready'` still assigns and `'complete'` is a compile error - and the words
 * come from the installed package rather than from a copy somebody made once.
 * A copy is what let a changeset report `status: 'complete'` for the life of
 * this host: the protocol says `ready`, nothing checked the difference, and a
 * conformant client read a changeset that never finished computing.
 *
 * Type-only, so nothing here imports a runtime value.
 */

/** One entry in a directory listing. */
export interface Entry {
  /** Base name, not a path. */
  name: string;
  /** Which of the two it is. A symlink is reported as what it points at. */
  type: Exclude<`${ResourceType}`, 'symlink'>;
}

/** What a path is, without opening it. */
export interface Metadata {
  /** The canonical URI, after symlinks unless they were not followed. */
  uri: string;
  /** Resource kind. */
  type: `${ResourceType}`;
  /** Size in bytes. Omitted for directories. */
  size?: number;
  /** ISO 8601 last-modified time. */
  mtime: string;
  /** ISO 8601 creation time. */
  ctime: string;
  /**
   * A weak validator for the bytes, as `resourceWrite`'s `ifMatch` reads it.
   *
   * Derived from size and modification time rather than from a hash of the
   * content: it exists to catch a lost update, so it has to be cheap enough to
   * produce on every stat, and two writes a millisecond apart that leave the
   * file the same length are not the case anybody is guarding against.
   */
  etag?: string;
}

/**
 * Where `data` goes in the file, as `ResourceWriteMode` has it.
 *
 * All three read `position` differently, which is the part worth stating: two
 * of them are rooted at the start of the file and `append` is rooted at its
 * end, so `position: 5` means "five bytes in" for the first two and "five
 * bytes before EOF" for the third.
 */
export type WriteMode = `${ResourceWriteMode}`;

/** One write, with everything the protocol lets a client ask for. */
export interface Write {
  /** The content, encoded as `encoding` says. */
  data: string;
  /** How to read `data`. Binary content MUST arrive base64. */
  encoding: `${ContentEncoding}`;
  /** How `data` is placed. `truncate` when the client says nothing. */
  mode?: WriteMode;
  /** The offset, read as `mode` says. Zero when the client says nothing. */
  position?: number;
  /** Refuse with `-32010` if the file is already there. */
  createOnly?: boolean;
  /** Refuse with `-32011` unless the file's current `etag` is this one. */
  ifMatch?: string;
}

/** One file's bytes, in whichever encoding was meaningful. */
export interface Read {
  /** The content, encoded as `encoding` says. */
  data: string;
  /** How `data` is encoded. Reported rather than assumed. */
  encoding: `${ContentEncoding}`;
  /** Sniffed MIME type, where there is one worth reporting. */
  contentType?: string;
}

/** What happened to one path, in the protocol's three words. */
export interface ResourceChange {
  uri: string;
  type: `${ResourceChangeType}`;
}

/** What a watch was asked to report. */
export interface WatchOptions {
  /** Report descendants too. Without it, the path itself and its direct children. */
  recursive?: boolean;
  /** Globs, relative to the watched root, whose matches are not reported. */
  excludes?: string[];
  /** Globs the reported set is restricted to. Absent reports everything not excluded. */
  includes?: string[];
}

/** A watch, for as long as somebody wants it. */
export interface Watcher {
  close(): void;
}

/**
 * The files a client reads through this host.
 *
 * A port, for the same reason `DirectoryFacts` is one: reading a directory is
 * `node:fs` on one runtime and something else on another, and a host embedded
 * in an editor may already have the file open. The whole filesystem, as the
 * reference host serves it: the connection token is what decides who may
 * read, and the served directories are where the catalogue looks.
 *
 * A host given none serves no `resource*` command at all - `-32601`, the same
 * answer it gives for anything else it does not have - and completes no `@`.
 *
 * It lives here rather than beside `HostOptions` because a backend is handed
 * one through `Start`, and `types/agent.ts` importing it from `host.ts` was a
 * cycle for no reason: the port describes files, not hosts.
 */
export interface ResourceStore {
  /** One directory's entries. */
  list(uri: string): Promise<Entry[]>;
  /** One file's bytes, or the range of them that was asked for. */
  read(uri: string, wanted?: string): Promise<Read>;
  /** What a URI is, without reading it. */
  resolve(uri: string, followSymlinks?: boolean): Promise<Metadata>;
  /** Paths under `base` that start with what is typed. */
  complete(typed: string, base: string, limit?: number): Promise<string[]>;

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
   * Nothing above these is gated: the write half is served to any connection,
   * so what a store leaves out is the whole of its answer about writing, and a
   * client the host will not write for is one the connection token never let
   * in. What is left to each method is what the path means, which is a store's
   * own business: a symlink, a directory, a parent that is not there.
   */

  /** Write, create or splice one file. */
  write?(uri: string, content: Write): Promise<void>;
  /** Remove a file, or a directory when `recursive`. */
  remove?(uri: string, recursive?: boolean): Promise<void>;
  /** Make a directory, and the parents it needs. */
  mkdir?(uri: string): Promise<void>;
  /** Rename. `failIfExists` refuses a destination already there. */
  move?(source: string, destination: string, failIfExists?: boolean): Promise<void>;
  /** Copy. `failIfExists` refuses a destination already there. */
  copy?(source: string, destination: string, failIfExists?: boolean): Promise<void>;

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
    options: WatchOptions,
    onChange: (changes: ResourceChange[]) => void,
  ): Promise<Watcher>;
}
