/** The two `SessionStore` implementations: one that forgets, one that does not. */

import { existsSync, readdirSync, renameSync, rmSync } from 'node:fs';
import { join, sep } from 'node:path';
import { readJson, writeJsonAtomic } from './jsonfile.js';
import type { Scope } from './scopes.js';
import type { NestedRecord, PullRequestBaseline, SessionStore, StoredChat } from './types/sessions.js';
import type { Owner } from './types/usage.js';
import { ownerOf } from './values.js';

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
  nested(id: string): NestedRecord | undefined;
  setNested(id: string, value: NestedRecord | undefined): void;
  nestedSessions(): [string, NestedRecord][];
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
    parent: (id) => rows.get(id)?.parent,
    setParent: (id, value) => { patch(id, { parent: value }); },
    nested: (id) => rows.get(id)?.nested,
    setNested: (id, value) => { patch(id, { nested: value }); },
    nestedSessions: () => [...rows.entries()]
      .flatMap(([id, held]) => held.nested === undefined ? [] : [[id, held.nested] as [string, NestedRecord]]),
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
        ...(held.artifacts === undefined ? {} : { artifacts: held.artifacts }),
        ...(held.pullRequests === undefined ? {} : { pullRequests: held.pullRequests }),
        ...(held.chatTitles === undefined ? {} : { chatTitles: held.chatTitles }),
        ...(held.chatFlags === undefined ? {} : { chatFlags: held.chatFlags }),
        ...(held.parent === undefined ? {} : { parent: held.parent }),
        ...(held.nested === undefined ? {} : { nested: held.nested }),
        ...(held.chats === undefined ? {} : { chats: held.chats }),
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
    return [{
      uri: held.uri,
      backendId: held.backendId,
      ...(typeof held.title === 'string' ? { title: held.title } : {}),
      ...(typeof origin === 'object' && origin !== null && !Array.isArray(origin)
        ? { origin: origin as Record<string, unknown> }
        : {}),
      ...(held.default === true ? { default: true } : {}),
      ...(held.closed === true ? { closed: true } : {}),
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
  artifacts?: Record<string, unknown>[] | undefined;
  pullRequests?: PullRequestBaseline | undefined;
  chatTitles?: Map<string, string> | undefined;
  chatFlags?: Map<string, number> | undefined;
  parent?: string | undefined;
  nested?: NestedRecord | undefined;
  chats?: StoredChat[] | undefined;
}

/** Whether a row says nothing at all, and so is not one to keep. */
const empty = (row: Row): boolean =>
  row.flags === undefined && row.config === undefined && row.scope === undefined
  && row.owner === undefined && row.senders === undefined && row.provider === undefined
  && row.artifacts === undefined && row.pullRequests === undefined && row.chatTitles === undefined
  && row.chatFlags === undefined
  && row.parent === undefined && row.nested === undefined && row.chats === undefined;

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
   * conversation - decision
   * `an-attachments-bytes-are-written-to-disk-and-the-message-names-the-file`.
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
      ...(held.artifacts === undefined ? {} : { artifacts: held.artifacts }),
      ...(held.pullRequests === undefined ? {} : { pullRequests: held.pullRequests }),
      ...(held.chatTitles === undefined ? {} : { chatTitles: Object.fromEntries(held.chatTitles) }),
      ...(held.chatFlags === undefined ? {} : { chatFlags: Object.fromEntries(held.chatFlags) }),
      ...(held.parent === undefined ? {} : { parent: held.parent }),
      ...(held.nested === undefined ? {} : { nested: held.nested }),
      ...(held.chats === undefined ? {} : { chats: held.chats }),
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
        told(`Could not read ${file}: ${read.error instanceof Error ? read.error.message : String(read.error)}`);
      }
      else if ((read.value as Partial<Saved>).version === 1 && typeof (read.value as Partial<Saved>).id === 'string') {
        row = read.value as Saved;
      }
      else told(`Ignoring ${file}: it is not a session store this version can read.`);
      // One file this version cannot read is one session it does not know, and
      // the rest of the folder still does.
      if (row === undefined) continue;
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
    parent: (id) => inner.parent(id),
    setParent: (id, value) => { touched(id, () => { inner.setParent(id, value); }); },
    nested: (id) => inner.nested(id),
    setNested: (id, value) => { touched(id, () => { inner.setNested(id, value); }); },
    nestedSessions: () => inner.nestedSessions(),
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
