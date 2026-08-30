/** What git says a directory has changed, as a host's `ChangesetSource`. */

import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import type {
  ChangesSummary, ChangesetFile, ChangesetSource, ChangesetState,
} from './types/changes.js';

/**
 * How many lines a file has, for one git will not count.
 *
 * Capped, because this is a *summary* and a row saying 40,000 is worth no more
 * than one saying a lot - and reading a hundred-megabyte file to find that out
 * is the expensive way to learn nothing.
 */
const lines = async (path: string): Promise<number> => {
  try {
    const text = await readFile(path, 'utf8');
    if (text === '') return 0;
    return text.split('\n').length - (text.endsWith('\n') ? 1 : 0);
  }
  catch { return 0; }
};

/**
 * How many lines differ between two versions, without diffing them.
 *
 * A count, not a diff: the rows carry both sides and a client renders the
 * real thing from those. Computing a proper LCS here to fill in two numbers
 * would be the same work twice, once where nobody can see it.
 */
const counted = (before: string, after: string): { added: number; removed: number } => {
  const was = before === '' ? [] : before.split('\n');
  const now = after === '' ? [] : after.split('\n');
  const shared = new Set(was);
  const added = now.filter((row) => !shared.has(row)).length;
  const kept_ = new Set(now);
  const removed = was.filter((row) => !kept_.has(row)).length;
  return { added, removed };
};

/** One `git` run, as text, or nothing when it would not run. */
const git = (dir: string, args: string[]): Promise<string | undefined> =>
  new Promise((answer) => {
    execFile('git', ['-C', dir, ...args], { timeout: 5000, maxBuffer: 32 * 1024 * 1024 },
      (error, out) => answer(error ? undefined : out.toString()));
  });

/**
 * The scheme for the side of an edit that is not on disk.
 *
 * `before` is what a file *used to be*, so no `file://` URI addresses it and
 * the filesystem port cannot serve it. This host mints its own URI and
 * resolves it itself, which is what `ChangesetSource.read` is for.
 */
const BEFORE = 'ahp-git:';
const beforeUri = (dir: string, path: string): string => `${BEFORE}//${dir}/${path}`;

/**
 * The scheme for a side that was *captured* rather than read.
 *
 * A turn's changeset is what the files looked like on either side of that
 * turn, and neither side is on disk once a later turn has run. Both are held
 * here and served from here.
 */
const CAPTURED = 'ahp-edit:';

/**
 * Uncommitted changes, from `git status` and `git diff`.
 *
 * ```ts
 * createHost({ path, agents, changes: gitChanges() });
 * ```
 *
 * Only the `uncommitted` scope. `session` and `turn/<id>` are the other two
 * the protocol defines, and neither can be answered from git alone: git knows
 * what a working tree looks like, not which turn made it look that way.
 */
/** One file, as a turn found it and as the turn left it. */
interface Captured {
  before?: string;
  after?: string;
}

