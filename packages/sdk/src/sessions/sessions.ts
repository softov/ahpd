/** The two `SessionStore` implementations: one that forgets, one that does not. */

import { existsSync, readdirSync, renameSync, rmSync } from 'node:fs';
import { join, sep } from 'node:path';
import { readJson, writeJsonAtomic } from '../utils/jsonfile.js';
import { asCreatedBy, asOrigin } from './remotesession.js';
import type { Scope } from '../usage/scopes.js';
import type { ChangesSummary } from '../types/changes.js';
import type { CreatedBy, NestedRecord, PullRequestBaseline, RemoteOrigin, SessionStore, StoredChat, StoredWorktree } from '../types/sessions.js';
import type { Owner } from '../types/usage.js';
import { ownerOf } from '../utils/values.js';

/**
 * What the file store needs beyond the port.
 *
 * The port answers one chat at a time, which is what a caller asks. Writing
 * the whole slot down needs them all, and that is the one question only the
 * store that holds them can answer.
 */
interface Held {
  chatTitlesOf(id: string): Record<string, string> | undefined;
  sendersOf(id: string): Record<string, Owner> | undefined;
  parent(id: string): string | undefined;
  setParent(id: string, value: string | undefined): void;
  rootOf(id: string): string;
  depthOf(id: string): number;
  nested(id: string): NestedRecord | undefined;
  setNested(id: string, value: NestedRecord | undefined): void;
  nestedSessions(): [string, NestedRecord][];
  /** Every session with a recorded folder, by id, and the folder it ran in. */
  recordedFolders(): [string, string][];
  workingDirectory(id: string): string | undefined;
  setWorkingDirectory(id: string, value: string | undefined): void;
  worktree(id: string): StoredWorktree | undefined;
  setWorktree(id: string, value: StoredWorktree | undefined): void;
  autoArchivedAt(id: string): string | undefined;
  setAutoArchivedAt(id: string, value: string | undefined): void;
  /** Everything held about one session, in the file's field order, or nothing where nothing is. */
  rowOf(id: string): Row | undefined;
}

/**
 * What a host keeps about its sessions, for as long as the process runs.
 *
 * The default, and the right one for a host embedded in something that has its
 * own place to put this, or for a test. One row per session in a `Map`, so a
 * restart returns every archived session to the catalogue and marks every read
 * one unread - which is a real answer for a host that was never meant to
 * outlive the thing that started it, and the wrong one for a daemon.
 *
 * A row is held only while it says something: a field handed the value that
 * means nothing goes, and a row left with every field gone is not a row at all.
 * So what is held is the sessions something was recorded for, and `prune` sees
 * those and no id that was merely asked about.
 */
