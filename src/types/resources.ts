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
