/**
 * The client plugins a host keeps on its own disk.
 *
 * A plugin a client announces lives on the client's machine, and a backend that
 * runs here can only open a path that is here. So the plugin is copied - the
 * client's own listing says what is in it, the client's own reads say what is in
 * each file - and the backend is handed the directory it landed in.
 *
 * The copy is kept between announcements: a client that announces the same URI
 * and the same nonce again is announcing what is already on disk, and a second
 * copy of it would be a second directory for one plugin. Naming is by the URI
 * and the nonce, so a client that changed a file and bumped the nonce gets a
 * fresh directory beside the old one rather than a directory written under the
 * feet of a turn already reading it.
 *
 * The directory is bounded, because a client asking for a copy is not a reason
 * to fill a disk: the copies least recently used go first, a per-plugin limit
 * before the whole-directory one, and a directory that will not go is left
 * where it is.
 *
 * An automation's plugins are copied in here too, under `automations/`, and
 * they are deliberately outside all of that. A run happens with nobody
 * connected, so what it loads has to outlive the client that wrote the
 * automation and may not be evicted by a session that announced more plugins
 * than it did - so these copies are not in the order, and what removes them is
 * the automation that named them going away, once no run is reading one and no
 * write is still capturing one.
 */

import { createHash } from 'node:crypto';
import { mkdirSync, readdirSync, renameSync, rmdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, relative } from 'node:path';
import { localPath, uriOf } from './fileuri.js';
import { readJsonObject, writeJsonAtomic } from './jsonfile.js';
import { bag, reason, str } from './values.js';
import type {
  AnnouncedPlugin, CapturedPlugin, ClientPlugins, HeldCopies, SyncedPlugin, TemplatePlugin,
} from './types/clientplugins.js';
import type { Clients } from './types/host.js';

/** How many copies the directory holds in all, over every client and every plugin. */
const COPIES = 64;
/** How many revisions of one plugin it holds. */
const REVISIONS = 8;
/** How much of a URI or a nonce names a directory. */
const KEY_CHARS = 128;
/** What a plugin announced with no nonce is filed under. */
const NO_NONCE = 'default';
/** What a half-built copy is named, beside the name it is moved to. */
const BUILDING = '.building';
/** The folder under the copies' directory where an automation's plugins live. */
const AUTOMATIONS = 'automations';

/**
 * What one URI or one nonce is filed under.
 *
 * Everything that is not a letter or a digit becomes a dash, and it is cut to
 * a length a filesystem takes. The same URI always answers the same name, which
 * is the whole point: the name is how a copy announced twice is found once.
 */
const keyOf = (text: string): string => text.replace(/[^a-zA-Z0-9]/g, '-').slice(0, KEY_CHARS);

/** Whether a path is a directory that is there. */
const isDir = (path: string): boolean => {
  try { return statSync(path).isDirectory(); } catch { return false; }
};

/** Whether a path is inside a directory, and so is one this host put there rather than one it was handed. */
const under = (dir: string, path: string): boolean => {
  const rest = relative(dir, path);
  return rest !== '' && !rest.startsWith('..') && !isAbsolute(rest);
};

/**
 * A `ClientPlugins` over one directory, reading from the clients a host has.
 *
 * The clients are asked for lazily, because the port is built where a host is
 * configured and the host it reads from is made after that.
 */