export function memorySessions(): SessionStore & Held {
  const rows = new Map<string, Row>();

  /**
   * Apply one change to a session's row, keeping it only while it still says
   * something.
   *
   * The one place a row is written, so every setter forgets a field the same
   * way: by handing `patch` the value that means nothing, which the setter has
   * already turned into the field's absence.
   */
  const patch = (id: string, change: Partial<Row>): void => {
    const held: Row = { ...rows.get(id), ...change };
    if (empty(held)) rows.delete(id);
    else rows.set(id, held);
  };

  /**
   * The top of a session's tree and how far under it the session sits.
   *
   * Walked up the parent links, which is all a tree is here: the `create` tool
   * writes the session it made a child of, and nothing else writes one. A
   * session nothing started is its own root at depth 0.
   *
   * The walk carries what it has seen, because a file edited by hand can hold
   * a loop - a session whose parent is its own descendant - and a walk that
   * trusted the links would never end. A loop stops at the link it would
   * repeat and calls that session the root, which is the answer that keeps the
   * question answerable rather than the answer that is true of a tree.
   */
  const treeOf = (id: string): { root: string; depth: number } => {
    const seen = new Set<string>([id]);
    let at = id;
    let depth = 0;
    for (;;) {
      const up = rows.get(at)?.parent;
      if (up === undefined || up === '' || seen.has(up)) return { root: at, depth };
      seen.add(up);
      at = up;
      depth += 1;
    }
  };

  return {
    flags: (id) => rows.get(id)?.flags ?? 0,
    setFlags: (id, value) => { patch(id, { flags: value === 0 ? undefined : value }); },
    config: (id) => rows.get(id)?.config,
    setConfig: (id, values) => { patch(id, { config: values }); },
    scope: (id) => rows.get(id)?.scope,
    setScope: (id, value) => { patch(id, { scope: value }); },
    owner: (id) => rows.get(id)?.owner,
    setOwner: (id, value) => { patch(id, { owner: value }); },
    sender: (id, turnId) => rows.get(id)?.senders?.get(turnId),
    setSender: (id, turnId, value) => {
      // Copied rather than edited in place, because the row is replaced whole:
      // the map a row holds is never written to after it is put there.
      const held = new Map(rows.get(id)?.senders);
      if (value === undefined) held.delete(turnId);
      else held.set(turnId, value);
      patch(id, { senders: held.size === 0 ? undefined : held });
    },
    provider: (id) => rows.get(id)?.provider,
    setProvider: (id, value) => { patch(id, { provider: value }); },
    uri: (id) => rows.get(id)?.uri,
    setUri: (id, value) => { patch(id, { uri: value === '' ? undefined : value }); },
    tools: (id) => rows.get(id)?.tools,
    // An empty list is held as that absence: a session that asked for no opt-in
    // tool is one nothing was recorded for, the way an empty chat list is.
    setTools: (id, value) => { patch(id, { tools: value === undefined || value.length === 0 ? undefined : [...value] }); },
    trustedFolder: (id) => rows.get(id)?.trustedFolder,
    setTrustedFolder: (id, value) => { patch(id, { trustedFolder: value === '' ? undefined : value }); },
    // Only the `false` a request asked for is held: absent is the default, and
    // a `true` written down would be a session nothing can tell from one that
    // never said.
    userSettings: (id) => rows.get(id)?.userSettings,
    setUserSettings: (id, value) => { patch(id, { userSettings: value === true ? undefined : value }); },
    parent: (id) => rows.get(id)?.parent,
    setParent: (id, value) => { patch(id, { parent: value }); },
    rootOf: (id) => treeOf(id).root,
    depthOf: (id) => treeOf(id).depth,
    nested: (id) => rows.get(id)?.nested,
    setNested: (id, value) => { patch(id, { nested: value }); },
    remoteOrigin: (id) => rows.get(id)?.remoteOrigin,
    setRemoteOrigin: (id, value) => { patch(id, { remoteOrigin: value }); },
    createdBy: (id) => rows.get(id)?.createdBy,
    setCreatedBy: (id, value) => { patch(id, { createdBy: value }); },
    worktree: (id) => rows.get(id)?.worktree,
    setWorktree: (id, value) => { patch(id, { worktree: value }); },
    autoArchivedAt: (id) => rows.get(id)?.autoArchivedAt,
    setAutoArchivedAt: (id, value) => { patch(id, { autoArchivedAt: value === '' ? undefined : value }); },
    workingDirectory: (id) => rows.get(id)?.workingDirectory,
    setWorkingDirectory: (id, value) => { patch(id, { workingDirectory: value === '' ? undefined : value }); },
    changes: (id) => rows.get(id)?.changes,
    setChanges: (id, value) => { patch(id, { changes: value }); },
    nestedSessions: () => [...rows.entries()]
      .flatMap(([id, held]) => held.nested === undefined ? [] : [[id, held.nested] as [string, NestedRecord]]),
    // A session whose record names no folder is left out: a folder is where a
    // listing would ask a backend to look, and there is none to name.
    recordedFolders: () => [...rows.entries()]
      .flatMap(([id, held]) => held.workingDirectory === undefined ? [] : [[id, held.workingDirectory] as [string, string]]),
    artifacts: (id) => rows.get(id)?.artifacts,
    setArtifacts: (id, values) => { patch(id, { artifacts: values.length === 0 ? undefined : values }); },
    pullRequests: (id) => rows.get(id)?.pullRequests,
    // An all-empty pair is still a baseline, so it is kept rather than dropped.
    setPullRequests: (id, value) => { patch(id, { pullRequests: value }); },
    chatTitle: (id, chatUri) => rows.get(id)?.chatTitles?.get(chatUri),
    setChatTitle: (id, chatUri, title) => {
      const held = new Map(rows.get(id)?.chatTitles);
      if (title === '') held.delete(chatUri);
      else held.set(chatUri, title);
      patch(id, { chatTitles: held.size === 0 ? undefined : held });
    },
    chatFlags: (id, chatUri) => rows.get(id)?.chatFlags?.get(chatUri) ?? 0,
    setChatFlags: (id, chatUri, value) => {
      const held = new Map(rows.get(id)?.chatFlags);
      // A chat with no bit set is a chat nothing was recorded for, the way a
      // session's own flags are: the map holds the chats that have one.
      if (value === 0) held.delete(chatUri);
      else held.set(chatUri, value);
      patch(id, { chatFlags: held.size === 0 ? undefined : held });
    },
    chats: (id) => rows.get(id)?.chats ?? [],
    // An empty list is held as that absence, the way an empty artifact list is:
    // a session with no chat left is a session nothing was recorded for.
    setChats: (id, list) => { patch(id, { chats: list.length === 0 ? undefined : [...list] }); },
    moveChat: (from, to, uri, turns) => {
      /*
       * The moving chat's own record, read before either row is written: its
       * entry on the source's list, the title it was given, and the senders of
       * the turns it owns. A row is replaced whole, so both rows are built from
       * what is read here.
       */
      const source = rows.get(from);
      const chat = (source?.chats ?? []).find((one) => one.uri === uri);
      const titles = new Map(source?.chatTitles);
      const title = titles.get(uri);
      titles.delete(uri);
      const senders = new Map(source?.senders);
      const ours = new Map<string, Owner>();
      for (const turn of turns) {
        const who = senders.get(turn);
        if (who === undefined) continue;
        ours.set(turn, who);
        senders.delete(turn);
      }
      const left = (source?.chats ?? []).filter((one) => one.uri !== uri);
      patch(from, {
        chats: left.length === 0 ? undefined : left,
        chatTitles: titles.size === 0 ? undefined : titles,
        senders: senders.size === 0 ? undefined : senders,
      });
      /*
       * And onto the destination, as one write: the entry appended to its list,
       * the senders its turns name, and the title. Only the fields this move
       * changes are handed over, so a `chatTitles` map the destination already
       * has is not replaced by a copy of itself.
       *
       * The entry is copied, because a read answers with the store's own
       * objects and this one is about to be written into another row.
       */
      const target = rows.get(to);
      const list = [...(target?.chats ?? [])];
      if (chat !== undefined) list.push({ ...chat });
      const theirs = new Map(target?.senders);
      for (const [turn, who] of ours) theirs.set(turn, who);
      const named = new Map(target?.chatTitles);
      if (title !== undefined) named.set(uri, title);
      patch(to, {
        chats: list.length === 0 ? undefined : list,
        ...(ours.size === 0 ? {} : { senders: theirs }),
        ...(title === undefined ? {} : { chatTitles: named }),
      });
    },
    // A row is held only while it says something, so this is the sessions
    // something was recorded for and no id that was merely asked about.
    sessions: () => [...rows.keys()],
    chatTitlesOf: (id) => {
      const held = rows.get(id)?.chatTitles;
      return held === undefined ? undefined : Object.fromEntries(held);
    },
    sendersOf: (id) => {
      const held = rows.get(id)?.senders;
      return held === undefined ? undefined : Object.fromEntries(held);
    },
    rowOf: (id) => {
      const held = rows.get(id);
      if (held === undefined) return undefined;
      // Written in the field order the file has always used, so a row read back
      // and written again is the same bytes.
      return {
        ...(held.flags === undefined ? {} : { flags: held.flags }),
        ...(held.config === undefined ? {} : { config: held.config }),
        ...(held.scope === undefined ? {} : { scope: held.scope }),
        ...(held.owner === undefined ? {} : { owner: held.owner }),
        ...(held.senders === undefined ? {} : { senders: held.senders }),
        ...(held.provider === undefined ? {} : { provider: held.provider }),
        ...(held.uri === undefined ? {} : { uri: held.uri }),
        ...(held.tools === undefined ? {} : { tools: held.tools }),
        ...(held.trustedFolder === undefined ? {} : { trustedFolder: held.trustedFolder }),
        ...(held.userSettings === undefined ? {} : { userSettings: held.userSettings }),
        ...(held.artifacts === undefined ? {} : { artifacts: held.artifacts }),
        ...(held.pullRequests === undefined ? {} : { pullRequests: held.pullRequests }),
        ...(held.chatTitles === undefined ? {} : { chatTitles: held.chatTitles }),
        ...(held.chatFlags === undefined ? {} : { chatFlags: held.chatFlags }),
        ...(held.parent === undefined ? {} : { parent: held.parent }),
        ...(held.nested === undefined ? {} : { nested: held.nested }),
        ...(held.chats === undefined ? {} : { chats: held.chats }),
        ...(held.remoteOrigin === undefined ? {} : { remoteOrigin: held.remoteOrigin }),
        ...(held.createdBy === undefined ? {} : { createdBy: held.createdBy }),
        ...(held.workingDirectory === undefined ? {} : { workingDirectory: held.workingDirectory }),
        ...(held.worktree === undefined ? {} : { worktree: held.worktree }),
        ...(held.autoArchivedAt === undefined ? {} : { autoArchivedAt: held.autoArchivedAt }),
        ...(held.changes === undefined ? {} : { changes: held.changes }),
      };
    },
    forget: (id) => { rows.delete(id); },
    prune: (gone) => {
      // One id per row, since a session is remembered under whichever of the
      // row's fields was written last and nothing else names it.
      for (const id of [...rows.keys()]) {
        if (gone(id)) rows.delete(id);
      }
    },
  };
}

