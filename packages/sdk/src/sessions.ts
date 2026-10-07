/** The two `SessionStore` implementations: one that forgets, one that does not. */

import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join, sep } from 'node:path';
import type { Scope } from './scopes.js';
import type { NestedRecord, PullRequestBaseline, SessionStore } from './types/sessions.js';
import type { Owner } from './types/usage.js';

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
  nested(id: string): NestedRecord | undefined;
  setNested(id: string, value: NestedRecord | undefined): void;
  nestedSessions(): [string, NestedRecord][];
}

/**
 * What a host keeps about its sessions, for as long as the process runs.
 *
 * The default, and the right one for a host embedded in something that has its
 * own place to put this, or for a test. Everything in a `Map`, so a restart
 * returns every archived session to the catalogue and marks every read one
 * unread - which is a real answer for a host that was never meant to outlive
 * the thing that started it, and the wrong one for a daemon.
 */
export function memorySessions(): SessionStore & Held {
  const flags = new Map<string, number>();
  const config = new Map<string, Record<string, unknown>>();
  const scope = new Map<string, Scope | null>();
  const owners = new Map<string, Owner>();
  const senders = new Map<string, Map<string, Owner>>();
  const providers = new Map<string, string>();
  const artifacts = new Map<string, Record<string, unknown>[]>();
  const pullRequests = new Map<string, PullRequestBaseline>();
  const chatTitles = new Map<string, Map<string, string>>();
  const nested = new Map<string, NestedRecord>();
  const forget = (id: string): void => {
    flags.delete(id); config.delete(id); scope.delete(id); owners.delete(id); senders.delete(id);
    providers.delete(id); artifacts.delete(id); pullRequests.delete(id); chatTitles.delete(id); nested.delete(id);
  };
  return {
    flags: (id) => flags.get(id) ?? 0,
    setFlags: (id, value) => { flags.set(id, value); },
    config: (id) => config.get(id),
    setConfig: (id, values) => { config.set(id, values); },
    scope: (id) => scope.get(id),
    setScope: (id, value) => { if (value === undefined) scope.delete(id); else scope.set(id, value); },
    owner: (id) => owners.get(id),
    setOwner: (id, value) => { if (value === undefined) owners.delete(id); else owners.set(id, value); },
    sender: (id, turnId) => senders.get(id)?.get(turnId),
    setSender: (id, turnId, value) => {
      const held = senders.get(id);
      if (value === undefined) {
        held?.delete(turnId);
        if (held !== undefined && held.size === 0) senders.delete(id);
        return;
      }
      if (held === undefined) senders.set(id, new Map([[turnId, value]]));
      else held.set(turnId, value);
    },
    provider: (id) => providers.get(id),
    setProvider: (id, value) => { if (value === undefined) providers.delete(id); else providers.set(id, value); },
    nested: (id) => nested.get(id),
    setNested: (id, value) => { if (value === undefined) nested.delete(id); else nested.set(id, value); },
    nestedSessions: () => [...nested.entries()],
    artifacts: (id) => artifacts.get(id),
    setArtifacts: (id, values) => { if (values.length === 0) artifacts.delete(id); else artifacts.set(id, values); },
    pullRequests: (id) => pullRequests.get(id),
    setPullRequests: (id, value) => { pullRequests.set(id, value); },
    chatTitle: (id, chatUri) => chatTitles.get(id)?.get(chatUri),
    setChatTitle: (id, chatUri, title) => {
      const held = chatTitles.get(id);
      if (title === '') {
        held?.delete(chatUri);
        if (held !== undefined && held.size === 0) chatTitles.delete(id);
        return;
      }
      if (held === undefined) chatTitles.set(id, new Map([[chatUri, title]]));
      else held.set(chatUri, title);
    },
    chatTitlesOf: (id) => {
      const held = chatTitles.get(id);
      return held === undefined ? undefined : Object.fromEntries(held);
    },
    sendersOf: (id) => {
      const held = senders.get(id);
      return held === undefined ? undefined : Object.fromEntries(held);
    },
    forget,
    prune: (gone) => {
      // Every id any of the ten holds, since a session is remembered under
      // whichever of them was written last and nothing else names it.
      for (const id of new Set([...flags.keys(), ...config.keys(), ...scope.keys(), ...owners.keys(),
        ...senders.keys(), ...providers.keys(), ...artifacts.keys(), ...pullRequests.keys(), ...chatTitles.keys(),
        ...nested.keys()])) {
        if (gone(id)) forget(id);
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
 * A typed reference as the file wrote it, or nothing when it is not one.
 *
 * The four kinds `Owner` names, and an id after the colon. Anything else is
 * ignored rather than guessed at, the way every other field here is.
 */
const ownerOf = (value: unknown): Owner | undefined =>
  typeof value === 'string' && /^(?:user|team|project|root):.+$/.test(value) ? value as Owner : undefined;

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

/** What is persisted for one session. Versioned, so a later shape can be recognised rather than guessed at. */
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
  nested?: NestedRecord;
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
  /** Every id this store has heard of, because the port has no way to list them. */
  const heard = new Set<string>();
  /** The ids that moved since the last save, and so the files to write. */
  const dirty = new Set<string>();
  let writing: ReturnType<typeof setTimeout> | undefined;
  /** Closed: what was waiting has been written, and nothing is written again. */
  let closed = false;

  /**
   * What one session is written down as, or nothing where there is nothing to
   * write: a session somebody looked at and left alone is not remembered.
   */
  const rowOf = (id: string): Saved | undefined => {
    const flags = inner.flags(id);
    const config = inner.config(id);
    const scope = inner.scope(id);
    const owner = inner.owner(id);
    const senders = inner.sendersOf(id);
    const provider = inner.provider(id);
    const artifacts = inner.artifacts(id);
    const pullRequests = inner.pullRequests(id);
    const chatTitles = inner.chatTitlesOf(id);
    const nested = inner.nested(id);
    if (flags === 0 && config === undefined && scope === undefined && owner === undefined
      && senders === undefined && provider === undefined && artifacts === undefined
      && pullRequests === undefined && chatTitles === undefined && nested === undefined) return undefined;
    return {
      version: 1,
      id,
      ...(flags === 0 ? {} : { flags }),
      ...(config === undefined ? {} : { config }),
      ...(scope === undefined ? {} : { scope }),
      ...(owner === undefined ? {} : { owner }),
      ...(senders === undefined ? {} : { senders }),
      ...(provider === undefined ? {} : { provider }),
      ...(artifacts === undefined ? {} : { artifacts }),
      ...(pullRequests === undefined ? {} : { pullRequests }),
      ...(chatTitles === undefined ? {} : { chatTitles }),
      ...(nested === undefined ? {} : { nested }),
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
        mkdirSync(dir, { recursive: true, mode: 0o700 });
        // Written beside and moved into place, so a daemon killed mid-write
        // leaves the last good file rather than half of this one.
        const temporary = `${file}.${process.pid}.tmp`;
        writeFileSync(temporary, `${JSON.stringify(row, null, 2)}\n`, { mode: 0o600 });
        renameSync(temporary, file);
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
      let row: Saved | undefined;
      try {
        const read: unknown = JSON.parse(readFileSync(file, 'utf8'));
        if ((read as Partial<Saved>).version === 1 && typeof (read as Partial<Saved>).id === 'string')
          row = read as Saved;
        else told(`Ignoring ${file}: it is not a session store this version can read.`);
      }
      catch (error) {
        told(`Could not read ${file}: ${error instanceof Error ? error.message : String(error)}`);
      }
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
      const nested = nestedOf(row.nested);
      if (nested !== undefined) inner.setNested(row.id, nested);
    }
  };

  load();

  return {
    flags: (id) => inner.flags(id),
    config: (id) => inner.config(id),
    setFlags: (id, value) => { heard.add(id); inner.setFlags(id, value); dirty.add(id); later(); },
    setConfig: (id, values) => { heard.add(id); inner.setConfig(id, values); dirty.add(id); later(); },
    scope: (id) => inner.scope(id),
    setScope: (id, value) => { heard.add(id); inner.setScope(id, value); dirty.add(id); later(); },
    owner: (id) => inner.owner(id),
    setOwner: (id, value) => { heard.add(id); inner.setOwner(id, value); dirty.add(id); later(); },
    sender: (id, turnId) => inner.sender(id, turnId),
    setSender: (id, turnId, value) => { heard.add(id); inner.setSender(id, turnId, value); dirty.add(id); later(); },
    provider: (id) => inner.provider(id),
    setProvider: (id, value) => { heard.add(id); inner.setProvider(id, value); dirty.add(id); later(); },
    nested: (id) => inner.nested(id),
    setNested: (id, value) => { heard.add(id); inner.setNested(id, value); dirty.add(id); later(); },
    nestedSessions: () => inner.nestedSessions(),
    artifacts: (id) => inner.artifacts(id),
    setArtifacts: (id, values) => { heard.add(id); inner.setArtifacts(id, values); dirty.add(id); later(); },
    pullRequests: (id) => inner.pullRequests(id),
    setPullRequests: (id, value) => { heard.add(id); inner.setPullRequests(id, value); dirty.add(id); later(); },
    chatTitle: (id, chatUri) => inner.chatTitle(id, chatUri),
    setChatTitle: (id, chatUri, title) => { heard.add(id); inner.setChatTitle(id, chatUri, title); dirty.add(id); later(); },
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
  let text: string;
  try { text = readFileSync(options.file, 'utf8'); }
  // Not there, which is what a first run looks like.
  catch { return; }
  let read: unknown;
  try { read = JSON.parse(text); }
  catch (error) {
    said(`Could not read ${options.file}: ${error instanceof Error ? error.message : String(error)}`);
    return;
  }
  const whole = read as Partial<Whole>;
  if (whole.version !== 1 || !Array.isArray(whole.sessions)) {
    said(`Ignoring ${options.file}: it is not a session store this version can read.`);
    return;
  }
  try {
    mkdirSync(options.dir, { recursive: true, mode: 0o700 });
    for (const row of whole.sessions) {
      if (typeof row?.id !== 'string' || row.id === '') continue;
      const file = join(options.dir, fileNameOf(row.id));
      const temporary = `${file}.${process.pid}.tmp`;
      writeFileSync(temporary, `${JSON.stringify({ ...row, version: 1 }, null, 2)}\n`, { mode: 0o600 });
      renameSync(temporary, file);
    }
    // Renamed rather than deleted, and only once every row is a file: a
    // daemon that is killed halfway has to find something to start from again.
    renameSync(options.file, `${options.file}.migrated`);
  }
  catch (error) {
    said(`Could not migrate ${options.file}: ${error instanceof Error ? error.message : String(error)}`);
  }
}
