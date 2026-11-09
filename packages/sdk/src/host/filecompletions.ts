/**
 * The file items `@` and a `#` on its way to a file complete with.
 *
 * VS Code's agent host's file completion provider: the files under every
 * working directory of the session, each owned by the deepest directory that
 * holds it, ranked by the Quick Open scorer against what was typed, fifty at
 * most and shared fairly between the directories when nothing was typed yet;
 * the trigger inserted with the file's name, and a name two of them share
 * labelled with the folder it is in.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentHostFileCompletionProvider.ts
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentHostFileCompletionUtils.ts
 *
 * The working directories are paths here where VS Code's are URIs, so its
 * comparison of two (`extUriBiasedIgnorePathCase`, case blind for a file
 * except on Linux) is made on the paths, and a relative path is the one
 * `node:path` gives, with forward slashes as VS Code's relative URI path has.
 */

import { basename, relative, resolve, sep } from 'node:path';
import { uriOf } from '../resources/fileuri.js';
import { compareItemsByFuzzyScore, prepareQuery, scoreItemFuzzy } from '../vscode/fuzzyscorer.js';
import type { FuzzyScorerCache, IItemAccessor } from '../vscode/fuzzyscorer.js';
import { shorten } from '../vscode/labels.js';
import { compare } from '../vscode/strings.js';
import type { Bag } from '../types/common.js';
import type { WorkspaceFiles } from '../types/host.js';
import type { LogLevel } from '../log.js';

/** Maximum number of completion items returned per call. */
const MAX_RESULTS = 50;

/** The `@` or `#` being typed, with what follows it and the range it covers. */
export interface AtToken {
  readonly token: string;
  readonly triggerChar: string;
  readonly rangeStart: number;
  readonly rangeEnd: number;
}

/** A file offered: its path, the working directory that owns it, and its path from there. */
interface FileCompletionCandidate {
  readonly path: string;
  readonly owner: string;
  readonly ownerIndex: number;
  readonly relativePath: string;
}

/** A candidate's basename, parent directory and owner-relative path, for the scorer. */
const accessor: IItemAccessor<FileCompletionCandidate> = {
  getItemLabel: (item) => basename(item.path),
  getItemDescription: (item) => {
    const idx = item.relativePath.lastIndexOf('/');
    return idx > 0 ? item.relativePath.slice(0, idx) : undefined;
  },
  getItemPath: (item) => item.relativePath,
};

/** A path as VS Code compares two: case blind except on Linux. */
const keyOf = (path: string): string => (process.platform === 'linux' ? path : path.toLowerCase());

/** Whether `path` is `parent` or under it, compared as `keyOf` compares. */
const isEqualOrParent = (path: string, parent: string): boolean => {
  const child = keyOf(path);
  const held = keyOf(parent);
  return child === held || child.startsWith(held.endsWith(sep) ? held : `${held}${sep}`);
};

/**
 * The working directories as roots: every one, normalized and once each, owns
 * the files under it, and only those no other holds are listed.
 */
const rootsOf = (workingDirectories: readonly string[]): { logicalRoots: string[]; enumerationRoots: string[] } => {
  const logicalRoots: string[] = [];
  const seen = new Set<string>();
  for (const workingDirectory of workingDirectories) {
    const normalized = resolve(workingDirectory);
    const key = keyOf(normalized);
    if (!seen.has(key)) {
      seen.add(key);
      logicalRoots.push(normalized);
    }
  }
  const enumerationRoots = logicalRoots.filter((candidate, candidateIndex) =>
    !logicalRoots.some((other, otherIndex) => candidateIndex !== otherIndex && isEqualOrParent(candidate, other)));
  return { logicalRoots, enumerationRoots };
};

/** The deepest working directory holding `path`. */
const deepestOwner = (path: string, roots: readonly string[]): string | undefined => {
  let deepestMatch: string | undefined;
  for (const root of roots) {
    if (isEqualOrParent(path, root) && (deepestMatch === undefined || root.length > deepestMatch.length)) deepestMatch = root;
  }
  return deepestMatch;
};

/**
 * Every root's files, and a root's nested working directories listed on their
 * own where its listing stopped short or failed.
 */
const enumerateRootFiles = async (
  roots: { logicalRoots: string[]; enumerationRoots: string[] },
  workspaceFiles: WorkspaceFiles,
  log: (line: string, level?: LogLevel) => void,
): Promise<string[][]> => {
  const filesByRoot: string[][] = [];
  const queuedRoots = new Set(roots.enumerationRoots.map(keyOf));
  let pendingRoots = [...roots.enumerationRoots];
  while (pendingRoots.length > 0) {
    const currentRoots = pendingRoots;
    pendingRoots = [];
    const enumerations = await Promise.all(currentRoots.map(async (root) => {
      try {
        const result = await workspaceFiles.getFiles(root);
        return { root, files: result.files, needsFallback: result.isTruncated };
      }
      catch (err) {
        log(`Failed to enumerate ${root}: ${err instanceof Error ? err.message : String(err)}`, 'error');
        return { root, files: [], needsFallback: true };
      }
    }));
    for (const enumeration of enumerations) {
      filesByRoot.push(enumeration.files);
      if (!enumeration.needsFallback) continue;
      const nestedRoots = roots.logicalRoots.filter((root) =>
        keyOf(root) !== keyOf(enumeration.root)
        && isEqualOrParent(root, enumeration.root)
        && !queuedRoots.has(keyOf(root)));
      for (const fallbackRoot of rootsOf(nestedRoots).enumerationRoots) {
        queuedRoots.add(keyOf(fallbackRoot));
        pendingRoots.push(fallbackRoot);
      }
    }
  }
  return filesByRoot;
};