export interface FileSessionOptions {
  /**
   * Where to keep them: a directory holding one file per session.
   *
   * A path rather than a directory this module picks, and the caller's decision
   * rather than this module's: where a daemon's state belongs is a daemon's
   * question, and a library that reached for `$XDG_STATE_HOME` would be
   * answering it for a host embedded in an editor too.
   */
  dir: string;
  /** Somewhere to say that it could not be read or written. */
  onProblem?(message: string): void;
}

/**
 * A nested session's record as the file wrote it, or nothing when it is not
 * one: every field a listing reads must be there with its type, and anything
 * else is ignored rather than guessed at.
 */
const nestedOf = (value: unknown): NestedRecord | undefined => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const held = value as Partial<Record<keyof NestedRecord, unknown>>;
  const text = (one: unknown): one is string => typeof one === 'string' && one !== '';
  if (!text(held.provider) || !text(held.machine) || !text(held.inner) || typeof held.title !== 'string'
    || !text(held.createdAt) || !text(held.modifiedAt) || !Array.isArray(held.workingDirectories)) return undefined;
  return {
    provider: held.provider,
    machine: held.machine,
    inner: held.inner,
    title: held.title,
    createdAt: held.createdAt,
    modifiedAt: held.modifiedAt,
    workingDirectories: held.workingDirectories.filter((one): one is string => typeof one === 'string'),
  };
};

/**
 * A session's worktree as the file wrote it, or nothing when it is not one:
 * the repository, the path and the base as non-empty strings, and a branch
 * that is one too where it is there at all. Anything else is ignored rather
 * than guessed at, since this record decides which tree a host takes away.
 * A `commit` is read back only as a full commit: it says where the counts
 * start, so a half-written one is dropped and the base's name answers instead.
 */
const worktreeOf = (value: unknown): StoredWorktree | undefined => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const held = value as Partial<Record<keyof StoredWorktree, unknown>>;
  const text = (one: unknown): one is string => typeof one === 'string' && one !== '';
  if (!text(held.repository) || !text(held.path) || !text(held.base)) return undefined;
  if (held.branch !== undefined && !text(held.branch)) return undefined;
  const commit = typeof held.commit === 'string' && /^[0-9a-f]{40}$/i.test(held.commit) ? held.commit : undefined;
  return {
    repository: held.repository,
    path: held.path,
    base: held.base,
    ...(held.branch === undefined ? {} : { branch: held.branch }),
    ...(commit === undefined ? {} : { commit }),
  };
};

/**
 * A session's own counts as the file wrote them, or nothing where it wrote
 * none.
 *
 * A count is a number or it is not there at all: anything else is ignored
 * rather than guessed at, as every other field of a row is. An object with
 * nothing countable in it is not a summary, so a row written by something that
 * meant something else reads as a session whose counts were never read.
 */
const countsOf = (value: unknown): ChangesSummary | undefined => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const held = value as ChangesSummary;
  const count = (one: unknown): number | undefined => (typeof one === 'number' && Number.isFinite(one) ? one : undefined);
  const files = count(held.files);
  const additions = count(held.additions);
  const deletions = count(held.deletions);
  if (files === undefined && additions === undefined && deletions === undefined) return undefined;
  return {
    ...(files === undefined ? {} : { files }),
    ...(additions === undefined ? {} : { additions }),
    ...(deletions === undefined ? {} : { deletions }),
  };
};

/** A chat's wake as the file wrote it, or nothing where it is not one. */
const wakeOf = (value: unknown): { wake: NonNullable<StoredChat['wake']> } | undefined => {
  if (typeof value !== 'object' || value === null) return undefined;
  const held = value as { at?: unknown; prompt?: unknown; sender?: unknown };
  if (typeof held.at !== 'number' || !Number.isFinite(held.at) || typeof held.prompt !== 'string') return undefined;
  // The person is carried only where the file wrote one: a wake from before
  // there was a person to write keeps none, which is the same nobody a wake
  // the agent asked for outside a turn has.
  const sender = ownerOf(held.sender);
  return { wake: { at: held.at, prompt: held.prompt, ...(sender === undefined ? {} : { sender }) } };
};

