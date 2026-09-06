/**
 * What a host knows about a session that no backend does.
 *
 * Two things, and they have nothing in common except who owns them. `flags`
 * are the client bits every connection shares - `IsRead` says somebody has
 * looked since the last change, `IsArchived` says somebody put it away - and
 * `config` is the settings a session is running under, which the host resolved
 * from a schema and hands back to the backend when it resumes one.
 *
 * Neither belongs to a backend. A transcript comes back from a harness on its
 * own; whether a person has read it does not, and a harness asked would have
 * no idea. So a host holding them in memory is a host that forgets them, and
 * a restart returns every archived session to the catalogue and marks every
 * read one unread - for everybody, with nothing said about it.
 *
 * A port rather than a file, for the reason `AutomationStore` is one: a host
 * embedded in an editor already has somewhere to put this and should not be
 * given a second place, and a host in a test wants none at all. `memorySessions()`
 * is the one that forgets, `fileSessions()` is the one that does not, and
 * `createHost` is told which rather than choosing.
 *
 * **Keyed by the backend's id, not by the URI.** A client may set a flag on a
 * row before this host has listed anything, and until it has, the name it will
 * publish that session under is not yet known. The id is the identity; the
 * scheme is only whose it is.
 */
export interface SessionStore {
  /** The client flags in force, or `0` where none were ever set. */
  flags(id: string): number;
  /** Replace them. The whole bitset, because that is what the protocol sends. */
  setFlags(id: string, value: number): void;
  /** The configuration a session is running under, or nothing where it has none. */
  config(id: string): Record<string, unknown> | undefined;
  /** Replace it. Merging is the caller's, which already holds the defaults. */
  setConfig(id: string, values: Record<string, unknown>): void;
  /**
   * Forget a session entirely.
   *
   * Called when one is disposed. Without it a store that survives restarts is
   * a file that only ever grows, carrying flags for sessions that went months
   * ago.
   */
  forget(id: string): void;
}