export function gitChanges(): ChangesetSource {
  /**
   * What each turn changed, per session.
   *
   * `session -> turn -> path -> both sides`. Held rather than derived because
   * git cannot answer it: a working tree says what it looks like now, so a
   * turn asked about after two more have run would be handed their work too.
   */
  const seen = new Map<string, Map<string, Map<string, Captured>>>();

  /** The text held for a captured side, by the URI minted for it. */
  const kept = new Map<string, string>();

  const capturedUri = (session: string, turn: string, path: string, phase: string): string =>
    `${CAPTURED}//${encodeURIComponent(session)}/${encodeURIComponent(turn)}/${phase}${path}`;

  /** Every file a session has touched, newest turn last. */
  const across = (session: string): Map<string, Captured> => {
    const flat = new Map<string, Captured>();
    for (const [, files] of seen.get(session) ?? []) {
      for (const [path, sides] of files) {
        const already = flat.get(path);
        // The first `before` and the last `after`: a session's changeset is
        // the whole conversation as one edit, not the last turn of it.
        flat.set(path, {
          ...(already?.before !== undefined ? { before: already.before } : sides.before !== undefined ? { before: sides.before } : {}),
          ...(sides.after !== undefined ? { after: sides.after } : already?.after !== undefined ? { after: already.after } : {}),
        });
      }
    }
    return flat;
  };

  /** Captured sides as the protocol's rows, with both sides fetchable. */
  const rowsOf = (session: string, turn: string, files: Map<string, Captured>): ChangesetFile[] =>
    [...files].map(([path, sides]) => {
      const uri = `file://${path}`;
      const before = capturedUri(session, turn, path, 'before');
      const after = capturedUri(session, turn, path, 'after');
      return {
        id: uri,
        edit: {
          // An empty `before` is a file the turn created, and the protocol
          // says a creation by leaving the side out rather than by a word.
          ...(sides.before ? { before: { uri, content: { uri: before } } } : {}),
          ...(sides.after !== undefined ? { after: { uri, content: { uri: after } } } : {}),
          diff: counted(sides.before ?? '', sides.after ?? ''),
        },
      };
    });

  /** The last answer per directory, so a catalogue of rows is not a hundred `git` runs. */
  const held = new Map<string, { files: ChangesetFile[]; summary: ChangesSummary }>();

  /**
   * What changed, as one pass over `git status` and one over `git diff`.
   *
   * `--porcelain=v1 -z` because a filename may contain anything a shell would
   * otherwise eat, newlines included; the NUL form is the only one that
   * survives a path somebody made on purpose.
   */
  const look = async (dir: string): Promise<{ files: ChangesetFile[]; summary: ChangesSummary } | undefined> => {
    const status = await git(dir, ['status', '--porcelain=v1', '-z', '--untracked-files=all']);
    if (status === undefined) return undefined;

    /** Line counts per path, for the files git can already diff. */
    const counts = new Map<string, { added: number; removed: number }>();
    const numstat = await git(dir, ['diff', '--numstat', '-z', 'HEAD']) ?? '';
    /*
     * `added<TAB>removed<TAB>path` per record, NUL between records.
     *
     * The tabs are *inside* a record and only the separator is NUL, which is
     * the whole point of `-z`: a path may contain a tab, and it may contain a
     * newline, and neither ends the record. A rename writes an empty path and
     * then two records of its own, old name and new.
     */
    const counted = numstat.split('\0');
    for (let i = 0; i < counted.length; i++) {
      const record = counted[i] as string;
      if (record === '') continue;
      const [rawAdded, rawRemoved, path] = record.split('\t');
      // `-` on both sides is a binary file, which has no lines to count.
      const added = Number(rawAdded);
      const removed = Number(rawRemoved);
      const named = path === '' || path === undefined
        // A rename: the two records after this one are the old and new names,
        // and it is the new one the working tree has.
        ? (i += 2, counted[i] as string | undefined)
        : path;
      if (!named) continue;
      counts.set(named, {
        added: Number.isFinite(added) ? added : 0,
        removed: Number.isFinite(removed) ? removed : 0,
      });
    }

    const files: ChangesetFile[] = [];
    const summary: ChangesSummary = { files: 0, additions: 0, deletions: 0 };
    const records = status.split('\0').filter((record) => record !== '');
    for (const record of records) {
      // `XY <path>`: two status letters, a space, then the path.
      const code = record.slice(0, 2);
      const path = record.slice(3);
      if (path === '') continue;
      const gone = code.includes('D');
      const fresh = code.includes('A') || code.includes('?');
      const uri = `file://${dir}/${path}`;
      // An untracked file is in no diff against HEAD, so git reports nothing
      // for it. Every line of it is an addition, which is what it is.
      const count = counts.get(path) ?? (fresh
        ? { added: await lines(`${dir}/${path}`), removed: 0 }
        : { added: 0, removed: 0 });

      files.push({
        id: uri,
        edit: {
          // Absent `before` is a creation and absent `after` a deletion. The
          // protocol says both by leaving a side out rather than by a word.
          ...(fresh ? {} : {
            before: { uri, content: { uri: beforeUri(dir, path) } },
          }),
          ...(gone ? {} : {
            after: { uri, content: { uri } },
          }),
          diff: { added: count.added, removed: count.removed },
        },
      });
      summary.files = (summary.files ?? 0) + 1;
      summary.additions = (summary.additions ?? 0) + count.added;
      summary.deletions = (summary.deletions ?? 0) + count.removed;
    }
    return { files, summary };
  };

  return {
    scopes: (dir, session) => {
      const scopes = held.has(dir)
        ? [{ id: 'uncommitted', label: 'Uncommitted Changes', description: 'The working tree, against HEAD' }]
        : [];
      const turns = seen.get(session);
      if (!turns || turns.size === 0) return scopes;
      return [
        ...scopes,
        { id: 'session', label: 'This Session', description: 'Everything this conversation changed' },
        // A template, which is how the protocol offers a scope that has to be
        // filled in: a client expands `{turnId}` from a turn it can see.
        { id: 'turn/{turnId}', label: 'This Turn', description: 'What one turn changed' },
      ];
    },

    state: async (dir, session, scope) => {
      if (scope === 'uncommitted') {
        const found = held.get(dir) ?? await look(dir);
        if (!found) return undefined;
        return { status: 'complete', files: found.files };
      }
      if (scope === 'session') {
        const files = across(session);
        if (files.size === 0) return { status: 'complete', files: [] };
        return { status: 'complete', files: rowsOf(session, 'session', files) };
      }
      if (scope.startsWith('turn/')) {
        const turn = scope.slice('turn/'.length);
        const files = seen.get(session)?.get(turn);
        // A turn nobody has heard of is not an empty changeset - it is a
        // question about something that did not happen.
        if (!files) return undefined;
        return { status: 'complete', files: rowsOf(session, turn, files) };
      }
      return undefined;
    },

    /*
     * Both sides of a file, captured as the tool runs.
     *
     * `before` is read as the tool is announced and `after` when its result
     * arrives. A file that did not exist reads as empty, which is what a
     * creation is.
     */
    observe: (dir, session, turnId, path, phase) => {
      void (async () => {
        const text = await readFile(path, 'utf8').catch(() => undefined);
        const turns = seen.get(session) ?? new Map<string, Map<string, Captured>>();
        seen.set(session, turns);
        const files = turns.get(turnId) ?? new Map<string, Captured>();
        turns.set(turnId, files);
        const sides = files.get(path) ?? {};
        // The first `before` wins: a turn that edits one file twice found it
        // in one state, and the second read is already its own work.
        if (phase === 'before' && sides.before === undefined) sides.before = text ?? '';
        if (phase === 'after') sides.after = text ?? '';
        files.set(path, sides);

        kept.set(capturedUri(session, turnId, path, phase), text ?? '');
        // The session-wide view is assembled from the turns, and its rows mint
        // URIs of their own, so those have to resolve too.
        const flat = across(session).get(path);
        if (flat?.before !== undefined) kept.set(capturedUri(session, 'session', path, 'before'), flat.before);
        if (flat?.after !== undefined) kept.set(capturedUri(session, 'session', path, 'after'), flat.after);
      })().catch(() => {});
    },

    summary: (dir) => held.get(dir)?.summary,

    /*
     * The `before` side, out of git rather than off the disk.
     *
     * `git show HEAD:<path>` is what the file was at the last commit, which is
     * the only place that version still exists.
     */
    read: async (uri) => {
      // Captured sides are held, not fetched: neither is on disk any more.
      if (uri.startsWith(CAPTURED)) {
        const text = kept.get(uri);
        return text === undefined ? undefined : { data: text, encoding: 'utf-8' };
      }
      if (!uri.startsWith(BEFORE)) return undefined;
      const rest = uri.slice(`${BEFORE}//`.length);
      // The directory is the longest known one this URI starts with: a path
      // has slashes and so does a directory, and splitting on the first one
      // would name neither.
      const dir = [...held.keys()]
        .filter((known) => rest.startsWith(`${known}/`))
        .sort((a, b) => b.length - a.length)[0];
      if (dir === undefined) return undefined;
      const path = rest.slice(dir.length + 1);
      const data = await git(dir, ['show', `HEAD:${path}`]);
      // A file that is not in HEAD has no before, and empty is the truthful
      // answer for one: it did not exist.
      return { data: data ?? '', encoding: 'utf-8' };
    },

    refresh: async (dir) => {
      const found = await look(dir);
      const before = JSON.stringify(held.get(dir)?.summary ?? null);
      if (!found) {
        if (!held.has(dir)) return false;
        held.delete(dir);
        return true;
      }
      held.set(dir, found);
      return JSON.stringify(found.summary) !== before;
    },
  };
}