/**
 * A session's chats as the file wrote them, or nothing where the field is not
 * a list of chats at all.
 *
 * An entry is kept when it names a URI and a backend id, which are the two
 * things a rebuild reads; anything else about one is carried only if it has
 * the shape this version wrote. A field that is not a list is the absence of
 * one rather than a reason to refuse the row, so a row holding anything else
 * there loads as a session with no chat recorded.
 */
const chatsOf = (value: unknown): StoredChat[] | undefined => {
  if (!Array.isArray(value)) return undefined;
  const text = (one: unknown): one is string => typeof one === 'string' && one !== '';
  return value.flatMap((one): StoredChat[] => {
    if (typeof one !== 'object' || one === null || Array.isArray(one)) return [];
    const held = one as Partial<Record<keyof StoredChat, unknown>>;
    if (!text(held.uri) || typeof held.backendId !== 'string') return [];
    const origin = held.origin;
    const config = held.config;
    return [{
      uri: held.uri,
      backendId: held.backendId,
      ...(text(held.provider) ? { provider: held.provider } : {}),
      ...(typeof config === 'object' && config !== null && !Array.isArray(config)
        ? { config: config as Record<string, unknown> }
        : {}),
      ...(typeof held.title === 'string' ? { title: held.title } : {}),
      ...(typeof origin === 'object' && origin !== null && !Array.isArray(origin)
        ? { origin: origin as Record<string, unknown> }
        : {}),
      ...(held.default === true ? { default: true } : {}),
      ...(held.closed === true ? { closed: true } : {}),
      ...(wakeOf(held.wake) ?? {}),
    }];
  });
};

/**
 * Everything a host holds about one session, as the store holds it.
 *
 * A field is absent where nothing was recorded for it, which is the whole of
 * what "unset" means here: the two that are answered with an empty value rather
 * than an absence - the flags, and the artifacts - are held as that absence as
 * well, so a row with nothing set is a row that is not there.
 *
 * Each field carries `undefined` in its type because that is what a setter
 * hands over to clear it, and nothing else in the store ever writes a row.
 */
interface Row {
  flags?: number | undefined;
  config?: Record<string, unknown> | undefined;
  /** `null` is charged to nothing on purpose, which is not the same as never decided. */
  scope?: Scope | null | undefined;
  owner?: Owner | undefined;
  senders?: Map<string, Owner> | undefined;
  provider?: string | undefined;
  /** The name the host holds the session under, when it chose one. */
  uri?: string | undefined;
  /** The opt-in host tools the session's request named, by name. */
  tools?: string[] | undefined;
  /** The one folder the session was started trusted in. */
  trustedFolder?: string | undefined;
  /** `false` where the session asked not to load its person's settings. */
  userSettings?: boolean | undefined;
  artifacts?: Record<string, unknown>[] | undefined;
  pullRequests?: PullRequestBaseline | undefined;
  chatTitles?: Map<string, string> | undefined;
  chatFlags?: Map<string, number> | undefined;
  parent?: string | undefined;
  nested?: NestedRecord | undefined;
  chats?: StoredChat[] | undefined;
  remoteOrigin?: RemoteOrigin | undefined;
  createdBy?: CreatedBy | undefined;
  workingDirectory?: string | undefined;
  worktree?: StoredWorktree | undefined;
  autoArchivedAt?: string | undefined;
  changes?: ChangesSummary | undefined;
}

/**
 * Whether a row says nothing at all, and so is not one to keep.
 *
 * The working folder is not counted. It says where a session ran, which is
 * worth keeping for a session something else was recorded for and for no
 * other: a folder alone is a session this host was never told anything about.
 * The URI is not counted for the same reason: a name alone is a session
 * nothing this host ran, and a row with one writes no file.
 */
const empty = (row: Row): boolean =>
  row.flags === undefined && row.config === undefined && row.scope === undefined
  && row.owner === undefined && row.senders === undefined && row.provider === undefined
  && row.tools === undefined && row.trustedFolder === undefined && row.userSettings === undefined
  && row.artifacts === undefined && row.pullRequests === undefined && row.chatTitles === undefined
  && row.chatFlags === undefined
  && row.parent === undefined && row.nested === undefined && row.chats === undefined
  && row.remoteOrigin === undefined && row.createdBy === undefined && row.worktree === undefined
  && row.autoArchivedAt === undefined && row.changes === undefined;

/**
 * What is persisted for one session: a `Row` as the file holds it.
 *
 * Versioned, so a later shape can be recognised rather than guessed at, and
 * carrying `id` because a file is opened on its own rather than under the name
 * the store holds it by. The two maps a row keeps are objects here, and the
 * owner is the reference it is spelled as.
 */
interface Saved {
  version: 1;
  id: string;
  flags?: number;
  config?: Record<string, unknown>;
  scope?: Scope | null;
  owner?: string;
  senders?: Record<string, string>;
  provider?: string;
  /** The name the host holds the session under, when it chose one. */
  uri?: string;
  /** The opt-in host tools the session's request named, by name. */
  tools?: string[];
  /** The one folder the session was started trusted in. */
  trustedFolder?: string;
  /** `false` where the session asked not to load its person's settings. */
  userSettings?: boolean;
  artifacts?: Record<string, unknown>[];
  pullRequests?: PullRequestBaseline;
  chatTitles?: Record<string, string>;
  /** The read and archived bits of each chat, by the chat's URI. */
  chatFlags?: Record<string, number>;
  /** The id of the session this one was started from, where one did. */
  parent?: string;
  nested?: NestedRecord;
  /** The chats of one session, in the order they were opened. */
  chats?: StoredChat[];
  /** Where this session was sent from, as the window that sent it named it. */
  remoteOrigin?: RemoteOrigin;
  /** The session that made this one, as a window recorded it. */
  createdBy?: CreatedBy;
  /** The folder the session works in, as a path. */
  workingDirectory?: string;
  /** The worktree this host made for the session. */
  worktree?: StoredWorktree;
  /** When the host archived the session because its pull requests were merged. */
  autoArchivedAt?: string;
  /** What this session's own work added and removed, as it was last read. */
  changes?: ChangesSummary;
}

