/**
 * Whether a newer release of this package is on npm.
 *
 * Three pieces, each on its own: a comparison, a file, and one request. The
 * daemon makes the request in the background and writes the file; whoever
 * prints a line reads the file and never waits on a network.
 *
 * `ahpc` carries a second copy of this, in its `src/update.ts`, because the
 * two share no package. A change here is a change to make there.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { ensureConfigDir, updatePath } from './config.js';

/** What the file holds: which package was asked, what npm said, and when. */
export interface Update {
  name: string;
  latest: string;
  checkedAt: string;
}

/** Six hours, the time a written answer is trusted before it is asked again. */
export const MAX_AGE_MS = 6 * 60 * 60 * 1000;

/** `X.Y.Z` with an optional prerelease tag; anything else is not a version here. */
const VERSION = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/;

/** The comparison's own reader, exported so `compat.ts` reuses it rather than writing a second one. */
export const parse = (text: string): { numbers: [number, number, number]; prerelease: boolean } | undefined => {
  const found = VERSION.exec(text);
  if (!found) return undefined;
  return {
    numbers: [Number(found[1]), Number(found[2]), Number(found[3])],
    prerelease: found[4] !== undefined,
  };
};

/**
 * Is `latest` ahead of `current`?
 *
 * Written rather than taken from `semver`, because one comparison does not
 * earn a dependency. A prerelease loses to its own release, so `0.5.0-beta.1`
 * is told about `0.5.0`. A local build ahead of the registry is not behind,
 * and neither is anything that does not parse - `version()` answers `unknown`
 * from a bundle, and a checkout is ahead of npm most days; a tool that says
 * so every start is a tool people switch off.
 */
export const newer = (latest: string, current: string): boolean => {
  const a = parse(latest);
  const b = parse(current);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) {
    if (a.numbers[i] !== b.numbers[i]) return (a.numbers[i] as number) > (b.numbers[i] as number);
  }
  return b.prerelease && !a.prerelease;
};

/**
 * The registry to ask, which is not always npmjs.org.
 *
 * `npm_config_registry` is what npm itself reads, so somebody behind a mirror
 * has already said where it is. Read before the default is assumed, so this
 * check does not quietly reach past the mirror.
 */
export const registry = (env: NodeJS.ProcessEnv = process.env): string => {
  const named = env.npm_config_registry;
  return named ? named.replace(/\/+$/, '') : 'https://registry.npmjs.org';
};

/** What the file says, or nothing: a missing, broken or misshapen file is the same answer. */
export function readUpdate(): Update | undefined {
  try {
    const found = JSON.parse(readFileSync(updatePath(), 'utf8')) as Partial<Update> | null;
    if (typeof found?.name !== 'string' || typeof found.latest !== 'string' || typeof found.checkedAt !== 'string') return undefined;
    return { name: found.name, latest: found.latest, checkedAt: found.checkedAt };
  }
  catch { return undefined; }
}

/** Is it time to ask again? No file, an unreadable date and an old one all say yes. */
export const stale = (found: Update | undefined, now = Date.now(), maxAgeMs = MAX_AGE_MS): boolean => {
  if (!found) return true;
  const at = Date.parse(found.checkedAt);
  return Number.isNaN(at) || now - at > maxAgeMs;
};

/**
 * Ask the registry, and write down what it said.
 *
 * `/-/package/<name>/dist-tags` is 18 bytes and is the whole question; the
 * packument answers the same thing in twenty kilobytes. Every failure is the
 * same silence: offline, a proxy that blackholes, a registry that is down, a
 * package not on npm yet, and a captive portal answering `200` with HTML all
 * leave the file as it was and throw nothing. There is nothing a person can
 * do about any of them from here, and this runs in the background of a
 * process that has better things to say.
 */
export async function refreshUpdate(options: { name: string; registry?: string; timeoutMs?: number }): Promise<void> {
  const at = `${options.registry ?? registry()}/-/package/${options.name}/dist-tags`;
  try {
    const answer = await fetch(at, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(options.timeoutMs ?? 5000),
    });
    if (!answer.ok) return;
    const said = await answer.json() as { latest?: unknown } | null;
    if (typeof said?.latest !== 'string') return;
    const record: Update = { name: options.name, latest: said.latest, checkedAt: new Date().toISOString() };
    ensureConfigDir();
    writeFileSync(updatePath(), `${JSON.stringify(record, null, 2)}\n`);
  }
  catch { /* nothing to report, by design */ }
}

/**
 * Whether to ask npm at all.
 *
 * Off by the flag or the file (`on`), or by either of two environment
 * variables: `NO_UPDATE_NOTIFIER` because it is the one every other update
 * check honours, and `CI` because a build machine is never the person who
 * would run `npm i -g`. Set to anything counts; an empty string is still
 * somebody having set it.
 */
export const checkingUpdates = (on: boolean, env: NodeJS.ProcessEnv = process.env): boolean =>
  on && env.NO_UPDATE_NOTIFIER === undefined && env.CI === undefined;

/**
 * The one line this is all for, with its newline, or nothing.
 *
 * Read from the file and never from the network, which is what lets `start`
 * and `status` print it and leave. Nothing is said when the file is absent,
 * names another package, or names a version this one is not behind.
 */
export const updateLine = (self: { name: string; version: string }): string | undefined => {
  const found = readUpdate();
  if (!found || found.name !== self.name || !newer(found.latest, self.version)) return undefined;
  return `update: ${self.name} ${found.latest} is on npm, this is ${self.version}\n`;
};