/** Empty-query candidates interleaved by working directory before the limit. */
const takeFairResults = (candidates: readonly FileCompletionCandidate[]): FileCompletionCandidate[] => {
  const buckets: FileCompletionCandidate[][] = [];
  for (const candidate of candidates) (buckets[candidate.ownerIndex] ??= []).push(candidate);
  const results: FileCompletionCandidate[] = [];
  for (let index = 0; results.length < MAX_RESULTS; index++) {
    let added = false;
    for (const bucket of buckets) {
      const candidate = bucket?.[index];
      if (candidate === undefined) continue;
      results.push(candidate);
      added = true;
      if (results.length === MAX_RESULTS) break;
    }
    if (!added) break;
  }
  return results;
};

/** Each owning directory's label: its name where unique, shortened where two share one. */
const ownerLabelsOf = (candidates: readonly FileCompletionCandidate[]): Map<string, string> => {
  const owners = new Map<string, string>();
  for (const candidate of candidates) owners.set(keyOf(candidate.owner), candidate.owner);
  const entries = [...owners.entries()];
  const ownerNameCounts = new Map<string, number>();
  for (const [, owner] of entries) {
    const ownerName = basename(owner);
    ownerNameCounts.set(ownerName, (ownerNameCounts.get(ownerName) ?? 0) + 1);
  }
  const shortenedOwnerPaths = shorten(entries.map(([, owner]) => owner.split(sep).join('/')), '/');
  return new Map(entries.map(([key, owner], index) => {
    const ownerName = basename(owner);
    const label = ownerName && ownerNameCounts.get(ownerName) === 1 ? ownerName : shortenedOwnerPaths[index] as string;
    return [key, label];
  }));
};

/** The file items for a token typed in a session working in `workingDirectories`. */
export const fileCompletions = async (
  workingDirectories: readonly string[],
  at: AtToken,
  workspaceFiles: WorkspaceFiles,
  log: (line: string, level?: LogLevel) => void,
): Promise<Bag[]> => {
  const roots = rootsOf(workingDirectories);
  if (roots.enumerationRoots.length === 0) return [];
  const filesByRoot = await enumerateRootFiles(roots, workspaceFiles, log);

  const query = prepareQuery(at.token);
  const candidates: FileCompletionCandidate[] = [];
  const candidateCountByOwner = new Array<number>(roots.logicalRoots.length).fill(0);
  const seen = new Set<string>();
  for (const files of filesByRoot) {
    for (const path of files) {
      const key = keyOf(path);
      if (seen.has(key)) continue;
      const owner = deepestOwner(path, roots.logicalRoots);
      const ownerIndex = owner === undefined ? -1 : roots.logicalRoots.indexOf(owner);
      if (owner === undefined || ownerIndex < 0 || (!query.normalized && (candidateCountByOwner[ownerIndex] ?? 0) >= MAX_RESULTS)) continue;
      seen.add(key);
      candidateCountByOwner[ownerIndex] = (candidateCountByOwner[ownerIndex] ?? 0) + 1;
      candidates.push({ path, owner, ownerIndex, relativePath: relative(owner, path).split(sep).join('/') });
    }
  }
  if (candidates.length === 0) return [];
  const cache: FuzzyScorerCache = Object.create(null) as FuzzyScorerCache;

  let results: FileCompletionCandidate[];
  if (!query.normalized) {
    results = takeFairResults(candidates);
  } else {
    // Filter out non-matches first to avoid sorting tens of thousands of zeros.
    const matching = candidates.filter((candidate) => scoreItemFuzzy(candidate, query, true, accessor, cache).score > 0);
    matching.sort((a, b) =>
      compareItemsByFuzzyScore(a, b, query, true, accessor, cache)
      || a.ownerIndex - b.ownerIndex
      || compare(a.relativePath, b.relativePath));
    results = matching.slice(0, MAX_RESULTS);
  }

  const duplicateNames = new Set<string>();
  const names = new Set<string>();
  for (const candidate of results) {
    const name = basename(candidate.path);
    if (names.has(name)) duplicateNames.add(name);
    else names.add(name);
  }
  const ownerLabels = ownerLabelsOf(results);

  return results.map((candidate) => {
    const name = basename(candidate.path);
    const ownerLabel = ownerLabels.get(keyOf(candidate.owner)) ?? candidate.owner;
    return {
      insertText: at.triggerChar + name,
      rangeStart: at.rangeStart,
      rangeEnd: at.rangeEnd,
      attachment: {
        type: 'resource',
        uri: uriOf(candidate.path),
        label: duplicateNames.has(name) ? `${ownerLabel} • ${candidate.relativePath}` : name,
        displayKind: 'document',
      },
    };
  });
};