export function clientPluginsIn(dir: string, clients: () => Clients): ClientPlugins {
  /** Where the order of use is kept, which is also where the copies that are there are listed. */
  const order = join(dir, 'lru.json');

  /** The copies this directory holds, least recently used first. */
  let held: { uri: string; nonce: string }[] = [];

  /** Where one revision of one plugin is copied to. Derived from the two names, never read from a file. */
  const placeOf = (uri: string, nonce: string): string => join(dir, keyOf(uri), keyOf(nonce));

  const load = (): void => {
    const read = readJsonObject(order);
    if (!read.ok) return;
    const rows = read.value.copies;
    if (!Array.isArray(rows)) return;
    held = rows.flatMap((row) => {
      const uri = str(bag(row).uri);
      const nonce = str(bag(row).nonce);
      if (uri === undefined || nonce === undefined) return [];
      // The directory is worked out again from the two names rather than taken
      // from the file: this is a list of what is deleted from, and a file
      // naming paths would be a file naming any path at all. A copy that is no
      // longer on disk is not held.
      return isDir(placeOf(uri, nonce)) ? [{ uri, nonce }] : [];
    });
  };

  /** Drop what is over the limits, oldest first. A directory that will not go is left where it is. */
  const evict = (): void => {
    const per = new Map<string, number>();
    const keep: { uri: string; nonce: string }[] = [];
    for (const one of [...held].reverse()) {
      const times = (per.get(keyOf(one.uri)) ?? 0) + 1;
      if (keep.length >= COPIES || times > REVISIONS) {
        try { rmSync(placeOf(one.uri, one.nonce), { recursive: true, force: true }); }
        // A copy that cannot be removed is not a reason to fail a sync that is
        // otherwise fine: the plugin the client asked for is still copied.
        catch { /* left where it is */ }
        continue;
      }
      per.set(keyOf(one.uri), times);
      keep.push(one);
    }
    held = keep.reverse();
  };

  /** Put a copy at the newest end of the order, drop what is over the limits, and write the order down. */
  const note = (uri: string, nonce: string): void => {
    held = [...held.filter((one) => one.uri !== uri || one.nonce !== nonce), { uri, nonce }];
    evict();
    writeJsonAtomic(order, { copies: held });
  };

  /** Copy one directory a client serves, into `into`. */
  const copy = async (client: string, uri: string, into: string): Promise<void> => {
    mkdirSync(into, { recursive: true });
    const listed = bag(await clients().list(client, uri)).entries;
    if (!Array.isArray(listed)) throw new Error(`${uri} could not be listed`);
    for (const row of listed) {
      const name = str(bag(row).name);
      // A name that would reach outside the directory is not one this host
      // writes: the copy is the client's content and never the client's paths.
      if (name === undefined || name === '' || name === '.' || name === '..' || name.includes('/')) {
        throw new Error(`${uri} is not a directory of files`);
      }
      const child = uri.endsWith('/') ? `${uri}${name}` : `${uri}/${name}`;
      if (str(bag(row).type) === 'directory') { await copy(client, child, join(into, name)); continue; }
      const file = bag(await clients().read(client, child));
      const data = str(file.data) ?? '';
      writeFileSync(join(into, name), Buffer.from(data, file.encoding === 'base64' ? 'base64' : 'utf8'));
    }
  };

  const sync = async (client: string, plugins: AnnouncedPlugin[]): Promise<SyncedPlugin[]> => {
    const answers: SyncedPlugin[] = [];
    for (const one of plugins) {
      const uri = typeof one.uri === 'string' ? one.uri : '';
      // An empty nonce names no revision, so it is filed as a missing one is.
      const nonce = one.nonce === undefined || one.nonce === '' ? NO_NONCE : one.nonce;
      const asked = one.nonce === undefined ? { uri } : { uri, nonce: one.nonce };
      if (uri === '') { answers.push({ ...asked, error: 'a plugin with no URI cannot be copied' }); continue; }

      const here = localPath(uri);
      // A plugin already under this directory is where a copy would have put
      // it, so it is used where it is: an automation runs with no client
      // connected, and its plugins are copies this host made earlier.
      if (uri.startsWith('file://') && under(dir, here) && isDir(here)) {
        answers.push({ ...asked, path: here });
        continue;
      }

      const at = placeOf(uri, nonce);
      if (isDir(at)) {
        note(uri, nonce);
        answers.push({ ...asked, path: at });
        continue;
      }

      // Built beside the name it is moved to, and moved into place whole: a
      // sync cut short leaves a half-written copy nobody is handed, not a
      // directory that looks like the plugin and is missing a file.
      const building = `${at}${BUILDING}`;
      try {
        rmSync(building, { recursive: true, force: true });
        rmSync(at, { recursive: true, force: true });
        await copy(client, uri, building);
        renameSync(building, at);
        note(uri, nonce);
        answers.push({ ...asked, path: at });
      } catch (error) {
        rmSync(building, { recursive: true, force: true });
        // And the name it was building under, when the copy was the first for
        // this plugin and so made that name: what a failed copy leaves is
        // nothing at all, not an empty directory where a plugin would be.
        try { rmdirSync(join(dir, keyOf(uri))); } catch { /* something else is in it */ }
        answers.push({ ...asked, error: reason(error) });
      }
    }
    return answers;
  };

  /** Where an automation's copies live, under the same directory and outside the order. */
  const automations = join(dir, AUTOMATIONS);

  /**
   * What one plugin a template named is filed under.
   *
   * The URI and the nonce, hashed, and nothing else: a template saved twice
   * with the same pair names the same copy, so the second save reads nothing
   * from the client - and a pair that moved is a name beside the old one
   * rather than a directory rewritten under a run already reading it. The
   * hash is also what keeps a client's URI off the filesystem: nothing a
   * client wrote is a path here.
   */
  const placeIn = (uri: string, nonce: string): string =>
    join(automations, createHash('sha256').update(`${uri}\n${nonce}`).digest('hex'));

  const capture = async (client: string, plugins: TemplatePlugin[]): Promise<HeldCopies> => {
    const ids = new Set<string>();
    for (const one of plugins) {
      const id = str(one.id)?.trim() ?? '';
      if (id === '' || ids.has(id)) throw new Error('Every plugin a template names needs an id of its own');
      ids.add(id);
    }
    // A copy is the client's tree read over its connection, so a template with
    // plugins and no client to read them from is a copy of nothing.
    if (plugins.length > 0 && client === '') {
      throw new Error('A template\'s plugins are copied from the client that asked for it, and this one named none');
    }
    /** What this capture has decided on, held back from a prune until it lets go. */
    const mine = new Set<string>();
    const hold = (path: string): void => {
      mine.add(path);
      holding.set(path, (holding.get(path) ?? 0) + 1);
    };
    const release = (): void => {
      for (const path of mine) {
        const left = (holding.get(path) ?? 1) - 1;
        if (left > 0) holding.set(path, left);
        else holding.delete(path);
      }
      mine.clear();
    };
    try {
      const captured: CapturedPlugin[] = [];
      for (const one of plugins) {
        const id = (str(one.id) ?? '').trim();
        const uri = str(one.uri) ?? '';
        if (uri === '') throw new Error(`${id} names no URI, so there is nothing to copy`);
        // An empty nonce names no revision, as it does in `sync`.
        const nonce = one.nonce === undefined || one.nonce === '' ? NO_NONCE : one.nonce;
        const at = placeIn(uri, nonce);
        /*
         * Held from here, before a byte moves. A prune from another write runs
         * while this one is between two reads, and what it would find at this
         * name is a copy no automation names yet - which is exactly what it
         * removes. The name it is built under is held with it, or a prune
         * would take the half-written directory out from under the copy.
         */
        hold(at);
        if (!isDir(at)) {
          /*
           * Built beside the name it is moved to, as a session's copy is, and
           * for the same reason: a copy cut short leaves nothing rather than a
           * directory that looks like the plugin and is missing a file. There
           * is no `note` here - these copies are not in the order, which is
           * what keeps a session from evicting a run's plugins.
           */
          const building = `${at}${BUILDING}`;
          hold(building);
          try {
            rmSync(building, { recursive: true, force: true });
            await copy(client, uri, building);
            renameSync(building, at);
          } catch (error) {
            rmSync(building, { recursive: true, force: true });
            throw error;
          }
        }
        const named = str(one.name);
        captured.push({
          type: 'plugin',
          id,
          uri: uriOf(at),
          // A plugin the template did not name is named by where it came from,
          // as a session's own list names one.
          name: named === undefined || named === '' ? uri : named,
          load: { kind: 'loaded' },
        });
      }
      return { copies: captured, release };
    } catch (error) {
      // A copy that half-arrived is this capture's to let go of, and there is
      // no write left to hand it to.
      release();
      throw error;
    }
  };

  /**
   * The copies a run session in this process was handed.
   *
   * A run reads its plugins where they are for as long as it is going, and the
   * automation that named them may be gone by then: a turn that loaded a
   * plugin in its first message still has it open when somebody removes the
   * automation, and the directory under that turn is not this host's to pull
   * away. So what a run was handed is held here, and `prune` leaves it - for
   * as long as the process, which is as long as anything reading it lasts.
   */
  const inUse = new Set<string>();

  /**
   * The copies a capture has decided on and not yet let go of.
   *
   * A capture reads a client several times over one connection, and a prune
   * from another write may run between two of those reads. A copy that is
   * placed and not yet stored is named by no automation, so without this it
   * looks like one to remove - and the entry about to name it would point at a
   * folder that is gone. Counted rather than listed, because two writes may
   * capture the same plugin at once and the first to finish is not the last to
   * let go.
   */
  const holding = new Map<string, number>();

  /**
   * Remove every copy under `automations/` that no automation names, no run
   * session was handed and no capture is still making.
   *
   * A child that is none of those goes whole, and one that will not go is left
   * where it is: this runs beside a write that has already been made, and a
   * copy nobody can delete is not a reason to fail it.
   */
  const prune = (kept: readonly string[]): void => {
    let children: string[];
    try { children = readdirSync(automations); }
    catch { return; }
    const held = [...kept, ...inUse, ...holding.keys()];
    for (const child of children) {
      const at = join(automations, child);
      if (held.some((one) => one === at || under(one, at))) continue;
      try { rmSync(at, { recursive: true, force: true }); }
      catch { /* left where it is */ }
    }
  };

  const spare = (paths: readonly string[]): void => {
    for (const one of paths) inUse.add(one);
  };

  load();
  return { sync, capture, prune, spare };
}
