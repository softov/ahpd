/** The host's filesystem, as far as a client is allowed to see it. */

/** One entry in a directory listing. */
export interface Entry {
  /** Base name, not a path. */
  name: string;
  /** Which of the two it is. A symlink is reported as what it points at. */
  type: 'file' | 'directory';
}

/** What a path is, without opening it. */
export interface Metadata {
  /** The canonical URI, after symlinks unless they were not followed. */
  uri: string;
  /** Resource kind. */
  type: 'file' | 'directory' | 'symlink';
  /** Size in bytes. Omitted for directories. */
  size?: number;
  /** ISO 8601 last-modified time. */
  mtime: string;
  /** ISO 8601 creation time. */
  ctime: string;
}

/** One file's bytes, in whichever encoding was meaningful. */
export interface Read {
  /** The content, encoded as `encoding` says. */
  data: string;
  /** How `data` is encoded. Reported rather than assumed. */
  encoding: 'utf-8' | 'base64';
  /** Sniffed MIME type, where there is one worth reporting. */
  contentType?: string;
}
