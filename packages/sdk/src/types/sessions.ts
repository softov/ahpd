import type { Scope } from '../scopes.js';
import type { Owner } from './usage.js';

/**
 * The pull requests a session's branch had when it started, and the ones it
 * has made its own since.
 *
 * An empty `initialPullRequestUrls` is a captured baseline and not an absent
 * one: it says the branch had none, which is a different answer from a host
 * that never asked. `associatedPullRequestUrls` is what the session took as
 * its own, most recent first. Both keep the spelling they arrived with.
 */
/** One session that runs in a host inside a machine, as the outer host lists it. */
export interface NestedRecord {
  /** The agent that runs it on this host. */
  provider: string;
  /** The machine's id, as in `computer://<id>`. */
  machine: string;
  /** The id the inner host holds the session under. */
  inner: string;
  /** The title a list shows. */
  title: string;
  /** When it was made, ISO 8601. */
  createdAt: string;
  /** When it last moved, ISO 8601. */
  modifiedAt: string;
  /** Its folders, as the URIs this host named. */
  workingDirectories: string[];
}

export interface PullRequestBaseline {
  initialPullRequestUrls: string[];
  associatedPullRequestUrls: string[];
}

/**
 * What a host knows about a session that no backend does.
 *
 * Two things, and they have nothing in common except who owns them. `flags`
 * are the client bits every connection shares - `IsRead` says somebody has
 * looked since the last change, `IsArchived` says somebody put it away - and
 * `config` is the settings a session is running under, which the host resolved
 * from a schema and hands back to the backend when it resumes one.
 *
 * `scope` is a third of the same kind: the team and project a session's work is
 * charged to, resolved from what the person asked and their memberships rather
 * than from a schema. It sits beside the session rather than in `config`,
 * because a backend is handed `config` when it resumes and has no idea what a
 * charge is.
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
   * What this session's work is charged to: `null` when it was decided that
   * nothing is (a host with no people or no teams, a root connection, a session
   * a clock started), `undefined` when nothing was decided yet.
   */
  scope(id: string): Scope | null | undefined;
  /**
   * Record the scope, `null` for charged to nothing, or forget it with `undefined`.
   *
   * The answer rather than the name that was chosen, because the answer is what
   * a later turn needs and a name would have to be resolved again by somebody
   * who is not there.
   */
  setScope(id: string, value: Scope | null | undefined): void;
  /**
   * Whose work this is, as a typed reference - decision
   * `work-is-owned-by-a-typed-reference`.
   *
   * `user:<id>` for the person who created it and `root:<host>` for a session
   * a root connection started. Undefined where nobody owns it: a host with no
   * users directory has no person to name, and neither has a session this host
   * began before it recorded one.
   */
  owner(id: string): Owner | undefined;
  /** Record it, or forget it with `undefined`. */
  setOwner(id: string, value: Owner | undefined): void;
  /**
   * Who sent one of this session's turns, as the same typed reference.
   *
   * Keyed by turn as well as by session because two people can be talking in
   * one session and only the turn says which of them it was. Undefined is the
   * answer for a turn nobody was recorded as having sent: one sent before this
   * was kept, and a worker's turn this host opened rather than a person asked.
   */
  sender(id: string, turnId: string): Owner | undefined;
  /** Record it, or forget it with `undefined`. */
  setSender(id: string, turnId: string, value: Owner | undefined): void;
  /**
   * Which harness this session runs on, or nothing where none was recorded.
   *
   * Two harnesses can read the same transcripts, so an id on its own says
   * neither whose a row is nor which endpoint resumes it. Only the host knows:
   * a transcript is written by whichever CLI answered, and says nothing about
   * the plugin that started it. Undefined for a session made before this was
   * recorded, and for one whose harness is not loaded - a listing falls back to
   * the first agent that lists it rather than dropping it.
   */
  provider(id: string): string | undefined;
  /** Record it, or forget it with `undefined`. */
  setProvider(id: string, value: string | undefined): void;
  /**
   * What this host knows of a session that runs in a host inside a machine,
   * or nothing for any other session.
   *
   * The transcript of a nested session is the inner host's, kept in the
   * machine, so no backend here lists it. This record is what lists it after a
   * restart and what a resume starts from, without asking the machine.
   * Optional: a store without it lists no nested session after a restart.
   */
  nested?(id: string): NestedRecord | undefined;
  /** Record it, or forget it with `undefined`. */
  setNested?(id: string, value: NestedRecord | undefined): void;
  /** Every nested session recorded, by id. */
  nestedSessions?(): [string, NestedRecord][];
  /**
   * What the agent recorded as worth coming back to, or nothing where it
   * recorded nothing.
   *
   * The reference host's session artifacts and references, as its
   * `add_artifact_or_reference` tool writes them and its window draws them
   * beside the input: `{ id, type, label, isArtifact, link?, uri?,
   * commitHash?, isGitHub? }`. Kept whole and in the order recorded, since a
   * client lists them newest last by that order.
   */
  artifacts(id: string): Record<string, unknown>[] | undefined;
  /** Replace them. Empty forgets them, which is what removing the last one means. */
  setArtifacts(id: string, values: Record<string, unknown>[]): void;
  /**
   * Where this session's attachments are kept, or nothing where this store
   * keeps no files.
   *
   * A client pastes a picture and the host writes the bytes here before the
   * message they belong to is applied, so what travels from then on is the
   * path - decision
   * `an-attachments-bytes-are-written-to-disk-and-the-message-names-the-file`.
   * The store answers rather than the host because the store is what owns the
   * directory a session's own file is written in, and a folder beside it is
   * the same decision made again.
   *
   * Optional: a store that keeps nothing answers nothing, and every message
   * goes on exactly as it arrived. A store that answers is a store whose
   * `forget` removes the folder with the session, since a folder holding the
   * bytes of a session that is gone is a folder nothing will ever read.
   */
  attachmentsDir?(id: string): string | undefined;
  /**
   * The pull requests this session inherited and the ones it made its own,
   * or nothing where its branch was never asked about.
   *
   * Kept per session rather than per directory, since the baseline is the
   * moment one session began and two sessions in one directory began at
   * different moments.
   */
  pullRequests(id: string): PullRequestBaseline | undefined;
  /**
   * Replace it. An all-empty pair is still a baseline - it says the branch
   * had none - so it is kept rather than dropped.
   */
  setPullRequests(id: string, value: PullRequestBaseline): void;
  /**
   * The title a chat was given, or nothing where it was never named.
   *
   * The catalogue's title is derived and the reference host keeps a chat's
   * own beside it. A chat is not a session: a peer chat's title belongs to
   * that chat, which is why the chat URI is part of the key.
   */
  chatTitle(id: string, chatUri: string): string | undefined;
  /** Set it. An empty string forgets it, which is a title taken back. */
  setChatTitle(id: string, chatUri: string, title: string): void;
  /**
   * Forget a session entirely.
   *
   * Called when one is disposed. Without it a store that survives restarts is
   * a file that only ever grows, carrying flags for sessions that went months
   * ago.
   */
  forget(id: string): void;
  /**
   * Forget every session `gone` says is gone, and keep the rest.
   *
   * Called after a catalogue listing that every backend answered. A session no
   * backend lists any more is a transcript deleted outside this host, and what
   * is kept for it - an archived bit, a chat's title - is for a row nothing can
   * open again.
   *
   * Asked per id rather than handed a list, because the answer is the host's
   * and only the host has it: whether a listing covered this row at all. A row
   * whose directory and provider no listing has named is one nothing looked
   * for, and `gone` says no.
   *
   * Optional, and a store that keeps nothing has nothing to prune. A store that
   * does not implement it keeps everything, which is the answer of a host
   * embedded in something that owns its own copies.
   */
  prune?(gone: (id: string) => boolean): void;
  /**
   * Write what is waiting to be written, and nothing after.
   *
   * Called when the host closes, so a successor reading the same file is its
   * only writer. Optional: a store that keeps nothing has nothing to finish.
   */
  close?(): void;
}