/**
 * An id as the name of the file that holds it, and the name back as an id.
 *
 * An id is an opaque key - anything a backend chose, slashes and colons
 * included - and a file name is not. Percent-encoding is what turns one into the
 * other and reads back as what it was; the id stays the key it always was, and
 * a name this version did not write decodes to nothing worth guessing at.
 */
const fileNameOf = (id: string): string => `${encodeURIComponent(id)}.json`;

/** The folder the sessions' attachments sit under, one folder per session. */
const ATTACHMENTS = 'attachments';

/**
 * One session's folder under the attachments root, as a name.
 *
 * An id is an opaque key and a folder name is not. `.` names the folder it is
 * written in, `..` names the one above it, and an empty name names the folder
 * itself: a session called any of the three would keep its attachments among
 * every session's, or beside the sessions directory, where removing it would
 * take the lot. The three are escaped to names no id produces, so a session
 * keeps a folder of its own under the root whatever it is called.
 */
const folderNameOf = (id: string): string => {
  const encoded = encodeURIComponent(id);
  return /^\.{0,2}$/.test(encoded) ? '%2E'.repeat(1 + encoded.length) : encoded;
};

/** Whether a path is inside a folder, and not merely prefixed by its name. */
const below = (root: string, path: string): boolean =>
  path.startsWith(root.endsWith(sep) ? root : `${root}${sep}`);

const idIn = (name: string): string | undefined => {
  try { return decodeURIComponent(name); }
  catch { return undefined; }
};

/**
 * The same store, written down.
 *
 * Composed on `memorySessions` rather than reimplemented, so there is one
 * answer to what a flag is and this file is only the reading and the writing.
 *
 * **One file per session.** What the daemon keeps follows the sessions that
 * exist rather than every session it ever saw: a change writes the one file it
 * belongs to, and a session that goes leaves nothing behind.
 *
 * **Read once, at construction, and synchronously.** Every reader of this is
 * synchronous - a catalogue of a hundred rows asks a hundred times while
 * answering one request - so there is no point at which an async load could
 * have finished before the first question. A daemon reads its folder at
 * startup and never again.
 *
 * **Written after the change, not during it.** A write is a rename over the
 * old file, and doing that inside every `setFlags` would put a `fsync` in the
 * path of somebody moving the highlight down a list. Coalesced onto the next
 * tick instead: many changes in one turn become one pass over what moved.
 *
 * A file that cannot be read is a warning and an empty row, never a refusal.
 * Losing which sessions were archived is worth saying out loud; refusing to
 * start a daemon over it is not.
 */
export function fileSessions(options: FileSessionOptions): SessionStore {
  const inner = memorySessions();
  const dir = options.dir;
  const told = (message: string): void => { options.onProblem?.(message); };
  /**
   * One session's attachments: a folder of its own, named beside its file.
   *
   * The host writes a pasted picture here and the message names the file, so
   * the bytes are written once rather than carried in every copy of the
   * conversation.
   * Named by the same encoding as the file beside it, because an id is an
   * opaque key and a folder name is not.
   *
   * Answered only for a folder that is strictly inside the attachments root.
   * One this store cannot place there is a line in the log and no folder at
   * all, because the folder that holds every session is the one thing a
   * removal must never reach.
   */
  const attachmentsRoot = join(dir, ATTACHMENTS);
  const attachmentsOf = (id: string): string | undefined => {
    const folder = join(attachmentsRoot, folderNameOf(id));
    if (below(attachmentsRoot, folder)) return folder;
    told(`Not keeping the attachments of ${id} in ${folder}: it is not inside ${attachmentsRoot}`);
    return undefined;
  };
  /** And a session that goes takes them with it, the way its file goes. */
  const attachmentsGone = (id: string): void => {
    const folder = attachmentsOf(id);
    if (folder === undefined) return;
    try { rmSync(folder, { recursive: true, force: true }); }
    catch (error) {
      told(`Could not remove ${folder}: ${error instanceof Error ? error.message : String(error)}`);
    }
  };
  /** Every id this store has heard of: what a prune walks, and what a removal is written for. */
  const heard = new Set<string>();
  /** The ids that moved since the last save, and so the files to write. */
  const dirty = new Set<string>();
  let writing: ReturnType<typeof setTimeout> | undefined;
  /** Closed: what was waiting has been written, and nothing is written again. */
  let closed = false;

  /**
   * What one session is written down as, or nothing where there is nothing to
   * write: a session somebody looked at and left alone is not remembered.
   *
   * `version` and `id` come first, and the rest in the field order the file has
   * always written, so a row read back and written again is the same bytes.
   */
  const rowOf = (id: string): Saved | undefined => {
    const held = inner.rowOf(id);
    if (held === undefined) return undefined;
    return {
      version: 1,
      id,
      ...(held.flags === undefined ? {} : { flags: held.flags }),
      ...(held.config === undefined ? {} : { config: held.config }),
      ...(held.scope === undefined ? {} : { scope: held.scope }),
      ...(held.owner === undefined ? {} : { owner: held.owner }),
      ...(held.senders === undefined ? {} : { senders: Object.fromEntries(held.senders) }),
      ...(held.provider === undefined ? {} : { provider: held.provider }),
      ...(held.uri === undefined ? {} : { uri: held.uri }),
      ...(held.tools === undefined ? {} : { tools: held.tools }),
      ...(held.trustedFolder === undefined ? {} : { trustedFolder: held.trustedFolder }),
      ...(held.userSettings === undefined ? {} : { userSettings: held.userSettings }),
      ...(held.artifacts === undefined ? {} : { artifacts: held.artifacts }),
      ...(held.pullRequests === undefined ? {} : { pullRequests: held.pullRequests }),
      ...(held.chatTitles === undefined ? {} : { chatTitles: Object.fromEntries(held.chatTitles) }),
      ...(held.chatFlags === undefined ? {} : { chatFlags: Object.fromEntries(held.chatFlags) }),
      ...(held.parent === undefined ? {} : { parent: held.parent }),
      ...(held.nested === undefined ? {} : { nested: held.nested }),
      ...(held.chats === undefined ? {} : { chats: held.chats }),
      ...(held.remoteOrigin === undefined ? {} : { remoteOrigin: held.remoteOrigin }),
      ...(held.createdBy === undefined ? {} : { createdBy: held.createdBy }),
      ...(held.workingDirectory === undefined ? {} : { workingDirectory: held.workingDirectory }),
      ...(held.worktree === undefined ? {} : { worktree: held.worktree }),
      ...(held.autoArchivedAt === undefined ? {} : { autoArchivedAt: held.autoArchivedAt }),
      ...(held.changes === undefined ? {} : { changes: held.changes }),
    };
  };

  const save = (): void => {
    if (closed) return;
    const waiting = [...dirty];
    dirty.clear();
    for (const id of waiting) {
      const row = rowOf(id);
      const file = join(dir, fileNameOf(id));
      try {
        // Nothing left to say about this one, which is a session disposed or a
        // flag read and cleared: its file goes with it.
        if (row === undefined) {
          rmSync(file, { force: true });
          continue;
        }
        // The folder is made at 0700: every file under it holds a person's
        // session, which is nobody else's business on a host with more than one
        // person on it.
        writeJsonAtomic(file, row, { dirMode: 0o700 });
      }
      catch (error) {
        told(`Could not write ${file}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  };

  const later = (): void => {
    if (writing !== undefined || closed) return;
    writing = setTimeout(() => { writing = undefined; save(); }, 0);
    // A daemon should not be held open by a pending write of a bit somebody
    // toggled a moment before quitting.
    writing.unref?.();
  };

  /**
   * One setter's whole work: record that the id is one this store has heard of,
   * change it, and write the row it changed to on the next tick.
   *
   * Written once, so every setter is this plus the one call it makes - and so
   * none of them can forget to mark what it moved.
   */
  const touched = (id: string, run: () => void): void => {
    heard.add(id);
    run();
    dirty.add(id);
    later();
  };

  /**
   * Move a file this version cannot read to `<file>.unreadable-<time>`.
   *
   * The name does not end in `.json`, so a later load does not read it again,
   * and the UTC time keeps two moves of one id apart. A move that fails leaves
   * the file where it is, and says so.
   */
  const setAside = (file: string): void => {
    const aside = `${file}.unreadable-${new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '')}`;
    try {
      renameSync(file, aside);
      told(`Moved ${file} to ${aside}.`);
    }
    catch (error) {
      told(`Could not move ${file} aside, so the next write for it replaces it: ${(error as NodeJS.ErrnoException).code ?? 'failed'}`);
    }
  };

  const load = (): void => {
    let names: string[];
    try { names = readdirSync(dir); }
    // Not there yet, which is what a first run looks like.
    catch { return; }
    for (const name of names) {
      if (!name.endsWith('.json')) continue;
      // A name that is not an id this version could have written is not one of
      // its files.
      if (idIn(name.slice(0, -'.json'.length)) === undefined) continue;
      const file = join(dir, name);
      const read = readJson(file);
      let row: Saved | undefined;
      if (!read.ok) {
        // The parser's error quotes what it choked on, so a file that is not
        // JSON is said to be that and no more.
        if (read.kind === 'missing') continue;
        told(`Could not read ${file}: ${read.kind === 'unreadable' ? read.code ?? 'unreadable' : 'it is not JSON'}`);
      }
      else if ((read.value as Partial<Saved>).version === 1 && typeof (read.value as Partial<Saved>).id === 'string') {
        row = read.value as Saved;
      }
      else told(`Ignoring ${file}: it is not a session store this version can read.`);
      // One file this version cannot read is one session it does not know, and
      // the rest of the folder still does. It is moved aside, because the next
      // write for its id would put what memory holds in its place.
      if (row === undefined) {
        setAside(file);
        continue;
      }
      heard.add(row.id);
      if (typeof row.flags === 'number') inner.setFlags(row.id, row.flags);
      if (typeof row.config === 'object' && row.config !== null && !Array.isArray(row.config)) inner.setConfig(row.id, row.config);
      // A scope is a team and optionally a project. A row written by a version
      // that meant something else is ignored rather than guessed at.
      const scope = row.scope as Partial<Scope> | null | undefined;
      if (scope === null) inner.setScope(row.id, null);
      else if (typeof scope === 'object' && scope !== null && typeof scope.team === 'string' && scope.team !== ''
        && (scope.project === undefined || (typeof scope.project === 'string' && scope.project !== ''))) {
        inner.setScope(row.id, scope.project === undefined
          ? { team: scope.team }
          : { team: scope.team, project: scope.project });
      }
      const owner = ownerOf(row.owner);
      if (owner !== undefined) inner.setOwner(row.id, owner);
      // A turn's sender is a typed reference or it is nothing, one value at a
      // time: a row written by something that meant something else is ignored
      // rather than guessed at, as an owner that is not one already is.
      if (typeof row.senders === 'object' && row.senders !== null && !Array.isArray(row.senders)) {
        for (const [turnId, sender] of Object.entries(row.senders)) {
          const who = ownerOf(sender);
          if (who !== undefined) inner.setSender(row.id, turnId, who);
        }
      }
      // A harness is named by whatever string the agent called itself, so any
      // non-empty one is taken as it stands. A row written before providers
      // were kept has none, and reads as a session nothing was recorded for.
      if (typeof row.provider === 'string' && row.provider !== '') inner.setProvider(row.id, row.provider);
      // A name is a URI the host chose, so any non-empty string is taken as it
      // stands. A row written before names were kept has none, and is named
      // from its provider as it was before.
      if (typeof row.uri === 'string' && row.uri !== '') inner.setUri?.(row.id, row.uri);
      // Opt-in tool names are strings and nothing else: a list that holds
      // anything else is ignored rather than guessed at, as every other field
      // here is. An empty one is the same as none named, as it is in the store.
      if (Array.isArray(row.tools)) {
        const names = row.tools.filter((one): one is string => typeof one === 'string');
        inner.setTools?.(row.id, names.length === 0 ? undefined : names);
      }
      // A folder, and anything that is not a non-empty string is ignored rather
      // than guessed at, as every other field here is.
      if (typeof row.trustedFolder === 'string' && row.trustedFolder !== '') inner.setTrustedFolder?.(row.id, row.trustedFolder);
      // Only the `false` a session can mean here: an absent flag is the
      // default, and anything that is not a boolean is ignored rather than
      // guessed at, as every other field is.
      if (row.userSettings === false) inner.setUserSettings?.(row.id, false);
      if (Array.isArray(row.artifacts)) inner.setArtifacts(row.id, row.artifacts.filter((one) => typeof one === 'object' && one !== null));
      // Only an object with two arrays of strings is a baseline this version
      // understands; anything else is ignored rather than guessed at.
      const baseline = row.pullRequests as Partial<PullRequestBaseline> | undefined;
      if (typeof baseline === 'object' && baseline !== null
        && Array.isArray(baseline.initialPullRequestUrls) && Array.isArray(baseline.associatedPullRequestUrls)) {
        const strings = (list: unknown[]): string[] => list.filter((one): one is string => typeof one === 'string');
        inner.setPullRequests(row.id, {
          initialPullRequestUrls: strings(baseline.initialPullRequestUrls),
          associatedPullRequestUrls: strings(baseline.associatedPullRequestUrls),
        });
      }
      // A record of string titles, one per chat, and anything else is ignored
      // rather than guessed at.
      if (typeof row.chatTitles === 'object' && row.chatTitles !== null && !Array.isArray(row.chatTitles)) {
        for (const [chatUri, title] of Object.entries(row.chatTitles)) {
          if (typeof title === 'string') inner.setChatTitle(row.id, chatUri, title);
        }
      }
      // A record of numbers, one per chat, and anything else is ignored rather
      // than guessed at - as every other field here is.
      if (typeof row.chatFlags === 'object' && row.chatFlags !== null && !Array.isArray(row.chatFlags)) {
        for (const [chatUri, value] of Object.entries(row.chatFlags)) {
          if (typeof value === 'number') inner.setChatFlags(row.id, chatUri, value);
        }
      }
      // The id of a session that started this one. Anything that is not a
      // non-empty string is ignored rather than guessed at, as every other
      // field here is.
      if (typeof row.parent === 'string' && row.parent !== '') inner.setParent(row.id, row.parent);
      const nested = nestedOf(row.nested);
      if (nested !== undefined) inner.setNested(row.id, nested);
      // A row with no list there has no chats recorded, and reads as the empty
      // one this store answers for a session it knows nothing about.
      const chats = chatsOf(row.chats);
      if (chats !== undefined) inner.setChats(row.id, chats);
      // Where a window sent this session from, read back through the same
      // reader that accepted it: a name the window could no longer have sent,
      // or a depth that is not one, is ignored rather than guessed at - as
      // every other field here is.
      const origin = asOrigin(row.remoteOrigin);
      if (origin !== undefined) inner.setRemoteOrigin?.(row.id, origin);
      const createdBy = asCreatedBy(row.createdBy);
      if (createdBy !== undefined) inner.setCreatedBy?.(row.id, createdBy);
      // A path, and anything that is not a non-empty string is ignored rather
      // than guessed at, as every other field here is.
      if (typeof row.workingDirectory === 'string' && row.workingDirectory !== '') inner.setWorkingDirectory(row.id, row.workingDirectory);
      const worktree = worktreeOf(row.worktree);
      if (worktree !== undefined) inner.setWorktree(row.id, worktree);
      // A time, and anything that is not one is ignored rather than guessed
      // at, since this record decides which session a host deletes.
      if (typeof row.autoArchivedAt === 'string' && !Number.isNaN(Date.parse(row.autoArchivedAt))) {
        inner.setAutoArchivedAt(row.id, row.autoArchivedAt);
      }
      // What the session's own work was when it was last read, which is what
      // its row carries until something reads it again.
      const changes = countsOf(row.changes);
      if (changes !== undefined) inner.setChanges(row.id, changes);
    }
  };

  load();

  return {
    flags: (id) => inner.flags(id),
    config: (id) => inner.config(id),
    setFlags: (id, value) => { touched(id, () => { inner.setFlags(id, value); }); },
    setConfig: (id, values) => { touched(id, () => { inner.setConfig(id, values); }); },
    scope: (id) => inner.scope(id),
    setScope: (id, value) => { touched(id, () => { inner.setScope(id, value); }); },
    owner: (id) => inner.owner(id),
    setOwner: (id, value) => { touched(id, () => { inner.setOwner(id, value); }); },
    sender: (id, turnId) => inner.sender(id, turnId),
    setSender: (id, turnId, value) => { touched(id, () => { inner.setSender(id, turnId, value); }); },
    provider: (id) => inner.provider(id),
    setProvider: (id, value) => { touched(id, () => { inner.setProvider(id, value); }); },
    uri: (id) => inner.uri?.(id),
    setUri: (id, value) => { touched(id, () => { inner.setUri?.(id, value); }); },
    tools: (id) => inner.tools?.(id),
    setTools: (id, value) => { touched(id, () => { inner.setTools?.(id, value); }); },
    trustedFolder: (id) => inner.trustedFolder?.(id),
    setTrustedFolder: (id, value) => { touched(id, () => { inner.setTrustedFolder?.(id, value); }); },
    userSettings: (id) => inner.userSettings?.(id),
    setUserSettings: (id, value) => { touched(id, () => { inner.setUserSettings?.(id, value); }); },
    parent: (id) => inner.parent(id),
    setParent: (id, value) => { touched(id, () => { inner.setParent(id, value); }); },
    rootOf: (id) => inner.rootOf(id),
    depthOf: (id) => inner.depthOf(id),
    nested: (id) => inner.nested(id),
    setNested: (id, value) => { touched(id, () => { inner.setNested(id, value); }); },
    nestedSessions: () => inner.nestedSessions(),
    recordedFolders: () => inner.recordedFolders(),
    remoteOrigin: (id) => inner.remoteOrigin?.(id),
    setRemoteOrigin: (id, value) => { touched(id, () => { inner.setRemoteOrigin?.(id, value); }); },
    createdBy: (id) => inner.createdBy?.(id),
    setCreatedBy: (id, value) => { touched(id, () => { inner.setCreatedBy?.(id, value); }); },
    worktree: (id) => inner.worktree(id),
    setWorktree: (id, value) => { touched(id, () => { inner.setWorktree(id, value); }); },
    autoArchivedAt: (id) => inner.autoArchivedAt(id),
    setAutoArchivedAt: (id, value) => { touched(id, () => { inner.setAutoArchivedAt(id, value); }); },
    workingDirectory: (id) => inner.workingDirectory(id),
    setWorkingDirectory: (id, value) => { touched(id, () => { inner.setWorkingDirectory(id, value); }); },
    changes: (id) => inner.changes(id),
    setChanges: (id, value) => { touched(id, () => { inner.setChanges(id, value); }); },
    artifacts: (id) => inner.artifacts(id),
    setArtifacts: (id, values) => { touched(id, () => { inner.setArtifacts(id, values); }); },
    pullRequests: (id) => inner.pullRequests(id),
    setPullRequests: (id, value) => { touched(id, () => { inner.setPullRequests(id, value); }); },
    chatTitle: (id, chatUri) => inner.chatTitle(id, chatUri),
    setChatTitle: (id, chatUri, title) => { touched(id, () => { inner.setChatTitle(id, chatUri, title); }); },
    chatFlags: (id, chatUri) => inner.chatFlags(id, chatUri),
    setChatFlags: (id, chatUri, value) => { touched(id, () => { inner.setChatFlags(id, chatUri, value); }); },
    chats: (id) => inner.chats(id),
    setChats: (id, list) => { touched(id, () => { inner.setChats(id, list); }); },
    // Two rows move, so two files have to be written - which is why this is
    // written out rather than handed to `touched`, which names one.
    moveChat: (from, to, uri, turns) => {
      heard.add(from);
      heard.add(to);
      inner.moveChat(from, to, uri, turns);
      dirty.add(from);
      dirty.add(to);
      later();
    },
    // What this store holds is what it read at construction, which is the whole
    // folder, and what it was told since: the composition answers both.
    sessions: () => inner.sessions(),
    attachmentsDir: attachmentsOf,
    forget: (id) => {
      heard.delete(id);
      inner.forget(id);
      attachmentsGone(id);
      dirty.add(id);
      later();
    },
    prune: (gone) => {
      for (const id of [...heard]) {
        if (!gone(id)) continue;
        heard.delete(id);
        inner.forget(id);
        attachmentsGone(id);
        // The file goes with the row, by the same path a `forget` takes.
        dirty.add(id);
      }
      later();
    },
    close: () => {
      if (closed) return;
      if (writing !== undefined) {
        clearTimeout(writing);
        writing = undefined;
        save();
      }
      closed = true;
    },
  };
}

export interface SessionMigrationOptions {
  /** The folder the store keeps one file per session in. */
  dir: string;
  /** The one file a daemon before this layout left behind. */
  file: string;
  /** Somewhere to say that it could not be read or written. */
  onProblem?(message: string): void;
}

/** What the one file held, before the store was a file per session. */
interface Whole {
  version: 1;
  sessions: Omit<Saved, 'version'>[];
}

/**
 * Split a store written as one file into a file per session, once.
 *
 * A daemon that carried every session it ever saw has them all in one file, and
 * the store this version opens reads a folder. So the rows become that folder's
 * files and the old file is renamed out of the way, which is what says it has
 * been read: a daemon that finds the folder already there leaves both alone,
 * and so does one that finds no file.
 *
 * Every row's values are carried as they were written. A config a later version
 * would refuse is a person's setting and is read back as the store reads any
 * other stored value.
 *
 * A file this version cannot read is left exactly as it is and named in a
 * warning: it is the only copy of what somebody archived, and guessing at it is
 * worse than leaving it for a daemon that can read it.
 */
export function migrateSessions(options: SessionMigrationOptions): void {
  const said = (message: string): void => { options.onProblem?.(message); };
  // A folder means the split has already happened, whatever became of the file.
  if (existsSync(options.dir)) return;
  const read = readJson(options.file);
  // Not there, which is what a first run looks like.
  if (!read.ok && read.kind === 'missing') return;
  if (!read.ok) {
    said(`Could not read ${options.file}: ${read.error instanceof Error ? read.error.message : String(read.error)}`);
    return;
  }
  const whole = read.value as Partial<Whole>;
  if (whole.version !== 1 || !Array.isArray(whole.sessions)) {
    said(`Ignoring ${options.file}: it is not a session store this version can read.`);
    return;
  }
  try {
    for (const row of whole.sessions) {
      if (typeof row?.id !== 'string' || row.id === '') continue;
      writeJsonAtomic(join(options.dir, fileNameOf(row.id)), { ...row, version: 1 }, { dirMode: 0o700 });
    }
    // Renamed rather than deleted, and only once every row is a file: a
    // daemon that is killed halfway has to find something to start from again.
    renameSync(options.file, `${options.file}.migrated`);
  }
  catch (error) {
    said(`Could not migrate ${options.file}: ${error instanceof Error ? error.message : String(error)}`);
  }
}
